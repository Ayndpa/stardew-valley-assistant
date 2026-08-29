import { useEffect, useMemo } from "react"
import { createPortal } from "react-dom"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { AlertTriangle } from "lucide-react"

interface ConfirmDialogProps {
  isOpen: boolean
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  variant?: "default" | "destructive"
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmText = "确定",
  cancelText = "取消",
  variant = "default",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const container = useMemo(() => {
    if (typeof document === "undefined") return null
    const div = document.createElement("div")
    div.setAttribute("data-confirm-dialog", "")
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

  if (!isOpen || !container) return null

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <Card className="w-full max-w-sm border border-border shadow-2xl bg-card rounded-xl overflow-hidden animate-in zoom-in-95 duration-200">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-start gap-3">
            {variant === "destructive" && (
              <div className="p-2 rounded-full bg-destructive/10 shrink-0">
                <AlertTriangle className="h-5 w-5 text-destructive" />
              </div>
            )}
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-foreground">{title}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">{message}</p>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onCancel}
              className="text-xs h-8 px-4"
            >
              {cancelText}
            </Button>
            <Button
              variant={variant === "destructive" ? "destructive" : "default"}
              size="sm"
              onClick={onConfirm}
              className="text-xs h-8 px-4"
            >
              {confirmText}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>,
    container
  )
}
