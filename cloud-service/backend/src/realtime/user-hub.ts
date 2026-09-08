/// UserHub Durable Object：每用户一个实例（idFromName(userId)），承载该用户的所有客户端连接。
///
/// 职责（REALTIME.md §2）：好友在线状态广播、私聊转发、房间邀请转发、好友关系变更推送。
/// 使用 WebSocket Hibernation API：唤醒后所需的一切都在 storage（profile / friends）
/// 或 attachment（{ connId }）里；内存只缓存副本与限流状态。

import type { Env } from "../types";
import {
  CLOSE_NORMAL,
  CLOSE_TOO_LARGE,
  MAX_CID_LENGTH,
  MAX_ROOM_NAME_CHARS,
  RateLimiter,
  broadcast,
  decodeHeaderJSON,
  isRecord,
  isUUIDString,
  jsonError,
  jsonResponse,
  newConnId,
  normalizeRoomCode,
  notifyHub,
  parseFrame,
  queryOnline,
  readAttachment,
  readBody,
  safeClose,
  sanitizeName,
  sanitizeText,
  send,
  sendError,
  toBriefList,
  userFromHeaders,
  type Frame,
  type UserBrief,
} from "./common";

interface HubAttachment {
  connId: string;
}

const KEY_PROFILE = "profile";
const KEY_FRIENDS = "friends";

export class UserHub implements DurableObject {
  private profile?: UserBrief; // storage: profile
  private friends?: Set<string>; // storage: friends（string[]）
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

    // 内部端点只经 stub 调用（Worker 公共路由永远不会转发 /internal/* 路径）
    if (url.pathname.startsWith("/internal/")) {
      if (isUpgrade) return jsonError(400, "bad_request", "内部端点不接受 WebSocket 升级");
      try {
        return await this.handleInternal(url.pathname, request);
      } catch (err) {
        console.error("UserHub 内部端点异常:", err);
        return jsonError(500, "internal", "服务器内部错误");
      }
    }

