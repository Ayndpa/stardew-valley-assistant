/// Room Durable Object：一个房间一个实例，最多两条 WebSocket（先到 offer，后到 answer）。
///
/// 使用 Hibernation WebSocket API：实例空闲时会被平台卸载而连接保持，
/// 来消息时唤醒。房间状态（成员/缓冲信号）很小，持久化在 DO storage，
/// 唤醒后按需恢复。除房间号来自 URL 而非 hello 外，线上协议与 Go 版逐字对齐。

import type { Env } from "./index";

const ROLE_OFFER = "offer";
const ROLE_ANSWER = "answer";
type Slot = "offer" | "answer";
const OTHER: Record<Slot, Slot> = { offer: "answer", answer: "offer" };

// 与 Go 版相同的资源上限
const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_SIGNAL_BYTES = 32 * 1024;
const MAX_PENDING = 8;
const MAX_NAME_RUNES = 32;

interface PeerInfo {
  name: string;
}

interface RoomState {
  /** 已完成 hello 的成员（present 即代表对端已就位） */
  slots: { offer?: PeerInfo; answer?: PeerInfo };
  /** 升级时预占、尚待 hello 的槽位，防止并发升级抢占同一槽 */
  reserved: { offer?: boolean; answer?: boolean };
  /** 对端未就位时缓冲的 signal 信封（JSON 字符串），对方 hello 后按序补发 */
  pending: string[];
}

const MESSAGE_LIMIT_CLOSE = 1009;

export class Room {
  private room?: RoomState; // 内存缓存；hibernation 唤醒后从 storage 恢复
  private loaded?: Promise<void>;

  constructor(
    private doState: DurableObjectState,
    private env: Env
  ) {}

