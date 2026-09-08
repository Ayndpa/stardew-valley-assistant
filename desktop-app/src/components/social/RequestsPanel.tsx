import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Check, Loader2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAccount } from "@/lib/account/account-provider"
import * as api from "@/lib/account/api"
import { describeError } from "@/lib/account/errors"
import { useSocial } from "@/lib/account/social-provider"
import type { FriendRequest } from "@/lib/account/types"
import { displayName } from "@/lib/account/utils"
import { UserAvatar } from "./UserAvatar"

interface RequestsPanelProps {
  onShowToast: (message: string, type: "success" | "info" | "warning") => void
}

export function RequestsPanel({ onShowToast }: RequestsPanelProps) {
  const { t } = useTranslation()
  const { withToken } = useAccount()
  const { requests, refreshFriends } = useSocial()
  const [busyId, setBusyId] = useState<string | null>(null)

  const total = requests.incoming.length + requests.outgoing.length
  if (total === 0) return null

  const run = async (id: string, action: () => Promise<unknown>) => {
    setBusyId(id)
    try {
      await action()
      await refreshFriends()
    } catch (err) {
      onShowToast(describeError(err, t), "warning")
    } finally {
      setBusyId(null)
    }
  }

  const renderRow = (req: FriendRequest, kind: "incoming" | "outgoing") => {
    const busy = busyId === req.id
    return (
      <div key={req.id} className="flex items-center gap-2 rounded-md px-1.5 py-1">
        <UserAvatar user={req.user} size="sm" />
        <p className="min-w-0 flex-1 truncate text-xs font-medium">{displayName(req.user)}</p>
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        ) : kind === "incoming" ? (
          <>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-600"
              title={t("social.friends.accept")}
              onClick={() => void run(req.id, () => withToken((tk) => api.acceptFriendRequest(tk, req.id)))}
            >
              <Check className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
              title={t("social.friends.decline")}
              onClick={() => void run(req.id, () => withToken((tk) => api.declineFriendRequest(tk, req.id)))}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px] text-muted-foreground"
            onClick={() => void run(req.id, () => withToken((tk) => api.declineFriendRequest(tk, req.id)))}
          >
            {t("social.friends.cancelRequest")}
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-2 border-t border-border/60 px-3 py-3">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {t("social.friends.requestsTitle")} · {total}
      </p>
      {requests.incoming.length > 0 && (
        <div className="space-y-1">
          <p className="px-1.5 text-[10px] text-muted-foreground">{t("social.friends.incoming")}</p>
          {requests.incoming.map((r) => renderRow(r, "incoming"))}
        </div>
      )}
      {requests.outgoing.length > 0 && (
        <div className="space-y-1">
          <p className="px-1.5 text-[10px] text-muted-foreground">{t("social.friends.outgoing")}</p>
          {requests.outgoing.map((r) => renderRow(r, "outgoing"))}
        </div>
      )}
    </div>
  )
}
