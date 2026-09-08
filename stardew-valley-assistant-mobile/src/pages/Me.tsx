import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Check, Languages, Loader2, LogOut, Pencil, Wifi } from "lucide-react"
import { useAccount } from "@shared/account/account-provider"
import { describeError } from "@shared/account/errors"
import { useSocial } from "@shared/account/social-provider"
import { displayName } from "@shared/account/utils"
import i18n from "../i18n"
import { cn } from "../lib/utils"
import { PageHeader } from "../components/PageHeader"
import { useToast } from "../components/Toast"
import { useConfirm } from "../components/useConfirm"
import { Button, Input, Sheet } from "../components/ui"
import { UserAvatar } from "../components/social/UserAvatar"

const LANGUAGES = [
  { code: "zh", label: "简体中文" },
  { code: "en", label: "English" },
]

/** 账号页：资料（GET/PATCH /api/me）、hub 连接状态、语言、退出登录 */
export function MePage() {
  const { t } = useTranslation()
  const { user, logout, updateProfile } = useAccount()
  const { hubStatus } = useSocial()
  const { showToast } = useToast()
  const { confirm, element: confirmElement } = useConfirm()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    if (!name.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      await updateProfile(name)
      setEditing(false)
      showToast(t("social.account.nameSaved"), "success")
    } catch (err) {
      setError(describeError(err, t, "social.account.nameFailed"))
    } finally {
      setSaving(false)
    }
  }

  const handleLogout = async () => {
    const ok = await confirm({
      title: t("social.account.logoutConfirmTitle"),
      message: t("social.account.logoutConfirmMessage"),
      confirmText: t("social.account.logout"),
      danger: true,
    })
    if (ok) logout()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title={t("social.account.title")} />

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 pb-6">
        <div className="flex items-center gap-3.5 rounded-2xl border border-border/60 bg-card p-4">
          <UserAvatar user={user} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-bold">{displayName(user)}</p>
            <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
          </div>
          <button
            type="button"
            aria-label={t("social.account.editName")}
            onClick={() => {
              setName(user?.username ?? "")
              setError(null)
              setEditing(true)
            }}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary active:bg-primary/20"
          >
            <Pencil className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-px overflow-hidden rounded-2xl border border-border/60 bg-card">
          <div className="flex min-h-12 items-center gap-3 px-4 py-3">
            <Wifi className="h-5 w-5 shrink-0 text-muted-foreground" />
            <span className="flex-1 text-sm">{t("social.account.connection")}</span>
            <span
              className={cn(
                "text-xs font-semibold",
                hubStatus === "online"
                  ? "text-emerald-600 dark:text-emerald-400"
                  : hubStatus === "connecting"
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-muted-foreground",
              )}
            >
              {t(`social.status.${hubStatus}`)}
            </span>
          </div>
          <div className="flex min-h-12 items-center gap-3 border-t border-border/60 px-4 py-3">
            <span className="w-[18px] shrink-0" />
            <span className="flex-1 text-sm text-muted-foreground">{t("social.account.userId")}</span>
            <span className="font-mono text-xs text-muted-foreground">{user?.id.slice(0, 8)}</span>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-border/60 bg-card">
          <div className="flex items-center gap-3 px-4 py-3">
            <Languages className="h-5 w-5 shrink-0 text-muted-foreground" />
            <span className="text-sm">{t("common.language")}</span>
          </div>
          {LANGUAGES.map((lng) => (
            <button
              key={lng.code}
              type="button"
              onClick={() => void i18n.changeLanguage(lng.code)}
              className="flex min-h-12 w-full items-center gap-3 border-t border-border/60 px-4 py-3 text-left active:bg-accent/60"
            >
              <span className="flex-1 text-sm">{lng.label}</span>
              {i18n.resolvedLanguage === lng.code && <Check className="h-5 w-5 text-primary" />}
            </button>
          ))}
        </div>

        <Button variant="danger" className="w-full" onClick={() => void handleLogout()}>
          <LogOut className="h-4 w-4" />
          {t("social.account.logout")}
        </Button>
      </div>

      <Sheet open={editing} onClose={() => setEditing(false)} title={t("social.account.editName")}>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("social.account.namePlaceholder")}
          maxLength={32}
          disabled={saving}
        />
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        <Button className="mt-4 w-full" onClick={() => void save()} disabled={saving || !name.trim()}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {t("common.save")}
        </Button>
      </Sheet>

      {confirmElement}
    </div>
  )
}
