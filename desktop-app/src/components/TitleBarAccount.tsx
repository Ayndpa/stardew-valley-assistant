import { useTranslation } from "react-i18next"
import { LogIn } from "lucide-react"
import { cn } from "@/lib/utils"
import { useAccount } from "@/lib/account/account-provider"
import { useSocial } from "@/lib/account/social-provider"
import { displayName, initialOf } from "@/lib/account/utils"
import { openFriendsWindow } from "@/lib/account/windows"

/**
 * 标题栏右侧的账号入口（Steam 风格）：
 * 已登录 → 头像首字 + 用户名 + 在线点 + 未读角标；未登录 → "登录账号"。点击都打开好友窗口。
 */
export function TitleBarAccount() {
  const { t } = useTranslation()
  const { user, status } = useAccount()
  const { hubStatus, totalUnread } = useSocial()

  const open = () => {
    openFriendsWindow(t("social.window.friendsTitle")).catch((err) => console.error("open_friends_window failed:", err))
  }

  // 启动时有本地缓存的账号但仍在校验 token（status = loading）：直接按已登录展示，避免闪现"登录账号"
  if (!user || status === "idle") {
    return (
      <button
        type="button"
        data-titlebar-no-drag="true"
        onClick={open}
        className="flex h-7 items-center gap-1.5 rounded-full border border-border/60 bg-accent/30 px-2.5 text-[11px] font-medium text-foreground transition-colors hover:bg-accent cursor-pointer"
        title={t("social.titlebar.login")}
      >
        <LogIn className="h-3.5 w-3.5 text-primary" />
        {t("social.titlebar.login")}
      </button>
    )
  }

  const online = hubStatus === "online"

  return (
    <button
      type="button"
      data-titlebar-no-drag="true"
      onClick={open}
      className="relative flex h-7 max-w-48 items-center gap-2 rounded-full border border-border/60 bg-accent/30 py-0.5 pl-0.5 pr-2.5 transition-colors hover:bg-accent cursor-pointer"
      title={t("social.titlebar.open")}
    >
      <span className="relative shrink-0">
        <span className="flex h-6 w-6 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-[11px] font-bold text-primary">
          {initialOf(user)}
        </span>
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-card",
            online ? "bg-emerald-500" : hubStatus === "connecting" ? "bg-amber-400" : "bg-muted-foreground/50",
          )}
        />
      </span>
      <span className="truncate text-[11px] font-semibold text-foreground">{displayName(user)}</span>
      {totalUnread > 0 && (
        <span className="min-w-4 rounded-full bg-red-500 px-1 text-center text-[10px] font-bold leading-4 text-white">
          {totalUnread > 99 ? "99+" : totalUnread}
        </span>
      )}
    </button>
  )
}
