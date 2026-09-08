import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { ChevronDown, ChevronRight, ChevronRight as Arrow, Users } from "lucide-react"
import { cn } from "../../lib/utils"
import type { FriendEntry } from "@shared/account/types"
import { displayName } from "@shared/account/utils"
import { EmptyState } from "../ui"
import { UserAvatar } from "./UserAvatar"

interface FriendListProps {
  friends: FriendEntry[]
  unread: Record<string, number>
  /** 点击好友行：打开该好友的会话页 */
  onOpen: (friend: FriendEntry) => void
}

function sortByName(list: FriendEntry[]): FriendEntry[] {
  return [...list].sort((a, b) => displayName(a).localeCompare(displayName(b)))
}

/** 在线 / 离线两个可折叠分组，与桌面端一致 */
export function FriendList({ friends, unread, onOpen }: FriendListProps) {
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useState<{ online: boolean; offline: boolean }>({ online: false, offline: false })

  const online = useMemo(() => sortByName(friends.filter((f) => f.online)), [friends])
  const offline = useMemo(() => sortByName(friends.filter((f) => !f.online)), [friends])

  if (friends.length === 0) {
    return <EmptyState icon={<Users />} title={t("social.friends.empty")} />
  }

  const renderSection = (key: "online" | "offline", list: FriendEntry[]) => {
    const isCollapsed = collapsed[key]
    return (
      <div key={key} className="flex flex-col">
        <button
          type="button"
          onClick={() => setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }))}
          className="flex h-10 w-full items-center gap-1 px-4 text-[11px] font-bold uppercase tracking-wider text-muted-foreground"
        >
          {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          <span>{t(`social.friends.${key}Section`)}</span>
          <span className="font-normal">({list.length})</span>
        </button>
        {!isCollapsed && (
          <div className="flex flex-col gap-1 px-3">
            {list.map((friend) => {
              const count = unread[friend.id] ?? 0
              return (
                <button
                  key={friend.id}
                  type="button"
                  onClick={() => onOpen(friend)}
                  className="flex min-h-14 w-full items-center gap-3 rounded-2xl border border-border/60 bg-card px-3 py-2.5 text-left active:bg-accent/60"
                >
                  <UserAvatar user={friend} online={friend.online} />
                  <div className="min-w-0 flex-1">
                    <p className={cn("truncate text-sm font-semibold", !friend.online && "text-muted-foreground")}>
                      {displayName(friend)}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {t(friend.online ? "social.friends.online" : "social.friends.offline")}
                    </p>
                  </div>
                  {count > 0 ? (
                    <span className="min-w-6 rounded-full bg-red-500 px-1.5 text-center text-xs font-bold leading-6 text-white">
                      {count > 99 ? "99+" : count}
                    </span>
                  ) : (
                    <Arrow className="h-4 w-4 shrink-0 text-muted-foreground/50" />
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
    <div className="flex flex-col gap-1 pb-2">
      {renderSection("online", online)}
      {renderSection("offline", offline)}
    </div>
  )
}
