import { useTranslation } from "react-i18next"
import { DoorOpen, X } from "lucide-react"
import { useSocial } from "@shared/account/social-provider"
import { displayName } from "@shared/account/utils"
import { Button } from "../ui"
import { UserAvatar } from "./UserAvatar"
import { useJoinRoomFlow } from "./useJoinRoomFlow"

interface InviteBannerProps {
  onJoined: () => void
}

/** 待处理的房间邀请（hub 的 invite 帧） */
export function InviteBanner({ onJoined }: InviteBannerProps) {
  const { t } = useTranslation()
  const { invites, dismissInvite } = useSocial()
  const join = useJoinRoomFlow(onJoined)

  if (invites.length === 0) return null

  return (
    <div className="space-y-2 px-3 pt-3">
      {invites.map((invite) => (
        <div key={invite.id} className="rounded-2xl border border-primary/30 bg-primary/5 p-3">
          <div className="flex items-center gap-3">
            <UserAvatar user={invite.from} size="sm" />
            <p className="min-w-0 flex-1 text-sm leading-snug">
              {t("social.invites.text", { name: displayName(invite.from), room: invite.room.name })}
            </p>
            <button
              type="button"
              aria-label={t("social.invites.dismiss")}
              onClick={() => dismissInvite(invite.id)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground active:bg-accent"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="mt-2.5 flex items-center gap-3">
            <span className="font-mono text-xs tracking-widest text-muted-foreground">{invite.room.code}</span>
            <Button
              size="sm"
              className="ml-auto"
              disabled={join.busy}
              onClick={() => {
                dismissInvite(invite.id)
                void join.start(invite.room.code, invite.room.name, false)
              }}
            >
              <DoorOpen className="h-3.5 w-3.5" />
              {t("social.invites.join")}
            </Button>
          </div>
        </div>
      ))}
      {join.element}
    </div>
  )
}
