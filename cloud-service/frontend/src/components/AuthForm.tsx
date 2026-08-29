import { useState } from "react"
import { LogIn, UserPlus, Loader2, Mail, Lock } from "lucide-react"
import { useAuth } from "@/lib/auth-context"

function Field({
  label,
  icon,
  ...rest
}: {
  label: string
  icon?: React.ReactNode
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground [&_svg]:h-4 [&_svg]:w-4">
          {icon}
        </span>
        <input
          {...rest}
          className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>
    </label>
  )
}

export function AuthForm() {
  const { signIn, signUp } = useAuth()
  const [mode, setMode] = useState<"login" | "register">("login")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [username, setUsername] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const switchMode = () => {
    setMode((m) => (m === "login" ? "register" : "login"))
    setError(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      if (mode === "login") {
        await signIn(email, password)
      } else {
        await signUp(email, password, username.trim() || undefined)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败，请稍后重试")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="w-full max-w-sm space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-bold tracking-tight">
          {mode === "login" ? "登录账户" : "注册账户"}
        </h1>
        <p className="text-sm text-muted-foreground">
          复用星露谷物语助手的账户系统，云端同步你的农场数据
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border bg-card p-6 shadow-sm">
        {mode === "register" && (
          <Field
            label="用户名"
            icon={<UserPlus />}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="可选，展示用昵称"
            autoComplete="username"
          />
        )}

        <Field
          label="邮箱"
          icon={<Mail />}
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
        />

        <Field
          label="密码"
          icon={<Lock />}
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={mode === "register" ? "至少 8 位" : "输入密码"}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
        />

        {error && <p className="text-sm text-destructive">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : mode === "login" ? (
            <LogIn className="h-4 w-4" />
          ) : (
            <UserPlus className="h-4 w-4" />
          )}
          {mode === "login" ? "登录" : "注册"}
        </button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        {mode === "login" ? "还没有账户？" : "已有账户？"}
        <button
          type="button"
          onClick={switchMode}
          className="ml-1 font-medium text-primary hover:underline"
        >
          {mode === "login" ? "立即注册" : "去登录"}
        </button>
      </p>
    </div>
  )
}