  // ---------- 生命周期入口 ----------

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("expected websocket upgrade", { status: 426 });
    }
    const room = new URL(request.url).searchParams.get("room") ?? "";
    await this.ensureLoaded();
    const st = this.room!;
    const pair = new WebSocketPair();

    let slot: Slot;
    if (!st.reserved.offer) {
      slot = ROLE_OFFER;
    } else if (!st.reserved.answer) {
      slot = ROLE_ANSWER;
    } else {
      // 房间已满：与 Go 版一致，先接受再下发错误信封并关闭
      pair[1].accept();
      pair[1].send(
        JSON.stringify({ type: "error", code: "room_full", message: `房间 ${room} 已满（仅支持两端配对）` })
      );
      pair[1].close(1008, "room full");
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    // 预占槽位（input gate 保证 load→check→persist 之间不会插入并发升级）
    st.reserved[slot] = true;
    await this.persist();

    this.doState.acceptWebSocket(pair[1], [slot]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  // 首条消息必须是 hello（与 Go 版一致）：校验 token、登记名字、
  // 下发 welcome、补发缓冲信号、通知对端
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") {
      return this.reject(ws, "bad_message", "仅支持文本消息");
    }
    if (message.length > MAX_MESSAGE_BYTES) {
      ws.close(MESSAGE_LIMIT_CLOSE, "message too large");
      return;
    }

    let m: Envelope;
    try {
      m = JSON.parse(message) as Envelope;
    } catch {
      return this.sendTo(ws, { type: "error", code: "bad_message", message: "JSON 解析失败" });
    }

    const slot = this.slotOf(ws);
    if (!slot) {
      return;
    }
    await this.ensureLoaded();
    const st = this.room!;

    // hello：入房登记
    if (!st.slots[slot]) {
      if (m.type !== "hello") {
        this.reject(ws, "bad_message", "首条消息必须是 hello");
        return;
      }
      const token = this.env.SIGNALING_TOKEN;
      if (token && m.token !== token) {
        this.reject(ws, "unauthorized", "token 不正确");
        return;
      }
      st.slots[slot] = { name: sanitizeName(m.name ?? "") };
      await this.persist();

      const otherSlot = st.slots[OTHER[slot]];
      this.sendTo(ws, {
        type: "welcome",
        room: this.roomId(),
        role: slot,
        peer: !!otherSlot || st.pending.length > 0,
      });
      // 补发对端提前发出的握手信号
      if (st.pending.length > 0) {
        for (const p of st.pending) {
          ws.send(p);
        }
        st.pending = [];
        await this.persist();
      }
      if (otherSlot) {
        this.sendToSlot(OTHER[slot], { type: "peer-joined", name: st.slots[slot]!.name });
      }
      return;
    }

    switch (m.type) {
      case "signal": {
        if (m.data === undefined) {
          this.sendTo(ws, { type: "error", code: "bad_message", message: "signal 缺少 data 字段" });
          return;
        }
        const payload = JSON.stringify({ type: "signal", data: m.data });
        if (payload.length > MAX_SIGNAL_BYTES) {
          this.sendTo(ws, { type: "error", code: "too_large", message: "signal.data 超过 32KB 上限" });
          return;
        }
        await this.ensureLoaded();
        const cur = this.room!;
        if (cur.slots[OTHER[slot]]) {
          this.sendToSlot(OTHER[slot], { type: "signal", data: m.data });
        } else {
          // 对端尚未 hello：缓冲，等对方就位后按序补发（超出上限丢弃最旧的）
          if (cur.pending.length >= MAX_PENDING) {
            cur.pending = cur.pending.slice(1);
          }
          cur.pending.push(payload);
          await this.persist();
        }
        return;
      }
      case "ping":
        this.sendTo(ws, { type: "pong" });
        return;
      case "bye":
        ws.close(1000, "bye");
        return;
      default:
        this.sendTo(ws, { type: "error", code: "bad_type", message: "未知消息类型: " + m.type });
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.leave(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.leave(ws);
  }

  // ---------- 内部 ----------

  // 离房：释放预占；若已 hello 则通知对端并作废缓冲信号（与 Go 版一致）。
  // 房间彻底空了就清空 storage——房间号下次有人用时自然重新开始。
  private async leave(ws: WebSocket): Promise<void> {
    const slot = this.slotOf(ws);
    if (!slot) {
      return;
    }
    await this.ensureLoaded();
    const st = this.room!;
    st.reserved[slot] = false;
    const hadHello = !!st.slots[slot];
    delete st.slots[slot];
    st.pending = [];
    await this.persist();

    if (hadHello) {
      const other = this.doState.getWebSockets(OTHER[slot])[0];
      other?.send(JSON.stringify({ type: "peer-left" }));
    }
    if (!st.reserved.offer && !st.reserved.answer && !st.slots.offer && !st.slots.answer) {
      await this.doState.storage.deleteAll();
      this.room = { slots: {}, reserved: {}, pending: [] };
    }
  }

  private slotOf(ws: WebSocket): Slot | undefined {
    if (this.doState.getWebSockets(ROLE_OFFER).includes(ws)) return ROLE_OFFER;
    if (this.doState.getWebSockets(ROLE_ANSWER).includes(ws)) return ROLE_ANSWER;
    return undefined;
  }

  private roomId(): string {
    // 入口一律以 idFromName(房间号) 创建本 DO
    return this.doState.id.name ?? "";
  }

  private sendTo(ws: WebSocket, m: Envelope): void {
    try {
      ws.send(JSON.stringify(m));
    } catch {
      // 连接已坏；close/error 事件会负责清理
    }
  }

  private sendToSlot(slot: Slot, m: Envelope): void {
    const peer = this.doState.getWebSockets(slot)[0];
    if (peer) {
      this.sendTo(peer, m);
    }
  }

  private reject(ws: WebSocket, code: string, message: string): void {
    this.sendTo(ws, { type: "error", code, message });
    ws.close(1008, code);
  }

  private ensureLoaded(): Promise<void> {
    if (!this.loaded) {
      this.loaded = (async () => {
        const stored = await this.doState.storage.get<RoomState>("room");
        this.room = stored ?? { slots: {}, reserved: {}, pending: [] };
      })();
    }
    return this.loaded;
  }

  private async persist(): Promise<void> {
    await this.doState.storage.put("room", this.room);
  }
}

// 信封结构（与 Go 版 Envelope 对齐）
interface Envelope {
  type: string;
  name?: string;
  room?: string;
  token?: string;
  role?: string;
  peer?: boolean;
  code?: string;
  message?: string;
  data?: unknown;
}

// 与 Go 版 sanitizeName 一致：去首尾空白、剔除控制字符、限长
function sanitizeName(s: string): string {
  const chars = Array.from(s.trim()).filter((ch) => (ch.codePointAt(0) ?? 0) >= 0x20);
  return chars.slice(0, MAX_NAME_RUNES).join("");
}
