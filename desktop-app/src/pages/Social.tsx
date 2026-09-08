import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { DoorOpen, Globe, Loader2, MessageSquare, Users, Wifi, WifiOff } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAccount } from "@/lib/account/account-provider"
import { useSocial } from "@/lib/account/social-provider"
import { displayName } from "@/lib/account/utils"
import { openFriendsWindow } from "@/lib/account/windows"
import { InviteBanner } from "@/components/social/InviteBanner"
import { LobbyPanel } from "@/components/social/LobbyPanel"
import { RoomPanel } from "@/components/social/RoomPanel"
import { UserAvatar } from "@/components/social/UserAvatar"

type SocialTab = "lobby" | "room"

interface SocialProps {
  onShowToast: (message: string, type: "success" | "info" | "warning") => void
}

/** 联机页：只保留大厅与房间；账号 / 好友 / 私聊都在独立的弹窗里 */
export function Social({ onShowToast }: SocialProps) {
  const { t } = useTranslation()
  const { status, user } = useAccount()
  const { hubStatus, room } = useSocial()
  const [tab, setTab] = useState<SocialTab>("lobby")

  const roomCode = room?.info.code ?? null

  // 加入 / 创建房间后自动切到房间页；房间关闭后退回大厅
  useEffect(() => {
    setTab(roomCode ? "room" : "lobby")
  }, [roomCode])

  const openFriends = () => {
    openFriendsWindow(t("social.window.friendsTitle")).catch((err) => console.error("open_friends_window failed:", err))
  }

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-primary to-green-600 bg-clip-text text-transparent">
          {t("social.title")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("social.description")}</p>
      </div>
      {status === "ready" && user && (
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-3 rounded-full border border-border/60 bg-card py-1 pl-1 pr-3">
            <UserAvatar user={user} size="sm" online={hubStatus === "online"} />
            <span className="max-w-40 truncate text-xs font-semibold">{displayName(user)}</span>
            <span
              className={cn(
                "flex items-center gap-1 text-[11px]",
                hubStatus === "online" ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
              )}
            >
              {hubStatus === "online" ? <Wifi className="h-3 w-3" /> : hubStatus === "connecting" ? <Loader2 className="h-3 w-3 animate-spin" /> : <WifiOff className="h-3 w-3" />}
              {t(`social.status.${hubStatus}`)}
            </span>
          </div>
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={openFriends}>
            <Users className="h-3.5 w-3.5" />
            {t("social.titlebar.open")}
          </Button>
        </div>
      )}
    </div>
  )

  if (status === "loading") {
    return (
      <div className="space-y-6 p-8">
        {header}
        <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {t("social.login.checking")}
        </div>
      </div>
    )
  }

  if (status !== "ready" || !user) {
    return (
      <div className="space-y-6 p-8">
        {header}
        <div className="flex min-h-[50vh] items-center justify-center">
          <Card className="w-full max-w-md overflow-hidden border border-border/80">
            <CardHeader className="bg-gradient-to-r from-primary/10 via-transparent to-transparent pb-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-primary/10">
                  <Globe className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-lg font-bold">{t("social.login.title")}</CardTitle>
                  <CardDescription>{t("social.login.description")}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 pt-6">
              <p className="text-xs text-muted-foreground">{t("social.login.openWindowHint")}</p>
              <Button className="w-full gap-2" onClick={openFriends}>
                <Users className="h-4 w-4" />
                {t("social.login.openWindow")}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-[600px] flex-col gap-4 p-8">
      {header}
      <InviteBanner onJoined={() => setTab("room")} onShowToast={onShowToast} />

      <Tabs value={tab} onValueChange={(v) => setTab(v as SocialTab)} className="flex min-h-0 flex-1 flex-col">
        <TabsList className="w-fit">
          <TabsTrigger value="lobby" className="gap-1.5">
            <MessageSquare className="h-3.5 w-3.5" />
            {t("social.tabs.lobby")}
          </TabsTrigger>
          <TabsTrigger value="room" className="gap-1.5" disabled={!room}>
            <DoorOpen className="h-3.5 w-3.5" />
            {t("social.tabs.room")}
            {room && <span className="font-mono text-[10px] text-muted-foreground">{room.info.code}</span>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="lobby" className="mt-4 flex min-h-0 flex-1 flex-col">
          <LobbyPanel onJoined={() => setTab("room")} onShowToast={onShowToast} />
        </TabsContent>

        <TabsContent value="room" className="mt-4 flex min-h-0 flex-1 flex-col">
          <RoomPanel onShowToast={onShowToast} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
