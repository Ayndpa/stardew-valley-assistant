import { useEffect, useMemo } from "react"
import { createPortal } from "react-dom"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { AlertTriangle, X } from "lucide-react"
import { useTranslation } from "react-i18next"

interface BetaDialogProps {
  isOpen: boolean
  onClose: () => void
}

export function BetaDialog({ isOpen, onClose }: BetaDialogProps) {
  const { t } = useTranslation()

  const container = useMemo(() => {
    if (typeof document === "undefined") return null
    const div = document.createElement("div")
    div.setAttribute("data-beta-dialog", "")
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

  if (!isOpen || !container) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={() => onClose()}
    >
      <Card
        className="w-full max-w-sm border border-border shadow-2xl bg-card rounded-xl overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <CardContent className="p-0">
          {/* Header */}
          <div className="flex items-center justify-between p-5 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-full bg-amber-500/15">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
              </div>
              <h3 className="text-base font-bold text-foreground">
                {t("beta.dialogTitle")}
              </h3>
            </div>
            <button
              onClick={() => onClose()}
              className="rounded-lg p-1.5 transition-colors hover:bg-accent text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Message */}
          <div className="px-5 pb-1">
            <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-4">
              <p className="text-sm text-foreground leading-relaxed whitespace-pre-line">
                {t("beta.dialogMessage")}
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="p-5 pt-4 flex justify-end">
            <Button
              size="sm"
              onClick={() => onClose()}
              className="text-xs h-8 px-6"
            >
              {t("beta.dialogConfirm")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>,
    container
  )
}
