import { useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Download, X, Sparkles } from "lucide-react"
import { useTranslation } from "react-i18next"

export interface UpdateInfo {
  has_update: boolean
  current_version: string
  latest_version: string
  release_url: string
  release_notes: string
  published_at: string
}

export const DISMISSED_UPDATE_VERSION_KEY = "dismissed_update_version"

interface UpdateDialogProps {
  isOpen: boolean
  updateInfo: UpdateInfo | null
  onClose: (dismissVersion?: boolean) => void
  onDownload: (url: string) => void
}

export function UpdateDialog({ isOpen, updateInfo, onClose, onDownload }: UpdateDialogProps) {
  const { t } = useTranslation()
  const [dismissVersion, setDismissVersion] = useState(false)

  // Reset checkbox when dialog opens
  useEffect(() => {
    if (isOpen) setDismissVersion(false)
  }, [isOpen])

  const container = useMemo(() => {
    if (typeof document === "undefined") return null
    const div = document.createElement("div")
    div.setAttribute("data-update-dialog", "")
    return div
  }, [])

  useEffect(() => {
    if (!isOpen || !container) return
    document.body.appendChild(container)
    return () => {
      if (container.parentNode) {
        container.parentNode.removeChild(container)
      }
    }
  }, [isOpen, container])

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen || !container || !updateInfo?.has_update) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={() => onClose()}
    >
      <Card
        className="w-full max-w-md border border-border shadow-2xl bg-card rounded-xl overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <CardContent className="p-0">
          {/* Header */}
          <div className="flex items-center justify-between p-5 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-full bg-primary/10">
                <Sparkles className="h-5 w-5 text-primary" />
              </div>
              <h3 className="text-base font-bold text-foreground">
                {t("settings.about.updateDialog.title")}
              </h3>
            </div>
            <button
              onClick={() => onClose()}
              className="rounded-lg p-1.5 transition-colors hover:bg-accent text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Version Info */}
          <div className="px-5 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {t("settings.about.updateDialog.currentVersion")}
              </span>
              <span className="font-medium">{updateInfo.current_version}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {t("settings.about.updateDialog.latestVersion")}
              </span>
              <span className="font-medium text-primary">{updateInfo.latest_version}</span>
            </div>
          </div>

          {/* Release Notes */}
          {updateInfo.release_notes && (
            <>
              <Separator className="my-3 mx-5" />
              <div className="px-5 pb-1">
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  {t("settings.about.updateDialog.releaseNotes")}
                </p>
                <div className="max-h-48 overflow-y-auto rounded-lg bg-accent/30 border border-border/50 p-3">
                  <pre className="text-xs text-foreground whitespace-pre-wrap break-words font-sans leading-relaxed">
                    {updateInfo.release_notes}
                  </pre>
                </div>
              </div>
            </>
          )}

          {/* Actions */}
          <div className="p-5 pt-4 space-y-3">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={dismissVersion}
                onChange={(e) => setDismissVersion(e.target.checked)}
                className="h-3.5 w-3.5 rounded accent-primary"
              />
              <span className="text-xs text-muted-foreground">
                {t("settings.about.updateDialog.dismissVersion", { version: updateInfo.latest_version })}
              </span>
            </label>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onClose(dismissVersion)}
                className="text-xs h-8 px-4"
              >
                {t("settings.about.updateDialog.close")}
              </Button>
              <Button
                size="sm"
                onClick={() => onDownload(updateInfo.release_url)}
                className="text-xs h-8 px-4"
              >
                <Download className="h-3.5 w-3.5 mr-1.5" />
                {t("settings.about.downloadUpdate")}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>,
    container
  )
}
