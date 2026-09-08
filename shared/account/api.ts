import { getAccountBaseUrl } from "./config"
import type { AccountUser, FriendEntry, FriendRequest, FriendRequests, UserBrief } from "./types"

export class AccountApiError extends Error {
  status: number
  code?: string

  constructor(status: number, message: string, code?: string) {
    super(message)
    this.name = "AccountApiError"
    this.status = status
    this.code = code
  }
}

export function isAccountApiError(err: unknown): err is AccountApiError {
  return err instanceof AccountApiError
}

/**
 * 统一的 JSON 请求封装。
 * - 自动附加 Authorization: Bearer <token>
 * - 4xx/5xx 解析 `{ error, code? }` 并抛出 AccountApiError
 * - 网络失败抛出 status=0 的 AccountApiError
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}, token?: string | null): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set("Accept", "application/json")
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`)
  }

  let res: Response
  try {
    res = await fetch(getAccountBaseUrl() + path, { ...init, headers })
  } catch (err) {
    throw new AccountApiError(0, err instanceof Error ? err.message : String(err), "network")
  }

  const text = await res.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }

  if (!res.ok) {
    const body = (data ?? {}) as { error?: unknown; code?: unknown }
    const message = typeof body.error === "string" && body.error ? body.error : `HTTP ${res.status}`
    const code = typeof body.code === "string" ? body.code : undefined
    throw new AccountApiError(res.status, message, code)
  }

  return data as T
}

function json(body: unknown): RequestInit {
  return { method: "POST", body: JSON.stringify(body) }
}

// ---------- 账号 ----------

export interface AuthResponse {
  token: string
  expires_at: string
  user: AccountUser
}

export function register(email: string, password: string, username?: string): Promise<AuthResponse> {
  return apiFetch<AuthResponse>("/api/register", json({ email, password, username: username || undefined }))
}

export function login(email: string, password: string): Promise<AuthResponse> {
  return apiFetch<AuthResponse>("/api/login", json({ email, password }))
}

export async function getMe(token: string): Promise<AccountUser> {
  const res = await apiFetch<{ user: AccountUser }>("/api/me", {}, token)
  return res.user
}

/**
 * 修改资料。服务端的 `PATCH /api/me` 只回 `{ ok: true }`（backend/src/handlers.ts 的 handleUpdateMe），
 * 并不返回 user——直接取 `res.user` 会把调用方的用户对象置为 undefined。
 * 因此 PATCH 成功后再 GET 一次，拿到权威的完整用户对象。
 */
export async function updateMe(
  token: string,
  patch: { username?: string | null; avatar_url?: string | null },
): Promise<AccountUser> {
  await apiFetch<{ ok: true }>("/api/me", { method: "PATCH", body: JSON.stringify(patch) }, token)
  return getMe(token)
}

export async function getSettings(token: string): Promise<Record<string, unknown>> {
  const res = await apiFetch<{ settings: Record<string, unknown> | null }>("/api/settings", {}, token)
  return res.settings ?? {}
}

export async function putSettings(token: string, settings: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await apiFetch<{ settings: Record<string, unknown> | null }>(
    "/api/settings",
    { method: "PUT", body: JSON.stringify({ settings }) },
    token,
  )
  return res.settings ?? settings
}

// ---------- 好友 ----------

export async function lookupUsers(token: string, q: string): Promise<UserBrief[]> {
  const res = await apiFetch<{ users: UserBrief[] }>(`/api/users/lookup?q=${encodeURIComponent(q.trim())}`, {}, token)
  return res.users ?? []
}

export async function listFriends(token: string): Promise<FriendEntry[]> {
  const res = await apiFetch<{ friends: (UserBrief & { since: string; online?: boolean })[] }>("/api/friends", {}, token)
  return (res.friends ?? []).map((f) => ({ ...f, online: !!f.online }))
}

export async function listFriendRequests(token: string): Promise<FriendRequests> {
  const res = await apiFetch<FriendRequests>("/api/friends/requests", {}, token)
  return { incoming: res.incoming ?? [], outgoing: res.outgoing ?? [] }
}

export function sendFriendRequest(
  token: string,
  userId: string,
): Promise<{ request: FriendRequest; accepted: boolean }> {
  return apiFetch("/api/friends/requests", json({ user_id: userId }), token)
}

export function acceptFriendRequest(token: string, requestId: string): Promise<{ ok: true; friend: UserBrief }> {
  return apiFetch(`/api/friends/requests/${encodeURIComponent(requestId)}/accept`, { method: "POST" }, token)
}

export function declineFriendRequest(token: string, requestId: string): Promise<{ ok: true }> {
  return apiFetch(`/api/friends/requests/${encodeURIComponent(requestId)}/decline`, { method: "POST" }, token)
}

export function removeFriend(token: string, userId: string): Promise<{ ok: true }> {
  return apiFetch(`/api/friends/${encodeURIComponent(userId)}`, { method: "DELETE" }, token)
}
