import { AuthForm } from "@/components/AuthForm"
import { AccountOverview } from "@/components/AccountOverview"
import { useAuth } from "@/lib/auth-context"
import { Loader2 } from "lucide-react"

function App() {
  const { user, loading } = useAuth()

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6 text-foreground">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-extrabold tracking-tight">
          星露谷物语助手
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">账户系统</p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>正在恢复登录状态…</span>
        </div>
      ) : user ? (
        <AccountOverview />
      ) : (
        <AuthForm />
      )}

      <div
        className="mt-8 flex items-center gap-1.5 text-xs text-muted-foreground/70"
        style={{ position: "absolute", bottom: "1.5rem" }}
      >
        <span>React 前端</span>
        <span aria-hidden>·</span>
        <span>Go 后端</span>
        <span aria-hidden>·</span>
        <span>复用现有 Supabase 数据库</span>
      </div>
    </div>
  )
}

export default App