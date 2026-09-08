import { useState, type FormEvent } from "react"
import { useTranslation } from "react-i18next"
import { DoorOpen, Loader2, Lock, LockOpen, Plus, Users, Wifi, WifiOff } from "lucide-react"
import { describeError } from "@shared/account/errors"
import { useSocial } from "@shared/account/social-provider"
import type { RoomSummary } from "@shared/account/types"
import { useLobby } from "@shared/account/use-lobby"
import { displayName } from "@shared/account/utils"
import { cn } from "../lib/utils"
import { PageHeader } from "../components/PageHeader"
import { Button, EmptyState, Field, Input, Sheet } from "../components/ui"
import { ChatBox } from "../components/social/ChatBox"
import { UserAvatar } from "../components/social/UserAvatar"
import { useJoinRoomFlow } from "../components/social/useJoinRoomFlow"

interface LobbyPageProps {
  onJoined: () => void
}

const MAX_OPTIONS = [2, 3, 4, 5, 6, 7, 8]

/**
 * 大厅页：/ws/lobby 的 lobby.ready / lobby.rooms / lobby.members / lobby.chat / room.create → room.created。
 * 房间列表与聊天在手机上放不下并排布局，改为页内两个标签页。
 */
export function LobbyPage({ onJoined }: LobbyPageProps) {
  const { t } = useTranslation()
  const lobby = useLobby()
  const { room } = useSocial()
  const join = useJoinRoomFlow(onJoined)

  const [tab, setTab] = useState<"rooms" | "chat">("rooms")
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
      // 创建者需要自己连房间（REALTIME.md §3.2），否则 60 秒后房间会被回收
      await join.start(created.code, created.name, false)
      setShowCreate(false)
      setName("")
      setPassword("")
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
    lobby.status === "online" ? (
      <Wifi className="h-4 w-4 text-emerald-500" />
    ) : lobby.status === "connecting" ? (
      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
    ) : (
      <WifiOff className="h-4 w-4 text-muted-foreground" />
    )

  const renderRoom = (r: RoomSummary) => {
    const isCurrent = room?.info.code === r.code
    const full = r.count >= r.max
    return (
      <div
        key={r.code}
        className={cn(
          "flex items-center gap-3 rounded-2xl border bg-card px-3 py-3",
          isCurrent ? "border-primary/50 bg-primary/5" : "border-border/60",
        )}
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          {r.locked ? <Lock className="h-5 w-5" /> : <LockOpen className="h-5 w-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-bold">{r.name}</p>
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{r.code}</span>
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {t("social.lobby.hostLabel", { name: displayName(r.host) })} · {r.count}/{r.max}
          </p>
        </div>
        <Button
          size="sm"
          variant={isCurrent ? "outline" : "primary"}
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
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={t("social.lobby.title")}
        subtitle={t(`social.status.${lobby.status}`)}
        action={
          <button
            type="button"
            aria-label={t("social.lobby.create")}
            onClick={() => setShowCreate(true)}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary active:bg-primary/20"
          >
            <Plus className="h-5 w-5" />
          </button>
        }
      />

      <div className="flex shrink-0 gap-1 border-b border-border/60 bg-card px-3 pb-2">
        {(["rooms", "chat"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "h-9 flex-1 rounded-xl text-sm font-semibold transition-colors",
              tab === key ? "bg-primary/10 text-primary" : "text-muted-foreground",
            )}
          >
            {t(key === "rooms" ? "social.lobby.tabRooms" : "social.lobby.tabChat")}
          </button>
        ))}
      </div>

      {tab === "rooms" ? (
        <>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
            <div className="flex items-center gap-2 px-1 pb-1 text-xs text-muted-foreground">
              {statusIcon}
              <span>
                {t("social.lobby.rooms")} ({lobby.rooms.length})
              </span>
              <span className="ml-auto flex items-center gap-1">
                <Users className="h-3.5 w-3.5" />
                {lobby.members.length}
              </span>
            </div>
            {lobby.rooms.length === 0 ? (
              <EmptyState
                icon={<DoorOpen />}
                title={lobby.status === "online" ? t("social.lobby.noRooms") : t("social.lobby.connecting")}
              />
            ) : (
              lobby.rooms.map(renderRoom)
            )}
          </div>
          <form onSubmit={handleJoinByCode} className="flex shrink-0 items-center gap-2 border-t border-border/60 bg-card p-3 pb-safe">
            <Input
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
              placeholder={t("social.lobby.codePlaceholder")}
              maxLength={6}
              autoCapitalize="characters"
              autoCorrect="off"
              className="font-mono uppercase"
            />
            <Button type="submit" variant="outline" disabled={join.busy || codeInput.trim().length !== 6}>
              {join.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t("social.lobby.joinByCode")}
            </Button>
          </form>
        </>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 flex-wrap gap-1.5 border-b border-border/60 p-3">
            {lobby.members.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("social.lobby.noMembers")}</p>
            ) : (
              lobby.members.map((m) => (
                <span
                  key={m.id}
                  className="flex items-center gap-1.5 rounded-full border border-border/60 bg-accent/30 py-0.5 pl-0.5 pr-2.5"
                >
                  <UserAvatar user={m} size="sm" />
                  <span className="max-w-28 truncate text-xs">{displayName(m)}</span>
                </span>
              ))
            )}
          </div>
          <ChatBox messages={lobby.chat} onSend={lobby.sendChat} disabled={lobby.status !== "online"} />
        </div>
      )}

      <Sheet open={showCreate} onClose={() => setShowCreate(false)} title={t("social.lobby.create")}>
        <form onSubmit={handleCreate} className="space-y-4">
          <Field label={t("social.lobby.roomName")}>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("social.lobby.roomNamePlaceholder")}
              maxLength={32}
              disabled={creating}
            />
          </Field>
          <div className="space-y-1.5">
            <p className="px-0.5 text-xs font-bold">{t("social.lobby.maxPlayers")}</p>
            <div className="grid grid-cols-7 gap-1.5">
              {MAX_OPTIONS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setMax(n)}
                  className={cn(
                    "h-11 rounded-xl border text-sm font-bold transition-colors",
                    max === n ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background",
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <Field label={t("social.lobby.password")} hint={t("social.lobby.passwordOptional")}>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              maxLength={32}
              disabled={creating}
            />
          </Field>
          {createError && <p className="text-xs text-destructive">{createError}</p>}
          <Button
            type="submit"
            className="w-full"
            disabled={creating || !name.trim() || lobby.status !== "online"}
          >
            {creating && <Loader2 className="h-4 w-4 animate-spin" />}
            {creating ? t("social.lobby.creating") : t("social.lobby.createButton")}
          </Button>
        </form>
      </Sheet>

      {join.element}
    </div>
  )
}
