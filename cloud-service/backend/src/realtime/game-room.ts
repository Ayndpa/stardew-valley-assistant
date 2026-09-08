/// GameRoom Durable Object：每房间一个实例（idFromName(code)）。
///
/// 职责（REALTIME.md §4）：成员列表、房间聊天、成员间 signal 定向转发（P2P ICE 握手）。
/// storage 只保存 `meta` 与 `members`；attachment 保存 { userId }；
/// 连接按用户 ID 打 tag（用于定向转发与顶替旧连接），另有 `conn:<id>` tag 供限流使用。
/// 聊天与信令内容只在内存经手，永不落库。

import type { Env } from "../types";
import {
  CLOSE_NORMAL,
  CLOSE_REPLACED,
  CLOSE_TOO_LARGE,
  MAX_ROOM_MAX,
  MAX_ROOM_NAME_CHARS,
  MAX_ROOM_PASSWORD_CHARS,
  MAX_SIGNAL_BYTES,
  MIN_ROOM_MAX,
  ROOM_HOST_JOIN_TIMEOUT_MS,
  RateLimiter,
  broadcast,
  decodeHeaderText,
  isRecord,
  isUUIDString,
  jsonError,
  jsonResponse,
  newConnId,
  normalizeRoomCode,
  notifyLobby,
  parseFrame,
  readAttachment,
  readBody,
  safeClose,
  sanitizeName,
  sanitizeText,
  send,
  sendError,
  toBrief,
  userFromHeaders,
  utf8ByteLength,
  type Frame,
  type RoomSummary,
  type UserBrief,
} from "./common";

interface RoomMeta {
  code: string;
  name: string;
  max: number;
  password: string;
  host_id: string;
  created_at: number;
  /** 房主摘要（房主尚未加入时目录仍需展示；转移房主时同步更新） */
  host: UserBrief;
}

interface RoomMember extends UserBrief {
  joined_at: number;
  /** 虚拟局域网 IP（REALTIME.md §7）：房间内唯一，成员离开后回收 */
  vip: string;
}

const VLAN_PREFIX = "10.77.0.";
const VLAN_MIN_HOST = 1;
const VLAN_MAX_HOST = 254;

interface RoomAttachment {
  userId: string;
}

type LeaveReason = "leave" | "kicked" | "disconnect";
type CloseReason = "host_closed" | "empty" | "expired";

const KEY_META = "meta";
const KEY_MEMBERS = "members";
const CONN_TAG_PREFIX = "conn:";

