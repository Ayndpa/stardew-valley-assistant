import { useState, type FormEvent } from "react"
import { useTranslation } from "react-i18next"
import { Loader2, Search, UserPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAccount } from "@/lib/account/account-provider"
import * as api from "@/lib/account/api"
import { describeError } from "@/lib/account/errors"
import { useSocial } from "@/lib/account/social-provider"
import type { UserBrief } from "@/lib/account/types"
import { displayName } from "@/lib/account/utils"
import { UserAvatar } from "./UserAvatar"

interface AddFriendProps {
  onShowToast: (message: string, type: "success" | "info" | "warning") => void
}

export function AddFriend({ onShowToast }: AddFriendProps) {
  const { t } = useTranslation()
  const { withToken } = useAccount()
  const { refreshFriends } = useSocial()
  const [query, setQuery] = useState("")
  const [busy, setBusy] = useState(false)
  const [candidates, setCandidates] = useState<UserBrief[]>([])
  const [message, setMessage] = useState<{ text: string; tone: "muted" | "error" } | null>(null)

  const sendRequest = async (user: UserBrief) => {
    setBusy(true)
    try {
      const res = await withToken((tk) => api.sendFriendRequest(tk, user.id))
      onShowToast(
        res.accepted
          ? t("social.friends.requestAccepted", { name: displayName(user) })
          : t("social.friends.requestSent", { name: displayName(user) }),
        "success",
      )
      setQuery("")
      setCandidates([])
      setMessage(null)
      await refreshFriends()
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
    <div className="space-y-2 border-t border-border/60 px-3 py-3">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{t("social.friends.addTitle")}</p>
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("social.friends.addPlaceholder")}
          className="h-8 text-xs"
          disabled={busy}
        />
        <Button type="submit" size="sm" variant="outline" className="h-8 shrink-0 gap-1 px-2.5 text-xs" disabled={busy || !query.trim()}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          {t("social.friends.addButton")}
        </Button>
      </form>
      {message && <p className={message.tone === "error" ? "text-[11px] text-destructive" : "text-[11px] text-muted-foreground"}>{message.text}</p>}
      {candidates.length > 0 && (
        <div className="space-y-1 rounded-lg border border-border/60 bg-accent/20 p-1.5">
          {candidates.map((u) => (
            <div key={u.id} className="flex items-center gap-2 rounded-md px-1.5 py-1">
              <UserAvatar user={u} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">{displayName(u)}</p>
                <p className="truncate font-mono text-[10px] text-muted-foreground">{u.id.slice(0, 8)}</p>
              </div>
              <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[11px]" onClick={() => void sendRequest(u)} disabled={busy}>
                <UserPlus className="h-3 w-3" />
                {t("social.friends.addButton")}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
