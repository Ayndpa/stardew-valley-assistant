import { useState, useEffect, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useTranslation } from "react-i18next"
import {
  Sun,
  CloudRain,
  CloudLightning,
  Snowflake,
  Wind,
  Coins,
  Heart,
  Pickaxe,
  TreePine,
  Clock,
  FileQuestion,
  Package,
  CheckCircle2,
  Circle,
} from "lucide-react"
import { ItemEntry } from "./items/types"

// Dynamic imports will be done inline inside useEffect/handlers for reliability


interface SaveSummary {
  id: string
  playerName: string
  farmName: string
  money: number
  totalMoneyEarned: number
  dayOfMonth: number
  season: number // 0: Spring, 1: Summer, 2: Fall, 3: Winter
  year: number
  farmingLevel: number
  miningLevel: number
  combatLevel: number
  foragingLevel: number
  fishingLevel: number
  deepestMineLevel: number
  millisecondsPlayed: number
  lastSaveTime: number
}

interface FriendshipInfo {
  npcName: string
  points: number
  giftsThisWeek: number
  giftsToday: number
  talkedToToday: boolean
  status: string
}

interface SaveDetail {
  summary: SaveSummary
  weatherToday: string
  weatherTomorrow: string
  museumPiecesCount: number
  museumPieces: string[]
  friendships: FriendshipInfo[]
}

const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]

const VILLAGERS = new Set([
  "Abigail", "Alex", "Caroline", "Clint", "Demetrius", "Elliott", "Emily", "Evelyn", 
  "George", "Gus", "Haley", "Harvey", "Jas", "Jodi", "Kent", "Krobus", "Leah", "Leo", 
  "Lewis", "Linus", "Marnie", "Maru", "Pam", "Penny", "Pierre", "Robin", "Sam", "Sandy", 
  "Sebastian", "Shane", "Vincent", "Willy", "Wizard", "Dwarf"
])

const getWeatherConfig = (weather: string, t: any) => {
  switch (weather) {
    case "Sun":
      return { label: t("dashboard.weather.sun"), color: "text-yellow-500", icon: Sun }
    case "Rain":
      return { label: t("dashboard.weather.rain"), color: "text-blue-400", icon: CloudRain }
    case "Storm":
      return { label: t("dashboard.weather.storm"), color: "text-purple-400", icon: CloudLightning }
    case "Snow":
      return { label: t("dashboard.weather.snow"), color: "text-sky-300", icon: Snowflake }
    case "Wind":
      return { label: t("dashboard.weather.wind"), color: "text-teal-400", icon: Wind }
    case "GreenRain":
      return { label: t("dashboard.weather.greenRain"), color: "text-emerald-400", icon: CloudRain }
    case "Festival":
      return { label: t("dashboard.weather.festival"), color: "text-amber-400", icon: Sun }
    default:
      return { label: t("dashboard.weather.sun"), color: "text-yellow-500", icon: Sun }
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
    if (s === 3) { // Winter
      return r < 0.35 ? "Snow" : "Sun"
    } else if (s === 1) { // Summer
      if (r < 0.15) return "Rain"
      if (r < 0.25) return "Storm"
      return "Sun"
    } else if (s === 2) { // Fall
      if (r < 0.20) return "Rain"
      if (r < 0.35) return "Wind"
      return "Sun"
    } else { // Spring
      if (r < 0.15) return "Rain"
      if (r < 0.30) return "Wind"
      return "Sun"
    }
  }

  forecast.push({ dayOffset: 0, weather: "Sun" }) // placeholder, will set directly
  forecast.push({ dayOffset: 1, weather: tomorrowWeather })

  for (let i = 2; i < 7; i++) {
    forecast.push({
      dayOffset: i,
      weather: getSeasonalWeather(season),
    })
  }

  return forecast
}

interface DashboardProps {
  selectedSaveId: string
}

