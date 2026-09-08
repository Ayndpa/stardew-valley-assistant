import { useState } from "react"
import { useTranslation } from "react-i18next"
import { DoorOpen, Home, MessageSquare, User, Users } from "lucide-react"
import { AccountProvider, useAccount } from "@shared/account/account-provider"
import { SocialProvider, useSocial } from "@shared/account/social-provider"
import type { FriendEntry } from "@shared/account/types"
import { MOBILE_VLAN_CONFIG } from "@shared/account/vlan"
import { cn } from "./lib/utils"
import { ToastProvider, useToast } from "./components/Toast"
import { ChatPage } from "./pages/Chat"
import { FriendsPage } from "./pages/Friends"
import { HomePage } from "./pages/Home"
import { LobbyPage } from "./pages/Lobby"
import { LoginPage } from "./pages/Login"
import { MePage } from "./pages/Me"
import { RoomPage } from "./pages/Room"
import "./index.css"

/** 底部标签栏的五个主页面；会话页是从好友页压入的二级页面，不占标签位 */
export type Tab = "home" | "lobby" | "room" | "friends" | "me"

/** 需要登录才能进入的标签 */
const NEEDS_LOGIN: Tab[] = ["lobby", "room", "friends", "me"]

const TABS: { key: Tab; icon: typeof Home }[] = [
  { key: "home", icon: Home },
  { key: "lobby", icon: DoorOpen },
  { key: "room", icon: Users },
  { key: "friends", icon: MessageSquare },
  { key: "me", icon: User },
]

function Shell({
  tab,
  onTab,
}: {
  tab: Tab
  onTab: (tab: Tab) => void
}) {
  const { t } = useTranslation()
  const { status } = useAccount()
  const { totalUnread, room } = useSocial()
  // 会话页：非空表示正在和该好友私聊，压在标签页之上
  const [chatWith, setChatWith] = useState<FriendEntry | null>(null)

  const needsLogin = NEEDS_LOGIN.includes(tab) && status !== "ready"

  const renderPage = () => {
    if (chatWith) return <ChatPage friend={chatWith} onBack={() => setChatWith(null)} />
    if (needsLogin) {
      // 本地 token 正在校验时先不闪登录表单
      if (status === "loading") {
        return (
          <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
            {t("social.login.checking")}
          </div>
        )
      }
      return <LoginPage />
    }
    switch (tab) {
      case "lobby":
        return <LobbyPage onJoined={() => onTab("room")} />
      case "room":
        return <RoomPage onGoLobby={() => onTab("lobby")} />
      case "friends":
        return (
          <FriendsPage onOpenChat={setChatWith} onJoinedRoom={() => onTab("room")} />
        )
      case "me":
        return <MePage />
      default:
        return <HomePage onGo={onTab} />
    }
  }

  return (
    <div className="mobile-shell flex h-full flex-col overflow-hidden">
      <main className="mobile-panel flex min-h-0 flex-1 flex-col overflow-hidden">{renderPage()}</main>

      {/* 会话页占满全屏（含自己的返回按钮），此时隐藏标签栏 */}
      {!chatWith && (
        <nav className="flex shrink-0 items-stretch border-t border-border/60 bg-card pb-safe">
          {TABS.map(({ key, icon: Icon }) => {
            const active = tab === key
            const badge = key === "friends" ? totalUnread : 0
            return (
              <button
                key={key}
                type="button"
                onClick={() => onTab(key)}
                className={cn(
                  "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 pt-1.5 transition-colors",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <span className="relative">
                  <Icon className="h-5 w-5" />
                  {badge > 0 && (
                    <span className="absolute -right-2 -top-1 min-w-4 rounded-full bg-red-500 px-1 text-center text-[10px] font-bold leading-4 text-white">
                      {badge > 99 ? "99+" : badge}
                    </span>
                  )}
                  {key === "room" && room && !active && (
                    <span className="absolute -right-1 -top-0.5 h-2 w-2 rounded-full bg-emerald-500" />
                  )}
                </span>
                <span className="text-[10px] font-semibold">{t(`social.nav.${key}`)}</span>
              </button>
            )
          })}
        </nav>
      )}
    </div>
  )
}

/** 标签状态提在 SocialProvider 之外：状态机要据此判断是否还需要弹房间 / 邀请提示 */
function SocialShell() {
  const { showToast } = useToast()
  const [tab, setTab] = useState<Tab>("home")

  return (
    <SocialProvider
      notify={showToast}
      socialActive={tab === "lobby" || tab === "room" || tab === "friends"}
      vlanConfig={MOBILE_VLAN_CONFIG}
    >
      <Shell tab={tab} onTab={setTab} />
    </SocialProvider>
  )
}

export default function App() {
  return (
    <AccountProvider>
      <ToastProvider>
        <SocialShell />
      </ToastProvider>
    </AccountProvider>
  )
}
