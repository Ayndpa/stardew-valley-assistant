import { useState, useRef, useEffect } from "react"
import { getVersion } from "@tauri-apps/api/app"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { Page, SaveSummary } from "@/App"
import appIcon from "@/assets/app-icon.png"
import { useTranslation } from "react-i18next"
import {
  LayoutDashboard,
  Sprout,
  Users,
  CalendarDays,
  Settings,
  Puzzle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  User,
  Download,
  Play,
  ListChecks,
  Fish,
  PencilRuler,
  ArchiveRestore,
  Package,
} from "lucide-react"

interface SidebarProps {
  currentPage: Page
  onNavigate: (page: Page) => void
  saves: SaveSummary[]
  selectedSaveId: string
  onSaveChange: (id: string) => void
  collapsed: boolean
  onToggleCollapse: () => void
  onLaunchGame: (launchMode?: "default" | "vanilla") => void
  isGameRunning: boolean
  downloadStats: {
    running: number
    queued: number
    paused: number
    failed: number
    finished: number
    total: number
    maxConcurrent: number
  }
  enabledFeatures: Page[]
}

const navItems: { id: Page; label: string; icon: React.ReactNode }[] = [
  { id: "dashboard", label: "仪表盘", icon: <LayoutDashboard /> },
  { id: "crops", label: "作物管理", icon: <Sprout /> },
  { id: "items", label: "物品百科", icon: <Package className="h-4 w-4" /> },
  { id: "npcs", label: "村民关系", icon: <Users /> },
  { id: "calendar", label: "节日日历", icon: <CalendarDays /> },
  { id: "fishingMap", label: "游戏地图", icon: <Fish /> },
  { id: "saveEditor", label: "存档编辑", icon: <PencilRuler className="h-4 w-4" /> },
  { id: "saveBackups", label: "存档备份", icon: <ArchiveRestore className="h-4 w-4" /> },
  { id: "mods", label: "模组管理", icon: <Puzzle /> },
  { id: "onlineMods", label: "获取模组", icon: <Download className="h-4 w-4" /> },
  { id: "downloads", label: "下载管理", icon: <ListChecks className="h-4 w-4" /> },
  { id: "settings", label: "设置", icon: <Settings /> },
]

function SaveAvatar({
  save,
  className,
  iconClassName,
}: {
  save?: SaveSummary
  className?: string
  iconClassName?: string
}) {
  return (
    <div
      className={cn(
        "rounded-md flex items-center justify-center bg-primary/10 border border-sidebar-border/60 shrink-0 overflow-hidden shadow-sm",
        className
      )}
    >
      {save?.farmerAvatar ? (
        <img
          src={save.farmerAvatar}
          alt={`${save.playerName}头像`}
          className="h-full w-auto object-contain [image-rendering:pixelated]"
          draggable={false}
        />
      ) : (
        <User className={cn("h-4 w-4 text-primary", iconClassName)} />
      )}
    </div>
  )
}

