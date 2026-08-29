import { useState } from "react"
import { LogOut, User, Loader2, Save, Check, Cloud, KeyRound } from "lucide-react"
import { useAuth } from "@/lib/auth-context"

export function AccountOverview() {
  const { user, signOut, updateProfile, loading } = useAuth()
  const [username, setUsername] = useState(user?.username ?? "")
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (loading || !user) return null

  const email = user.email ?? ""
  const displayName = user.username || email.split("@")[0] || "玩家"

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      await updateProfile({ username: username.trim() || null })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="w-full max-w-md space-y-6">
      <div className="flex items-center gap-4 rounded-xl border bg-card p-6 shadow-sm">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/15 text-primary">
          <User className="h-7 w-7" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-semibold text-foreground">{displayName}</p>
          <p className="truncate text-sm text-muted-foreground">{email}</p>
          <p className="mt-1 flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
            <Cloud className="h-3 w-3" />
            已登录 · 数据可云端同步
          </p>
        </div>
        <button
          type="button"
          onClick={() => signOut().catch(() => {})}
          className="flex h-9 items-center gap-2 rounded-md border border-input px-3 text-sm text-destructive transition-colors hover:bg-destructive/10"
        >
          <LogOut className="h-4 w-4" />
          退出登录
        </button>
      </div>

      <form onSubmit={handleSave} className="space-y-4 rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="text-base font-semibold">个人资料</h2>

        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-foreground">用户名</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="展示用昵称"
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>

        <div className="flex items-center justify-between rounded-lg border border-border/70 bg-accent/30 px-3 py-2.5 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <KeyRound className="h-4 w-4" />
            <span>账户 ID</span>
          </div>
          <code className="truncate text-xs text-muted-foreground">{user.id}</code>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <button
          type="submit"
          disabled={saving}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : saved ? (
            <Check className="h-4 w-4" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {saved ? "已保存" : "保存"}
        </button>
      </form>
    </div>
  )
}