import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { DoorOpen } from "lucide-react"
import { useSocial } from "@shared/account/social-provider"
import type { ChatMessage, FriendEntry } from "@shared/account/types"
import { displayName } from "@shared/account/utils"
import { PageHeader } from "../components/PageHeader"
import { useToast } from "../components/Toast"
import { ChatBox } from "../components/social/ChatBox"

interface ChatPageProps {
  friend: FriendEntry
  onBack: () => void
}

/**
 * 私聊会话页：dm.send / dm / dm.echo / dm.ack（REALTIME.md §2.2）。
 * 服务端不存聊天记录，消息只保留在内存里，与桌面端语义一致。
 */
export function ChatPage({ friend, onBack }: ChatPageProps) {
  const { t } = useTranslation()
  const { dmThreads, sendDm, setActiveThread, room, sendInvite } = useSocial()
  const { showToast } = useToast()
  const [invited, setInvited] = useState(false)

  // 停留在本页时该好友的新消息不计未读
  useEffect(() => {
    setActiveThread(friend.id)
    return () => setActiveThread(null)
  }, [friend.id, setActiveThread])

  const messages = dmThreads.get(friend.id) ?? []

  const inviteToRoom = () => {
    if (!room) return
    if (sendInvite(friend.id, { code: room.info.code, name: room.info.name })) {
      setInvited(true)
      setTimeout(() => setInvited(false), 2000)
    } else {
      showToast(t("social.chat.notConnected"), "warning")
    }
  }

  const renderMeta = (msg: ChatMessage) => {
    if (msg.from !== "me") return null
    if (msg.pending) return <span>{t("social.chat.pending")}</span>
    if (msg.delivered === false) return <span className="text-amber-600 dark:text-amber-400">{t("social.chat.notDelivered")}</span>
    return null
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={displayName(friend)}
        subtitle={t(friend.online ? "social.friends.online" : "social.friends.offline")}
        onBack={onBack}
        action={
          room && (
            <button
              type="button"
              onClick={inviteToRoom}
              disabled={invited}
              className="flex h-10 items-center gap-1.5 rounded-full bg-primary/10 px-3 text-xs font-semibold text-primary active:bg-primary/20 disabled:opacity-60"
            >
              <DoorOpen className="h-4 w-4" />
              {t("social.friends.inviteToRoom")}
            </button>
          )
        }
      />

      {!friend.online && (
        <p className="shrink-0 border-b border-border/60 bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-300">
          {t("social.chat.friendOffline")}
        </p>
      )}

      <ChatBox
        messages={messages}
        onSend={(text) => sendDm(friend.id, text)}
        emptyText={t("social.chat.dmEmpty", { name: displayName(friend) })}
        renderMeta={renderMeta}
      />
    </div>
  )
}
