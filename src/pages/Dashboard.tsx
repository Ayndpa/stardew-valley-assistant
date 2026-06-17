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
  Fish,
  UtensilsCrossed,
  ScrollText,
  Wrench,
  Star,
  Trophy,
  Cookie,
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

interface MonsterKillInfo {
  name: string
  count: number
}

interface SaveDetail {
  summary: SaveSummary
  weatherToday: string
  weatherTomorrow: string
  museumPiecesCount: number
  museumPieces: string[]
  friendships: FriendshipInfo[]
  // Collection tracking
  shippedItems: string[]
  fishCaught: string[]
  cookingRecipes: string[]
  craftingRecipes: string[]
  recipesCooked: string[]
  secretNotesSeen: number[]
  songsHeard: string[]
  mailReceived: string[]
  maxStamina: number
  specificMonstersKilled: MonsterKillInfo[]
  goldenWalnutsFound: number
}

const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]

const VILLAGERS = new Set([
  "Abigail", "Alex", "Caroline", "Clint", "Demetrius", "Elliott", "Emily", "Evelyn", 
  "George", "Gus", "Haley", "Harvey", "Jas", "Jodi", "Kent", "Krobus", "Leah", "Leo", 
  "Lewis", "Linus", "Marnie", "Maru", "Pam", "Penny", "Pierre", "Robin", "Sam", "Sandy", 
  "Sebastian", "Shane", "Vincent", "Willy", "Wizard", "Dwarf"
])

