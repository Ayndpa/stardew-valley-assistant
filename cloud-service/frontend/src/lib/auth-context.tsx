import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import type { ReactNode } from "react"
import { api, getToken, setToken, type User } from "@/lib/api"

interface AuthContextValue {
  user: User | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<User>
  signUp: (email: string, password: string, username?: string) => Promise<User>
  signOut: () => Promise<void>
  updateProfile: (updates: { username?: string | null; avatar_url?: string | null }) => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  // 启动时如果有本地令牌，拉取 /api/me 恢复登录态
  useEffect(() => {
    let cancelled = false
    async function boot() {
      if (!getToken()) {
        setLoading(false)
        return
      }
      try {
        const { user } = await api.me()
        if (!cancelled) setUser(user)
      } catch {
        // 令牌失效：清掉本地缓存
        setToken(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void boot()
    return () => {
      cancelled = true
    }
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    const res = await api.login(email, password)
    setToken(res.token)
    setUser(res.user)
    return res.user
  }, [])

  const signUp = useCallback(async (email: string, password: string, username?: string) => {
    const res = await api.register(email, password, username)
    setToken(res.token)
    setUser(res.user)
    return res.user
  }, [])

  const signOut = useCallback(async () => {
    try {
      await api.logout()
    } catch {
      // 忽略：本地退出不依赖网络
    }
    setToken(null)
    setUser(null)
  }, [])

  const updateProfile = useCallback(
    async (updates: { username?: string | null; avatar_url?: string | null }) => {
      await api.updateMe(updates)
      setUser((prev) => (prev ? { ...prev, ...updates } : prev))
    },
    []
  )

  const refresh = useCallback(async () => {
    if (!getToken()) return
    const { user } = await api.me()
    setUser(user)
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, signIn, signUp, signOut, updateProfile, refresh }),
    [user, loading, signIn, signUp, signOut, updateProfile, refresh]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within AuthProvider")
  return ctx
}