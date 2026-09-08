import { useState, type FormEvent } from "react"
import { useTranslation } from "react-i18next"
import { Loader2, LogIn, UserPlus } from "lucide-react"
import { useAccount } from "@shared/account/account-provider"
import { describeError } from "@shared/account/errors"
import { cn } from "../lib/utils"
import { Button, Field, Input } from "../components/ui"
import appIcon from "../assets/app-icon.png"

type Mode = "login" | "register"

/** 登录 / 注册：POST /api/login、POST /api/register，成功后 token 存 localStorage 并建立 hub 连接 */
export function LoginPage() {
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
    } catch (err) {
      setError(describeError(err, t, mode === "login" ? "social.login.loginFailed" : "social.login.registerFailed"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pt-safe">
      <div className="flex flex-col items-center pt-8 text-center">
        <img src={appIcon} alt="" draggable={false} className="h-16 w-16 rounded-2xl border border-primary/25" />
        <h1 className="mt-4 text-xl font-extrabold">{t("social.login.title")}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{t("social.login.description")}</p>
      </div>

      <form onSubmit={handleSubmit} className="mt-7 space-y-4 pb-safe">
        <div className="grid grid-cols-2 gap-1 rounded-2xl bg-muted p-1">
          {(["login", "register"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m)
                setError(null)
              }}
              className={cn(
                "h-10 rounded-xl text-sm font-bold transition-colors",
                mode === m ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
              )}
            >
              {t(`social.login.${m}Tab`)}
            </button>
          ))}
        </div>

        <Field label={t("social.login.email")}>
          <Input
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            disabled={busy}
          />
        </Field>

        <Field label={t("social.login.password")}>
          <Input
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("social.login.passwordPlaceholder")}
            disabled={busy}
          />
        </Field>

        {mode === "register" && (
          <Field label={t("social.login.username")} hint={t("social.login.usernameOptional")}>
            <Input
              autoComplete="nickname"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              maxLength={32}
              disabled={busy}
            />
          </Field>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}

        <Button type="submit" disabled={busy} className="w-full">
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : mode === "login" ? (
            <LogIn className="h-4 w-4" />
          ) : (
            <UserPlus className="h-4 w-4" />
          )}
          {mode === "login" ? t("social.login.submitLogin") : t("social.login.submitRegister")}
        </Button>
      </form>
    </div>
  )
}
