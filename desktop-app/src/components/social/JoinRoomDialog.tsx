import { useEffect, useMemo, useState, type FormEvent } from "react"
import { createPortal } from "react-dom"
import { useTranslation } from "react-i18next"
import { Loader2, Lock } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface JoinRoomDialogProps {
  isOpen: boolean
  roomName: string
  roomCode: string
  busy: boolean
  error: string | null
  onSubmit: (password: string) => void
  onCancel: () => void
}

/** 加入带密码的房间时的密码输入弹窗（与 confirm-dialog 相同的 portal 方式） */
export function JoinRoomDialog({ isOpen, roomName, roomCode, busy, error, onSubmit, onCancel }: JoinRoomDialogProps) {
  const { t } = useTranslation()
  const [password, setPassword] = useState("")
  const container = useMemo(() => {
    if (typeof document === "undefined") return null
    const div = document.createElement("div")
    div.setAttribute("data-join-room-dialog", "")
    return div
  }, [])

  useEffect(() => {
    if (!isOpen || !container) return
    document.body.appendChild(container)
    return () => {
      if (container.parentNode) container.parentNode.removeChild(container)
    }
  }, [isOpen, container])

  useEffect(() => {
    if (isOpen) setPassword("")
  }, [isOpen])

  if (!isOpen || !container) return null

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    onSubmit(password)
  }

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <Card className="w-full max-w-sm overflow-hidden rounded-xl border border-border bg-card shadow-2xl animate-in zoom-in-95 duration-200">
        <CardContent className="space-y-4 p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="shrink-0 rounded-full bg-primary/10 p-2">
                <Lock className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0 space-y-1">
                <h3 className="text-sm font-bold text-foreground">{t("social.room.joinDialogTitle")}</h3>
                <p className="truncate text-xs text-muted-foreground">
                  {roomName} · <span className="font-mono">{roomCode}</span>
                </p>
              </div>
            </div>
            <Input
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("social.room.joinDialogPassword")}
              maxLength={32}
              className="h-9 text-sm"
              disabled={busy}
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={onCancel} className="h-8 px-4 text-xs" disabled={busy}>
                {t("social.room.joinDialogCancel")}
              </Button>
              <Button type="submit" size="sm" className="h-8 gap-1.5 px-4 text-xs" disabled={busy}>
                {busy && <Loader2 className="h-3 w-3 animate-spin" />}
                {t("social.room.joinDialogSubmit")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>,
    container,
  )
}
