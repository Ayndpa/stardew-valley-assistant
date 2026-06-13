import { useState, useRef, useEffect } from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { Page, SaveSummary } from "@/App"
import {
  LayoutDashboard,
  Sprout,
  Users,
  CalendarDays,
  Settings,
  Leaf,
  Puzzle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  User,
  Download,
  Play,
  ListChecks,
} from "lucide-react"

interface SidebarProps {
  currentPage: Page
  onNavigate: (page: Page) => void
  saves: SaveSummary[]
  selectedSaveId: string
  onSaveChange: (id: string) => void
  collapsed: boolean
  onToggleCollapse: () => void
  onLaunchGame: () => void
  isGameRunning: boolean
  downloadStats: {
    running: number
    queued: number
    failed: number
    finished: number
    total: number
    maxConcurrent: number
  }
}

const navItems: { id: Page; label: string; icon: React.ReactNode }[] = [
  { id: "dashboard", label: "仪表盘", icon: <LayoutDashboard /> },
  { id: "crops", label: "作物管理", icon: <Sprout /> },
  { id: "npcs", label: "村民关系", icon: <Users /> },
  { id: "calendar", label: "节日日历", icon: <CalendarDays /> },
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
}: SidebarProps) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Click outside to close
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const currentSave = saves.find((s) => s.id === selectedSaveId) || saves[0]

  const handleSelectSave = (id: string) => {
    onSaveChange(id)
    setIsOpen(false)
  }

  return (
    <aside className={cn(
      "border-r border-sidebar-border bg-sidebar flex flex-col transition-all duration-300",
      collapsed ? "w-16" : "w-64"
    )}>
      {/* Logo */}
      <div className={cn("flex items-center gap-3 py-5 transition-all duration-300", collapsed ? "px-3 justify-center" : "px-6")}>
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary shrink-0">
          <Leaf className="h-5 w-5 text-primary-foreground" />
        </div>
        {!collapsed && (
          <div className="overflow-hidden">
            <h1 className="text-lg font-bold text-sidebar-foreground whitespace-nowrap">星露谷助手</h1>
            <p className="text-xs text-muted-foreground whitespace-nowrap">Stardew Valley</p>
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
                当前存档
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
              title={collapsed ? currentSave?.playerName : undefined}
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
                      {currentSave ? currentSave.playerName : "未选择存档"}
                    </span>
                    <span className="text-[10px] text-muted-foreground truncate">
                      {currentSave ? `${currentSave.farmName}农场` : "—"}
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
              <div className="absolute left-4 right-4 mt-2 bg-sidebar border border-sidebar-border/80 rounded-lg shadow-xl z-50 py-1 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150 max-h-64 flex flex-col">
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
                              {s.farmName}农场 · 第{s.year}年 · {s.money.toLocaleString()}g
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

      {/* Navigation */}
      <ScrollArea className={cn("flex-1 py-4", collapsed ? "px-2" : "px-3")}>
        <nav className="flex flex-col gap-1">
          <Button
            variant="ghost"
            className={cn(
              "gap-3 h-10 text-sm font-medium transition-all duration-200 border border-border/40 hover:bg-sidebar-accent/50 text-sidebar-foreground",
              collapsed ? "justify-center px-2" : "justify-start px-3"
            )}
            onClick={onLaunchGame}
            disabled={isGameRunning}
            title={isGameRunning ? "游戏运行中" : "一键启动游戏"}
          >
            <span className="shrink-0">
              <Play className="h-4 w-4 text-primary" />
            </span>
            {!collapsed && (isGameRunning ? "游戏运行中" : "一键启动")}
          </Button>
          {navItems.map((item) => {
            const showDownloadCount = item.id === "downloads" && downloadStats.total > 0
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
                title={collapsed ? item.label : undefined}
              >
                <span className="shrink-0">{item.icon}</span>
                {!collapsed && (
                  <>
                    <span className="min-w-0 flex-1 text-left">{item.label}</span>
                    {showDownloadCount && (
                      <span className="ml-auto min-w-5 rounded-full bg-primary px-1.5 text-center text-[10px] font-bold leading-5 text-primary-foreground">
                        {downloadStats.total}
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
            "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-all duration-200 cursor-pointer",
            collapsed ? "justify-center" : "justify-start"
          )}
          title={collapsed ? "展开侧边栏" : "收起侧边栏"}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          {!collapsed && <span className="text-xs">收起侧边栏</span>}
        </button>
      </div>

      {/* Footer */}
      <div className={cn("border-t border-sidebar-border text-xs text-muted-foreground", collapsed ? "px-2 py-3" : "px-6 py-3")}>
        {!collapsed && <p className="text-center">v0.1.0 · 星露谷物语助手</p>}
      </div>
    </aside>
  )
}

