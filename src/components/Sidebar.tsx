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
  User,
  Download,
} from "lucide-react"

interface SidebarProps {
  currentPage: Page
  onNavigate: (page: Page) => void
  saves: SaveSummary[]
  selectedSaveId: string
  onSaveChange: (id: string) => void
}

const navItems: { id: Page; label: string; icon: React.ReactNode }[] = [
  { id: "dashboard", label: "仪表盘", icon: <LayoutDashboard /> },
  { id: "crops", label: "作物管理", icon: <Sprout /> },
  { id: "npcs", label: "村民关系", icon: <Users /> },
  { id: "calendar", label: "节日日历", icon: <CalendarDays /> },
  { id: "mods", label: "模组管理", icon: <Puzzle /> },
  { id: "onlineMods", label: "获取模组", icon: <Download className="h-4 w-4" /> },
  { id: "settings", label: "设置", icon: <Settings /> },
]

export function Sidebar({ currentPage, onNavigate, saves, selectedSaveId, onSaveChange }: SidebarProps) {
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

  // A helper to generate a premium gradient based on the player name's length/content
  const getAvatarGradient = (name: string) => {
    const sum = name.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0)
    const gradients = [
      "from-amber-500 to-orange-600",
      "from-emerald-500 to-teal-600",
      "from-blue-500 to-indigo-600",
      "from-indigo-500 to-purple-600",
      "from-violet-500 to-fuchsia-600",
      "from-pink-500 to-rose-600",
      "from-rose-500 to-red-600",
    ]
    return gradients[sum % gradients.length]
  }

  const handleSelectSave = (id: string) => {
    onSaveChange(id)
    setIsOpen(false)
  }

  return (
    <aside className="w-64 border-r border-sidebar-border bg-sidebar flex flex-col">
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 py-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary">
          <Leaf className="h-5 w-5 text-primary-foreground" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-sidebar-foreground">星露谷助手</h1>
          <p className="text-xs text-muted-foreground">Stardew Valley</p>
        </div>
      </div>

      <Separator className="bg-sidebar-border" />

      {/* Save File Selector */}
      {saves.length > 0 && (
        <>
          <div className="px-4 py-3 relative" ref={dropdownRef}>
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block mb-1.5 px-1">
              当前存档
            </label>
            
            {/* Custom Dropdown Trigger */}
            <button
              onClick={() => setIsOpen(!isOpen)}
              className={cn(
                "w-full flex items-center justify-between gap-3 px-3 py-2 bg-sidebar-accent/20 border border-sidebar-border/60 hover:border-sidebar-border hover:bg-sidebar-accent/40 rounded-lg text-left transition-all duration-200 cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary/50",
                isOpen && "border-sidebar-border bg-sidebar-accent/40"
              )}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                {currentSave ? (
                  <div className={cn(
                    "h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0 shadow-sm bg-gradient-to-br",
                    getAvatarGradient(currentSave.playerName)
                  )}>
                    {currentSave.playerName.charAt(0)}
                  </div>
                ) : (
                  <div className="h-8 w-8 rounded-full flex items-center justify-center bg-muted text-muted-foreground shrink-0 border border-sidebar-border/50">
                    <User className="h-4 w-4" />
                  </div>
                )}
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-bold text-sidebar-foreground truncate">
                    {currentSave ? currentSave.playerName : "未选择存档"}
                  </span>
                  <span className="text-[10px] text-muted-foreground truncate">
                    {currentSave ? `${currentSave.farmName}农场` : "—"}
                  </span>
                </div>
              </div>
              <ChevronDown className={cn(
                "h-4 w-4 text-muted-foreground transition-transform duration-200 shrink-0",
                isOpen && "rotate-180 text-sidebar-foreground"
              )} />
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
                          <div className={cn(
                            "h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0 shadow-sm bg-gradient-to-br",
                            getAvatarGradient(s.playerName)
                          )}>
                            {s.playerName.charAt(0)}
                          </div>
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
      <ScrollArea className="flex-1 px-3 py-4">
        <nav className="flex flex-col gap-1">
          {navItems.map((item) => (
            <Button
              key={item.id}
              variant={currentPage === item.id ? "secondary" : "ghost"}
              className={cn(
                "justify-start gap-3 px-3 h-10 text-sm font-medium",
                currentPage === item.id
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/50"
              )}
              onClick={() => onNavigate(item.id)}
            >
              {item.icon}
              {item.label}
            </Button>
          ))}
        </nav>
      </ScrollArea>

      {/* Footer */}
      <div className="border-t border-sidebar-border px-6 py-4">
        <p className="text-xs text-muted-foreground text-center">
          v0.1.0 · 星露谷物语助手
        </p>
      </div>
    </aside>
  )
}

