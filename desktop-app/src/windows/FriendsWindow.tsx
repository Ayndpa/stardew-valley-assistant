import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Check, Loader2, LogOut, Pencil, Settings, Wifi, WifiOff, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAccount } from "@/lib/account/account-provider"
import { describeError } from "@/lib/account/errors"
import { useSocial, type Notifier } from "@/lib/account/social-provider"
import type { FriendEntry } from "@/lib/account/types"
import { displayName } from "@/lib/account/utils"
import { OPEN_CHATS_KEY, readOpenChats, useStorageValue } from "@/lib/account/window-signals"
import { openChatWindow } from "@/lib/account/windows"
import { AddFriend } from "@/components/social/AddFriend"
import { FriendList } from "@/components/social/FriendList"
import { LoginForm } from "@/components/social/LoginForm"
import { RequestsPanel } from "@/components/social/RequestsPanel"
import { UserAvatar } from "@/components/social/UserAvatar"
import { CloudSyncPanel } from "@/components/settings/CloudSyncPanel"
import { PopupChrome } from "./PopupChrome"
import { PopupShell } from "./PopupShell"

/** 好友窗口（Steam "好友与聊天"风格）：账号头部 + 在线/离线好友 + 好友申请 + 添加好友 */
export function FriendsWindow() {
  const { t } = useTranslation()
  return <PopupShell title={t("social.window.friendsTitle")}>{(showToast) => <FriendsWindowContent showToast={showToast} />}</PopupShell>
}

function FriendsWindowContent({ showToast }: { showToast: Notifier }) {
  const { t } = useTranslation()
  const { user, status, logout, updateProfile } = useAccount()
  const { hubStatus, friends, unread, markRead } = useSocial()
  const [showSettings, setShowSettings] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState("")
  const [savingName, setSavingName] = useState(false)

  // 某个好友的私聊窗口打开后，本窗口里该好友的未读随之清零
  const openChatsRaw = useStorageValue(OPEN_CHATS_KEY)
  useEffect(() => {
    for (const id of readOpenChats()) markRead(id)
  }, [openChatsRaw, markRead])

  const openChat = (friend: FriendEntry) => {
    markRead(friend.id)
    openChatWindow(friend.id, displayName(friend)).catch((err) => {
      showToast(describeError(err, t), "warning")
    })
  }

  const startEditName = () => {
    setNameDraft(user?.username ?? "")
    setEditingName(true)
  }

  const saveName = async () => {
    if (savingName) return
    setSavingName(true)
    try {
      await updateProfile(nameDraft)
      setEditingName(false)
    } catch (err) {
      showToast(describeError(err, t), "warning")
    } finally {
      setSavingName(false)
    }
  }

  if (status === "loading") {
    return (
      <>
        <PopupChrome title={t("social.window.friendsTitle")} />
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("social.login.checking")}
        </div>
      </>
    )
  }

  if (status !== "ready" || !user) {
    return (
      <>
        <PopupChrome title={t("social.window.friendsTitle")} />
        <div className="flex flex-1 flex-col justify-center overflow-y-auto px-5 py-6">
          <div className="mb-4 text-center">
            <p className="text-sm font-semibold">{t("social.login.title")}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t("social.login.description")}</p>
          </div>
          <LoginForm />
        </div>
      </>
    )
  }

  const statusLabel = t(`social.status.${hubStatus}`)

  return (
    <>
      <PopupChrome title={t("social.window.friendsTitle")} />

      {/* 账号头部 */}
      <div className="border-b border-border/60 bg-card px-3 py-3">
        <div className="flex items-center gap-3">
          <UserAvatar user={user} size="lg" online={hubStatus === "online"} />
          <div className="min-w-0 flex-1">
            {editingName ? (
              <div className="flex items-center gap-1">
                <Input
                  autoFocus
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void saveName()
                    if (e.key === "Escape") setEditingName(false)
                  }}
                  maxLength={32}
                  placeholder={t("settings.account.usernamePlaceholder")}
                  className="h-7 text-xs"
                  disabled={savingName}
                />
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => void saveName()} disabled={savingName} title={t("settings.account.save")}>
                  {savingName ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5 text-emerald-500" />}
                </Button>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditingName(false)} disabled={savingName} title={t("settings.account.cancel")}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={startEditName}
                className="group flex max-w-full items-center gap-1.5 text-left cursor-pointer"
                title={t("social.window.editName")}
              >
                <span className="truncate text-sm font-semibold">{displayName(user)}</span>
                <Pencil className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </button>
            )}
            <p
              className={cn(
                "mt-0.5 flex items-center gap-1 text-[11px]",
                hubStatus === "online" ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
              )}
            >
              {hubStatus === "online" ? <Wifi className="h-3 w-3" /> : hubStatus === "connecting" ? <Loader2 className="h-3 w-3 animate-spin" /> : <WifiOff className="h-3 w-3" />}
              {statusLabel}
            </p>
          </div>
          <Button
            size="sm"
            variant={showSettings ? "secondary" : "ghost"}
            className="h-8 w-8 p-0"
            onClick={() => setShowSettings((v) => !v)}
            title={t("social.window.settings")}
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>

        {showSettings && (
          <div className="mt-3 space-y-3 rounded-lg border border-border/60 bg-accent/20 p-3 animate-in fade-in slide-in-from-top-1 duration-150">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-xs font-medium">{user.email}</p>
                <p className="truncate font-mono text-[10px] text-muted-foreground">{user.id}</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 shrink-0 gap-1.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={logout}
              >
                <LogOut className="h-3.5 w-3.5" />
                {t("settings.account.logout")}
              </Button>
            </div>
            <CloudSyncPanel compact />
          </div>
        )}
      </div>

      {/* 好友列表 + 申请 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <FriendList friends={friends} unread={unread} onOpen={openChat} />
        <RequestsPanel onShowToast={showToast} />
      </div>

      {/* 添加好友 */}
      <div className="shrink-0 bg-card">
        <AddFriend onShowToast={showToast} />
      </div>
    </>
  )
}
