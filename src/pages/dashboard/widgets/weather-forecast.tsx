import { useState, useEffect } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { useTranslation } from "react-i18next"
import { Sun, CloudRain, CloudLightning, Snowflake, Wind } from "lucide-react"
import { registerWidget } from "../widget-registry"
import type { WidgetRenderProps } from "../types"

const getWeatherConfig = (weather: string, season: number, t: any) => {
  switch (weather) {
    case "Sun":
      return {
        label: t("dashboard.weather.sun"),
        color: "text-yellow-500",
        icon: Sun,
        bgGradient: "from-yellow-500/15 via-amber-500/10 to-orange-500/10",
        flavor: t("dashboard.weather.flavor.sun"),
        tip: season === 3 ? t("dashboard.weather.tip.sunWinter") : t("dashboard.weather.tip.sun"),
      }
    case "Rain":
      return {
        label: t("dashboard.weather.rain"),
        color: "text-blue-400",
        icon: CloudRain,
        bgGradient: "from-blue-500/15 via-sky-500/10 to-indigo-500/10",
        flavor: t("dashboard.weather.flavor.rain"),
        tip: t("dashboard.weather.tip.rain"),
      }
    case "Storm":
      return {
        label: t("dashboard.weather.storm"),
        color: "text-purple-400",
        icon: CloudLightning,
        bgGradient: "from-purple-500/15 via-fuchsia-500/10 to-indigo-500/10",
        flavor: t("dashboard.weather.flavor.storm"),
        tip: t("dashboard.weather.tip.storm"),
      }
    case "Snow":
      return {
        label: t("dashboard.weather.snow"),
        color: "text-sky-300",
        icon: Snowflake,
        bgGradient: "from-sky-300/15 via-blue-300/10 to-indigo-300/10",
        flavor: t("dashboard.weather.flavor.snow"),
        tip: t("dashboard.weather.tip.snow"),
      }
    case "Wind":
      return {
        label: t("dashboard.weather.wind"),
        color: "text-teal-400",
        icon: Wind,
        bgGradient: "from-teal-500/15 via-emerald-500/10 to-cyan-500/10",
        flavor: t("dashboard.weather.flavor.wind"),
        tip: t("dashboard.weather.tip.wind"),
      }
    case "GreenRain":
      return {
        label: t("dashboard.weather.greenRain"),
        color: "text-emerald-400",
        icon: CloudRain,
        bgGradient: "from-emerald-500/15 via-green-500/10 to-teal-500/10",
        flavor: t("dashboard.weather.flavor.greenRain"),
        tip: t("dashboard.weather.tip.greenRain"),
      }
    case "Festival":
      return {
        label: t("dashboard.weather.festival"),
        color: "text-amber-400",
        icon: Sun,
        bgGradient: "from-amber-500/15 via-orange-500/10 to-red-500/10",
        flavor: t("dashboard.weather.flavor.festival"),
        tip: t("dashboard.weather.tip.festival"),
      }
    default:
      return {
        label: t("dashboard.weather.sun"),
        color: "text-yellow-500",
        icon: Sun,
        bgGradient: "from-yellow-500/15 via-amber-500/10 to-orange-500/10",
        flavor: t("dashboard.weather.flavor.sun"),
        tip: t("dashboard.weather.tip.sun"),
      }
  }
}

const generateForecast = (startDay: number, season: number, saveId: string, tomorrowWeather: string) => {
  const forecast = []
  let seed = saveId.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0) + startDay
  const random = () => {
    const x = Math.sin(seed++) * 10000
    return x - Math.floor(x)
  }

  const getSeasonalWeather = (s: number) => {
    const r = random()
    if (s === 3) return r < 0.35 ? "Snow" : "Sun"
    else if (s === 1) {
      if (r < 0.15) return "Rain"
      if (r < 0.25) return "Storm"
      return "Sun"
    } else if (s === 2) {
      if (r < 0.20) return "Rain"
      if (r < 0.35) return "Wind"
      return "Sun"
    } else {
      if (r < 0.15) return "Rain"
      if (r < 0.30) return "Wind"
      return "Sun"
    }
  }

  forecast.push({ dayOffset: 0, weather: "Sun" })
  forecast.push({ dayOffset: 1, weather: tomorrowWeather })
  for (let i = 2; i < 7; i++) {
    forecast.push({ dayOffset: i, weather: getSeasonalWeather(season) })
  }
  return forecast
}