    if (!isUpgrade) {
      return jsonError(426, "upgrade_required", "需要 WebSocket 升级");
    }
    return this.handleUpgrade(request);
  }

  private async handleInternal(pathname: string, request: Request): Promise<Response> {
    await this.ensureLoaded();

    if (pathname === "/internal/status" && request.method === "GET") {
      return jsonResponse({ online: this.hasConnections() });
    }

    if (pathname === "/internal/notify" && request.method === "POST") {
      const body = await readBody<unknown>(request);
      if (!isRecord(body) || typeof body["type"] !== "string") {
        return jsonError(400, "bad_message", "帧格式错误");
      }
      const frame: Frame = { ...body } as Frame;

      // friends.changed 附带 friend_ids 时用它替换好友集合缓存（不下发给客户端）
      if (frame.type === "friends.changed" && Array.isArray(frame["friend_ids"])) {
        const ids = (frame["friend_ids"] as unknown[]).filter(isUUIDString);
        this.friends = new Set(ids);
        await this.state.storage.put(KEY_FRIENDS, ids);
        delete frame["friend_ids"];
      }

      const sockets = this.state.getWebSockets();
      const delivered = sockets.length > 0;
      if (delivered) {
        broadcast(sockets, frame);
      }

      // 接受好友后互相同步在线状态：查询对方 DO 并推给本用户各连接
      if (frame.type === "friends.changed" && frame["reason"] === "accepted" && delivered) {
        const other = frame["user"];
        if (isRecord(other) && isUUIDString(other["id"])) {
          const otherId = other["id"];
          this.state.waitUntil(
            queryOnline(this.env, otherId)
              .then((online) => {
                broadcast(this.state.getWebSockets(), { type: "presence", user_id: otherId, online });
              })
              .catch((err) => console.error("同步好友在线状态失败:", err)),
          );
        }
      }
      return jsonResponse({ delivered });
    }

    if (pathname === "/internal/profile" && request.method === "POST") {
      const body = await readBody<unknown>(request);
      if (!isRecord(body)) return jsonError(400, "bad_message", "请求体格式错误");
      const current = this.profile ?? { id: this.userId(), username: null, avatar_url: null };
      this.profile = {
        id: current.id,
        username: typeof body["username"] === "string" && body["username"] !== "" ? body["username"] : null,
        avatar_url:
          typeof body["avatar_url"] === "string" && body["avatar_url"] !== "" ? body["avatar_url"] : null,
      };
      await this.state.storage.put(KEY_PROFILE, this.profile);
      return jsonResponse({ ok: true });
    }

    return jsonError(404, "not_found", "未知内部端点");
  }

  // ---------- WebSocket 升级 ----------

  private async handleUpgrade(request: Request): Promise<Response> {
    const user = userFromHeaders(request.headers);
    if (!user) {
      return jsonError(400, "bad_request", "缺少用户信息");
    }
    const friendBriefs = toBriefList(decodeHeaderJSON<unknown>(request.headers.get("x-friends")));

    await this.ensureLoaded();
    // 每次连接都以数据库中的最新资料 / 好友列表刷新缓存
    this.profile = user;
    this.friends = new Set(friendBriefs.map((f) => f.id));
    await this.state.storage.put({
      [KEY_PROFILE]: this.profile,
      [KEY_FRIENDS]: [...this.friends],
    });

    const firstConnection = !this.hasConnections();
    const pair = new WebSocketPair();
    const server = pair[1];
    const attachment: HubAttachment = { connId: newConnId() };
    server.serializeAttachment(attachment);
    this.state.acceptWebSocket(server, [attachment.connId]);

    // hub.ready 需要并行询问各好友 DO，异步完成，不阻塞 101 握手
    this.state.waitUntil(
      this.afterConnect(server, friendBriefs, firstConnection).catch((err) => {
        console.error("UserHub 连接初始化失败:", err);
        sendError(server, "internal", "初始化失败");
      }),
    );

    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  private async afterConnect(ws: WebSocket, friendBriefs: UserBrief[], firstConnection: boolean): Promise<void> {
    const tasks: Promise<unknown>[] = [];
    const statusTask = Promise.all(friendBriefs.map((f) => queryOnline(this.env, f.id)));
    tasks.push(statusTask);
    if (firstConnection) {
      tasks.push(this.broadcastPresence(true));
    }
    const online = await statusTask;
    send(ws, {
      type: "hub.ready",
      user: this.profile,
      friends: friendBriefs.map((f, i) => ({ ...f, online: online[i] === true })),
    });
    await Promise.allSettled(tasks);
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
      await this.ensureLoaded();
      const frame = parsed.frame;
      switch (frame.type) {
        case "ping":
          send(ws, { type: "pong" });
          return;
        case "dm.send":
          await this.handleDM(ws, frame);
          return;
        case "invite.send":
          await this.handleInvite(ws, frame);
          return;
        default:
          sendError(ws, "bad_type", "未知消息类型: " + frame.type);
      }
    } catch (err) {
      console.error("UserHub 处理消息异常:", err);
      sendError(ws, "internal", "服务器内部错误");
    }
  }

  private async handleDM(ws: WebSocket, frame: Frame): Promise<void> {
    const to = frame["to"];
    if (!isUUIDString(to)) {
      return sendError(ws, "bad_message", "缺少或非法的 to");
    }
    const cid = frame["cid"];
    if (typeof cid !== "string" || cid.length === 0 || cid.length > MAX_CID_LENGTH) {
      return sendError(ws, "bad_message", "缺少或非法的 cid（≤ 64 字符）");
    }
    const text = sanitizeText(frame["text"]);
    if (text === null) {
      return sendError(ws, "bad_message", "text 需为 1~2000 个字符");
    }
    if (!this.friends!.has(to)) {
      return sendError(ws, "not_friend", "对方不是你的好友");
    }
    if (!this.limiter.allow(this.connIdOf(ws))) {
      return sendError(ws, "rate_limited", "发送过快，请稍后再试");
    }

    const ts = Date.now();
    const delivered = await notifyHub(this.env, to, { type: "dm", from: this.profile, text, ts });

    const sockets = this.state.getWebSockets();
    broadcast(sockets, { type: "dm.ack", cid, to, delivered, ts });
    // 多端同步：让发送方的其他设备也看到自己发出的消息
    broadcast(sockets, { type: "dm.echo", to, text, ts, cid }, ws);
  }

  private async handleInvite(ws: WebSocket, frame: Frame): Promise<void> {
    const to = frame["to"];
    if (!isUUIDString(to)) {
      return sendError(ws, "bad_message", "缺少或非法的 to");
    }
    const room = frame["room"];
    if (!isRecord(room)) {
      return sendError(ws, "bad_message", "缺少 room 字段");
    }
    const code = normalizeRoomCode(room["code"]);
    if (!code) {
      return sendError(ws, "bad_message", "房间号格式不正确");
    }
    const name = sanitizeName(room["name"], MAX_ROOM_NAME_CHARS) ?? code;
    if (!this.friends!.has(to)) {
      return sendError(ws, "not_friend", "对方不是你的好友");
    }
    if (!this.limiter.allow(this.connIdOf(ws))) {
      return sendError(ws, "rate_limited", "发送过快，请稍后再试");
    }

    const ts = Date.now();
    const delivered = await notifyHub(this.env, to, {
      type: "invite",
      from: this.profile,
      room: { code, name },
      ts,
    });
    send(ws, { type: "invite.ack", to, delivered });
  }

  // ---------- 断开 ----------

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    await this.handleDisconnect(ws, code, reason);
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error("UserHub WebSocket 错误:", error);
    await this.handleDisconnect(ws, CLOSE_NORMAL, "error");
  }

  private async handleDisconnect(ws: WebSocket, _code: number, reason: string): Promise<void> {
    try {
      this.limiter.forget(this.connIdOf(ws));
      // 完成关闭握手（对端已发 close 帧时需要服务端回应）
      safeClose(ws, CLOSE_NORMAL, reason || "closed");
      const remaining = this.state.getWebSockets().filter((s) => s !== ws);
      if (remaining.length === 0) {
        await this.ensureLoaded();
        await this.broadcastPresence(false);
      }
    } catch (err) {
      console.error("UserHub 处理断开异常:", err);
    }
  }

  // ---------- 内部 ----------

  /** 向所有好友 DO 推送本用户的在线状态（并行，失败只记日志）。 */
  private async broadcastPresence(online: boolean): Promise<void> {
    const userId = this.userId();
    const friends = this.friends ? [...this.friends] : [];
    await Promise.allSettled(
      friends.map((fid) => notifyHub(this.env, fid, { type: "presence", user_id: userId, online })),
    );
  }

  private hasConnections(): boolean {
    return this.state.getWebSockets().length > 0;
  }

  private connIdOf(ws: WebSocket): string {
    return readAttachment<HubAttachment>(ws)?.connId ?? "unknown";
  }

  /** 本 DO 一律以 idFromName(userId) 创建，因此 id.name 即用户 ID。 */
  private userId(): string {
    return this.profile?.id ?? this.state.id.name ?? "";
  }

  private ensureLoaded(): Promise<void> {
    if (!this.loaded) {
      this.loaded = (async () => {
        const stored = await this.state.storage.get<unknown>([KEY_PROFILE, KEY_FRIENDS]);
        const profile = stored.get(KEY_PROFILE) as UserBrief | undefined;
        const friends = stored.get(KEY_FRIENDS) as string[] | undefined;
        this.profile = profile ?? { id: this.state.id.name ?? "", username: null, avatar_url: null };
        this.friends = new Set(Array.isArray(friends) ? friends.filter(isUUIDString) : []);
      })().catch((err) => {
        this.loaded = undefined;
        throw err;
      });
    }
    return this.loaded;
  }
}
