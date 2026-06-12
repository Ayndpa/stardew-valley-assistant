import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { ThemeMode, ThemeSeason } from "@/lib/theme-provider"
import {
  Sun,
  Moon,
  Monitor,
  Palette,
  Check,
  ArrowRight,
} from "lucide-react"

interface OnboardingStep3Props {
  themeMode: ThemeMode
  themeSeason: ThemeSeason
  setThemeMode: (mode: ThemeMode) => void
  setThemeSeason: (season: ThemeSeason) => void
  onPrev: () => void
  onNext: () => void
}

export function OnboardingStep3({
  themeMode,
  themeSeason,
  setThemeMode,
  setThemeSeason,
  onPrev,
  onNext,
}: OnboardingStep3Props) {
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="space-y-2 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary mb-2">
          <Palette className="h-6 w-6 animate-pulse" />
        </div>
        <h2 className="text-xl font-bold tracking-tight">个性外观选择</h2>
        <p className="text-xs text-muted-foreground max-w-sm mx-auto">
          选择您喜欢的主题模式与星露谷季节配色，随时可以去设置中调整。
        </p>
      </div>

      {/* Theme Mode */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">主题模式</h4>
        <div className="grid grid-cols-3 gap-3">
          {[
            { value: "light" as ThemeMode, label: "浅色", icon: Sun },
            { value: "dark" as ThemeMode, label: "深色", icon: Moon },
            { value: "system" as ThemeMode, label: "跟随系统", icon: Monitor },
          ].map((item) => {
            const Icon = item.icon
            const isActive = themeMode === item.value
            return (
              <Button
                key={item.value}
                type="button"
                variant={isActive ? "default" : "outline"}
                onClick={() => setThemeMode(item.value)}
                className={cn(
                  "flex items-center justify-center gap-2 py-3 h-auto transition-all duration-200 cursor-pointer rounded-xl border border-border/80",
                  isActive ? "shadow-md scale-[1.02] font-semibold border-primary" : "hover:bg-accent/40"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="text-xs">{item.label}</span>
              </Button>
            )
          })}
        </div>
      </div>

      {/* Season Themes */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">季节主题色</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {[
            {
              value: "default" as ThemeSeason,
              label: "经典绿 (Classic Green)",
              desc: "星露谷的经典底色，自然生机盎然",
              gradient: "from-emerald-500/90 to-green-600/90",
              color: "bg-emerald-500",
            },
            {
              value: "spring" as ThemeSeason,
              label: "春季粉 (Spring Sakura)",
              desc: "粉色樱花瓣漫天飞舞，浪漫温柔",
              gradient: "from-pink-400/90 to-rose-500/90",
              color: "bg-pink-400",
            },
            {
              value: "summer" as ThemeSeason,
              label: "夏季黄 (Summer Gold)",
              desc: "金色向日葵傲然绽放，热情洋溢",
              gradient: "from-amber-400/90 to-yellow-500/90",
              color: "bg-amber-400",
            },
            {
              value: "fall" as ThemeSeason,
              label: "秋季橙 (Fall Maple)",
              desc: "红橙枫叶挂满枝头，丰收的喜悦",
              gradient: "from-orange-500/90 to-amber-600/90",
              color: "bg-orange-500",
            },
            {
              value: "winter" as ThemeSeason,
              label: "冬季蓝 (Winter Frost)",
              desc: "冰雪覆盖的幽静寒蓝，静谧纯洁",
              gradient: "from-sky-400/90 to-blue-500/90",
              color: "bg-sky-400",
            },
          ].map((item) => {
            const isSelected = themeSeason === item.value
            return (
              <button
                type="button"
                key={item.value}
                onClick={() => setThemeSeason(item.value)}
                className={cn(
                  "group relative flex flex-col justify-between text-left p-3 rounded-xl border transition-all duration-300 cursor-pointer overflow-hidden bg-card text-card-foreground",
                  isSelected 
                    ? "border-primary shadow-md ring-2 ring-primary/20 scale-[1.01]" 
                    : "border-border/60 hover:border-border-foreground/45 hover:shadow-md hover:scale-[1.005]"
                )}
              >
                {/* Left color bar decorator */}
                <div className={cn("absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b", item.gradient)} />
                
                <div className="pl-2 space-y-0.5 flex-1 pr-6">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-xs leading-tight text-foreground group-hover:text-primary transition-colors">
                      {item.label}
                    </span>
                    <span className={cn("h-1.5 w-1.5 rounded-full", item.color)} />
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-normal pr-4">
                    {item.desc}
                  </p>
                </div>

                {/* Check icon indicator */}
                {isSelected && (
                  <div className="absolute right-2.5 top-2.5 h-4 w-4 rounded-full bg-primary flex items-center justify-center text-primary-foreground animate-in zoom-in-75 duration-200">
                    <Check className="h-2.5 w-2.5 stroke-[3]" />
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Navigation Action Buttons */}
      <div className="pt-2 flex justify-between gap-4">
        <Button variant="ghost" onClick={onPrev} className="px-5 rounded-xl font-medium">
          返回
        </Button>
        <Button onClick={onNext} className="px-6 py-5 rounded-xl flex gap-2 font-semibold">
          下一步
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
