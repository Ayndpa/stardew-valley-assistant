import { useState, type FormEvent } from "react"
import { useTranslation } from "react-i18next"
import { Loader2, Search, UserPlus } from "lucide-react"
import { useAccount } from "@shared/account/account-provider"
import * as api from "@shared/account/api"
import { describeError } from "@shared/account/errors"
import { useSocial } from "@shared/account/social-provider"
import type { UserBrief } from "@shared/account/types"
import { displayName } from "@shared/account/utils"
import { useToast } from "../Toast"
import { Button, Input, Sheet } from "../ui"
import { UserAvatar } from "./UserAvatar"

interface AddFriendSheetProps {
  open: boolean
  onClose: () => void
}

/** 添加好友：GET /api/users/lookup 精确查人 → POST /api/friends/requests */
export function AddFriendSheet({ open, onClose }: AddFriendSheetProps) {
  const { t } = useTranslation()
  const { withToken } = useAccount()
  const { refreshFriends } = useSocial()
  const { showToast } = useToast()
  const [query, setQuery] = useState("")
  const [busy, setBusy] = useState(false)
  const [candidates, setCandidates] = useState<UserBrief[]>([])
  const [message, setMessage] = useState<{ text: string; tone: "muted" | "error" } | null>(null)

  const reset = () => {
    setQuery("")
    setCandidates([])
    setMessage(null)
  }

  const sendRequest = async (user: UserBrief) => {
    setBusy(true)
    try {
      const res = await withToken((tk) => api.sendFriendRequest(tk, user.id))
      showToast(
        res.accepted
          ? t("social.friends.requestAccepted", { name: displayName(user) })
          : t("social.friends.requestSent", { name: displayName(user) }),
        "success",
      )
      reset()
      await refreshFriends()
      onClose()
    } catch (err) {
      setMessage({ text: describeError(err, t, "social.friends.addFailed"), tone: "error" })
    } finally {
      setBusy(false)
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const q = query.trim()
    if (!q || busy) return
    setBusy(true)
    setMessage(null)
    setCandidates([])
    try {
      const users = await withToken((tk) => api.lookupUsers(tk, q))
      if (users.length === 0) {
        setMessage({ text: t("social.friends.lookupEmpty"), tone: "muted" })
      } else if (users.length === 1) {
        // 精确匹配只有一个结果时直接发申请，省掉一次点击
        setBusy(false)
        await sendRequest(users[0])
        return
      } else {
        setCandidates(users)
      }
    } catch (err) {
      setMessage({ text: describeError(err, t, "social.friends.addFailed"), tone: "error" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={() => {
        reset()
        onClose()
      }}
      title={t("social.friends.addTitle")}
    >
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("social.friends.addPlaceholder")}
          autoCapitalize="none"
          autoCorrect="off"
          disabled={busy}
        />
        <Button type="submit" disabled={busy || !query.trim()} className="w-24">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          {t("social.friends.addButton")}
        </Button>
      </form>

      {message && (
        <p className={message.tone === "error" ? "mt-3 text-xs text-destructive" : "mt-3 text-xs text-muted-foreground"}>
          {message.text}
        </p>
      )}

      {candidates.length > 0 && (
        <div className="mt-3 space-y-2">
          {candidates.map((u) => (
            <div key={u.id} className="flex items-center gap-3 rounded-2xl border border-border/60 bg-background p-2.5">
              <UserAvatar user={u} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{displayName(u)}</p>
                <p className="truncate font-mono text-[11px] text-muted-foreground">{u.id.slice(0, 8)}</p>
              </div>
              <Button size="sm" onClick={() => void sendRequest(u)} disabled={busy}>
                <UserPlus className="h-3.5 w-3.5" />
                {t("social.friends.addButton")}
              </Button>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  )
}
