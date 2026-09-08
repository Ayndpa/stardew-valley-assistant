import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Loader2, MailWarning, MoreVertical, Send, UserMinus, UserX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useConfirm } from "@/hooks/useConfirm"
import { useAccount } from "@/lib/account/account-provider"
import * as api from "@/lib/account/api"
import { describeError } from "@/lib/account/errors"
import { useSocial, type Notifier } from "@/lib/account/social-provider"
import type { ChatMessage } from "@/lib/account/types"
import { displayName } from "@/lib/account/utils"
import { CURRENT_ROOM_KEY, addOpenChat, readCurrentRoom, removeOpenChat, useStorageValue } from "@/lib/account/window-signals"
import { closeCurrentWindow } from "@/lib/account/windows"
import { ChatBox } from "@/components/social/ChatBox"
import { PopupChrome } from "./PopupChrome"
import { PopupShell } from "./PopupShell"

interface ChatWindowProps {
  userId: string
}

/** 与一位好友的私聊窗口 */
export function ChatWindow({ userId }: ChatWindowProps) {
  const { t } = useTranslation()
  const [title, setTitle] = useState(t("social.window.chatTitle"))
  return (
    <PopupShell title={title}>
      {(showToast) => <ChatWindowContent userId={userId} showToast={showToast} onTitle={setTitle} />}
    </PopupShell>
  )
}

function ChatWindowContent({ userId, showToast, onTitle }: ChatWindowProps & { showToast: Notifier; onTitle: (title: string) => void }) {
  const { t } = useTranslation()
  const { status, withToken } = useAccount()
  const { hubStatus, friends, dmThreads, sendDm, setActiveThread, markRead, sendInvite, refreshFriends } = useSocial()
  const { confirm, ConfirmDialogElement } = useConfirm()
  const [menuOpen, setMenuOpen] = useState(false)
  const [removing, setRemoving] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const friend = friends.find((f) => f.id === userId) ?? null
  const messages = useMemo(() => dmThreads.get(userId) ?? [], [dmThreads, userId])
  const currentRoomRaw = useStorageValue(CURRENT_ROOM_KEY)
  const currentRoom = useMemo(() => (currentRoomRaw ? readCurrentRoom() : null), [currentRoomRaw])

  // 告知其他窗口"这个好友的聊天窗口已打开"（好友窗口/主窗口据此不再累计未读）
  useEffect(() => {
    addOpenChat(userId)
    const cleanup = () => removeOpenChat(userId)
    window.addEventListener("pagehide", cleanup)
    return () => {
      window.removeEventListener("pagehide", cleanup)
      cleanup()
    }
  }, [userId])

  useEffect(() => {
    setActiveThread(userId)
    return () => setActiveThread(null)
  }, [userId, setActiveThread])

  useEffect(() => {
    markRead(userId)
  }, [messages.length, userId, markRead])

  useEffect(() => {
    if (friend) onTitle(displayName(friend))
  }, [friend, onTitle])

  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [menuOpen])

  const handleInvite = () => {
    if (!currentRoom) return
    if (!sendInvite(userId, currentRoom)) showToast(t("social.chat.notConnected"), "warning")
  }

  const handleRemove = async () => {
    setMenuOpen(false)
    if (!friend) return
    const ok = await confirm({
      title: t("social.friends.removeConfirmTitle"),
      message: t("social.friends.removeConfirmMessage", { name: displayName(friend) }),
      confirmText: t("social.friends.removeButton"),
      cancelText: t("social.friends.cancel"),
      variant: "destructive",
    })
    if (!ok) return
    setRemoving(true)
    try {
      await withToken((tk) => api.removeFriend(tk, userId))
      await refreshFriends().catch(() => {})
      await closeCurrentWindow()
    } catch (err) {
      showToast(describeError(err, t), "warning")
      setRemoving(false)
    }
  }

  const renderMeta = (msg: ChatMessage) => {
    if (msg.from !== "me") return null
    if (msg.pending) return <span>{t("social.chat.pending")}</span>
    if (msg.delivered === false) {
      return (
        <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
          <MailWarning className="h-3 w-3" />
          {t("social.chat.notDelivered")}
        </span>
      )
    }
    return null
  }

  if (status !== "ready") {
    return (
      <>
        <PopupChrome title={t("social.window.chatTitle")} />
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">{t("social.login.title")}</div>
      </>
    )
  }

  if (!friend) {
    return (
      <>
        <PopupChrome title={t("social.window.chatTitle")} />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
          {hubStatus === "online" ? (
            <>
              <UserX className="h-8 w-8 opacity-40" />
              <p>{t("social.window.notFriend")}</p>
              <Button size="sm" variant="outline" onClick={() => void closeCurrentWindow()}>
                {t("titlebar.close")}
              </Button>
            </>
          ) : (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              <p>{t("social.window.loading")}</p>
            </>
          )}
        </div>
      </>
    )
  }

  return (
    <>
      <PopupChrome
        title={displayName(friend)}
        subtitle={
          <span className={friend.online ? "text-emerald-600 dark:text-emerald-400" : undefined}>
            {friend.online ? t("social.friends.online") : t("social.friends.offline")}
          </span>
        }
        right={
          <>
            {currentRoom && (
              <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-[11px]" onClick={handleInvite} disabled={!friend.online} title={currentRoom.name}>
                <Send className="h-3 w-3" />
                {t("social.friends.inviteToRoom")}
              </Button>
            )}
            <div ref={menuRef} className="relative">
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setMenuOpen((v) => !v)} title={t("social.window.more")}>
                {removing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MoreVertical className="h-3.5 w-3.5" />}
              </Button>
              {menuOpen && (
                <div className="absolute right-0 top-8 z-50 min-w-36 overflow-hidden rounded-lg border border-border/80 bg-popover py-1 shadow-xl animate-in fade-in slide-in-from-top-1 duration-150">
                  <button
                    type="button"
                    onClick={() => void handleRemove()}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-destructive transition-colors hover:bg-destructive/10 cursor-pointer"
                  >
                    <UserMinus className="h-3.5 w-3.5" />
                    {t("social.friends.remove")}
                  </button>
                </div>
              )}
            </div>
          </>
        }
      />
      {!friend.online && (
        <div className="border-b border-amber-500/20 bg-amber-500/10 px-4 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
          {t("social.chat.friendOffline")}
        </div>
      )}
      <ChatBox
        messages={messages}
        onSend={(text) => sendDm(userId, text)}
        disabled={hubStatus !== "online" || removing}
        emptyText={t("social.chat.dmEmpty", { name: displayName(friend) })}
        renderMeta={renderMeta}
      />
      {ConfirmDialogElement}
    </>
  )
}
