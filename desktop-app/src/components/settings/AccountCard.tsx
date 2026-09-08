import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Loader2, LogOut, Save, UserRound, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { useAccount } from "@/lib/account/account-provider"
import { describeError } from "@/lib/account/errors"
import { displayName } from "@/lib/account/utils"
import { openFriendsWindow } from "@/lib/account/windows"
import { LoginForm } from "@/components/social/LoginForm"
import { UserAvatar } from "@/components/social/UserAvatar"
import { CloudSyncPanel } from "./CloudSyncPanel"

export function AccountCard() {
  const { t } = useTranslation()
  const { user, status, logout, updateProfile } = useAccount()
  const [username, setUsername] = useState(user?.username ?? "")
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "error" } | null>(null)

  useEffect(() => {
    setUsername(user?.username ?? "")
  }, [user?.username])

  const handleSaveProfile = async () => {
    if (saving) return
    setSaving(true)
    setMessage(null)
    try {
      await updateProfile(username)
      setMessage({ text: t("settings.account.profileSaved"), tone: "ok" })
    } catch (err) {
      setMessage({ text: describeError(err, t), tone: "error" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="overflow-hidden border border-border/80">
      <CardHeader className="bg-gradient-to-r from-primary/10 via-transparent to-transparent pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-primary/10">
            <UserRound className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle className="text-lg font-bold">{t("settings.account.title")}</CardTitle>
            <CardDescription>{t("settings.account.description")}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-6">
        {status === "loading" ? (
          <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>{t("social.login.checking")}</span>
          </div>
        ) : status !== "ready" || !user ? (
          <div className="mx-auto max-w-sm rounded-lg border border-border/60 bg-accent/20 p-4">
            <LoginForm />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
              <div className="flex min-w-0 items-center gap-3">
                <UserAvatar user={user} size="md" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{displayName(user)}</p>
                  <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                  <p className="truncate font-mono text-[10px] text-muted-foreground">{user.id}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => void openFriendsWindow(t("social.window.friendsTitle"))} className="gap-2">
                  <Users className="h-4 w-4" />
                  {t("settings.account.openFriends")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={logout}
                  className="flex items-center gap-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  <LogOut className="h-4 w-4" />
                  {t("settings.account.logout")}
                </Button>
              </div>
            </div>

            <div className="space-y-2 rounded-lg border border-border/60 bg-accent/30 p-3">
              <label className="text-xs font-bold text-foreground">{t("settings.account.username")}</label>
              <div className="flex items-center gap-2">
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={t("settings.account.usernamePlaceholder")}
                  maxLength={32}
                  className="h-9 text-sm"
                  disabled={saving}
                />
                <Button
                  size="sm"
                  className="h-9 shrink-0 gap-1.5"
                  onClick={() => void handleSaveProfile()}
                  disabled={saving || username.trim() === (user.username ?? "")}
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  {t("settings.account.save")}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">{t("settings.account.usernameHint")}</p>
              {message && (
                <p className={message.tone === "ok" ? "text-xs text-emerald-600 dark:text-emerald-400" : "text-xs text-destructive"}>{message.text}</p>
              )}
            </div>

            <Separator className="bg-border/60" />

            <CloudSyncPanel />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
