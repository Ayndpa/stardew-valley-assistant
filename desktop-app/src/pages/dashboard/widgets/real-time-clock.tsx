import { useState, useEffect } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { useTranslation } from "react-i18next"
import { Clock } from "lucide-react"
import { registerWidget } from "../widget-registry"
import type { WidgetRenderProps } from "../types"

const WEEKDAY_NAMES_ZH = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]
const WEEKDAY_NAMES_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function useCurrentTime() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  return now
}

function RealTimeClockContent(_props: WidgetRenderProps) {
  const { i18n } = useTranslation()
  const now = useCurrentTime()

  const isZh = i18n.language.startsWith("zh")
  const weekdayNames = isZh ? WEEKDAY_NAMES_ZH : WEEKDAY_NAMES_EN

  const hours = now.getHours().toString().padStart(2, "0")
  const minutes = now.getMinutes().toString().padStart(2, "0")
  const seconds = now.getSeconds().toString().padStart(2, "0")

  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const day = now.getDate()
  const weekday = weekdayNames[now.getDay()]

  const dateStr = isZh
    ? `${year}年${month}月${day}日`
    : `${year}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`

  return (
    <Card className="h-full overflow-hidden border-none bg-gradient-to-br from-card/50 to-card shadow-lg">
      <CardContent className="p-0 h-full">
        <div className="@container p-4 @sm:p-5 @md:p-6 flex flex-col h-full bg-gradient-to-br from-violet-500/10 via-purple-500/5 to-fuchsia-500/10">
          {/* ── Compact layout (default, <640px) ─────────────────────── */}
          <div className="flex flex-col items-center justify-center text-center flex-1 gap-2 @sm:hidden">
            <p className="text-[10px] font-bold uppercase tracking-widest text-foreground/60">
              {isZh ? "现实时间" : "Real Time"}
            </p>
            <div className="flex items-baseline gap-0.5">
              <span className="text-5xl font-black tabular-nums tracking-tighter">{hours}</span>
              <span className="text-5xl font-black text-primary/60 animate-pulse">:</span>
              <span className="text-5xl font-black tabular-nums tracking-tighter">{minutes}</span>
              <span className="text-xl font-bold text-muted-foreground ml-1 tabular-nums">{seconds}</span>
            </div>
            <p className="text-sm font-bold text-foreground/80">
              {dateStr} {weekday}
            </p>
          </div>

          {/* ── Medium layout (640px–896px) ──────────────────────────── */}
          <div className="hidden @sm:flex @md:hidden flex-row items-center justify-center flex-1 gap-6">
            <div className="flex items-baseline gap-0.5">
              <span className="text-6xl font-black tabular-nums tracking-tighter">{hours}</span>
              <span className="text-6xl font-black text-primary/60 animate-pulse">:</span>
              <span className="text-6xl font-black tabular-nums tracking-tighter">{minutes}</span>
              <span className="text-2xl font-bold text-muted-foreground ml-1.5 tabular-nums">{seconds}</span>
            </div>
            <div className="flex flex-col items-start">
              <p className="text-[10px] font-bold uppercase tracking-widest text-foreground/60">
                {isZh ? "现实时间" : "Real Time"}
              </p>
              <p className="text-lg font-bold">{weekday}</p>
              <p className="text-sm text-muted-foreground">{dateStr}</p>
            </div>
          </div>

          {/* ── Expanded layout (≥896px) ─────────────────────────────── */}
          <div className="hidden @md:flex flex-row items-stretch flex-1 gap-6">
            {/* Left: Clock face */}
            <div className="flex flex-col items-start justify-center text-left space-y-2 min-w-[200px]">
              <p className="text-[10px] font-bold uppercase tracking-widest text-foreground/60">
                {isZh ? "现实时间" : "Real Time"}
              </p>
              <div className="flex items-baseline gap-1">
                <span className="text-7xl font-black tabular-nums tracking-tighter">{hours}</span>
                <span className="text-7xl font-black text-primary/60 animate-pulse">:</span>
                <span className="text-7xl font-black tabular-nums tracking-tighter">{minutes}</span>
              </div>
              <p className="text-2xl font-bold text-muted-foreground tabular-nums">{seconds}</p>
            </div>

            {/* Right: Date details */}
            <div className="flex-1 flex flex-col justify-center gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-xl bg-background/40 backdrop-blur-md border border-white/10">
                  <p className="text-[10px] font-bold uppercase text-foreground/50 mb-1">
                    {isZh ? "日期" : "Date"}
                  </p>
                  <p className="text-lg font-black">{dateStr}</p>
                </div>
                <div className="p-3 rounded-xl bg-background/40 backdrop-blur-md border border-white/10">
                  <p className="text-[10px] font-bold uppercase text-foreground/50 mb-1">
                    {isZh ? "星期" : "Weekday"}
                  </p>
                  <p className="text-lg font-black">{weekday}</p>
                </div>
                <div className="col-span-2 p-3 rounded-xl bg-background/40 backdrop-blur-md border border-white/10">
                  <p className="text-[10px] font-bold uppercase text-foreground/50 mb-1">
                    {isZh ? "时区" : "Timezone"}
                  </p>
                  <p className="text-sm font-bold text-muted-foreground">
                    {Intl.DateTimeFormat().resolvedOptions().timeZone}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

registerWidget({
  id: "real-time-clock",
  nameKey: "dashboard.widgetPicker.realTimeClock.name",
  descriptionKey: "dashboard.widgetPicker.realTimeClock.description",
  icon: Clock,
  defaultSize: "small",
  category: "time",
  render: (props) => <RealTimeClockContent {...props} />,
})
