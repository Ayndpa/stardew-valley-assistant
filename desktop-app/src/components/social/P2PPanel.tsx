import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Cable, Check, ChevronDown, ChevronRight, Loader2, Unplug, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { useSocial } from "@/lib/account/social-provider"
import { displayName, formatTime } from "@/lib/account/utils"
import { ChatBox } from "./ChatBox"

interface P2PPanelProps {
  onShowToast: (message: string, type: "success" | "info" | "warning") => void
}

/** P2P 直连面板（REALTIME.md §6）：邀请横幅 + 状态日志 + 直连聊天 */
export function P2PPanel({ onShowToast }: P2PPanelProps) {
  const { t } = useTranslation()
  const { peer, p2pOffer, acceptP2POffer, declineP2POffer } = useSocial()
  const [showLog, setShowLog] = useState(false)
  const [accepting, setAccepting] = useState(false)

  const handleAccept = async () => {
    setAccepting(true)
    try {
      await acceptP2POffer()
    } finally {
      setAccepting(false)
    }
  }

  const handleSend = async (text: string) => {
    try {
      await peer.send(text)
      return true
    } catch (err) {
      onShowToast(t("social.p2p.sendFailed", { error: err instanceof Error ? err.message : String(err) }), "warning")
      return false
    }
  }

  const statusColor =
    peer.status === "connected"
      ? "text-emerald-600 dark:text-emerald-400"
      : peer.status === "connecting"
        ? "text-amber-600 dark:text-amber-400"
        : peer.status === "error"
          ? "text-destructive"
          : "text-muted-foreground"

  const errorText =
    peer.error === "p2p_unavailable" ? t("social.p2p.unavailable") : peer.error

  const active = peer.status !== "idle"

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border/80 bg-card">
      <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2.5">
        <Cable className="h-3.5 w-3.5 text-primary" />
        <p className="text-sm font-semibold">{t("social.p2p.title")}</p>
        <span className={cn("ml-auto flex items-center gap-1 text-[11px] font-medium", statusColor)}>
          {peer.status === "connecting" && <Loader2 className="h-3 w-3 animate-spin" />}
          {t(`social.p2p.status.${peer.status}`)}
        </span>
        {active && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-[11px] text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => void peer.close().then(() => peer.reset())}
          >
            <Unplug className="h-3 w-3" />
            {t("social.p2p.disconnect")}
          </Button>
        )}
      </div>

      {p2pOffer && (
        <div className="flex items-center gap-3 border-b border-primary/30 bg-primary/5 px-4 py-2.5 animate-in fade-in duration-200">
          <p className="min-w-0 flex-1 text-xs">
            {t("social.p2p.offerFrom", {
              name: p2pOffer.fromUser ? displayName(p2pOffer.fromUser) : p2pOffer.from.slice(0, 8),
            })}
            <span className="ml-2 font-mono text-[11px] text-muted-foreground">{p2pOffer.code}</span>
          </p>
          <Button size="sm" className="h-7 gap-1 px-2.5 text-[11px]" onClick={() => void handleAccept()} disabled={accepting}>
            {accepting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            {t("social.p2p.accept")}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[11px]" onClick={declineP2POffer} disabled={accepting}>
            <X className="h-3 w-3" />
            {t("social.p2p.decline")}
          </Button>
        </div>
      )}

      {!active && !p2pOffer ? (
        <div className="px-4 py-6 text-center text-xs text-muted-foreground">{t("social.p2p.description")}</div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border/60 px-4 py-2 text-[11px] text-muted-foreground">
            {peer.code && (
              <span>
                {t("social.p2p.code")}: <span className="font-mono text-foreground">{peer.code}</span>
              </span>
            )}
            {peer.role && (
              <span>
                {t("social.p2p.roleLabel")}: <span className="text-foreground">{t(`social.p2p.role.${peer.role}`)}</span>
              </span>
            )}
            {peer.peer && (
              <span>
                {t("social.p2p.peer")}: <span className="text-foreground">{peer.peer}</span>
              </span>
            )}
            {errorText && <span className="text-destructive">{errorText}</span>}
            <button
              type="button"
              onClick={() => setShowLog((v) => !v)}
              className="ml-auto flex items-center gap-0.5 text-[11px] hover:text-foreground cursor-pointer"
            >
              {showLog ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              {t("social.p2p.log")} ({peer.log.length})
            </button>
          </div>
          {showLog && (
            <div className="max-h-32 shrink-0 overflow-y-auto border-b border-border/60 bg-muted/40 px-4 py-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
              {peer.log.length === 0 ? (
                <p>—</p>
              ) : (
                peer.log.map((line) => (
                  <p key={line.id} className={cn(line.kind === "error" && "text-destructive", line.kind === "connected" && "text-emerald-600 dark:text-emerald-400")}>
                    [{formatTime(line.ts)}] {line.kind}: {line.text}
                  </p>
                ))
              )}
            </div>
          )}
          <div className="flex min-h-56 flex-1 flex-col">
            <ChatBox
              messages={peer.messages}
              onSend={handleSend}
              disabled={peer.status !== "connected"}
              placeholder={t("social.p2p.chatPlaceholder")}
              emptyText={peer.status === "connected" ? t("social.p2p.chatEmpty") : t("social.p2p.notConnected")}
            />
          </div>
        </>
      )}
    </div>
  )
}
