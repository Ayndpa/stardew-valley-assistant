import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Check, Loader2, X } from "lucide-react"
import { useAccount } from "@shared/account/account-provider"
import * as api from "@shared/account/api"
import { describeError } from "@shared/account/errors"
import { useSocial } from "@shared/account/social-provider"
import type { FriendRequest } from "@shared/account/types"
import { displayName } from "@shared/account/utils"
import { useToast } from "../Toast"
import { Button } from "../ui"
import { UserAvatar } from "./UserAvatar"

/** 好友申请：POST /api/friends/requests/:id/{accept,decline} */
export function RequestsPanel() {
  const { t } = useTranslation()
  const { withToken } = useAccount()
  const { requests, refreshFriends } = useSocial()
  const { showToast } = useToast()
  const [busyId, setBusyId] = useState<string | null>(null)

  const total = requests.incoming.length + requests.outgoing.length
  if (total === 0) return null

  const run = async (id: string, action: () => Promise<unknown>) => {
    setBusyId(id)
    try {
      await action()
      await refreshFriends()
    } catch (err) {
      showToast(describeError(err, t), "warning")
    } finally {
      setBusyId(null)
    }
  }

  const renderRow = (req: FriendRequest, kind: "incoming" | "outgoing") => {
    const busy = busyId === req.id
    return (
      <div
        key={req.id}
        className="flex min-h-14 items-center gap-3 rounded-2xl border border-border/60 bg-card px-3 py-2.5"
      >
        <UserAvatar user={req.user} />
        <p className="min-w-0 flex-1 truncate text-sm font-semibold">{displayName(req.user)}</p>
        {busy ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : kind === "incoming" ? (
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              aria-label={t("social.friends.accept")}
              onClick={() => void run(req.id, () => withToken((tk) => api.acceptFriendRequest(tk, req.id)))}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 active:bg-emerald-500/20 dark:text-emerald-400"
            >
              <Check className="h-5 w-5" />
            </button>
            <button
              type="button"
              aria-label={t("social.friends.decline")}
              onClick={() => void run(req.id, () => withToken((tk) => api.declineFriendRequest(tk, req.id)))}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 text-destructive active:bg-destructive/20"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void run(req.id, () => withToken((tk) => api.declineFriendRequest(tk, req.id)))}
          >
            {t("social.friends.cancelRequest")}
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-2 px-3 pb-2">
      <p className="px-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        {t("social.friends.requestsTitle")} · {total}
      </p>
      {requests.incoming.length > 0 && (
        <div className="space-y-2">
          <p className="px-1 text-[11px] text-muted-foreground">{t("social.friends.incoming")}</p>
          {requests.incoming.map((r) => renderRow(r, "incoming"))}
        </div>
      )}
      {requests.outgoing.length > 0 && (
        <div className="space-y-2">
          <p className="px-1 text-[11px] text-muted-foreground">{t("social.friends.outgoing")}</p>
          {requests.outgoing.map((r) => renderRow(r, "outgoing"))}
        </div>
      )}
    </div>
  )
}