const getWeatherConfig = (weather: string, season: number, t: any) => {
  switch (weather) {
    case "Sun":
      return {
        label: t("dashboard.weather.sun"),
        color: "text-yellow-500",
        icon: Sun,
        bgGradient: "from-yellow-500/15 via-amber-500/10 to-orange-500/10",
        flavor: t("dashboard.weather.flavor.sun"),
        tip: season === 3 ? t("dashboard.weather.tip.sunWinter") : t("dashboard.weather.tip.sun")
      }
    case "Rain":
      return {
        label: t("dashboard.weather.rain"),
        color: "text-blue-400",
        icon: CloudRain,
        bgGradient: "from-blue-500/15 via-sky-500/10 to-indigo-500/10",
        flavor: t("dashboard.weather.flavor.rain"),
        tip: t("dashboard.weather.tip.rain")
      }
    case "Storm":
      return {
        label: t("dashboard.weather.storm"),
        color: "text-purple-400",
        icon: CloudLightning,
        bgGradient: "from-purple-500/15 via-fuchsia-500/10 to-indigo-500/10",
        flavor: t("dashboard.weather.flavor.storm"),
        tip: t("dashboard.weather.tip.storm")
      }
    case "Snow":
      return {
        label: t("dashboard.weather.snow"),
        color: "text-sky-300",
        icon: Snowflake,
        bgGradient: "from-sky-300/15 via-blue-300/10 to-indigo-300/10",
        flavor: t("dashboard.weather.flavor.snow"),
        tip: t("dashboard.weather.tip.snow")
      }
    case "Wind":
      return {
        label: t("dashboard.weather.wind"),
        color: "text-teal-400",
        icon: Wind,
        bgGradient: "from-teal-500/15 via-emerald-500/10 to-cyan-500/10",
        flavor: t("dashboard.weather.flavor.wind"),
        tip: t("dashboard.weather.tip.wind")
      }
    case "GreenRain":
      return {
        label: t("dashboard.weather.greenRain"),
        color: "text-emerald-400",
        icon: CloudRain,
        bgGradient: "from-emerald-500/15 via-green-500/10 to-teal-500/10",
        flavor: t("dashboard.weather.flavor.greenRain"),
        tip: t("dashboard.weather.tip.greenRain")
      }
    case "Festival":
      return {
        label: t("dashboard.weather.festival"),
        color: "text-amber-400",
        icon: Sun,
        bgGradient: "from-amber-500/15 via-orange-500/10 to-red-500/10",
        flavor: t("dashboard.weather.flavor.festival"),
        tip: t("dashboard.weather.tip.festival")
      }
    default:
      return {
        label: t("dashboard.weather.sun"),
        color: "text-yellow-500",
        icon: Sun,
        bgGradient: "from-yellow-500/15 via-amber-500/10 to-orange-500/10",
        flavor: t("dashboard.weather.flavor.sun"),
        tip: t("dashboard.weather.tip.sun")
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

  // Collection progress computation (must be before any early returns to keep hook order stable)
  const collectionStats = useMemo(() => {
    if (!detail || !itemEntries) return null

    // Shipping: exclude items with certain itemTypeKey or categoryKey
    const SHIPPING_EXCLUDE_TYPES = new Set(["arch", "fish", "minerals", "cooking", "ring", "seeds", "litter", "interactive", "quest", "asdf"])
    const SHIPPING_EXCLUDE_CATS = new Set([
      "seed", "fertilizer", "bait", "tackle", "furniture", "big_craftable", "clothing", "hat",
    ])
    const shippedSet = new Set(detail.shippedItems)
    const shippableItems = itemEntries.filter(
      (item) => !SHIPPING_EXCLUDE_TYPES.has(item.itemTypeKey) && !SHIPPING_EXCLUDE_CATS.has(item.categoryKey),
    )
    const shippedCount = shippableItems.filter((item) => shippedSet.has(item.id)).length

    // Fish
    const fishSet = new Set(detail.fishCaught.map((id) => id.replace(/\(O\)/g, "")))
    const allFish = itemEntries.filter((item) => item.itemTypeKey === "fish")
    const caughtCount = allFish.filter((item) => fishSet.has(item.id)).length

    // Museum (artifacts + minerals)
    const museumSet = new Set(detail.museumPieces.map((id) => id.trim()))
    const allMuseum = itemEntries.filter(
      (item) => item.itemTypeKey === "arch" || item.itemTypeKey === "minerals",
    )
    const museumCount = allMuseum.filter((item) => museumSet.has(item.id)).length

    // Cooking
    const cookedSet = new Set(detail.recipesCooked)
    const allCooking = itemEntries.filter((item) => item.itemTypeKey === "cooking")
    const cookedCount = allCooking.filter((item) => cookedSet.has(item.id)).length

    // Crafting
    const craftedSet = new Set(
      detail.craftingRecipes.filter(([, count]) => count > 0).map(([name]) => name),
    )
    const allCrafting = itemEntries.filter((item) => item.itemTypeKey === "crafting")
    const craftedCount = allCrafting.filter(
      (item) => craftedSet.has(item.name) || craftedSet.has(item.internalName),
    ).length

    // Secret Notes (IDs 1-25 are secret notes, 1001+ are journal scraps)
    const secretNotesTotal = 25
    const secretNotesCount = detail.secretNotesSeen.filter((id) => id >= 1 && id <= 25).length

    // Stardrops: check 7 mail flags
    const stardropFlags = ["CF_Fair", "CF_Fish", "CF_Mines", "CF_Sewer", "museumComplete", "CF_Spouse", "CF_Statue"]
    const mailSet = new Set(detail.mailReceived)
    const stardropsFound = stardropFlags.filter((f) => mailSet.has(f)).length
    // Also check maxStamina as fallback (270 base + 34 per stardrop)
    const stardropsFromStamina = Math.min(7, Math.max(0, Math.floor((detail.maxStamina - 270) / 34)))
    const stardrops = Math.max(stardropsFound, stardropsFromStamina)

    // Monster Slayer: count completed goals (sum of kills per goal >= required count)
    // We approximate by counting goals with any kills; exact check needs MonsterSlayerQuests data
    const monsterGoalsCompleted = detail.specificMonstersKilled.filter((m) => m.count > 0).length

    // Perfection score (weighted like the game)
    const shipPct = shippableItems.length > 0 ? shippedCount / shippableItems.length : 0
    const fishPct = allFish.length > 0 ? caughtCount / allFish.length : 0
    const museumPct = allMuseum.length > 0 ? museumCount / allMuseum.length : 0
    const cookPct = allCooking.length > 0 ? cookedCount / allCooking.length : 0
    const craftPct = allCrafting.length > 0 ? craftedCount / allCrafting.length : 0
    const stardropPct = stardrops / 7
    const walnutPct = detail.goldenWalnutsFound / 130
    const monsterPct = monsterGoalsCompleted > 0 ? Math.min(1, monsterGoalsCompleted / 12) : 0
    // Weights: ship 15%, fish 10%, museum ~10%, cooking 10%, crafting 10%, stardrops 10%, walnuts 5%, monsters 10%, skills 5%, friendship 11%, buildings ~14%
    // We only have partial data, so compute what we can (total ~70% of perfection)
    const perfectionPct =
      shipPct * 15 + fishPct * 10 + museumPct * 10 + cookPct * 10 + craftPct * 10 +
      stardropPct * 10 + walnutPct * 5 + monsterPct * 10

    return {
      shipping: { collected: shippedCount, total: shippableItems.length },
      fish: { collected: caughtCount, total: allFish.length },
      museum: { collected: museumCount, total: allMuseum.length },
      cooking: { collected: cookedCount, total: allCooking.length },
      crafting: { collected: craftedCount, total: allCrafting.length },
      notes: { collected: secretNotesCount, total: secretNotesTotal },
      stardrops,
      walnuts: detail.goldenWalnutsFound,
      monsterGoals: monsterGoalsCompleted,
      perfectionPct: Math.round(perfectionPct),
    }
  }, [detail, itemEntries])

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

  const weatherConfig = getWeatherConfig(detail.weatherToday, summary.season, t)
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
      value: `${collectionStats?.perfectionPct ?? 0}%`,
      icon: <Trophy className="h-5 w-5" />,
      description: t("dashboard.stats.collectionDesc", { percent: collectionStats?.perfectionPct ?? 0 }),
      color: "text-amber-500",
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

      {/* Weather Forecast Widget */}
      <Card className="overflow-hidden border-none bg-gradient-to-br from-card/50 to-card shadow-lg">
        <CardContent className="p-0">
          <div className={`p-6 md:p-8 flex flex-col md:flex-row items-center md:items-stretch gap-8 transition-colors duration-700 bg-gradient-to-br ${currentForecast.bgGradient.replace(/\/1[05]/g, '/10')}`}>
            {/* Left: Selected Day Details */}
            <div className="flex flex-col items-center md:items-start text-center md:text-left space-y-2 md:min-w-[200px]">
              <p className="text-sm font-bold uppercase tracking-widest text-foreground/60">{currentForecast.day}</p>
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
                  const isActive = globalIndex === selectedForecastIndex;
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
                      <span className={`text-[10px] font-bold uppercase mb-2 ${isActive ? 'text-primary' : 'text-muted-foreground'}`}>
                        {forecast.day === t("dashboard.forecast.today") ? t("dashboard.forecast.today").substring(0, 2) : forecast.day.substring(0, 3)}
                      </span>
                      <div className={`mb-2 p-1.5 rounded-xl ${isActive ? 'bg-primary/10' : ''}`}>
                        {forecast.icon && (
                          <div className="scale-90">{forecast.icon}</div>
                        )}
                      </div>
                      <span className="text-xs font-black tabular-nums">{forecast.temp}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Collection Progress */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-lg">{t("dashboard.collection.title")}</CardTitle>
              <CardDescription>
                {t("dashboard.collection.overall", { percent: collectionStats?.perfectionPct ?? 0 })}
              </CardDescription>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/10 shrink-0">
              <Trophy className="h-5 w-5 text-amber-500" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {itemEntries === null || !collectionStats ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
              {t("dashboard.collection.loading")}
            </div>
          ) : (
            <>
              {/* Extra stats row */}
              <div className="flex flex-wrap gap-3">
                <Badge variant="secondary" className="gap-1.5 px-3 py-1.5">
                  <Star className="h-3.5 w-3.5 text-amber-400" />
                  {t("dashboard.collection.stardrops", { count: collectionStats.stardrops })}
                </Badge>
                <Badge variant="secondary" className="gap-1.5 px-3 py-1.5">
                  <Cookie className="h-3.5 w-3.5 text-amber-600" />
                  {t("dashboard.collection.walnuts", { count: collectionStats.walnuts })}
                </Badge>
                <Badge variant="secondary" className="gap-1.5 px-3 py-1.5">
                  <Trophy className="h-3.5 w-3.5 text-red-400" />
                  {t("dashboard.collection.monsterSlayer", { count: collectionStats.monsterGoals })}
                </Badge>
              </div>

              {/* Category cards grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {[
                  { key: "shipping", icon: Package, color: "text-green-500", bgColor: "bg-green-500/10", stats: collectionStats.shipping },
                  { key: "fish", icon: Fish, color: "text-blue-400", bgColor: "bg-blue-400/10", stats: collectionStats.fish },
                  { key: "museum", icon: Pickaxe, color: "text-violet-500", bgColor: "bg-violet-500/10", stats: collectionStats.museum },
                  { key: "cooking", icon: UtensilsCrossed, color: "text-orange-400", bgColor: "bg-orange-400/10", stats: collectionStats.cooking },
                  { key: "crafting", icon: Wrench, color: "text-teal-500", bgColor: "bg-teal-500/10", stats: collectionStats.crafting },
                  { key: "notes", icon: ScrollText, color: "text-pink-400", bgColor: "bg-pink-400/10", stats: collectionStats.notes },
                ].map(({ key, icon: Icon, color, bgColor, stats }) => {
                  const pct = stats.total > 0 ? Math.round((stats.collected / stats.total) * 100) : 0
                  return (
                    <div
                      key={key}
                      className="flex items-center gap-3 p-3 rounded-lg border bg-card/50 hover:bg-accent/30 transition-colors"
                    >
                      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${bgColor}`}>
                        <Icon className={`h-5 w-5 ${color}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium truncate">
                            {t(`dashboard.collection.${key}.title`)}
                          </span>
                          <span className="text-xs text-muted-foreground shrink-0 ml-2">
                            {stats.collected}/{stats.total}
                          </span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${color.replace("text-", "bg-")}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
