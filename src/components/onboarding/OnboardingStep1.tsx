import { Button } from "@/components/ui/button"
import {
  Leaf,
  Sprout,
  Users,
  CalendarDays,
  Puzzle,
  ChevronRight,
} from "lucide-react"

interface OnboardingStep1Props {
  onNext: () => void
}

export function OnboardingStep1({ onNext }: OnboardingStep1Props) {
  return (
    <div className="space-y-6 text-center animate-fade-in">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-inner">
        <Leaf className="h-8 w-8 text-primary animate-pulse" />
      </div>
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight text-primary">
          欢迎来到星露谷助手 !
        </h1>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          这是你的专属农场助手，能够为你管理游戏模组、提醒作物收获、打理村民关系以及追踪节日。
        </p>
      </div>

      {/* Feature Highlights Grid */}
      <div className="grid grid-cols-2 gap-4 text-left mt-6">
        <div className="p-4 rounded-xl border border-border bg-accent/20 hover:bg-accent/40 transition-colors flex gap-3">
          <div className="mt-0.5 rounded-lg p-2 bg-primary/10 text-primary">
            <Puzzle className="h-4 w-4" />
          </div>
          <div>
            <h4 className="text-sm font-semibold">模组管理</h4>
            <p className="text-xs text-muted-foreground mt-0.5">一键扫描、启用/禁用、热升级 SMAPI 模组。</p>
          </div>
        </div>

        <div className="p-4 rounded-xl border border-border bg-accent/20 hover:bg-accent/40 transition-colors flex gap-3">
          <div className="mt-0.5 rounded-lg p-2 bg-primary/10 text-primary">
            <Sprout className="h-4 w-4" />
          </div>
          <div>
            <h4 className="text-sm font-semibold">作物管理</h4>
            <p className="text-xs text-muted-foreground mt-0.5">记录当前种植，计算成熟时间与提醒。</p>
          </div>
        </div>

        <div className="p-4 rounded-xl border border-border bg-accent/20 hover:bg-accent/40 transition-colors flex gap-3">
          <div className="mt-0.5 rounded-lg p-2 bg-primary/10 text-primary">
            <Users className="h-4 w-4" />
          </div>
          <div>
            <h4 className="text-sm font-semibold">村民关系</h4>
            <p className="text-xs text-muted-foreground mt-0.5">记录村民喜好、追踪生日与送礼进度。</p>
          </div>
        </div>

        <div className="p-4 rounded-xl border border-border bg-accent/20 hover:bg-accent/40 transition-colors flex gap-3">
          <div className="mt-0.5 rounded-lg p-2 bg-primary/10 text-primary">
            <CalendarDays className="h-4 w-4" />
          </div>
          <div>
            <h4 className="text-sm font-semibold">日程提醒</h4>
            <p className="text-xs text-muted-foreground mt-0.5">完美对接游戏日历，重要事件提前知晓。</p>
          </div>
        </div>
      </div>

      <div className="pt-4 flex justify-end">
        <Button onClick={onNext} className="w-full sm:w-auto px-6 py-5 rounded-xl flex items-center justify-center gap-2 group font-semibold">
          开始配置
          <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
        </Button>
      </div>
    </div>
  )
}
