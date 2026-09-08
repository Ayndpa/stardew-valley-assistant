/// 实时模块共享工具：帧解析、文本清洗、限流、房间号生成、DO 间内部调用等。
/// 三个 Durable Object（UserHub / Lobby / GameRoom）与 HTTP 侧（friends.ts、handlers.ts）共用。

import type { Env } from "../types";
import { UUID_PATTERN } from "../util";

// ---------- 类型 ----------

/** 用户摘要（REALTIME.md §0.2） */
export interface UserBrief {
  id: string;
  username: string | null;
  avatar_url: string | null;
}

/** WebSocket 帧：UTF-8 文本 JSON，`type` 必填，其余字段随 type 而定 */
export interface Frame {
  type: string;
  [key: string]: unknown;
}

/** 大厅房间目录条目（REALTIME.md §3.1） */
export interface RoomSummary {
  code: string;
  name: string;
  host: UserBrief;
  count: number;
  max: number;
  locked: boolean;
  created_at: number;
}

// ---------- 常量（REALTIME.md §0.3） ----------

/** 单帧上限：超限直接以 1009 关闭 */
export const MAX_FRAME_BYTES = 64 * 1024;
/** room.signal 的 data 序列化后上限 */
export const MAX_SIGNAL_BYTES = 32 * 1024;
/** 聊天文本最大 code point 数 */
export const MAX_TEXT_CHARS = 2000;
/** 客户端消息 ID（cid）最大长度 */
export const MAX_CID_LENGTH = 64;
/** 房间名最大字符数 */
export const MAX_ROOM_NAME_CHARS = 32;
/** 房间密码最大字符数 */
export const MAX_ROOM_PASSWORD_CHARS = 32;
export const MIN_ROOM_MAX = 2;
export const MAX_ROOM_MAX = 8;
/** 聊天限流：每连接每 10 秒最多 20 条 */
export const RATE_WINDOW_MS = 10_000;
export const RATE_MAX_MESSAGES = 20;
/** 房间号字母表（剔除易混淆的 0/O、1/I/L） */
export const ROOM_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const ROOM_CODE_LENGTH = 6;
export const ROOM_CODE_RE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;
/** 创建者未在此时间内加入则房间自动删除 */
export const ROOM_HOST_JOIN_TIMEOUT_MS = 60_000;

/** WebSocket 关闭码 */
export const CLOSE_NORMAL = 1000;
export const CLOSE_POLICY = 1008;
export const CLOSE_TOO_LARGE = 1009;
export const CLOSE_REPLACED = 4000;

// ---------- 帧解析 ----------

export type ParsedFrame =
  | { ok: true; frame: Frame }
  | { ok: false; code: "bad_message" | "too_large"; message: string };

/** 把入站消息解析为帧；二进制 / 非 JSON / 缺 type 一律视为 bad_message，超限视为 too_large。 */
export function parseFrame(message: string | ArrayBuffer): ParsedFrame {
  if (typeof message !== "string") {
    return { ok: false, code: "bad_message", message: "仅支持文本帧" };
  }
  if (utf8ByteLength(message) > MAX_FRAME_BYTES) {
    return { ok: false, code: "too_large", message: "单帧超过 64KB 上限" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(message);
  } catch {
    return { ok: false, code: "bad_message", message: "JSON 解析失败" };
  }
  if (!isRecord(parsed) || typeof parsed["type"] !== "string" || parsed["type"] === "") {
    return { ok: false, code: "bad_message", message: "缺少 type 字段" };
  }
  return { ok: true, frame: parsed as Frame };
}

/** UTF-8 字节长度；短字符串走快速路径避免每条消息都编码。 */
export function utf8ByteLength(s: string): number {
  // 每个 UTF-16 码元最多编码为 3 字节；乘 3 仍不超限时无需精确计算
  if (s.length * 3 <= MAX_FRAME_BYTES) return s.length;
  return new TextEncoder().encode(s).byteLength;
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function isUUIDString(v: unknown): v is string {
  return typeof v === "string" && UUID_PATTERN.test(v);
}

// ---------- 文本清洗（REALTIME.md §0.3） ----------

/**
 * 聊天文本：去首尾空白后按 code point 计 1~2000 个字符，剔除除 `\n` 外的控制字符（< 0x20）。
 * 不合法（非字符串 / 为空 / 超长）返回 null。
 */
export function sanitizeText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const chars = Array.from(raw.trim()).filter((ch) => {
    const cp = ch.codePointAt(0) ?? 0;
    return cp >= 0x20 || ch === "\n";
  });
  const text = chars.join("").trim();
  if (text.length === 0) return null;
  const count = Array.from(text).length;
  if (count > MAX_TEXT_CHARS) return null;
  return text;
}

/**
 * 短名称（房间名 / 邀请里的房间名）：去首尾空白、剔除所有控制字符，按 code point 限长。
 * 空串返回 null；超长时截断而不是拒绝。
 */
export function sanitizeName(raw: unknown, maxChars: number): string | null {
  if (typeof raw !== "string") return null;
  const chars = Array.from(raw.trim()).filter((ch) => (ch.codePointAt(0) ?? 0) >= 0x20);
  if (chars.length === 0) return null;
  return chars.slice(0, maxChars).join("");
}

/** 规范化房间号：去空白、转大写；格式不合法返回 null。 */
export function normalizeRoomCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return ROOM_CODE_RE.test(code) ? code : null;
}

