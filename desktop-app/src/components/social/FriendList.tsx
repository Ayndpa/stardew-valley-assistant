import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { ChevronDown, ChevronRight, MessageSquare, Users } from "lucide-react"
import { cn } from "@/lib/utils"
import type { FriendEntry } from "@/lib/account/types"
import { displayName } from "@/lib/account/utils"
import { UserAvatar } from "./UserAvatar"

interface FriendListProps {
  friends: FriendEntry[]
  unread: Record<string, number>
  /** 点击好友行（好友窗口里会打开该好友的私聊窗口） */
  onOpen: (friend: FriendEntry) => void
}

function sortByName(list: FriendEntry[]): FriendEntry[] {
  return [...list].sort((a, b) => displayName(a).localeCompare(displayName(b)))
}

/** Steam 风格的好友列表：在线 / 离线两个可折叠分组 */
export function FriendList({ friends, unread, onOpen }: FriendListProps) {
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useState<{ online: boolean; offline: boolean }>({ online: false, offline: false })

  const online = useMemo(() => sortByName(friends.filter((f) => f.online)), [friends])
  const offline = useMemo(() => sortByName(friends.filter((f) => !f.online)), [friends])

  if (friends.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-xs text-muted-foreground">
        <Users className="h-6 w-6 opacity-40" />
        {t("social.friends.empty")}
      </div>
    )
  }

  const renderSection = (key: "online" | "offline", list: FriendEntry[]) => {
    const isCollapsed = collapsed[key]
    return (
      <div key={key} className="flex flex-col">
        <button
          type="button"
          onClick={() => setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }))}
          className="flex w-full items-center gap-1 px-3 pb-1 pt-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground cursor-pointer"
        >
          {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          <span>{t(`social.friends.${key}Section`)}</span>
          <span className="font-normal">({list.length})</span>
        </button>
        {!isCollapsed && (
          <div className="flex flex-col gap-0.5 px-2">
            {list.map((friend) => {
              const count = unread[friend.id] ?? 0
              return (
                <button
                  key={friend.id}
                  type="button"
                  onClick={() => onOpen(friend)}
                  title={t("social.friends.openChat")}
                  className="group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent/60 cursor-pointer"
                >
                  <UserAvatar user={friend} size="sm" online={friend.online} />
                  <div className="min-w-0 flex-1">
                    <p className={cn("truncate text-sm font-medium", !friend.online && "text-muted-foreground")}>{displayName(friend)}</p>
                  </div>
                  {count > 0 ? (
                    <span className="min-w-5 rounded-full bg-red-500 px-1.5 text-center text-[10px] font-bold leading-5 text-white">
                      {count > 99 ? "99+" : count}
                    </span>
                  ) : (
                    <MessageSquare className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col pb-2">
      {renderSection("online", online)}
      {renderSection("offline", offline)}
    </div>
  )
}
