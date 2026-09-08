import { useState } from "react"
import { useTranslation } from "react-i18next"
import { UserPlus } from "lucide-react"
import { useSocial } from "@shared/account/social-provider"
import type { FriendEntry } from "@shared/account/types"
import { PageHeader } from "../components/PageHeader"
import { AddFriendSheet } from "../components/social/AddFriendSheet"
import { FriendList } from "../components/social/FriendList"
import { InviteBanner } from "../components/social/InviteBanner"
import { RequestsPanel } from "../components/social/RequestsPanel"

interface FriendsPageProps {
  onOpenChat: (friend: FriendEntry) => void
  onJoinedRoom: () => void
}

/**
 * 好友页：好友列表（hub.ready / presence / friends.changed）+ 好友申请 + 房间邀请。
 * 好友数据来自 GET /api/friends 与 GET /api/friends/requests，在线状态来自 hub。
 */
export function FriendsPage({ onOpenChat, onJoinedRoom }: FriendsPageProps) {
  const { t } = useTranslation()
  const { friends, unread } = useSocial()
  const [adding, setAdding] = useState(false)

  const online = friends.filter((f) => f.online).length

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={t("social.friends.title")}
        subtitle={t("social.friends.onlineCount", { online, total: friends.length })}
        action={
          <button
            type="button"
            aria-label={t("social.friends.addTitle")}
            onClick={() => setAdding(true)}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary active:bg-primary/20"
          >
            <UserPlus className="h-5 w-5" />
          </button>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        <InviteBanner onJoined={onJoinedRoom} />
        <RequestsPanel />
        <FriendList friends={friends} unread={unread} onOpen={onOpenChat} />
      </div>

      <AddFriendSheet open={adding} onClose={() => setAdding(false)} />
    </div>
  )
}