/** 生成随机房间号（6 位，服务端统一大写字母表）。 */
export function randomRoomCode(): string {
  const rnd = crypto.getRandomValues(new Uint8Array(ROOM_CODE_LENGTH));
  return Array.from(rnd, (n) => ROOM_CODE_ALPHABET[n % ROOM_CODE_ALPHABET.length]).join("");
}

/** 生成连接 ID（保存在 attachment，用于限流 / 区分同一用户的多端连接）。 */
export function newConnId(): string {
  return crypto.randomUUID();
}

// ---------- 限流 ----------

/**
 * 滑动窗口限流器：按连接 ID 记录最近发送时间戳。
 * 状态只在 DO 内存中，休眠唤醒后自然清零（可接受，窗口只有 10 秒）。
 */
export class RateLimiter {
  private readonly buckets = new Map<string, number[]>();

  constructor(
    private readonly windowMs: number = RATE_WINDOW_MS,
    private readonly max: number = RATE_MAX_MESSAGES,
  ) {}

  /** 允许则记录并返回 true；超限返回 false（不记录）。 */
  allow(connId: string, now = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    let stamps = this.buckets.get(connId);
    if (!stamps) {
      stamps = [];
      this.buckets.set(connId, stamps);
    }
    // 丢弃窗口外的旧记录
    let drop = 0;
    while (drop < stamps.length && stamps[drop]! <= cutoff) drop++;
    if (drop > 0) stamps.splice(0, drop);
    if (stamps.length >= this.max) return false;
    stamps.push(now);
    return true;
  }

  forget(connId: string): void {
    this.buckets.delete(connId);
  }
}

// ---------- 发送 ----------

/** 发送一帧；连接已关闭或发送异常时静默忽略（close/error 事件会负责清理）。 */
export function send(ws: WebSocket, frame: Frame): void {
  try {
    ws.send(JSON.stringify(frame));
  } catch {
    // 连接已坏，忽略
  }
}

export function sendError(ws: WebSocket, code: string, message: string): void {
  send(ws, { type: "error", code, message });
}

/** 向一组连接广播同一帧（只序列化一次）。 */
export function broadcast(sockets: Iterable<WebSocket>, frame: Frame, except?: WebSocket): void {
  const payload = JSON.stringify(frame);
  for (const ws of sockets) {
    if (ws === except) continue;
    try {
      ws.send(payload);
    } catch {
      // 忽略已关闭连接
    }
  }
}

/** 安全关闭连接（重复关闭 / 已关闭时不抛异常）。 */
export function safeClose(ws: WebSocket, code: number, reason: string): void {
  try {
    ws.close(code, reason);
  } catch {
    // 忽略
  }
}

/** 读取 attachment（休眠唤醒后仍可用）；不存在或损坏返回 null。 */
export function readAttachment<T>(ws: WebSocket): T | null {
  try {
    const v = ws.deserializeAttachment() as T | null | undefined;
    return v ?? null;
  } catch {
    return null;
  }
}

// ---------- HTTP 工具（DO 内部端点） ----------

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export function jsonError(status: number, code: string, message: string): Response {
  return jsonResponse({ error: message, code }, status);
}

/** 解析 JSON 请求体；失败返回 null。 */
export async function readBody<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

// ---------- 内部 Header 编解码（升级请求经 Worker 转交 DO） ----------

/** Header 值只能是 Latin-1，因此文本字段统一 encodeURIComponent。 */
export function encodeHeaderText(s: string | null | undefined): string {
  return s == null ? "" : encodeURIComponent(s);
}

