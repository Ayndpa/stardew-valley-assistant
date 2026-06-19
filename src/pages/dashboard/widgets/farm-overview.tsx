import { Card, CardContent } from "@/components/ui/card"
import { useTranslation } from "react-i18next"
import { Sun, CloudRain, CloudLightning, Snowflake, Wind, Coins, Clock, Calendar } from "lucide-react"
import { registerWidget } from "../widget-registry"
import type { WidgetRenderProps } from "../types"

const WEATHER_ICONS: Record<string, typeof Sun> = {
  Sun: Sun,
  Rain: CloudRain,
  Storm: CloudLightning,
  Snow: Snowflake,
  Wind: Wind,
  GreenRain: CloudRain,
  Festival: Sun,
}

const WEATHER_COLORS: Record<string, string> = {
  Sun: "text-yellow-500",
  Rain: "text-blue-400",
  Storm: "text-purple-400",
  Snow: "text-sky-300",
  Wind: "text-teal-400",
  GreenRain: "text-emerald-400",
  Festival: "text-amber-400",
}

function FarmOverviewContent({ saveDetail }: WidgetRenderProps) {
  const { t } = useTranslation()

  if (!saveDetail) return null

  const summary = saveDetail.summary
  const seasonName = t("seasons." + ["spring", "summer", "fall", "winter"][summary.season])
  const weekdayName = t("dashboard.weekdays." + ["mon", "tue", "wed", "thu", "fri", "sat", "sun"][(summary.dayOfMonth - 1) % 7])
  const playHours = Math.floor(summary.millisecondsPlayed / 3600000)

  const WeatherIcon = WEATHER_ICONS[saveDetail.weatherToday] ?? Sun
  const weatherColor = WEATHER_COLORS[saveDetail.weatherToday] ?? "text-yellow-500"
  const weatherLabel = t(`dashboard.weather.${saveDetail.weatherToday.toLowerCase()}`, t("dashboard.weather.sun"))

  const seasonIcons = ["🌱", "☀️", "🍂", "❄️"]

  return (
    <Card className="h-full">
      <CardContent className="p-4 space-y-3">
        {/* Season & Date */}
        <div className="flex items-center gap-2">
          <span className="text-2xl">{seasonIcons[summary.season]}</span>
          <div>
            <p className="text-lg font-bold">{seasonName} 第 {summary.dayOfMonth} 天</p>
            <p className="text-xs text-muted-foreground">{weekdayName} · 第 {summary.year} 年</p>
          </div>
        </div>

        {/* Stats */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <Coins className="h-4 w-4 text-yellow-500" />
            <span className="font-medium">{summary.money.toLocaleString()}g</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <WeatherIcon className={`h-4 w-4 ${weatherColor}`} />
            <span>{weatherLabel}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">{t("dashboard.playTime", { hours: playHours })}</span>
          </div>
        </div>

        {/* Player info */}
        <div className="pt-1 border-t">
          <p className="text-xs text-muted-foreground">
            {summary.playerName} · {summary.farmName}农场
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

registerWidget({
  id: "farm-overview",
  nameKey: "dashboard.widgetPicker.farmOverview.name",
  descriptionKey: "dashboard.widgetPicker.farmOverview.description",
  icon: Calendar,
  defaultSize: "small",
  category: "info",
  render: (props) => <FarmOverviewContent {...props} />,
})