export function Dashboard({ selectedSaveId }: DashboardProps) {
  const { t, i18n } = useTranslation()
  const [detail, setDetail] = useState<SaveDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [showAllForecast, setShowAllForecast] = useState(false)
  const [selectedForecastIndex, setSelectedForecastIndex] = useState(0)
  const [itemEntries, setItemEntries] = useState<ItemEntry[] | null>(null)

  const activeLang = i18n.resolvedLanguage || i18n.language || "zh"

  // Fetch details for the selected save
  useEffect(() => {
    async function fetchDetail() {
      if (!selectedSaveId) {
        setLoading(false)
        return
      }

      setLoading(true)
      const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;

      if (isTauri) {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          const gameDir = localStorage.getItem("stardewGameDirectory") || undefined
          const d: SaveDetail = await invoke("get_save_detail", {
            id: selectedSaveId,
            gameDir,
            includeAvatar: false,
          })
          setDetail(d)
        } catch (err) {
          console.error("Error loading save detail:", err)
          setDetail(null)
        } finally {
          setLoading(false)
        }
      } else {
        setLoading(false)
      }
    }
    fetchDetail()
  }, [selectedSaveId])

  // Fetch item game data for resolving museum piece names
  useEffect(() => {
    let canceled = false

    async function loadItems() {
      const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__
      if (!isTauri) {
        setItemEntries([])
        return
      }

      const gameDir = localStorage.getItem("stardewGameDirectory") || ""
      try {
        const { invoke } = await import("@tauri-apps/api/core")
        const data = await invoke<{ encyclopedia: ItemEntry[] }>("get_item_game_data", {
          gameDir: gameDir.trim() || undefined,
          lang: activeLang,
        })
        if (!canceled) {
          setItemEntries(data.encyclopedia)
        }
      } catch (err) {
        console.error("Error loading item game data:", err)
        if (!canceled) {
          setItemEntries([])
        }
      }
    }

    loadItems()

    return () => {
      canceled = true
    }
  }, [activeLang])

  const forecastResetKey = detail
    ? `${detail.summary.id}-${detail.summary.season}-${detail.summary.year}-${detail.summary.dayOfMonth}`
    : ""
  useEffect(() => {
    if (forecastResetKey) {
      setSelectedForecastIndex(0)
    }
  }, [forecastResetKey])

  // Museum collection data (must be before any early returns to keep hook order stable)
  const museumItemSet = useMemo(() => {
    if (!detail) return new Set<string>()
    return new Set(detail.museumPieces.map((id) => id.trim()))
  }, [detail])

  const allMuseumItems = useMemo(() => {
    if (!itemEntries) return []
    return itemEntries.filter(
      (item) => item.itemTypeKey === "arch" || item.itemTypeKey === "minerals",
    )
  }, [itemEntries])

  const collectedMuseumItems = useMemo(() => {
    return allMuseumItems.filter((item) => museumItemSet.has(item.id))
  }, [allMuseumItems, museumItemSet])

  const missingMuseumItems = useMemo(() => {
    return allMuseumItems.filter((item) => !museumItemSet.has(item.id))
  }, [allMuseumItems, museumItemSet])

  const museumProgress = useMemo(() => {
    const total = allMuseumItems.length
    if (total === 0) return { percent: 0, collected: detail?.museumPiecesCount || 0, total: 95 }
    const collected = collectedMuseumItems.length
    return { percent: Math.round((collected / total) * 100), collected, total }
  }, [allMuseumItems, collectedMuseumItems, detail])

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-[50vh]">
        <div className="text-center space-y-2">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto"></div>
          <p className="text-muted-foreground text-sm font-medium">{t("dashboard.loading")}</p>
        </div>
      </div>
    )
  }

  // No save selected or no save data
  if (!selectedSaveId || !detail) {
    return (
      <div className="p-8 flex items-center justify-center h-[70vh]">
        <div className="text-center space-y-4 max-w-md">
          <FileQuestion className="h-16 w-16 text-muted-foreground/30 mx-auto" />
          <h3 className="text-xl font-bold text-muted-foreground">{t("dashboard.noSaveTitle")}</h3>
          <p className="text-sm text-muted-foreground/70">
            {t("dashboard.noSaveDescription")}
          </p>
        </div>
      </div>
    )
  }

  const summary = detail.summary

  const seasonName = t("seasons." + ["spring", "summer", "fall", "winter"][summary.season])
  const dayOfMonth = summary.dayOfMonth
  const year = summary.year
  const weekdayName = t("dashboard.weekdays." + WEEKDAY_KEYS[(dayOfMonth - 1) % 7])
  const playHours = Math.floor(summary.millisecondsPlayed / 3600000)
  const playTimeStr = t("dashboard.playTime", { hours: playHours })

  const weatherConfig = getWeatherConfig(detail.weatherToday, t)
  const WeatherIcon = weatherConfig.icon

    // Calculate relationships
  let maxHeartsCount = 0
  let totalTracked = 0
  detail.friendships.forEach((f) => {
    if (VILLAGERS.has(f.npcName)) {
      totalTracked++
      const hearts = Math.floor(f.points / 250)
      if (hearts >= 8) {
        maxHeartsCount++
      }
    }
  })
  if (totalTracked === 0) totalTracked = 34

  // Stats cards data binding
  const statsCards = [
    {
      title: t("dashboard.stats.moneyTitle"),
      value: `${summary.money.toLocaleString()}g`,
      icon: <Coins className="h-5 w-5" />,
      description: t("dashboard.stats.moneyDesc", { amount: summary.totalMoneyEarned.toLocaleString() }),
      color: "text-yellow-500",
    },
    {
      title: t("dashboard.stats.levelTitle"),
      value: t("dashboard.stats.levelValue", { level: Math.round((summary.farmingLevel + summary.miningLevel + summary.combatLevel + summary.foragingLevel + summary.fishingLevel) / 5) || 1 }),
      icon: <TreePine className="h-5 w-5" />,
      description: t("dashboard.stats.levelDesc", { farming: summary.farmingLevel, mining: summary.miningLevel }),
      color: "text-green-500",
    },
    {
      title: t("dashboard.stats.friendshipTitle"),
      value: `${maxHeartsCount} / ${totalTracked}`,
      icon: <Heart className="h-5 w-5" />,
      description: t("dashboard.stats.friendshipDesc"),
      color: "text-red-400",
    },
    {
      title: t("dashboard.stats.collectionTitle"),
      value: `${museumProgress.percent}%`,
      icon: <Pickaxe className="h-5 w-5" />,
      description: t("dashboard.stats.collectionDesc", { count: museumProgress.collected, total: museumProgress.total }),
      color: "text-blue-500",
    },
  ]

  // 7-day forecast generation
  const forecastRaw = generateForecast(dayOfMonth, summary.season, summary.id, detail.weatherTomorrow)
  forecastRaw[0].weather = detail.weatherToday // override today with actual

  const getForecastDayLabel = (offset: number, currentDay: number) => {
    if (offset === 0) return t("dashboard.forecast.today")
    if (offset === 1) return t("dashboard.forecast.tomorrow")
    const targetDay = currentDay + offset
    const weekdayIdx = (targetDay - 1) % 7
    const daysShort = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
    return t("dashboard.forecast.weekdays." + daysShort[weekdayIdx])
  }

  const getSeasonalTemp = (weather: string, s: number) => {
    if (s === 3) { // Winter
      return weather === "Snow" ? "-3°C" : "1°C"
    } else if (s === 1) { // Summer
      return weather === "Storm" || weather === "Rain" ? "25°C" : "29°C"
    } else if (s === 2) { // Fall
      return weather === "Rain" ? "12°C" : "16°C"
    } else { // Spring
      return weather === "Rain" ? "14°C" : "18°C"
    }
  }

  const forecastData = forecastRaw.map((item) => {
    const config = getWeatherConfig(item.weather, t)
    const DayIcon = config.icon
    return {
      day: getForecastDayLabel(item.dayOffset, dayOfMonth),
      weather: config.label,
      icon: <DayIcon className={`h-6 w-6 ${config.color}`} />,
      temp: getSeasonalTemp(item.weather, summary.season),
    }
  })

  const safeForecastIndex = Math.min(
    Math.max(selectedForecastIndex, 0),
    forecastData.length > 0 ? forecastData.length - 1 : 0,
  )
  const currentForecast = forecastData[safeForecastIndex] || forecastData[0]
  const timelineIndices = showAllForecast ? forecastData.map((_, index) => index) : [0, 1]
  const visibleTimeline = timelineIndices
    .filter((index) => index < forecastData.length)

  return (
    <div className="p-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-3xl font-bold tracking-tight">{t("dashboard.title")}</h2>
          </div>
          <p className="text-muted-foreground mt-1 font-medium">
            {t("dashboard.dateValue", { season: seasonName, day: dayOfMonth, weekday: weekdayName, year: year })}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="secondary" className="gap-1.5 px-3 py-1.5 font-medium">
            <WeatherIcon className={`h-4 w-4 ${weatherConfig.color}`} />
            {weatherConfig.label}
          </Badge>
          <Badge variant="secondary" className="gap-1.5 px-3 py-1.5 font-medium">
            <Clock className="h-4 w-4 text-primary" />
            {playTimeStr}
          </Badge>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {statsCards.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.title}
              </CardTitle>
              <div className={stat.color}>{stat.icon}</div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              <p className="text-xs text-muted-foreground mt-1">{stat.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Weather Forecast */}
      <Card>
        <CardHeader className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-lg">{t("dashboard.forecast.title")}</CardTitle>
            </div>
            {forecastData.length > 2 && (
              <button
                type="button"
                onClick={() => {
                  setShowAllForecast((s) => !s)
                  setSelectedForecastIndex(0)
                }}
                className="text-xs font-medium px-3 py-1.5 rounded-full bg-accent hover:bg-accent/80 text-accent-foreground transition-colors"
              >
                {showAllForecast ? t("dashboard.forecast.showLess") : t("dashboard.forecast.showMore")}
              </button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {currentForecast && (
            <div className="rounded-2xl border border-primary/30 bg-gradient-to-br from-sky-500/15 via-cyan-500/10 to-indigo-500/10 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">{t("dashboard.forecast.currentViewing")}</p>
                  <p className="text-xl font-black mt-1">{currentForecast.day}</p>
                  <p className="text-sm text-muted-foreground mt-1">{currentForecast.weather}</p>
                  <p className="text-3xl font-black mt-2 leading-none">
                    {currentForecast.temp}
                  </p>
                </div>
                <div className="rounded-xl bg-white/10 dark:bg-black/20 p-2">
                  {currentForecast.icon}
                </div>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                {t("dashboard.forecast.tip")}
              </p>
            </div>
          )}
          <div className="flex items-center gap-2 overflow-x-auto pb-2 snap-x snap-mandatory">
            {visibleTimeline.map((globalIndex) => {
              const forecast = forecastData[globalIndex]
              if (!forecast) return null
              const isActive = globalIndex === selectedForecastIndex
              return (
                <button
                  type="button"
                  key={`${forecast.day}-${globalIndex}`}
                  onClick={() => setSelectedForecastIndex(globalIndex)}
                  className={`snap-start min-w-[132px] shrink-0 rounded-2xl border px-3 py-3 text-left transition-all ${
                    isActive || safeForecastIndex === globalIndex
                      ? "border-primary/50 bg-primary/8 shadow-sm shadow-primary/20"
                      : "border-border/70 bg-card"
                  }`}
                >
                  <p className="text-xs text-muted-foreground">{forecast.day}</p>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-xs font-medium">{forecast.weather}</span>
                    {forecast.icon}
                  </div>
                  <p className="text-sm font-bold mt-2">{forecast.temp}</p>
                </button>
              )
            })}
          </div>
          {showAllForecast && (
            <div className="text-center">
              <button
                type="button"
                onClick={() => {
                  setShowAllForecast(false)
                  setSelectedForecastIndex(0)
                }}
                className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-3"
              >
                {t("dashboard.forecast.collapseTip")}
              </button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Collection Stats */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-lg">{t("dashboard.collection.title")}</CardTitle>
              <CardDescription>
                {t("dashboard.collection.description", {
                  collected: museumProgress.collected,
                  total: museumProgress.total,
                })}
              </CardDescription>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent shrink-0">
              <Pickaxe className="h-5 w-5 text-blue-500" />
            </div>
          </div>
          <div className="mt-3 h-2 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-blue-500 transition-all"
              style={{ width: `${museumProgress.total > 0 ? (museumProgress.collected / museumProgress.total) * 100 : 0}%` }}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {itemEntries === null ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
              {t("dashboard.collection.loading")}
            </div>
          ) : (
            <>
              <div>
                <h4 className="text-sm font-semibold flex items-center gap-2 mb-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  {t("dashboard.collection.collectedTitle", { count: collectedMuseumItems.length })}
                </h4>
                {collectedMuseumItems.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("dashboard.collection.noCollected")}</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-[240px] overflow-y-auto pr-1">
                    {collectedMuseumItems.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center gap-2 p-2 rounded-md bg-accent/30 text-sm"
                      >
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-background/80">
                          {item.icon ? (
                            <img
                              src={item.icon}
                              alt=""
                              className="h-5 w-5 object-contain"
                              style={{ imageRendering: "pixelated" }}
                            />
                          ) : (
                            <Package className="h-3.5 w-3.5 text-muted-foreground" />
                          )}
                        </div>
                        <span className="truncate">{item.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h4 className="text-sm font-semibold flex items-center gap-2 mb-2">
                  <Circle className="h-4 w-4 text-amber-500" />
                  {t("dashboard.collection.missingTitle", { count: missingMuseumItems.length })}
                </h4>
                {missingMuseumItems.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("dashboard.collection.noMissing")}</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-[240px] overflow-y-auto pr-1">
                    {missingMuseumItems.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center gap-2 p-2 rounded-md bg-accent/20 text-sm text-muted-foreground"
                      >
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-background/80">
                          {item.icon ? (
                            <img
                              src={item.icon}
                              alt=""
                              className="h-5 w-5 object-contain opacity-60"
                              style={{ imageRendering: "pixelated" }}
                            />
                          ) : (
                            <Package className="h-3.5 w-3.5 text-muted-foreground" />
                          )}
                        </div>
                        <span className="truncate">{item.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
