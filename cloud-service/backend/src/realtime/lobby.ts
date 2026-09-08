/// Lobby Durable Object：全局唯一（idFromName("global")）。
///
/// 职责（REALTIME.md §3）：房间目录、大厅聊天、大厅在线成员。
/// storage 只保存 `rooms`（Record<code, RoomSummary>）；attachment 保存 UserBrief；
/// 连接 ID 放在 tag（`conn:<id>`）里供限流使用。

import type { Env } from "../types";
import {
  CLOSE_NORMAL,
  CLOSE_TOO_LARGE,
  MAX_ROOM_MAX,
  MAX_ROOM_NAME_CHARS,
  MAX_ROOM_PASSWORD_CHARS,
  MIN_ROOM_MAX,
  RateLimiter,
  broadcast,
  internalPost,
  isRecord,
  jsonError,
  jsonResponse,
  newConnId,
  normalizeRoomCode,
  parseFrame,
  randomRoomCode,
  readAttachment,
  readBody,
  safeClose,
  sanitizeName,
  sanitizeText,
  send,
  sendError,
  toBrief,
  userFromHeaders,
  type Frame,
  type RoomSummary,
  type UserBrief,
} from "./common";

const KEY_ROOMS = "rooms";
const CONN_TAG_PREFIX = "conn:";
/** 生成唯一房间号的最大尝试次数 */
const MAX_CODE_ATTEMPTS = 8;

export class Lobby implements DurableObject {
  private rooms?: Record<string, RoomSummary>; // storage: rooms
  private loaded?: Promise<void>;
  private readonly limiter = new RateLimiter();

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  // ---------- HTTP 入口 ----------

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const isUpgrade = request.headers.get("Upgrade")?.toLowerCase() === "websocket";

    if (url.pathname.startsWith("/internal/")) {
      if (isUpgrade) return jsonError(400, "bad_request", "内部端点不接受 WebSocket 升级");
      try {
        return await this.handleInternal(url.pathname, request);
      } catch (err) {
        console.error("Lobby 内部端点异常:", err);
        return jsonError(500, "internal", "服务器内部错误");
      }
    }

