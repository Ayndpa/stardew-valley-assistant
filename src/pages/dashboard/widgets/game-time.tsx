import { Card, CardContent } from "@/components/ui/card"
import { useTranslation } from "react-i18next"
import { CalendarClock, Clock } from "lucide-react"
import { registerWidget } from "../widget-registry"
import type { WidgetRenderProps } from "../types"

const SEASON_EMOJIS = ["🌱", "☀️", "🍂", "❄️"]
const SEASON_KEYS = ["spring", "summer", "fall", "winter"]
const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]

function GameTimeContent({ saveDetail }: WidgetRenderProps) {
  const { t } = useTranslation()

  if (!saveDetail) return null

  const summary = saveDetail.summary
  const seasonName = t("seasons." + SEASON_KEYS[summary.season])
  const weekdayName = t("dashboard.weekdays." + WEEKDAY_KEYS[(summary.dayOfMonth - 1) % 7])
  const seasonEmoji = SEASON_EMOJIS[summary.season]

  const totalMinutes = Math.floor(summary.millisecondsPlayed / 60000)
  const playHours = Math.floor(totalMinutes / 60)
  const playMinutes = totalMinutes % 60

  const lastSaveDate = new Date(summary.lastSaveTime)
  const saveMonth = lastSaveDate.getMonth() + 1
  const saveDay = lastSaveDate.getDate()
  const saveHour = lastSaveDate.getHours().toString().padStart(2, "0")
  const saveMinute = lastSaveDate.getMinutes().toString().padStart(2, "0")

  return (
    <Card className="h-full overflow-hidden border-none bg-gradient-to-br from-card/50 to-card shadow-lg">
      <CardContent className="p-0 h-full">
        <div className="@container p-4 @sm:p-5 @md:p-6 flex flex-col h-full bg-gradient-to-br from-emerald-500/10 via-teal-500/5 to-cyan-500/10">
          {/* ── Compact layout (default, <640px) ─────────────────────── */}
          <div className="flex flex-col items-center justify-center text-center flex-1 gap-2.5 @sm:hidden">
            <p className="text-[10px] font-bold uppercase tracking-widest text-foreground/60">
              {t("dashboard.widgetPicker.gameTime.name")}
            </p>
            <span className="text-4xl">{seasonEmoji}</span>
            <div>
              <p className="text-2xl font-black tracking-tight">
                {seasonName} 第 {summary.dayOfMonth} 天
              </p>
              <p className="text-sm font-bold text-foreground/80">
                {weekdayName} · 第 {summary.year} 年
              </p>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              <span>{t("dashboard.playTime", { hours: playHours })}{playMinutes > 0 ? ` ${playMinutes}分` : ""}</span>
            </div>
          </div>

          {/* ── Medium layout (640px–896px) ──────────────────────────── */}
          <div className="hidden @sm:flex @md:hidden flex-col justify-center flex-1 gap-4">
            <div className="flex items-center gap-4">
              <div className="p-2.5 rounded-2xl bg-background/40 backdrop-blur-md border border-white/10">
                <span className="text-3xl">{seasonEmoji}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-widest text-foreground/60">
                  {t("dashboard.widgetPicker.gameTime.name")}
                </p>
                <p className="text-2xl font-black tracking-tight">
                  {seasonName} 第 {summary.dayOfMonth} 天
                </p>
                <p className="text-sm font-bold text-foreground/80">
                  {weekdayName} · 第 {summary.year} 年
                </p>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  <span>{t("dashboard.playTime", { hours: playHours })}</span>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  上次保存: {saveMonth}/{saveDay} {saveHour}:{saveMinute}
                </p>
              </div>
            </div>
          </div>

          {/* ── Expanded layout (≥896px) ─────────────────────────────── */}
          <div className="hidden @md:flex flex-row items-stretch flex-1 gap-6">
            {/* Left: Large date display */}
            <div className="flex flex-col items-start text-left space-y-2 min-w-[200px]">
              <p className="text-[10px] font-bold uppercase tracking-widest text-foreground/60">
                {t("dashboard.widgetPicker.gameTime.name")}
              </p>
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-3xl bg-background/40 backdrop-blur-md border border-white/10 shadow-sm">
                  <span className="text-5xl">{seasonEmoji}</span>
                </div>
                <div>
                  <p className="text-4xl font-black tracking-tighter">
                    {seasonName}
                  </p>
                  <p className="text-xl font-bold text-foreground/80">
                    第 {summary.dayOfMonth} 天
                  </p>
                </div>
              </div>
            </div>

            {/* Right: Details */}
            <div className="flex-1 flex flex-col justify-center gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-xl bg-background/40 backdrop-blur-md border border-white/10">
                  <p className="text-[10px] font-bold uppercase text-foreground/50 mb-1">星期</p>
                  <p className="text-lg font-black">{weekdayName}</p>
                </div>
                <div className="p-3 rounded-xl bg-background/40 backdrop-blur-md border border-white/10">
                  <p className="text-[10px] font-bold uppercase text-foreground/50 mb-1">年份</p>
                  <p className="text-lg font-black">第 {summary.year} 年</p>
                </div>
                <div className="p-3 rounded-xl bg-background/40 backdrop-blur-md border border-white/10">
                  <p className="text-[10px] font-bold uppercase text-foreground/50 mb-1">游戏时长</p>
                  <p className="text-lg font-black">{playHours}时{playMinutes > 0 ? `${playMinutes}分` : ""}</p>
                </div>
                <div className="p-3 rounded-xl bg-background/40 backdrop-blur-md border border-white/10">
                  <p className="text-[10px] font-bold uppercase text-foreground/50 mb-1">上次保存</p>
                  <p className="text-lg font-black">{saveMonth}/{saveDay}</p>
                  <p className="text-xs text-muted-foreground">{saveHour}:{saveMinute}</p>
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
  id: "game-time",
  nameKey: "dashboard.widgetPicker.gameTime.name",
  descriptionKey: "dashboard.widgetPicker.gameTime.description",
  icon: CalendarClock,
  defaultSize: "small",
  category: "time",
  render: (props) => <GameTimeContent {...props} />,
})
