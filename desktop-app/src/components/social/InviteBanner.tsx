import { useTranslation } from "react-i18next"
import { DoorOpen, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useSocial } from "@/lib/account/social-provider"
import { displayName } from "@/lib/account/utils"
import { UserAvatar } from "./UserAvatar"
import { useJoinRoomFlow } from "./useJoinRoomFlow"

interface InviteBannerProps {
  onJoined: () => void
  onShowToast: (message: string, type: "success" | "info" | "warning") => void
}

/** 待处理的房间邀请（来自 hub 的 invite 帧） */
export function InviteBanner({ onJoined, onShowToast }: InviteBannerProps) {
  const { t } = useTranslation()
  const { invites, dismissInvite } = useSocial()
  const join = useJoinRoomFlow(onJoined, (message) => onShowToast(message, "warning"))

  if (invites.length === 0) return null

  return (
    <div className="space-y-2">
      {invites.map((invite) => (
        <div
          key={invite.id}
          className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5 animate-in fade-in slide-in-from-top-1 duration-200"
        >
          <UserAvatar user={invite.from} size="sm" />
          <p className="min-w-0 flex-1 truncate text-sm">
            {t("social.invites.text", { name: displayName(invite.from), room: invite.room.name })}
            <span className="ml-2 font-mono text-xs text-muted-foreground">{invite.room.code}</span>
          </p>
          <Button
            size="sm"
            className="h-8 gap-1.5 text-xs"
            disabled={join.busy}
            onClick={() => {
              dismissInvite(invite.id)
              void join.start(invite.room.code, invite.room.name, false)
            }}
          >
            <DoorOpen className="h-3.5 w-3.5" />
            {t("social.invites.join")}
          </Button>
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title={t("social.invites.dismiss")} onClick={() => dismissInvite(invite.id)}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}
      {join.element}
    </div>
  )
}
