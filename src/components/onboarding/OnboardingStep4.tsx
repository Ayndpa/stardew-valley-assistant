import { Button } from "@/components/ui/button"
import { ThemeMode, ThemeSeason } from "@/lib/theme-provider"
import { CheckCircle2, Heart } from "lucide-react"

interface OnboardingStep4Props {
  directory: string
  themeMode: ThemeMode
  themeSeason: ThemeSeason
  onPrev: () => void
  onComplete: () => void
}

export function OnboardingStep4({
  directory,
  themeMode,
  themeSeason,
  onPrev,
  onComplete,
}: OnboardingStep4Props) {
  return (
    <div className="space-y-6 text-center animate-fade-in">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-500 shadow-inner">
        <CheckCircle2 className="h-8 w-8 text-emerald-500 animate-bounce" />
      </div>
      <div className="space-y-2">
        <h2 className="text-2xl font-bold tracking-tight text-primary">配置已完成！</h2>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          游戏安装目录与个性外观已配置完成。超级星露谷已经为您准备就绪。
        </p>
      </div>

      {/* Summary card */}
      <div className="bg-primary/5 p-4 rounded-xl border border-primary/10 text-left max-w-md mx-auto space-y-2">
        <div className="flex justify-between items-center text-xs border-b border-primary/10 pb-2">
          <span className="text-muted-foreground font-medium">已连接游戏目录:</span>
          <span className="font-mono text-foreground font-bold truncate max-w-[200px]" title={directory}>{directory}</span>
        </div>
        <div className="flex justify-between items-center text-xs border-b border-primary/10 pb-2 pt-1">
          <span className="text-muted-foreground font-medium">主题模式:</span>
          <span className="font-semibold text-foreground">
            {themeMode === "light" && "浅色模式"}
            {themeMode === "dark" && "深色模式"}
            {themeMode === "system" && "跟随系统"}
          </span>
        </div>
        <div className="flex justify-between items-center text-xs border-b border-primary/10 pb-2 pt-1">
          <span className="text-muted-foreground font-medium">季节主题色:</span>
          <span className="font-semibold text-foreground">
            {themeSeason === "default" && "经典绿"}
            {themeSeason === "spring" && "春季粉"}
            {themeSeason === "summer" && "夏季黄"}
            {themeSeason === "fall" && "秋季橙"}
            {themeSeason === "winter" && "冬季蓝"}
          </span>
        </div>
        <div className="flex justify-between items-center text-xs pt-1">
          <span className="text-muted-foreground font-medium">已启用功能:</span>
          <span className="text-emerald-500 font-semibold flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" /> 模组扫描 · 存档读取 · 日历通知
          </span>
        </div>
      </div>

      <div className="pt-4 flex justify-between gap-4">
        <Button variant="ghost" onClick={onPrev} className="px-5 rounded-xl font-medium">
          返回
        </Button>
        <Button onClick={onComplete} className="flex-1 py-6 rounded-xl text-md font-bold flex gap-2 shadow-lg hover:shadow-xl transition-all justify-center items-center">
          进入助手
          <Heart className="h-5 w-5 fill-primary-foreground animate-pulse" />
        </Button>
      </div>
    </div>
  )
}
