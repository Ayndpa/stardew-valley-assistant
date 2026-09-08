import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Send, UserPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useSocial } from "@/lib/account/social-provider"
import type { RoomRef } from "@/lib/account/types"
import { displayName } from "@/lib/account/utils"
import { UserAvatar } from "./UserAvatar"

interface InviteFriendsMenuProps {
  room: RoomRef
  onShowToast: (message: string, type: "success" | "info" | "warning") => void
}

/** 房间页的"邀请好友"下拉：列出在线好友，点击即发送 invite.send */
export function InviteFriendsMenu({ room, onShowToast }: InviteFriendsMenuProps) {
  const { t } = useTranslation()
  const { friends, sendInvite } = useSocial()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const online = friends.filter((f) => f.online)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open])

  const invite = (userId: string) => {
    if (!sendInvite(userId, room)) onShowToast(t("social.chat.notConnected"), "warning")
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative">
      <Button size="sm" variant={open ? "secondary" : "outline"} className="h-8 gap-1.5 text-xs" onClick={() => setOpen((v) => !v)}>
        <UserPlus className="h-3.5 w-3.5" />
        {t("social.room.inviteFriends")}
      </Button>
      {open && (
        <div className="absolute right-0 top-9 z-50 w-56 overflow-hidden rounded-lg border border-border/80 bg-popover py-1 shadow-xl animate-in fade-in slide-in-from-top-1 duration-150">
          {online.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">{t("social.room.noOnlineFriends")}</p>
          ) : (
            <div className="max-h-64 overflow-y-auto">
              {online.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => invite(f.id)}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-accent cursor-pointer"
                >
                  <UserAvatar user={f} size="sm" online />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">{displayName(f)}</span>
                  <Send className="h-3 w-3 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
