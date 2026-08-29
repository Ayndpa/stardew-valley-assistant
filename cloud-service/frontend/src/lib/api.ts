const TOKEN_KEY = "stardew_account_token"

export interface User {
  id: string
  email: string
  username: string | null
  avatar_url: string | null
  created_at?: string
}

export interface AuthResponse {
  token: string
  expires_at: string
  user: User
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: HeadersInit = { "Content-Type": "application/json" }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`

  const response = await fetch(path, { ...init, headers })

  if (!response.ok) {
    let message = `请求失败 (${response.status})`
    try {
      const body = (await response.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {
      // ignore
    }
    throw new ApiError(response.status, message)
  }

  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export const api = {
  register(email: string, password: string, username?: string) {
    return request<AuthResponse>("/api/register", {
      method: "POST",
      body: JSON.stringify({ email, password, username }),
    })
  },
  login(email: string, password: string) {
    return request<AuthResponse>("/api/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    })
  },
  async me(): Promise<{ user: User }> {
    return request<{ user: User }>("/api/me")
  },
  updateMe(updates: { username?: string | null; avatar_url?: string | null }) {
    return request<{ ok: boolean }>("/api/me", {
      method: "PATCH",
      body: JSON.stringify(updates),
    })
  },
  async getSettings(): Promise<Record<string, unknown>> {
    const res = await request<{ settings: Record<string, unknown> }>("/api/settings")
    return res.settings
  },
  putSettings(settings: Record<string, unknown>) {
    return request<{ ok: boolean }>("/api/settings", {
      method: "PUT",
      body: JSON.stringify({ settings }),
    })
  },
  logout() {
    return request<{ ok: boolean }>("/api/logout", { method: "POST" })
  },
}