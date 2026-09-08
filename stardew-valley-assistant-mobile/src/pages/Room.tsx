import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Check, Copy, Crown, DoorOpen, Lock, Power, UserPlus, UserX } from "lucide-react"
import { useSocial } from "@shared/account/social-provider"
import { displayName } from "@shared/account/utils"
import { cn } from "../lib/utils"
import { PageHeader } from "../components/PageHeader"
import { useToast } from "../components/Toast"
import { useConfirm } from "../components/useConfirm"
import { Badge, Button, EmptyState } from "../components/ui"
import { ChatBox } from "../components/social/ChatBox"
import { InviteFriendsSheet } from "../components/social/InviteFriendsSheet"
import { UserAvatar } from "../components/social/UserAvatar"
import { VlanCard } from "../components/social/VlanCard"

interface RoomPageProps {
  onGoLobby: () => void
}

/**
 * 房间页：/ws/room/<code> 的 room.ready / room.members / room.joined / room.left /
 * room.chat / room.kick / room.close / room.leave（REALTIME.md §4）。
 */
export function RoomPage({ onGoLobby }: RoomPageProps) {
  const { t } = useTranslation()
  const { room, leaveRoom, sendRoomChat, kick, closeRoom } = useSocial()
  const { showToast } = useToast()
  const { confirm, element: confirmElement } = useConfirm()
  const [tab, setTab] = useState<"members" | "chat">("members")
  const [copied, setCopied] = useState(false)
  const [inviting, setInviting] = useState(false)

  if (!room) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <PageHeader title={t("social.room.title")} />
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center">
          <EmptyState icon={<DoorOpen />} title={t("social.room.notInRoom")} hint={t("social.room.notInRoomHint")} />
          <Button onClick={onGoLobby}>{t("social.room.goLobby")}</Button>
        </div>
      </div>
    )
  }

  const isHost = room.info.host_id === room.you
  const members = [...room.members].sort((a, b) => a.joined_at - b.joined_at)

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(room.info.code)
      setCopied(true)
      showToast(t("social.room.copied"), "success")
      setTimeout(() => setCopied(false), 1500)
    } catch {
      showToast(t("social.room.copyFailed"), "warning")
    }
  }

  const handleLeave = async () => {
    const ok = await confirm({
      title: t("social.room.leaveConfirmTitle"),
      message: t("social.room.leaveConfirmMessage"),
      confirmText: t("social.room.leave"),
    })
    if (ok) leaveRoom()
  }

  const handleClose = async () => {
    const ok = await confirm({
      title: t("social.room.closeConfirmTitle"),
      message: t("social.room.closeConfirmMessage"),
      confirmText: t("social.room.close"),
      danger: true,
    })
    if (ok && !closeRoom()) showToast(t("social.chat.notConnected"), "warning")
  }

  const handleKick = async (userId: string, name: string) => {
    const ok = await confirm({
      title: t("social.room.kickConfirmTitle"),
      message: t("social.room.kickConfirmMessage", { name }),
      confirmText: t("social.room.kick"),
      danger: true,
    })
    if (ok && !kick(userId)) showToast(t("social.chat.notConnected"), "warning")
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={room.info.name}
        subtitle={`${room.members.length}/${room.info.max}`}
        action={
          <button
            type="button"
            aria-label={t("social.room.inviteFriends")}
            onClick={() => setInviting(true)}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary active:bg-primary/20"
          >
            <UserPlus className="h-5 w-5" />
          </button>
        }
      />

      {/* 房间号：局域网联机时要念给队友，做成一整块大点击区域 */}
      <button
        type="button"
        onClick={() => void copyCode()}
        className="flex shrink-0 items-center gap-3 border-b border-border/60 bg-card px-4 py-3 text-left active:bg-accent/40"
      >
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {t("social.room.code")}
            {room.info.locked && <Lock className="h-3 w-3" />}
            {isHost && (
              <Badge>
                <Crown className="h-3 w-3 text-amber-500" />
                {t("social.room.host")}
              </Badge>
            )}
          </p>
          <p className="font-mono text-xl font-bold tracking-[0.3em]">{room.info.code}</p>
        </div>
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
          {copied ? <Check className="h-5 w-5 text-emerald-500" /> : <Copy className="h-5 w-5" />}
        </span>
      </button>

      <div className="flex shrink-0 gap-1 border-b border-border/60 bg-card px-3 pb-2 pt-2">
        {(["members", "chat"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "h-9 flex-1 rounded-xl text-sm font-semibold transition-colors",
              tab === key ? "bg-primary/10 text-primary" : "text-muted-foreground",
            )}
          >
            {t(key === "members" ? "social.room.tabMembers" : "social.room.tabChat")}
          </button>
        ))}
      </div>

      {tab === "members" ? (
        <>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto py-3">
            <VlanCard />
            <div className="space-y-1.5 px-3">
              {members.map((m) => {
                const me = m.id === room.you
                const host = m.id === room.info.host_id
                return (
                  <div
                    key={m.id}
                    className={cn(
                      "flex min-h-14 items-center gap-3 rounded-2xl border border-border/60 px-3 py-2.5",
                      me ? "bg-accent/40" : "bg-card",
                    )}
                  >
                    <UserAvatar user={m} />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 truncate text-sm font-semibold">
                        {displayName(m)}
                        {host && <Crown className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
                        {me && <span className="text-[11px] font-normal text-muted-foreground">({t("social.room.you")})</span>}
                      </p>
                      {m.vip && <p className="font-mono text-[11px] text-muted-foreground">{m.vip}</p>}
                    </div>
                    {isHost && !me && (
                      <button
                        type="button"
                        aria-label={t("social.room.kick")}
                        onClick={() => void handleKick(m.id, displayName(m))}
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive active:bg-destructive/20"
                      >
                        <UserX className="h-5 w-5" />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
          <div className="flex shrink-0 gap-3 border-t border-border/60 bg-card p-3 pb-safe">
            {isHost && (
              <Button variant="danger" className="flex-1" onClick={() => void handleClose()}>
                <Power className="h-4 w-4" />
                {t("social.room.close")}
              </Button>
            )}
            <Button variant="outline" className="flex-1" onClick={() => void handleLeave()}>
              <DoorOpen className="h-4 w-4" />
              {t("social.room.leave")}
            </Button>
          </div>
        </>
      ) : (
        <ChatBox messages={room.chat} onSend={sendRoomChat} />
      )}

      <InviteFriendsSheet
        open={inviting}
        onClose={() => setInviting(false)}
        room={{ code: room.info.code, name: room.info.name }}
      />
      {confirmElement}
    </div>
  )
}
