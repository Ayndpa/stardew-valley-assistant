import { useTranslation } from "react-i18next"
import { Send } from "lucide-react"
import { useSocial } from "@shared/account/social-provider"
import type { RoomRef } from "@shared/account/types"
import { displayName } from "@shared/account/utils"
import { useToast } from "../Toast"
import { Sheet } from "../ui"
import { UserAvatar } from "./UserAvatar"

interface InviteFriendsSheetProps {
  open: boolean
  onClose: () => void
  room: RoomRef
}

/** 邀请好友进房：列出在线好友，点击即发 invite.send */
export function InviteFriendsSheet({ open, onClose, room }: InviteFriendsSheetProps) {
  const { t } = useTranslation()
  const { friends, sendInvite } = useSocial()
  const { showToast } = useToast()

  const online = friends.filter((f) => f.online)

  const invite = (userId: string) => {
    if (!sendInvite(userId, room)) showToast(t("social.chat.notConnected"), "warning")
    onClose()
  }

  return (
    <Sheet open={open} onClose={onClose} title={t("social.room.inviteFriends")}>
      {online.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t("social.room.noOnlineFriends")}</p>
      ) : (
        <div className="space-y-2">
          {online.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => invite(f.id)}
              className="flex min-h-14 w-full items-center gap-3 rounded-2xl border border-border/60 bg-background px-3 py-2.5 text-left active:bg-accent/60"
            >
              <UserAvatar user={f} online />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{displayName(f)}</span>
              <Send className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>
      )}
    </Sheet>
  )
}