export function decodeHeaderText(s: string | null): string | null {
  if (s == null || s === "") return null;
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

/** JSON 结构经 UTF-8 → base64 放进 Header（比 URL 编码更紧凑）。 */
export function encodeHeaderJSON(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function decodeHeaderJSON<T>(s: string | null): T | null {
  if (!s) return null;
  try {
    const bin = atob(s);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null;
  }
}

/** 从升级请求的内部 Header 还原当前用户的 UserBrief；缺少 x-user-id 返回 null。 */
export function userFromHeaders(headers: Headers): UserBrief | null {
  const id = headers.get("x-user-id");
  if (!id || !UUID_PATTERN.test(id)) return null;
  return {
    id,
    username: decodeHeaderText(headers.get("x-user-name")),
    avatar_url: decodeHeaderText(headers.get("x-avatar-url")),
  };
}

/** 把任意输入整理成 UserBrief 数组（容忍纯 ID 字符串），非法项丢弃。 */
export function toBriefList(raw: unknown): UserBrief[] {
  if (!Array.isArray(raw)) return [];
  const out: UserBrief[] = [];
  for (const item of raw) {
    if (typeof item === "string" && UUID_PATTERN.test(item)) {
      out.push({ id: item, username: null, avatar_url: null });
    } else if (isRecord(item) && isUUIDString(item["id"])) {
      out.push({
        id: item["id"],
        username: typeof item["username"] === "string" ? item["username"] : null,
        avatar_url: typeof item["avatar_url"] === "string" ? item["avatar_url"] : null,
      });
    }
  }
  return out;
}

/** 校验一个未知值是否为 UserBrief；返回规范化副本或 null。 */
export function toBrief(raw: unknown): UserBrief | null {
  return toBriefList([raw])[0] ?? null;
}

// ---------- DO 间内部调用 ----------

/** 向指定命名空间中 idFromName(name) 的 DO 发起内部 POST。 */
export async function internalPost(
  ns: DurableObjectNamespace,
  name: string,
  path: string,
  body: unknown,
): Promise<Response> {
  const stub = ns.get(ns.idFromName(name));
  return stub.fetch(`https://internal${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function internalGet(ns: DurableObjectNamespace, name: string, path: string): Promise<Response> {
  const stub = ns.get(ns.idFromName(name));
  return stub.fetch(`https://internal${path}`, { method: "GET" });
}

/**
 * 通过 UserHub 向某用户的所有连接推送一帧（REALTIME.md §2.5 `/internal/notify`）。
 * 失败只记录日志，永远不抛出，返回 delivered（对方当时是否有在线连接）。
 */
export async function notifyHub(env: Env, userId: string, frame: Frame): Promise<boolean> {
  try {
    const res = await internalPost(env.USER_HUB, userId, "/internal/notify", frame);
    if (!res.ok) {
      console.error(`通知 UserHub(${userId}) 失败: HTTP ${res.status}`);
      return false;
    }
    const data = (await res.json().catch(() => null)) as { delivered?: boolean } | null;
    return data?.delivered === true;
  } catch (err) {
    console.error(`通知 UserHub(${userId}) 异常:`, err);
    return false;
  }
}

/** 查询某用户是否在线（`GET /internal/status`）；失败视为离线。 */
export async function queryOnline(env: Env, userId: string): Promise<boolean> {
  try {
    const res = await internalGet(env.USER_HUB, userId, "/internal/status");
    if (!res.ok) return false;
    const data = (await res.json().catch(() => null)) as { online?: boolean } | null;
    return data?.online === true;
  } catch (err) {
    console.error(`查询 UserHub(${userId}) 在线状态异常:`, err);
    return false;
  }
}

/** 更新某用户 UserHub 缓存的资料（`POST /internal/profile`）；失败只记录日志。 */
export async function updateHubProfile(
  env: Env,
  userId: string,
  profile: { username: string | null; avatar_url: string | null },
): Promise<void> {
  try {
    const res = await internalPost(env.USER_HUB, userId, "/internal/profile", profile);
    if (!res.ok) {
      console.error(`更新 UserHub(${userId}) 资料失败: HTTP ${res.status}`);
    }
  } catch (err) {
    console.error(`更新 UserHub(${userId}) 资料异常:`, err);
  }
}

/** 通知 Lobby 房间目录变化；失败只记录日志。 */
export async function notifyLobby(
  env: Env,
  path: "/internal/room-update" | "/internal/room-remove",
  body: RoomSummary | { code: string },
): Promise<void> {
  try {
    const res = await internalPost(env.LOBBY, "global", path, body);
    if (!res.ok) {
      console.error(`通知 Lobby ${path} 失败: HTTP ${res.status}`);
    }
  } catch (err) {
    console.error(`通知 Lobby ${path} 异常:`, err);
  }
}