export function Sidebar({
  currentPage,
  onNavigate,
  saves,
  selectedSaveId,
  onSaveChange,
  collapsed,
  onToggleCollapse,
  onLaunchGame,
  isGameRunning,
  downloadStats,
  enabledFeatures,
}: SidebarProps) {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const [isLaunchMenuOpen, setIsLaunchMenuOpen] = useState(false)
  const [appVersion, setAppVersion] = useState<string>("")
  const dropdownRef = useRef<HTMLDivElement>(null)
  const launchDropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => setAppVersion(""))
  }, [])

  // Click outside to close
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
      if (launchDropdownRef.current && !launchDropdownRef.current.contains(event.target as Node)) {
        setIsLaunchMenuOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const currentSave = saves.find((s) => s.id === selectedSaveId) || saves[0]
  const activeDownloadCount = downloadStats.queued + downloadStats.running + downloadStats.paused

  const handleSelectSave = (id: string) => {
    onSaveChange(id)
    setIsOpen(false)
  }

  const handleLaunch = (launchMode?: "default" | "vanilla") => {
    setIsLaunchMenuOpen(false)
    onLaunchGame(launchMode)
  }

  return (
    <aside className={cn(
      "app-sidebar border-r border-sidebar-border/70 flex flex-col pt-13 transition-all duration-300",
      collapsed ? "w-16" : "w-64"
    )}>
      {/* Logo */}
      <div className={cn("flex items-center gap-3 py-5 transition-all duration-300", collapsed ? "px-3 justify-center" : "px-6")}>
        <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg border border-sidebar-border/60 bg-card shadow-sm shrink-0">
          <img
            src={appIcon}
            alt={t("sidebar.version")}
            className="h-full w-full object-cover"
            draggable={false}
          />
        </div>
        {!collapsed && (
          <div className="overflow-hidden min-w-0 flex-1">
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold leading-tight text-sidebar-foreground truncate">
                  {t("sidebar.appName")}
                </span>
                {appVersion && (
                  <span className="shrink-0 rounded border border-sidebar-border/60 bg-sidebar-accent/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    v{appVersion}
                  </span>
                )}
              </div>
              {t("sidebar.appNameSubtitle") && (
                <span className="text-xs font-medium leading-tight text-muted-foreground truncate">
                  {t("sidebar.appNameSubtitle")}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      <Separator className="bg-sidebar-border" />

      {/* Save File Selector */}
      {saves.length > 0 && (
        <>
          <div className={cn("py-3 relative", collapsed ? "px-2" : "px-4")} ref={dropdownRef}>
            {!collapsed && (
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block mb-1.5 px-1">
                {t("sidebar.currentSave")}
              </label>
            )}
            
            {/* Custom Dropdown Trigger */}
            <button
              onClick={() => setIsOpen(!isOpen)}
              className={cn(
                "w-full flex items-center bg-sidebar-accent/20 border border-sidebar-border/60 hover:border-sidebar-border hover:bg-sidebar-accent/40 rounded-lg text-left transition-all duration-200 cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary/50",
                collapsed ? "justify-center px-1 py-2" : "justify-between gap-3 px-3 py-2",
                isOpen && "border-sidebar-border bg-sidebar-accent/40"
              )}
              title={collapsed ? (currentSave?.playerName || t("sidebar.noSaveSelected")) : undefined}
            >
              <div className={cn("flex items-center", collapsed ? "" : "gap-2.5 min-w-0")}>
                {currentSave ? (
                  <SaveAvatar
                    save={currentSave}
                    className={collapsed ? "h-11 w-10" : "h-10 w-9"}
                  />
                ) : (
                  <SaveAvatar className="h-10 w-9" iconClassName="text-muted-foreground" />
                )}
                {!collapsed && (
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs font-bold text-sidebar-foreground truncate">
                      {currentSave ? currentSave.playerName : t("sidebar.noSaveSelected")}
                    </span>
                    <span className="text-[10px] text-muted-foreground truncate">
                      {currentSave ? t("sidebar.farmNameSuffix", { name: currentSave.farmName }) : "—"}
                    </span>
                  </div>
                )}
              </div>
              {!collapsed && (
                <ChevronDown className={cn(
                  "h-4 w-4 text-muted-foreground transition-transform duration-200 shrink-0",
                  isOpen && "rotate-180 text-sidebar-foreground"
                )} />
              )}
            </button>

            {/* Custom Dropdown List */}
            {isOpen && (
              <div
                className={cn(
                  "absolute mt-2 bg-sidebar border border-sidebar-border/80 rounded-lg shadow-xl z-50 py-1 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150 max-h-64 flex flex-col",
                  collapsed ? "left-full top-0 ml-2 w-max min-w-64" : "left-4 w-max min-w-[calc(100%-2rem)]"
                )}
              >
                <ScrollArea className="flex-1">
                  <div className="max-h-60 overflow-y-auto py-1">
                    {saves.map((s) => {
                      const isSelected = s.id === selectedSaveId
                      return (
                        <button
                          key={s.id}
                          onClick={() => handleSelectSave(s.id)}
                          className={cn(
                            "w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-sidebar-accent/80 text-sidebar-foreground transition-all duration-150 cursor-pointer border-l-2 border-transparent",
                            isSelected && "bg-sidebar-accent text-sidebar-accent-foreground border-primary font-medium"
                          )}
                        >
                          <SaveAvatar save={s} className="h-9 w-8" />
                          <div className="flex flex-col min-w-0 flex-1">
                            <span className="text-xs font-semibold truncate leading-normal">
                              {s.playerName}
                            </span>
                            <span className="text-[9px] text-muted-foreground truncate leading-normal">
                              {t("sidebar.farmNameSuffix", { name: s.farmName })} · {t("settings.saveInfo.gameDateValue", { season: t("seasons." + ["spring", "summer", "fall", "winter"][s.season]), day: s.dayOfMonth, year: s.year })} · {s.money.toLocaleString()}g
                            </span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </ScrollArea>
              </div>
            )}
          </div>
          <Separator className="bg-sidebar-border" />
        </>
      )}

      <div className={cn("py-4", collapsed ? "px-2" : "px-3")}>
        <div className="relative" ref={launchDropdownRef}>
          {collapsed ? (
            <div className="flex flex-col gap-1">
              <Button
                variant="ghost"
                className="h-10 w-full justify-center border border-border/40 px-0 text-sidebar-foreground transition-all duration-200 hover:bg-sidebar-accent/50"
                onClick={() => handleLaunch()}
                disabled={isGameRunning}
                title={isGameRunning ? t("sidebar.gameRunning") : t("sidebar.launchGameTooltip")}
              >
                <Play className="h-4 w-4 text-primary" />
              </Button>
              <Button
                variant="ghost"
                className="h-7 w-full justify-center border border-border/40 px-0 text-sidebar-foreground transition-all duration-200 hover:bg-sidebar-accent/50"
                onClick={() => setIsLaunchMenuOpen((value) => !value)}
                disabled={isGameRunning}
                title={isGameRunning ? t("sidebar.gameRunning") : t("sidebar.selectLaunchMode")}
              >
                {collapsed ? (
                  <ChevronRight
                    className={cn(
                      "h-3.5 w-3.5 text-muted-foreground transition-transform duration-200",
                      isLaunchMenuOpen && "text-sidebar-foreground"
                    )}
                  />
                ) : (
                  <ChevronDown
                    className={cn(
                      "h-3.5 w-3.5 text-muted-foreground transition-transform duration-200",
                      isLaunchMenuOpen && "rotate-180 text-sidebar-foreground"
                    )}
                  />
                )}
              </Button>
            </div>
          ) : (
            <div className="flex w-full">
              <Button
                variant="ghost"
                className="flex-1 justify-start gap-3 rounded-r-none border border-border/40 px-3 text-sm font-medium text-sidebar-foreground transition-all duration-200 hover:bg-sidebar-accent/50"
                onClick={() => handleLaunch()}
                disabled={isGameRunning}
                title={isGameRunning ? t("sidebar.gameRunning") : t("sidebar.launchGameTooltip")}
              >
                <span className="shrink-0">
                  <Play className="h-4 w-4 text-primary" />
                </span>
                {isGameRunning ? t("sidebar.gameRunning") : t("sidebar.launchGame")}
              </Button>
              <Button
                variant="ghost"
                className="h-10 w-8 shrink-0 rounded-l-none border border-l-0 border-border/40 px-2 text-sidebar-foreground hover:bg-sidebar-accent/50"
                onClick={() => setIsLaunchMenuOpen((value) => !value)}
                disabled={isGameRunning}
                title={isGameRunning ? t("sidebar.gameRunning") : t("sidebar.selectLaunchMode")}
              >
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 text-muted-foreground transition-transform duration-200",
                    isLaunchMenuOpen && "rotate-180 text-sidebar-foreground"
                  )}
                />
              </Button>
            </div>
          )}
          {isLaunchMenuOpen && (
            <div
              className={cn(
                "absolute rounded-lg border border-sidebar-border/80 bg-sidebar py-1 shadow-xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150",
                collapsed ? "left-full top-11 ml-2 w-48" : "left-0 right-0 mt-2"
              )}
            >
              <button
                type="button"
                onClick={() => handleLaunch("vanilla")}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs font-medium text-sidebar-foreground hover:bg-sidebar-accent/80 transition-all duration-150 cursor-pointer"
              >
                <Play className="h-3.5 w-3.5 text-primary shrink-0" />
                <span className="min-w-0 flex-1">{t("sidebar.launchVanilla")}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Navigation */}
      <ScrollArea className={cn("flex-1 pb-4", collapsed ? "px-2" : "px-3")}>
        <nav className="flex flex-col gap-1">
          {navItems
            .filter((item) => item.id === "dashboard" || item.id === "settings" || enabledFeatures.includes(item.id))
            .map((item) => {
            const showDownloadCount = item.id === "downloads" && activeDownloadCount > 0
            return (
              <Button
                key={item.id}
                variant={currentPage === item.id ? "secondary" : "ghost"}
                className={cn(
                  "gap-3 h-10 text-sm font-medium transition-all duration-200 relative",
                  collapsed ? "justify-center px-2" : "justify-start px-3",
                  currentPage === item.id
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                )}
                onClick={() => onNavigate(item.id)}
                title={collapsed ? t(`sidebar.${item.id}`) : undefined}
              >
                <span className="shrink-0">{item.icon}</span>
                {!collapsed && (
                  <>
                    <span className="min-w-0 flex-1 text-left">{t(`sidebar.${item.id}`)}</span>
                    {showDownloadCount && (
                      <span className="ml-auto min-w-5 rounded-full bg-primary px-1.5 text-center text-[10px] font-bold leading-5 text-primary-foreground">
                        {activeDownloadCount}
                      </span>
                    )}
                  </>
                )}
                {collapsed && showDownloadCount && (
                  <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-primary" />
                )}
              </Button>
            )
          })}
        </nav>
      </ScrollArea>

      {/* Collapse Toggle */}
      <div className={cn("border-t border-sidebar-border py-2", collapsed ? "px-2" : "px-4")}>
        <button
          onClick={onToggleCollapse}
          className={cn(
            "w-full flex items-center py-2 rounded-lg text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-all duration-200 cursor-pointer",
            collapsed ? "justify-center px-0" : "justify-start gap-2 px-3"
          )}
          title={collapsed ? t("sidebar.expandSidebar") : t("sidebar.collapseSidebar")}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          {!collapsed && <span className="text-xs">{t("sidebar.collapseSidebar")}</span>}
        </button>
      </div>

    </aside>
  )
}
