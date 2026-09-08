import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Check, Copy, Crown, DoorOpen, Lock, Power, UserX } from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useConfirm } from "@/hooks/useConfirm"
import { useSocial } from "@/lib/account/social-provider"
import { displayName } from "@/lib/account/utils"
import { ChatBox } from "./ChatBox"
import { InviteFriendsMenu } from "./InviteFriendsMenu"
import { UserAvatar } from "./UserAvatar"
import { VlanPanel } from "./VlanPanel"

interface RoomPanelProps {
  onShowToast: (message: string, type: "success" | "info" | "warning") => void
}

export function RoomPanel({ onShowToast }: RoomPanelProps) {
  const { t } = useTranslation()
  const { room, leaveRoom, sendRoomChat, kick, closeRoom } = useSocial()
  const { confirm, ConfirmDialogElement } = useConfirm()
  const [copied, setCopied] = useState(false)

  if (!room) {
    return <div className="py-10 text-center text-sm text-muted-foreground">{t("social.room.notInRoom")}</div>
  }

  const isHost = room.info.host_id === room.you
  const members = [...room.members].sort((a, b) => a.joined_at - b.joined_at)

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(room.info.code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      onShowToast(t("social.room.copyFailed"), "warning")
    }
  }

  const handleLeave = async () => {
    const ok = await confirm({
      title: t("social.room.leaveConfirmTitle"),
      message: t("social.room.leaveConfirmMessage"),
      confirmText: t("social.room.leave"),
      cancelText: t("social.room.cancel"),
    })
    if (ok) leaveRoom()
  }

  const handleClose = async () => {
    const ok = await confirm({
      title: t("social.room.closeConfirmTitle"),
      message: t("social.room.closeConfirmMessage"),
      confirmText: t("social.room.close"),
      cancelText: t("social.room.cancel"),
      variant: "destructive",
    })
    if (ok && !closeRoom()) onShowToast(t("social.chat.notConnected"), "warning")
  }

  const handleKick = async (userId: string, name: string) => {
    const ok = await confirm({
      title: t("social.room.kickConfirmTitle"),
      message: t("social.room.kickConfirmMessage", { name }),
      confirmText: t("social.room.kick"),
      cancelText: t("social.room.cancel"),
      variant: "destructive",
    })
    if (ok && !kick(userId)) onShowToast(t("social.chat.notConnected"), "warning")
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/* 头部 */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/80 bg-card px-4 py-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <DoorOpen className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-base font-bold">{room.info.name}</p>
            {room.info.locked && <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
            {isHost && (
              <Badge variant="secondary" className="gap-1 text-[10px]">
                <Crown className="h-3 w-3 text-amber-500" />
                {t("social.room.host")}
              </Badge>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>{t("social.room.code")}</span>
            <span className="font-mono text-sm font-semibold tracking-widest text-foreground">{room.info.code}</span>
            <button
              type="button"
              onClick={() => void copyCode()}
              className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-accent hover:text-foreground cursor-pointer"
              title={t("social.room.copy")}
            >
              {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
              {copied ? t("social.room.copied") : t("social.room.copy")}
            </button>
            <span>·</span>
            <span>
              {room.members.length}/{room.info.max}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <InviteFriendsMenu room={{ code: room.info.code, name: room.info.name }} onShowToast={onShowToast} />
          {isHost && (
            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => void handleClose()}>
              <Power className="h-3.5 w-3.5" />
              {t("social.room.close")}
            </Button>
          )}
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => void handleLeave()}>
            <DoorOpen className="h-3.5 w-3.5" />
            {t("social.room.leave")}
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {/* 成员 */}
        <div className="flex min-h-0 flex-col gap-4">
          <div className="flex max-h-72 min-h-0 flex-col overflow-hidden rounded-xl border border-border/80 bg-card">
            <div className="border-b border-border/60 px-4 py-2.5">
              <p className="text-sm font-semibold">
                {t("social.room.members")} <span className="text-[11px] font-normal text-muted-foreground">({members.length})</span>
              </p>
            </div>
            <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
              {members.map((m) => {
                const me = m.id === room.you
                const host = m.id === room.info.host_id
                return (
                  <div key={m.id} className={cn("flex items-center gap-2.5 rounded-lg px-2 py-1.5", me && "bg-accent/40")}>
                    <UserAvatar user={m} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 truncate text-sm">
                        {displayName(m)}
                        {host && <Crown className="h-3 w-3 shrink-0 text-amber-500" />}
                        {me && <span className="text-[10px] text-muted-foreground">({t("social.room.you")})</span>}
                      </p>
                      {m.vip && (
                        <p className="font-mono text-[10px] text-muted-foreground" title={t("social.vlan.colVip")}>
                          {m.vip}
                        </p>
                      )}
                    </div>
                    {isHost && !me && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        title={t("social.room.kick")}
                        onClick={() => void handleKick(m.id, displayName(m))}
                      >
                        <UserX className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
          <VlanPanel onShowToast={onShowToast} />
        </div>

        {/* 房间聊天 */}
        <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border/80 bg-card">
          <div className="border-b border-border/60 px-4 py-2.5">
            <p className="text-sm font-semibold">{t("social.room.chatTitle")}</p>
          </div>
          <ChatBox messages={room.chat} onSend={sendRoomChat} />
        </div>
      </div>
      {ConfirmDialogElement}
    </div>
  )
}
