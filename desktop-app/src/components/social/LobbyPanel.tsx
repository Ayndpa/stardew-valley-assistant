import { useState, type FormEvent } from "react"
import { useTranslation } from "react-i18next"
import { DoorOpen, Loader2, Lock, LockOpen, Plus, Users, Wifi, WifiOff } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { describeError } from "@/lib/account/errors"
import { useSocial } from "@/lib/account/social-provider"
import type { RoomSummary } from "@/lib/account/types"
import { useLobby } from "@/lib/account/use-lobby"
import { displayName } from "@/lib/account/utils"
import { ChatBox } from "./ChatBox"
import { UserAvatar } from "./UserAvatar"
import { useJoinRoomFlow } from "./useJoinRoomFlow"

interface LobbyPanelProps {
  onJoined: () => void
  onShowToast: (message: string, type: "success" | "info" | "warning") => void
}

export function LobbyPanel({ onJoined, onShowToast }: LobbyPanelProps) {
  const { t } = useTranslation()
  const lobby = useLobby()
  const { joinRoom, room } = useSocial()
  const join = useJoinRoomFlow(onJoined, (message) => onShowToast(message, "warning"))

  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState("")
  const [max, setMax] = useState(4)
  const [password, setPassword] = useState("")
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [codeInput, setCodeInput] = useState("")

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || creating) return
    setCreating(true)
    setCreateError(null)
    try {
      const created = await lobby.createRoom(trimmed, max, password || undefined)
      await joinRoom(created.code, password || undefined)
      setShowCreate(false)
      setName("")
      setPassword("")
      onJoined()
    } catch (err) {
      setCreateError(describeError(err, t, "social.lobby.createFailed"))
    } finally {
      setCreating(false)
    }
  }

  const handleJoinByCode = (e: FormEvent) => {
    e.preventDefault()
    const code = codeInput.trim().toUpperCase()
    if (!code) return
    const known = lobby.rooms.find((r) => r.code === code)
    void join.start(code, known?.name ?? code, known?.locked ?? false)
    setCodeInput("")
  }

  const statusIcon =
    lobby.status === "online" ? <Wifi className="h-3.5 w-3.5 text-emerald-500" /> : lobby.status === "connecting" ? (
      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
    ) : (
      <WifiOff className="h-3.5 w-3.5 text-muted-foreground" />
    )

  const renderRoom = (r: RoomSummary) => {
    const isCurrent = room?.info.code === r.code
    const full = r.count >= r.max
    return (
      <div
        key={r.code}
        className={cn(
          "flex items-center gap-3 rounded-xl border bg-card px-3 py-2.5 transition-colors",
          isCurrent ? "border-primary/50 bg-primary/5" : "border-border/60 hover:border-border",
        )}
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {r.locked ? <Lock className="h-4 w-4" /> : <LockOpen className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold">{r.name}</p>
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{r.code}</span>
          </div>
          <p className="truncate text-[11px] text-muted-foreground">
            {t("social.lobby.hostLabel", { name: displayName(r.host) })} · {r.count}/{r.max}
          </p>
        </div>
        <Button
          size="sm"
          variant={isCurrent ? "secondary" : "outline"}
          className="h-8 gap-1.5 text-xs"
          disabled={join.busy || isCurrent || full}
          onClick={() => void join.start(r.code, r.name, r.locked)}
        >
          <DoorOpen className="h-3.5 w-3.5" />
          {isCurrent ? t("social.lobby.joined") : full ? t("social.lobby.full") : t("social.lobby.join")}
        </Button>
      </div>
    )
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      {/* 房间列表 + 创建 */}
      <div className="flex min-h-0 flex-col rounded-xl border border-border/80 bg-card">
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <div className="flex items-center gap-2">
            {statusIcon}
            <p className="text-sm font-semibold">{t("social.lobby.rooms")}</p>
            <span className="text-[11px] text-muted-foreground">({lobby.rooms.length})</span>
          </div>
          <Button size="sm" variant={showCreate ? "secondary" : "default"} className="h-8 gap-1.5 text-xs" onClick={() => setShowCreate((v) => !v)}>
            <Plus className="h-3.5 w-3.5" />
            {t("social.lobby.create")}
          </Button>
        </div>

        {showCreate && (
          <form onSubmit={handleCreate} className="space-y-3 border-b border-border/60 bg-accent/20 px-4 py-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-foreground">{t("social.lobby.roomName")}</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("social.lobby.roomNamePlaceholder")}
                  maxLength={32}
                  className="h-8 text-xs"
                  disabled={creating}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-foreground">{t("social.lobby.maxPlayers")}</label>
                <div className="flex h-8 items-center gap-1">
                  {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setMax(n)}
                      className={cn(
                        "h-7 flex-1 rounded-md border text-xs font-medium transition-colors cursor-pointer",
                        max === n ? "border-primary bg-primary text-primary-foreground" : "border-border/60 bg-background hover:bg-accent",
                      )}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-foreground">
                {t("social.lobby.password")}
                <span className="ml-1 font-normal text-muted-foreground">{t("social.lobby.passwordOptional")}</span>
              </label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                maxLength={32}
                className="h-8 text-xs"
                disabled={creating}
              />
            </div>
            {createError && <p className="text-[11px] text-destructive">{createError}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setShowCreate(false)} disabled={creating}>
                {t("social.lobby.cancel")}
              </Button>
              <Button type="submit" size="sm" className="h-8 gap-1.5 text-xs" disabled={creating || !name.trim() || lobby.status !== "online"}>
                {creating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {creating ? t("social.lobby.creating") : t("social.lobby.createButton")}
              </Button>
            </div>
          </form>
        )}

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          {lobby.rooms.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 py-10 text-center text-xs text-muted-foreground">
              <DoorOpen className="h-6 w-6 opacity-40" />
              {lobby.status === "online" ? t("social.lobby.noRooms") : t("social.lobby.connecting")}
            </div>
          ) : (
            lobby.rooms.map(renderRoom)
          )}
        </div>

        <form onSubmit={handleJoinByCode} className="flex items-center gap-2 border-t border-border/60 px-3 py-2">
          <Input
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
            placeholder={t("social.lobby.codePlaceholder")}
            maxLength={6}
            className="h-8 font-mono text-xs uppercase"
          />
          <Button type="submit" size="sm" variant="outline" className="h-8 shrink-0 text-xs" disabled={join.busy || codeInput.trim().length !== 6}>
            {t("social.lobby.joinByCode")}
          </Button>
        </form>
      </div>

      {/* 在线成员 + 大厅聊天 */}
      <div className="flex min-h-0 flex-col gap-4">
        <div className="max-h-44 shrink-0 overflow-hidden rounded-xl border border-border/80 bg-card">
          <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2.5">
            <Users className="h-3.5 w-3.5 text-primary" />
            <p className="text-sm font-semibold">{t("social.lobby.members")}</p>
            <span className="text-[11px] text-muted-foreground">({lobby.members.length})</span>
          </div>
          <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto p-3">
            {lobby.members.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("social.lobby.noMembers")}</p>
            ) : (
              lobby.members.map((m) => (
                <div key={m.id} className="flex items-center gap-1.5 rounded-full border border-border/60 bg-accent/30 py-0.5 pl-0.5 pr-2.5">
                  <UserAvatar user={m} size="sm" />
                  <span className="max-w-32 truncate text-xs">{displayName(m)}</span>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/80 bg-card">
          <div className="border-b border-border/60 px-4 py-2.5">
            <p className="text-sm font-semibold">{t("social.lobby.chatTitle")}</p>
          </div>
          <ChatBox messages={lobby.chat} onSend={lobby.sendChat} disabled={lobby.status !== "online"} />
        </div>
      </div>
      {join.element}
    </div>
  )
}
