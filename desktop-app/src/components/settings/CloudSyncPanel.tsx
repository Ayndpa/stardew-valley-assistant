import { useState } from "react"
import { useTranslation } from "react-i18next"
import { CloudDownload, CloudUpload, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { useConfirm } from "@/hooks/useConfirm"
import { useAccount } from "@/lib/account/account-provider"
import * as api from "@/lib/account/api"
import { describeError } from "@/lib/account/errors"

/** 参与云端同步的 localStorage 键：只包含偏好设置，绝不包含 API Key 或本机路径 */
const SYNC_KEYS = [
  "i18nextLng",
  "stardew-theme-mode",
  "stardew-theme-season",
  "enabledFeatures",
  "sidebarCollapsed",
  "stardewSmapiMirror",
  "translationEngine",
] as const

interface DesktopSettingsBlob {
  values: Record<string, string>
  updated_at: string
}

function collectLocalSettings(): Record<string, string> {
  const values: Record<string, string> = {}
  for (const key of SYNC_KEYS) {
    const v = localStorage.getItem(key)
    if (v !== null) values[key] = v
  }
  return values
}

function readDesktopBlob(settings: Record<string, unknown>): DesktopSettingsBlob | null {
  const blob = settings.desktop
  if (!blob || typeof blob !== "object") return null
  const values = (blob as { values?: unknown }).values
  if (!values || typeof values !== "object") return null
  const safe: Record<string, string> = {}
  for (const key of SYNC_KEYS) {
    const v = (values as Record<string, unknown>)[key]
    if (typeof v === "string") safe[key] = v
  }
  const updated = (blob as { updated_at?: unknown }).updated_at
  return { values: safe, updated_at: typeof updated === "string" ? updated : "" }
}

interface CloudSyncPanelProps {
  /** 紧凑模式（好友窗口内） */
  compact?: boolean
  className?: string
}

/** "云端设置同步"：上传本机偏好 / 从云端恢复（恢复后重新加载窗口） */
export function CloudSyncPanel({ compact, className }: CloudSyncPanelProps) {
  const { t } = useTranslation()
  const { withToken } = useAccount()
  const { confirm, ConfirmDialogElement } = useConfirm()
  const [syncing, setSyncing] = useState<"upload" | "restore" | null>(null)
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "error" } | null>(null)

  const handleUpload = async () => {
    if (syncing) return
    setSyncing("upload")
    setMessage(null)
    try {
      const current = await withToken((tk) => api.getSettings(tk))
      const blob: DesktopSettingsBlob = { values: collectLocalSettings(), updated_at: new Date().toISOString() }
      await withToken((tk) => api.putSettings(tk, { ...current, desktop: blob }))
      setMessage({ text: t("settings.account.sync.uploaded", { count: Object.keys(blob.values).length }), tone: "ok" })
    } catch (err) {
      setMessage({ text: describeError(err, t), tone: "error" })
    } finally {
      setSyncing(null)
    }
  }

  const handleRestore = async () => {
    if (syncing) return
    setSyncing("restore")
    setMessage(null)
    try {
      const remote = await withToken((tk) => api.getSettings(tk))
      const blob = readDesktopBlob(remote)
      if (!blob || Object.keys(blob.values).length === 0) {
        setMessage({ text: t("settings.account.sync.nothingToRestore"), tone: "error" })
        return
      }
      setSyncing(null)
      const ok = await confirm({
        title: t("settings.account.sync.restoreConfirmTitle"),
        message: t("settings.account.sync.restoreConfirmMessage", {
          count: Object.keys(blob.values).length,
          time: blob.updated_at ? new Date(blob.updated_at).toLocaleString() : "—",
        }),
        confirmText: t("settings.account.sync.restoreConfirmButton"),
        cancelText: t("settings.account.cancel"),
      })
      if (!ok) return
      for (const [key, value] of Object.entries(blob.values)) {
        localStorage.setItem(key, value)
      }
      window.location.reload()
    } catch (err) {
      setMessage({ text: describeError(err, t), tone: "error" })
    } finally {
      setSyncing(null)
    }
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div>
        <p className={cn("font-medium", compact ? "text-xs" : "text-sm")}>{t("settings.account.sync.title")}</p>
        {!compact && <p className="text-xs text-muted-foreground">{t("settings.account.sync.description")}</p>}
      </div>
      <div className={cn("grid gap-2", compact ? "grid-cols-2" : "grid-cols-1 gap-3 sm:grid-cols-2")}>
        <Button
          variant="outline"
          size={compact ? "sm" : "default"}
          className={cn("justify-start gap-2", compact ? "h-8 text-xs" : "h-auto gap-3 py-3")}
          onClick={() => void handleUpload()}
          disabled={!!syncing}
        >
          {syncing === "upload" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudUpload className="h-4 w-4 text-primary" />}
          {compact ? (
            <span>{t("settings.account.sync.upload")}</span>
          ) : (
            <span className="flex flex-col items-start text-left">
              <span className="text-sm font-semibold">{t("settings.account.sync.upload")}</span>
              <span className="text-[11px] font-normal text-muted-foreground">{t("settings.account.sync.uploadDesc")}</span>
            </span>
          )}
        </Button>
        <Button
          variant="outline"
          size={compact ? "sm" : "default"}
          className={cn("justify-start gap-2", compact ? "h-8 text-xs" : "h-auto gap-3 py-3")}
          onClick={() => void handleRestore()}
          disabled={!!syncing}
        >
          {syncing === "restore" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudDownload className="h-4 w-4 text-primary" />}
          {compact ? (
            <span>{t("settings.account.sync.restore")}</span>
          ) : (
            <span className="flex flex-col items-start text-left">
              <span className="text-sm font-semibold">{t("settings.account.sync.restore")}</span>
              <span className="text-[11px] font-normal text-muted-foreground">{t("settings.account.sync.restoreDesc")}</span>
            </span>
          )}
        </Button>
      </div>
      {!compact && <p className="text-[11px] text-muted-foreground">{t("settings.account.sync.scope")}</p>}
      {message && (
        <p className={message.tone === "ok" ? "text-xs text-emerald-600 dark:text-emerald-400" : "text-xs text-destructive"}>{message.text}</p>
      )}
      {ConfirmDialogElement}
    </div>
  )
}
