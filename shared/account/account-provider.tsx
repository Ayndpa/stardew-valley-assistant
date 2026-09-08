import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import * as api from "./api"
import { isAccountApiError } from "./api"
import { TOKEN_KEY, USER_KEY } from "./storage"
import type { AccountUser } from "./types"

export type AccountStatus = "idle" | "loading" | "ready"

interface AccountState {
  user: AccountUser | null
  token: string | null
  /** idle = 未登录；loading = 正在校验本地 token；ready = 已登录 */
  status: AccountStatus
  login: (email: string, password: string) => Promise<AccountUser>
  register: (email: string, password: string, username?: string) => Promise<AccountUser>
  logout: () => void
  refreshMe: () => Promise<AccountUser | null>
  updateProfile: (username: string) => Promise<AccountUser>
  /**
   * 用当前 token 执行一个请求；未登录时抛错，遇到 401 自动登出后再抛出。
   * 所有需要鉴权的 HTTP 调用都应经过它。
   */
  withToken: <T>(fn: (token: string) => Promise<T>) => Promise<T>
}

const AccountContext = createContext<AccountState | undefined>(undefined)

function readStoredUser(): AccountUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as AccountUser
    return parsed && typeof parsed.id === "string" ? parsed : null
  } catch {
    return null
  }
}

function readStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(readStoredToken)
  const [user, setUser] = useState<AccountUser | null>(() => (readStoredToken() ? readStoredUser() : null))
  const [status, setStatus] = useState<AccountStatus>(() => (readStoredToken() ? "loading" : "idle"))
  const tokenRef = useRef(token)
  tokenRef.current = token

  const persist = useCallback((nextToken: string | null, nextUser: AccountUser | null) => {
    try {
      if (nextToken) localStorage.setItem(TOKEN_KEY, nextToken)
      else localStorage.removeItem(TOKEN_KEY)
      if (nextUser) localStorage.setItem(USER_KEY, JSON.stringify(nextUser))
      else localStorage.removeItem(USER_KEY)
    } catch {
      // 忽略隐私模式等写入失败
    }
  }, [])

  const logout = useCallback(() => {
    tokenRef.current = null
    setToken(null)
    setUser(null)
    setStatus("idle")
    persist(null, null)
  }, [persist])

  const applyAuth = useCallback(
    (nextToken: string, nextUser: AccountUser) => {
      tokenRef.current = nextToken
      setToken(nextToken)
      setUser(nextUser)
      setStatus("ready")
      persist(nextToken, nextUser)
    },
    [persist],
  )

  const withToken = useCallback(
    async <T,>(fn: (token: string) => Promise<T>): Promise<T> => {
      const current = tokenRef.current
      if (!current) {
        throw new api.AccountApiError(401, "未登录", "unauthorized")
      }
      try {
        return await fn(current)
      } catch (err) {
        if (isAccountApiError(err) && err.status === 401) {
          logout()
        }
        throw err
      }
    },
    [logout],
  )

  const refreshMe = useCallback(async (): Promise<AccountUser | null> => {
    if (!tokenRef.current) return null
    try {
      const me = await withToken((tk) => api.getMe(tk))
      setUser(me)
      setStatus("ready")
      persist(tokenRef.current, me)
      return me
    } catch (err) {
      if (isAccountApiError(err) && err.status === 401) {
        return null
      }
      // 账户已被删除（旧版后端返回 404）：同样视为会话失效
      if (isAccountApiError(err) && err.status === 404) {
        logout()
        return null
      }
      // 网络错误等：保留缓存的用户信息，仍视为已登录
      if (tokenRef.current) setStatus("ready")
      throw err
    }
  }, [withToken, persist, logout])

  const refreshMeRef = useRef(refreshMe)
  refreshMeRef.current = refreshMe

  // 启动时若有 token，校验并刷新资料
  useEffect(() => {
    if (!tokenRef.current) return
    refreshMeRef.current().catch(() => {
      // 已在 refreshMe 内处理
    })
  }, [])

  // 其他窗口登录 / 登出 / 改资料时，通过 storage 事件同步到本窗口
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key !== null && e.key !== TOKEN_KEY && e.key !== USER_KEY) return
      const nextToken = readStoredToken()
      if (nextToken !== tokenRef.current) {
        tokenRef.current = nextToken
        setToken(nextToken)
        if (!nextToken) {
          setUser(null)
          setStatus("idle")
        } else {
          setUser(readStoredUser())
          setStatus("ready")
          refreshMeRef.current().catch(() => {})
        }
        return
      }
      if (nextToken && e.key === USER_KEY) {
        const cached = readStoredUser()
        if (cached) setUser(cached)
      }
    }
    window.addEventListener("storage", handler)
    return () => window.removeEventListener("storage", handler)
  }, [])

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api.login(email.trim(), password)
      applyAuth(res.token, res.user)
      return res.user
    },
    [applyAuth],
  )

  const register = useCallback(
    async (email: string, password: string, username?: string) => {
      const res = await api.register(email.trim(), password, username?.trim() || undefined)
      applyAuth(res.token, res.user)
      return res.user
    },
    [applyAuth],
  )

  const updateProfile = useCallback(
    async (username: string) => {
      const me = await withToken((tk) => api.updateMe(tk, { username: username.trim() }))
      setUser(me)
      persist(tokenRef.current, me)
      return me
    },
    [withToken, persist],
  )

  const value = useMemo<AccountState>(
    () => ({ user, token, status, login, register, logout, refreshMe, updateProfile, withToken }),
    [user, token, status, login, register, logout, refreshMe, updateProfile, withToken],
  )

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>
}

export function useAccount(): AccountState {
  const ctx = useContext(AccountContext)
  if (ctx === undefined) {
    throw new Error("useAccount must be used within an AccountProvider")
  }
  return ctx
}
