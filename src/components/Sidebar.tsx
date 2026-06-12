import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { Page } from "@/App"
import {
  LayoutDashboard,
  Sprout,
  Users,
  CalendarDays,
  Settings,
  Leaf,
  Puzzle,
} from "lucide-react"

interface SidebarProps {
  currentPage: Page
  onNavigate: (page: Page) => void
}

const navItems: { id: Page; label: string; icon: React.ReactNode }[] = [
  { id: "dashboard", label: "仪表盘", icon: <LayoutDashboard /> },
  { id: "crops", label: "作物管理", icon: <Sprout /> },
  { id: "npcs", label: "村民关系", icon: <Users /> },
  { id: "calendar", label: "节日日历", icon: <CalendarDays /> },
  { id: "mods", label: "模组管理", icon: <Puzzle /> },
  { id: "settings", label: "设置", icon: <Settings /> },
]

export function Sidebar({ currentPage, onNavigate }: SidebarProps) {
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
