import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Sliders, X, Trash2 } from "lucide-react"

interface SmapiManagerProps {
  isManagementOpen: boolean
  setIsManagementOpen: (open: boolean) => void
  smapiStatus: {
    installed: boolean
    version: string | null
    path: string | null
  } | null
  gameVersion: string | null
  smapiLatestVersion: string | null
  onUninstall: () => void
  isGameRunning?: boolean
}

export function SmapiManager({
  isManagementOpen,
  setIsManagementOpen,
  smapiStatus,
  gameVersion,
  smapiLatestVersion,
  onUninstall,
  isGameRunning = false,
}: SmapiManagerProps) {
  if (!isManagementOpen || !smapiStatus?.installed) return null

  return (
    <Card className="bg-card border-border shadow-md rounded-2xl p-6 relative overflow-hidden animate-in slide-in-from-top-3 duration-300">
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary to-green-600"></div>
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="font-extrabold text-lg text-foreground flex items-center gap-2">
            <Sliders className="h-5 w-5 text-primary" />
            SMAPI 管理面板
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5 font-medium">查看和维护当前安装的 SMAPI 状态</p>
        </div>
        <button 
          onClick={() => setIsManagementOpen(false)}
          className="p-1 rounded-lg hover:bg-accent text-muted-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm mb-6">
        <div className="space-y-1">
          <span className="text-xs text-muted-foreground block font-medium">游戏版本</span>
          <span className="font-semibold text-foreground font-mono bg-accent/30 px-2 py-0.5 rounded text-xs">{gameVersion || "未检测到"}</span>
        </div>
        <div className="space-y-1">
          <span className="text-xs text-muted-foreground block font-medium">已安装 SMAPI 版本</span>
          <span className="font-semibold text-primary font-mono bg-primary/10 px-2 py-0.5 rounded text-xs">{smapiStatus.version || "已安装"}</span>
        </div>
        <div className="space-y-1">
          <span className="text-xs text-muted-foreground block font-medium">最新可用版本</span>
          <span className="font-semibold text-emerald-600 dark:text-emerald-400 font-mono bg-emerald-500/10 px-2 py-0.5 rounded text-xs">{smapiLatestVersion || "检测中..."}</span>
        </div>
      </div>

      <div className="border-t border-border pt-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="space-y-0.5 flex-1 min-w-0">
          <span className="text-xs text-muted-foreground block font-medium">启动文件路径</span>
          <code className="text-[11px] font-mono break-all text-foreground bg-accent/40 px-2 py-1 rounded block max-w-full truncate" title={smapiStatus.path || "无"}>
            {smapiStatus.path || "无"}
          </code>
        </div>
        <Button
          variant="destructive"
          size="sm"
          onClick={onUninstall}
          disabled={isGameRunning}
          title={isGameRunning ? "游戏运行中，不能卸载 SMAPI" : undefined}
          className="rounded-xl font-semibold gap-1.5 self-end sm:self-auto shrink-0 bg-red-600 hover:bg-red-700 text-white shadow-sm transition-colors"
        >
          <Trash2 className="h-4 w-4" />
          卸载 SMAPI
        </Button>
      </div>
    </Card>
  )
}