function WeatherForecastContent({ saveDetail }: WidgetRenderProps) {
  const { t } = useTranslation()
  const [selectedForecastIndex, setSelectedForecastIndex] = useState(0)

  const detail = saveDetail
  if (!detail) return null

  const summary = detail.summary
  const dayOfMonth = summary.dayOfMonth

  const forecastResetKey = `${summary.id}-${summary.season}-${summary.year}-${dayOfMonth}`
  useEffect(() => {
    setSelectedForecastIndex(0)
  }, [forecastResetKey])

  const forecastRaw = generateForecast(dayOfMonth, summary.season, summary.id, detail.weatherTomorrow)
  forecastRaw[0].weather = detail.weatherToday

  const getForecastDayLabel = (offset: number, currentDay: number) => {
    if (offset === 0) return t("dashboard.forecast.today")
    if (offset === 1) return t("dashboard.forecast.tomorrow")
    const targetDay = currentDay + offset
    const weekdayIdx = (targetDay - 1) % 7
    const daysShort = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
    return t("dashboard.forecast.weekdays." + daysShort[weekdayIdx])
  }

  const getSeasonalTemp = (weather: string, s: number) => {
    if (s === 3) return weather === "Snow" ? "-3°C" : "1°C"
    else if (s === 1) return weather === "Storm" || weather === "Rain" ? "25°C" : "29°C"
    else if (s === 2) return weather === "Rain" ? "12°C" : "16°C"
    else return weather === "Rain" ? "14°C" : "18°C"
  }

  const forecastData = forecastRaw.map((item) => {
    const config = getWeatherConfig(item.weather, summary.season, t)
    const DayIcon = config.icon
    return {
      day: getForecastDayLabel(item.dayOffset, dayOfMonth),
      weather: config.label,
      icon: <DayIcon className={`h-6 w-6 ${config.color}`} />,
      temp: getSeasonalTemp(item.weather, summary.season),
      bgGradient: config.bgGradient,
      flavor: config.flavor,
      tip: config.tip,
    }
  })

  const safeForecastIndex = Math.min(
    Math.max(selectedForecastIndex, 0),
    forecastData.length > 0 ? forecastData.length - 1 : 0,
  )
  const currentForecast = forecastData[safeForecastIndex] || forecastData[0]

  return (
    <Card className="overflow-hidden border-none bg-gradient-to-br from-card/50 to-card shadow-lg h-full">
      <CardContent className="p-0 h-full">
        <div
          className={`p-6 md:p-8 flex flex-col md:flex-row items-center md:items-stretch gap-8 transition-colors duration-700 bg-gradient-to-br ${currentForecast.bgGradient.replace(/\/1[05]/g, "/10")} h-full`}
        >
          {/* Left: Selected Day Details */}
          <div className="flex flex-col items-center md:items-start text-center md:text-left space-y-2 md:min-w-[200px]">
            <p className="text-sm font-bold uppercase tracking-widest text-foreground/60">
              {currentForecast.day}
            </p>
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-3xl bg-background/40 backdrop-blur-md border border-white/10 shadow-sm">
                <div className="scale-125 transform">{currentForecast.icon}</div>
              </div>
              <div>
                <p className="text-4xl font-black tracking-tighter">{currentForecast.temp}</p>
                <p className="font-bold text-foreground/80">{currentForecast.weather}</p>
              </div>
            </div>
            <div className="pt-2">
              <p className="text-sm leading-relaxed text-foreground/70 max-w-[280px]">
                {currentForecast.flavor}
              </p>
              {currentForecast.tip && (
                <p className="text-[11px] mt-2 font-bold text-primary flex items-center gap-1.5 opacity-80">
                  <Sun className="h-3 w-3" />
                  {currentForecast.tip}
                </p>
              )}
            </div>
          </div>

          {/* Right: 7-Day Timeline Strip */}
          <div className="flex-1 flex flex-col justify-center">
            <div className="grid grid-cols-4 sm:grid-cols-7 gap-2 md:gap-3 w-full">
              {forecastData.map((forecast, globalIndex) => {
                const isActive = globalIndex === selectedForecastIndex
                return (
                  <button
                    type="button"
                    key={`${forecast.day}-${globalIndex}`}
                    onClick={() => setSelectedForecastIndex(globalIndex)}
                    className={`flex flex-col items-center p-2 md:p-3 rounded-2xl transition-all duration-300 border ${
                      isActive
                        ? "bg-background/60 border-primary/40 shadow-sm scale-105"
                        : "bg-transparent border-transparent hover:bg-background/30"
                    }`}
                  >
                    <span
                      className={`text-[10px] font-bold uppercase mb-2 ${isActive ? "text-primary" : "text-muted-foreground"}`}
                    >
                      {forecast.day === t("dashboard.forecast.today")
                        ? t("dashboard.forecast.today").substring(0, 2)
                        : forecast.day.substring(0, 3)}
                    </span>
                    <div className={`mb-2 p-1.5 rounded-xl ${isActive ? "bg-primary/10" : ""}`}>
                      {forecast.icon && <div className="scale-90">{forecast.icon}</div>}
                    </div>
                    <span className="text-xs font-black tabular-nums">{forecast.temp}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

registerWidget({
  id: "weather-forecast",
  nameKey: "dashboard.widgetPicker.weatherForecast.name",
  descriptionKey: "dashboard.widgetPicker.weatherForecast.description",
  icon: Sun,
  defaultSize: "full",
  category: "weather",
  render: (props) => <WeatherForecastContent {...props} />,
})
