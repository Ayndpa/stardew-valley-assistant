import { useState, type FormEvent } from "react"
import { useTranslation } from "react-i18next"
import { Loader2, LogIn, UserPlus } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAccount } from "@/lib/account/account-provider"
import { describeError } from "@/lib/account/errors"

interface LoginFormProps {
  onSuccess?: () => void
  className?: string
}

type Mode = "login" | "register"

export function LoginForm({ onSuccess, className }: LoginFormProps) {
  const { t } = useTranslation()
  const { login, register } = useAccount()
  const [mode, setMode] = useState<Mode>("login")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [username, setUsername] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setError(null)
    if (!email.trim().includes("@")) {
      setError(t("social.login.invalidEmail"))
      return
    }
    if (password.length < 8) {
      setError(t("social.login.passwordTooShort"))
      return
    }
    setBusy(true)
    try {
      if (mode === "login") {
        await login(email, password)
      } else {
        await register(email, password, username)
      }
      setPassword("")
      onSuccess?.()
    } catch (err) {
      setError(describeError(err, t, mode === "login" ? "social.login.loginFailed" : "social.login.registerFailed"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className={cn("space-y-3", className)}>
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
        {(["login", "register"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m)
              setError(null)
            }}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer",
              mode === m ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(`social.login.${m}Tab`)}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        <label className="text-xs font-bold text-foreground">{t("social.login.email")}</label>
        <Input
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="h-9 text-sm"
          disabled={busy}
        />
      </div>
      <div className="space-y-2">
        <label className="text-xs font-bold text-foreground">{t("social.login.password")}</label>
        <Input
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t("social.login.passwordPlaceholder")}
          className="h-9 text-sm"
          disabled={busy}
        />
      </div>
      {mode === "register" && (
        <div className="space-y-2">
          <label className="text-xs font-bold text-foreground">
            {t("social.login.username")}
            <span className="ml-1 font-normal text-muted-foreground">{t("social.login.usernameOptional")}</span>
          </label>
          <Input
            autoComplete="nickname"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            maxLength={32}
            className="h-9 text-sm"
            disabled={busy}
          />
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      <Button type="submit" disabled={busy} className="w-full gap-2">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === "login" ? <LogIn className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
        {mode === "login" ? t("social.login.submitLogin") : t("social.login.submitRegister")}
      </Button>
    </form>
  )
}