    if (!isUpgrade) {
      return jsonError(426, "upgrade_required", "需要 WebSocket 升级");
    }
    return this.handleUpgrade(request);
  }

  private async handleInternal(pathname: string, request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return jsonError(405, "method_not_allowed", "仅支持 POST");
    }
    await this.ensureLoaded();
    const rooms = this.rooms!;

    if (pathname === "/internal/room-update") {
      const summary = toRoomSummary(await readBody<unknown>(request));
      if (!summary) return jsonError(400, "bad_message", "RoomSummary 格式错误");
      rooms[summary.code] = summary;
      await this.persist();
      this.broadcastRooms();
      return jsonResponse({ ok: true });
    }

    if (pathname === "/internal/room-remove") {
      const body = await readBody<unknown>(request);
      const code = isRecord(body) ? normalizeRoomCode(body["code"]) : null;
      if (!code) return jsonError(400, "bad_message", "房间号格式不正确");
      const existed = code in rooms;
      if (existed) {
        delete rooms[code];
        await this.persist();
        this.broadcastRooms();
      }
      return jsonResponse({ ok: true, removed: existed });
    }

    if (pathname === "/internal/room-exists") {
      const body = await readBody<unknown>(request);
      const code = isRecord(body) ? normalizeRoomCode(body["code"]) : null;
      if (!code) return jsonError(400, "bad_message", "房间号格式不正确");
      return jsonResponse({ exists: code in rooms });
    }

    return jsonError(404, "not_found", "未知内部端点");
  }

  // ---------- WebSocket 升级 ----------

  private async handleUpgrade(request: Request): Promise<Response> {
    const user = userFromHeaders(request.headers);
    if (!user) {
      return jsonError(400, "bad_request", "缺少用户信息");
    }
    await this.ensureLoaded();

    const alreadyPresent = this.state.getWebSockets(user.id).length > 0;
    const pair = new WebSocketPair();
    const server = pair[1];
    server.serializeAttachment(user);
    this.state.acceptWebSocket(server, [user.id, CONN_TAG_PREFIX + newConnId()]);

    send(server, {
      type: "lobby.ready",
      user,
      rooms: this.roomList(),
      members: this.members(),
    });
    // 同一用户首个连接才算“进入大厅”，多端重复进入不重复广播
    if (!alreadyPresent) {
      broadcast(this.state.getWebSockets(), { type: "lobby.members", members: this.members() }, server);
    }
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  // ---------- 消息 ----------

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      const parsed = parseFrame(message);
      if (!parsed.ok) {
        if (parsed.code === "too_large") {
          safeClose(ws, CLOSE_TOO_LARGE, "message too large");
        } else {
          sendError(ws, parsed.code, parsed.message);
        }
        return;
      }
      const user = readAttachment<UserBrief>(ws);
      if (!user) {
        sendError(ws, "unauthorized", "连接状态丢失");
        safeClose(ws, CLOSE_NORMAL, "no attachment");
        return;
      }
      await this.ensureLoaded();
      const frame = parsed.frame;
      switch (frame.type) {
        case "ping":
          send(ws, { type: "pong" });
          return;
        case "lobby.chat":
          this.handleChat(ws, user, frame);
          return;
        case "room.create":
          await this.handleCreate(ws, user, frame);
          return;
        default:
          sendError(ws, "bad_type", "未知消息类型: " + frame.type);
      }
    } catch (err) {
      console.error("Lobby 处理消息异常:", err);
      sendError(ws, "internal", "服务器内部错误");
    }
  }

  private handleChat(ws: WebSocket, user: UserBrief, frame: Frame): void {
    const text = sanitizeText(frame["text"]);
    if (text === null) {
      return sendError(ws, "bad_message", "text 需为 1~2000 个字符");
    }
    if (!this.limiter.allow(this.connIdOf(ws))) {
      return sendError(ws, "rate_limited", "发送过快，请稍后再试");
    }
    broadcast(this.state.getWebSockets(), { type: "lobby.chat", from: user, text, ts: Date.now() });
  }

  private async handleCreate(ws: WebSocket, user: UserBrief, frame: Frame): Promise<void> {
    const name = sanitizeName(frame["name"], MAX_ROOM_NAME_CHARS);
    if (name === null) {
      return sendError(ws, "bad_message", "房间名需为 1~32 个字符");
    }
    const max = frame["max"];
    if (typeof max !== "number" || !Number.isInteger(max) || max < MIN_ROOM_MAX || max > MAX_ROOM_MAX) {
      return sendError(ws, "bad_message", "max 需为 2~8 的整数");
    }
    const rawPassword = frame["password"];
    let password = "";
    if (rawPassword !== undefined && rawPassword !== null) {
      if (typeof rawPassword !== "string" || Array.from(rawPassword).length > MAX_ROOM_PASSWORD_CHARS) {
        return sendError(ws, "bad_message", "密码需为 0~32 个字符");
      }
      password = rawPassword;
    }
    if (!this.limiter.allow(this.connIdOf(ws))) {
      return sendError(ws, "rate_limited", "操作过快，请稍后再试");
    }

    const rooms = this.rooms!;
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      const code = randomRoomCode();
      if (code in rooms) continue;

      let res: Response;
      try {
        res = await internalPost(this.env.GAME_ROOM, code, "/internal/init", {
          code,
          name,
          max,
          password,
          host: user,
        });
      } catch (err) {
        console.error("初始化 GameRoom 失败:", err);
        return sendError(ws, "internal", "创建房间失败");
      }
      if (res.status === 409) continue; // 房间号撞车（DO 里已有活动房间），换一个
      if (!res.ok) {
        console.error(`初始化 GameRoom 失败: HTTP ${res.status}`);
        return sendError(ws, "internal", "创建房间失败");
      }
      const init = (await res.json().catch(() => null)) as { created_at?: number } | null;

      const summary: RoomSummary = {
        code,
        name,
        host: user,
        count: 0,
        max,
        locked: password !== "",
        created_at: typeof init?.created_at === "number" ? init.created_at : Date.now(),
      };
      rooms[code] = summary;
      await this.persist();
      send(ws, { type: "room.created", room: summary });
      this.broadcastRooms();
      return;
    }
    sendError(ws, "internal", "房间号分配失败，请重试");
  }

  // ---------- 断开 ----------

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    await this.handleDisconnect(ws, reason);
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error("Lobby WebSocket 错误:", error);
    await this.handleDisconnect(ws, "error");
  }

  private async handleDisconnect(ws: WebSocket, reason: string): Promise<void> {
    try {
      this.limiter.forget(this.connIdOf(ws));
      safeClose(ws, CLOSE_NORMAL, reason || "closed");
      const user = readAttachment<UserBrief>(ws);
      if (!user) return;
      const stillPresent = this.state.getWebSockets(user.id).some((s) => s !== ws);
      if (!stillPresent) {
        const others = this.state.getWebSockets().filter((s) => s !== ws);
        broadcast(others, { type: "lobby.members", members: this.members(ws) });
      }
    } catch (err) {
      console.error("Lobby 处理断开异常:", err);
    }
  }

  // ---------- 内部 ----------

  private roomList(): RoomSummary[] {
    return Object.values(this.rooms ?? {}).sort((a, b) => a.created_at - b.created_at);
  }

  private broadcastRooms(): void {
    broadcast(this.state.getWebSockets(), { type: "lobby.rooms", rooms: this.roomList() });
  }

  /** 当前大厅在线用户（按用户 ID 去重，可排除某条正在关闭的连接）。 */
  private members(except?: WebSocket): UserBrief[] {
    const seen = new Map<string, UserBrief>();
    for (const s of this.state.getWebSockets()) {
      if (s === except) continue;
      const user = readAttachment<UserBrief>(s);
      if (user && !seen.has(user.id)) seen.set(user.id, user);
    }
    return [...seen.values()];
  }

  private connIdOf(ws: WebSocket): string {
    try {
      const tag = this.state.getTags(ws).find((t) => t.startsWith(CONN_TAG_PREFIX));
      return tag ?? "unknown";
    } catch {
      return "unknown";
    }
  }

  private ensureLoaded(): Promise<void> {
    if (!this.loaded) {
      this.loaded = (async () => {
        const stored = await this.state.storage.get<Record<string, RoomSummary>>(KEY_ROOMS);
        this.rooms = stored ?? {};
      })().catch((err) => {
        this.loaded = undefined;
        throw err;
      });
    }
    return this.loaded;
  }

  private async persist(): Promise<void> {
    await this.state.storage.put(KEY_ROOMS, this.rooms ?? {});
  }
}

/** 校验并规范化 RoomSummary（来自 GameRoom 的内部调用）。 */
function toRoomSummary(raw: unknown): RoomSummary | null {
  if (!isRecord(raw)) return null;
  const code = normalizeRoomCode(raw["code"]);
  const host = toBrief(raw["host"]);
  const name = typeof raw["name"] === "string" ? raw["name"] : null;
  const count = raw["count"];
  const max = raw["max"];
  const createdAt = raw["created_at"];
  if (!code || !host || name === null) return null;
  if (typeof count !== "number" || typeof max !== "number" || typeof createdAt !== "number") return null;
  return {
    code,
    name,
    host,
    count,
    max,
    locked: raw["locked"] === true,
    created_at: createdAt,
  };
}