export class GameRoom implements DurableObject {
  private meta: RoomMeta | null = null; // storage: meta
  private members: Record<string, RoomMember> = {}; // storage: members
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
        console.error("GameRoom 内部端点异常:", err);
        return jsonError(500, "internal", "服务器内部错误");
      }
    }

    if (!isUpgrade) {
      return jsonError(426, "upgrade_required", "需要 WebSocket 升级");
    }
    try {
      return await this.handleUpgrade(request);
    } catch (err) {
      console.error("GameRoom 升级异常:", err);
      return jsonError(500, "internal", "服务器内部错误");
    }
  }

  private async handleInternal(pathname: string, request: Request): Promise<Response> {
    if (pathname === "/internal/init" && request.method === "POST") {
      const body = await readBody<unknown>(request);
      if (!isRecord(body)) return jsonError(400, "bad_message", "请求体格式错误");
      const code = normalizeRoomCode(body["code"]);
      const name = sanitizeName(body["name"], MAX_ROOM_NAME_CHARS);
      const max = body["max"];
      const password = body["password"] == null ? "" : body["password"];
      const host = toBrief(body["host"]);
      if (!code || name === null || !host) {
        return jsonError(400, "bad_message", "缺少 code / name / host");
      }
      if (typeof max !== "number" || !Number.isInteger(max) || max < MIN_ROOM_MAX || max > MAX_ROOM_MAX) {
        return jsonError(400, "bad_message", "max 需为 2~8 的整数");
      }
      if (typeof password !== "string" || Array.from(password).length > MAX_ROOM_PASSWORD_CHARS) {
        return jsonError(400, "bad_message", "密码需为 0~32 个字符");
      }
      if (code !== (this.state.id.name ?? code)) {
        return jsonError(400, "bad_message", "房间号与 DO 不匹配");
      }

      await this.ensureLoaded();
      if (this.meta) {
        return jsonError(409, "room_exists", "房间号已被占用");
      }
      const createdAt = Date.now();
      this.meta = { code, name, max, password, host_id: host.id, created_at: createdAt, host };
      this.members = {};
      await this.persist();
      // 创建者 60 秒内未加入则自动删除
      await this.state.storage.setAlarm(createdAt + ROOM_HOST_JOIN_TIMEOUT_MS);
      return jsonResponse({ ok: true, created_at: createdAt });
    }

    return jsonError(404, "not_found", "未知内部端点");
  }

  // ---------- WebSocket 升级（REALTIME.md §4.1） ----------

  private async handleUpgrade(request: Request): Promise<Response> {
    const user = userFromHeaders(request.headers);
    if (!user) {
      return jsonError(400, "bad_request", "缺少用户信息");
    }
    const password = decodeHeaderText(request.headers.get("x-room-password")) ?? "";

    await this.ensureLoaded();
    const meta = this.meta;
    if (!meta) {
      return jsonError(404, "room_not_found", "房间不存在或已关闭");
    }
    if (meta.password !== "" && password !== meta.password) {
      return jsonError(403, "bad_password", "房间密码错误");
    }
    const existing = this.members[user.id];
    if (!existing && Object.keys(this.members).length >= meta.max) {
      return jsonError(409, "room_full", "房间已满");
    }

    // 同一用户重复连接：新连接顶替旧连接
    for (const old of this.state.getWebSockets(user.id)) {
      sendError(old, "replaced", "已在其他地方连接到此房间");
      safeClose(old, CLOSE_REPLACED, "replaced");
    }

    const pair = new WebSocketPair();
    const server = pair[1];
    const attachment: RoomAttachment = { userId: user.id };
    server.serializeAttachment(attachment);
    this.state.acceptWebSocket(server, [user.id, CONN_TAG_PREFIX + newConnId()]);

    let memberCountChanged = false;
    if (existing) {
      // 重连：刷新资料，保留原虚拟 IP
      this.members[user.id] = {
        ...existing,
        username: user.username,
        avatar_url: user.avatar_url,
        vip: existing.vip ?? this.allocateVip(),
      };
    } else {
      this.members[user.id] = { ...user, joined_at: Date.now(), vip: this.allocateVip() };
      memberCountChanged = true;
    }
    if (user.id === meta.host_id) {
      meta.host = user;
      await this.state.storage.deleteAlarm();
    }
    await this.persist();

    send(server, { type: "room.ready", room: this.roomInfo(), members: this.memberList(), you: user.id });

    if (memberCountChanged) {
      const others = this.state.getWebSockets().filter((s) => s !== server);
      broadcast(others, { type: "room.joined", user });
      broadcast(others, { type: "room.members", room: this.roomInfo(), members: this.memberList() });
      // 目录更新不阻塞 101 握手
      this.state.waitUntil(notifyLobby(this.env, "/internal/room-update", this.summary()));
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
      const userId = readAttachment<RoomAttachment>(ws)?.userId;
      if (!userId) {
        sendError(ws, "unauthorized", "连接状态丢失");
        safeClose(ws, CLOSE_NORMAL, "no attachment");
        return;
      }
      await this.ensureLoaded();
      const frame = parsed.frame;
      if (frame.type === "ping") {
        send(ws, { type: "pong" });
        return;
      }
      const me = this.meta ? this.members[userId] : undefined;
      if (!this.meta || !me) {
        sendError(ws, "room_not_found", "房间不存在或你已不在房内");
        safeClose(ws, CLOSE_NORMAL, "not in room");
        return;
      }
      switch (frame.type) {
        case "room.chat":
          this.handleChat(ws, me, frame);
          return;
        case "room.signal":
          this.handleSignal(ws, userId, frame);
          return;
        case "room.kick":
          await this.handleKick(ws, userId, frame);
          return;
        case "room.close":
          if (userId !== this.meta.host_id) {
            return sendError(ws, "forbidden", "只有房主可以关闭房间");
          }
          await this.closeRoom("host_closed");
          return;
        case "room.leave":
          await this.leaveMember(userId, "leave", true);
          return;
        default:
          sendError(ws, "bad_type", "未知消息类型: " + frame.type);
      }
    } catch (err) {
      console.error("GameRoom 处理消息异常:", err);
      sendError(ws, "internal", "服务器内部错误");
    }
  }

  private handleChat(ws: WebSocket, me: RoomMember, frame: Frame): void {
    const text = sanitizeText(frame["text"]);
    if (text === null) {
      return sendError(ws, "bad_message", "text 需为 1~2000 个字符");
    }
    if (!this.limiter.allow(this.connIdOf(ws))) {
      return sendError(ws, "rate_limited", "发送过快，请稍后再试");
    }
    const from: UserBrief = { id: me.id, username: me.username, avatar_url: me.avatar_url };
    broadcast(this.state.getWebSockets(), { type: "room.chat", from, text, ts: Date.now() });
  }

  private handleSignal(ws: WebSocket, userId: string, frame: Frame): void {
    const to = frame["to"];
    if (!isUUIDString(to) || !this.members[to]) {
      return sendError(ws, "bad_message", "to 必须是房内成员");
    }
    if (!("data" in frame) || frame["data"] === undefined) {
      return sendError(ws, "bad_message", "缺少 data 字段");
    }
    const data = frame["data"];
    let serialized: string;
    try {
      serialized = JSON.stringify(data) ?? "null";
    } catch {
      return sendError(ws, "bad_message", "data 无法序列化");
    }
    if (utf8ByteLength(serialized) > MAX_SIGNAL_BYTES) {
      return sendError(ws, "too_large", "signal.data 超过 32KB 上限");
    }
    // 服务端不解析 data，原样定向转发给目标用户的所有连接
    broadcast(this.state.getWebSockets(to), { type: "room.signal", from: userId, data });
  }

  private async handleKick(ws: WebSocket, userId: string, frame: Frame): Promise<void> {
    if (userId !== this.meta!.host_id) {
      return sendError(ws, "forbidden", "只有房主可以踢人");
    }
    const target = frame["user_id"];
    if (!isUUIDString(target) || !this.members[target]) {
      return sendError(ws, "bad_message", "user_id 必须是房内成员");
    }
    if (target === userId) {
      return sendError(ws, "bad_message", "不能踢出自己");
    }
    await this.leaveMember(target, "kicked", true);
  }

  // ---------- 断开 / 定时器 ----------

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    await this.handleDisconnect(ws, reason);
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error("GameRoom WebSocket 错误:", error);
    await this.handleDisconnect(ws, "error");
  }

  private async handleDisconnect(ws: WebSocket, reason: string): Promise<void> {
    try {
      this.limiter.forget(this.connIdOf(ws));
      safeClose(ws, CLOSE_NORMAL, reason || "closed");
      const userId = readAttachment<RoomAttachment>(ws)?.userId;
      if (!userId) return;
      // 被新连接顶替的旧连接：该用户仍有其他连接，不算离开
      if (this.state.getWebSockets(userId).some((s) => s !== ws)) return;
      await this.ensureLoaded();
      if (!this.meta || !this.members[userId]) return;
      await this.leaveMember(userId, "disconnect", false);
    } catch (err) {
      console.error("GameRoom 处理断开异常:", err);
    }
  }

  /** 创建者 60 秒内未加入 → 房间过期删除。 */
  async alarm(): Promise<void> {
    try {
      await this.ensureLoaded();
      if (!this.meta) return;
      if (this.members[this.meta.host_id]) return; // 房主已加入（正常情况下 alarm 已被取消）
      await this.closeRoom("expired");
    } catch (err) {
      console.error("GameRoom alarm 异常:", err);
    }
  }

  // ---------- 房间状态变更 ----------

  /**
   * 成员离开（主动 / 被踢 / 掉线）：
   * 房主离开则转移给 joined_at 最早的剩余成员；最后一人离开则删除房间。
   */
  private async leaveMember(userId: string, reason: LeaveReason, closeSockets: boolean): Promise<void> {
    const meta = this.meta;
    const member = this.members[userId];
    if (!meta || !member) return;

    delete this.members[userId];
    const remaining = Object.values(this.members);
    const user: UserBrief = { id: member.id, username: member.username, avatar_url: member.avatar_url };
    const leavingSockets = this.state.getWebSockets(userId);

    if (remaining.length === 0) {
      // 最后一人离开：清空 storage，并从大厅目录移除
      if (closeSockets) {
        for (const s of leavingSockets) safeClose(s, CLOSE_NORMAL, reason);
      }
      await this.destroy();
      return;
    }

    if (meta.host_id === userId) {
      const next = remaining.reduce((a, b) => (b.joined_at < a.joined_at ? b : a));
      meta.host_id = next.id;
      meta.host = { id: next.id, username: next.username, avatar_url: next.avatar_url };
    }
    await this.persist();

    // room.left 面向所有人（含离开者自己），随后才关闭离开者的连接
    broadcast(this.state.getWebSockets(), { type: "room.left", user, reason });
    if (closeSockets) {
      for (const s of leavingSockets) safeClose(s, CLOSE_NORMAL, reason);
    }
    const others = this.state.getWebSockets().filter((s) => !leavingSockets.includes(s));
    broadcast(others, { type: "room.members", room: this.roomInfo(), members: this.memberList() });
    await notifyLobby(this.env, "/internal/room-update", this.summary());
  }

  /** 关闭房间：通知所有人后以 1000 关闭连接，清空 storage 并从大厅目录移除。 */
  private async closeRoom(reason: CloseReason): Promise<void> {
    const sockets = this.state.getWebSockets();
    broadcast(sockets, { type: "room.closed", reason });
    for (const s of sockets) safeClose(s, CLOSE_NORMAL, reason);
    await this.destroy();
  }

  private async destroy(): Promise<void> {
    const code = this.meta?.code ?? this.state.id.name ?? "";
    this.meta = null;
    this.members = {};
    await this.state.storage.deleteAlarm();
    await this.state.storage.deleteAll();
    if (code) {
      await notifyLobby(this.env, "/internal/room-remove", { code });
    }
  }

  // ---------- 视图 ----------

  private roomInfo(): { code: string; name: string; host_id: string; max: number; locked: boolean } {
    const m = this.meta!;
    return { code: m.code, name: m.name, host_id: m.host_id, max: m.max, locked: m.password !== "" };
  }

  private memberList(): RoomMember[] {
    return Object.values(this.members).sort((a, b) => a.joined_at - b.joined_at);
  }

  /** 分配房间内未被占用的最小虚拟 IP（10.77.0.1 ~ 10.77.0.254）。 */
  private allocateVip(): string {
    const used = new Set(Object.values(this.members).map((m) => m.vip));
    for (let host = VLAN_MIN_HOST; host <= VLAN_MAX_HOST; host++) {
      const vip = VLAN_PREFIX + host;
      if (!used.has(vip)) return vip;
    }
    throw new Error("虚拟 IP 已耗尽");
  }

  private summary(): RoomSummary {
    const m = this.meta!;
    return {
      code: m.code,
      name: m.name,
      host: m.host,
      count: Object.keys(this.members).length,
      max: m.max,
      locked: m.password !== "",
      created_at: m.created_at,
    };
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
        const stored = await this.state.storage.get<unknown>([KEY_META, KEY_MEMBERS]);
        const meta = stored.get(KEY_META) as RoomMeta | undefined;
        const members = stored.get(KEY_MEMBERS) as Record<string, RoomMember> | undefined;
        this.meta = meta ?? null;
        this.members = members ?? {};
      })().catch((err) => {
        this.loaded = undefined;
        throw err;
      });
    }
    return this.loaded;
  }

  private async persist(): Promise<void> {
    await this.state.storage.put({ [KEY_META]: this.meta, [KEY_MEMBERS]: this.members });
  }
}
