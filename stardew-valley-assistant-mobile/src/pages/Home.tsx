import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import {
  CalendarDays,
  ChevronRight,
  DoorOpen,
  Map,
  MessageSquare,
  PackageOpen,
  Play,
  Puzzle,
  Sprout,
  Trophy,
  Users,
} from "lucide-react"
import { useSocial } from "@shared/account/social-provider"
import appIcon from "../assets/app-icon.png"

interface HomePageProps {
  onGo: (tab: "lobby" | "room" | "friends") => void
}

/** 尚未实现的功能，保持原有"即将上线"占位 */
const SOON: { icon: ReactNode; key: string }[] = [
  { icon: <Trophy />, key: "collections" },
  { icon: <Sprout />, key: "crops" },
  { icon: <Users />, key: "npcs" },
  { icon: <CalendarDays />, key: "calendar" },
  { icon: <PackageOpen />, key: "bundles" },
  { icon: <Map />, key: "fishing" },
  { icon: <Puzzle />, key: "mods" },
  { icon: <Play />, key: "launcher" },
]

export function HomePage({ onGo }: HomePageProps) {
  const { t } = useTranslation()
  const { room, totalUnread } = useSocial()

  const online: { icon: ReactNode; key: "lobby" | "room" | "friends"; desc: string; badge?: number }[] = [
    { icon: <DoorOpen />, key: "lobby", desc: t("home.online.lobbyDesc") },
    { icon: <Users />, key: "room", desc: room ? room.info.name : t("home.online.roomIdle") },
    {
      icon: <MessageSquare />,
      key: "friends",
      desc: totalUnread > 0 ? t("home.online.friendsUnread", { count: totalUnread }) : t("home.online.friendsDesc"),
      badge: totalUnread,
    },
  ]

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-safe">
      {/* 顶部品牌区 */}
      <div className="flex flex-col items-center pt-8 text-center">
        <div className="relative">
          <div className="absolute -inset-4 rounded-full bg-primary/15 blur-2xl" />
          <img
            src={appIcon}
            alt="星露谷物语助手"
            draggable={false}
            className="pixelated relative h-24 w-24 rounded-3xl border border-primary/25 object-cover shadow-xl shadow-primary/10"
          />
        </div>
        <h1 className="mt-6 bg-gradient-to-r from-primary to-green-600 bg-clip-text text-3xl font-extrabold tracking-tight text-transparent">
          星露谷物语助手
        </h1>
        <p className="mt-2 text-sm font-medium text-muted-foreground">{t("home.subtitle")}</p>
      </div>

      {/* 联机入口（已可用） */}
      <section className="mt-9">
        <div className="flex items-center gap-2 px-1">
          <span className="h-4 w-1 rounded-full bg-primary" />
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            {t("home.onlineSection")}
          </h2>
        </div>
        <div className="mt-4 space-y-2.5">
          {online.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => onGo(item.key)}
              className="flex min-h-16 w-full items-center gap-3.5 rounded-2xl border border-border/70 bg-card px-4 py-3.5 text-left active:bg-accent/60"
            >
              <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary [&_svg]:h-5 [&_svg]:w-5">
                {item.icon}
                {!!item.badge && item.badge > 0 && (
                  <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-500 px-1 text-center text-[10px] font-bold leading-5 text-white">
                    {item.badge > 99 ? "99+" : item.badge}
                  </span>
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold text-card-foreground">
                  {t(`home.online.${item.key}`)}
                </span>
                <span className="block truncate text-xs text-muted-foreground">{item.desc}</span>
              </span>
              <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground/50" />
            </button>
          ))}
        </div>
      </section>

      {/* 功能预告 */}
      <section className="mt-8">
        <div className="flex items-center gap-2 px-1">
          <span className="h-4 w-1 rounded-full bg-muted-foreground/40" />
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t("home.soonSection")}</h2>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          {SOON.map((feature) => (
            <div
              key={feature.key}
              className="flex items-center gap-3 rounded-xl border border-border/70 bg-card/70 px-4 py-3.5 opacity-70"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:h-5 [&_svg]:w-5">
                {feature.icon}
              </span>
              <span className="min-w-0 truncate text-sm font-medium text-card-foreground">
                {t(`home.features.${feature.key}`)}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-5 text-center text-xs leading-relaxed text-muted-foreground/80">{t("home.soonHint")}</p>
        <p className="mt-3 text-center text-[10px] font-medium tracking-wider text-muted-foreground/60">
          {t("home.version")}
        </p>
      </section>
    </div>
  )
}
