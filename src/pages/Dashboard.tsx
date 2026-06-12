import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
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
  User,
  FileQuestion,
} from "lucide-react"

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
}

interface SaveDetail {
  summary: SaveSummary
  weatherToday: string
  weatherTomorrow: string
  museumPiecesCount: number
  friendships: FriendshipInfo[]
}

const SEASONS = ["春季", "夏季", "秋季", "冬季"]
const WEEKDAYS = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"]

const BIRTHDAYS: Record<string, Record<number, string>> = {
  "春季": { 4: "肯特 (Kent)", 7: "刘易斯 (Lewis)", 10: "文森特 (Vincent)", 14: "海莉 (Haley)", 18: "潘姆 (Pam)", 20: "谢恩 (Shane)", 26: "皮埃尔 (Pierre)" },
  "夏季": { 4: "贾斯 (Jas)", 8: "格斯 (Gus)", 10: "玛鲁 (Maru)", 13: "亚历克斯 (Alex)", 17: "山姆 (Sam)", 19: "德米特里厄斯 (Demetrius)", 22: "矮人 (Dwarf)", 24: "威利 (Willy)", 26: "里奥 (Leo)" },
  "秋季": { 2: "潘妮 (Penny)", 5: "艾略特 (Elliott)", 11: "乔迪 (Jodi)", 13: "阿比盖尔 (Abigail)", 15: "桑迪 (Sandy)", 18: "玛妮 (Marnie)", 21: "罗宾 (Robin)", 24: "乔治 (George)" },
  "冬季": { 3: "科罗布斯 (Krobus)", 7: "莱纳斯 (Linus)", 10: "塞巴斯蒂安 (Sebastian)", 14: "哈维 (Harvey)", 17: "法师 (Wizard)", 20: "艾芙琳 (Evelyn)", 23: "莉亚 (Leah)", 26: "克林特 (Clint)" }
}

const getWeatherConfig = (weather: string) => {
  switch (weather) {
    case "Sun":
      return { label: "晴天", color: "text-yellow-500", icon: Sun }
    case "Rain":
      return { label: "雨天", color: "text-blue-400", icon: CloudRain }
    case "Storm":
      return { label: "雷雨天", color: "text-purple-400", icon: CloudLightning }
    case "Snow":
      return { label: "雪天", color: "text-sky-300", icon: Snowflake }
    case "Wind":
      return { label: "大风", color: "text-teal-400", icon: Wind }
    case "GreenRain":
      return { label: "绿雨", color: "text-emerald-400", icon: CloudRain }
    case "Festival":
      return { label: "节日晴天", color: "text-amber-400", icon: Sun }
    default:
      return { label: "晴天", color: "text-yellow-500", icon: Sun }
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
  const [detail, setDetail] = useState<SaveDetail | null>(null)
  const [loading, setLoading] = useState(true)

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
          const d: SaveDetail = await invoke("get_save_detail", { id: selectedSaveId })
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


  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-[50vh]">
        <div className="text-center space-y-2">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto"></div>
          <p className="text-muted-foreground text-sm font-medium">正在读取存档数据...</p>
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
          <h3 className="text-xl font-bold text-muted-foreground">暂无存档数据</h3>
          <p className="text-sm text-muted-foreground/70">
            您尚未选择游戏存档，或本地未检测到任何星露谷物语存档文件。请在游戏中创建存档后，通过侧边栏选择对应的存档文件以查看仪表盘数据。
          </p>
        </div>
      </div>
    )
  }

  const summary = detail.summary

  const seasonName = SEASONS[summary.season] || "春季"
  const dayOfMonth = summary.dayOfMonth
  const year = summary.year
  const weekdayName = WEEKDAYS[(dayOfMonth - 1) % 7] || "星期一"
  const playHours = Math.floor(summary.millisecondsPlayed / 3600000)
  const playTimeStr = `累计玩了 ${playHours} 小时`

  const weatherConfig = getWeatherConfig(detail.weatherToday)
  const WeatherIcon = weatherConfig.icon

  const VILLAGERS = new Set([
    "Abigail", "Alex", "Caroline", "Clint", "Demetrius", "Elliott", "Emily", "Evelyn", 
    "George", "Gus", "Haley", "Harvey", "Jas", "Jodi", "Kent", "Krobus", "Leah", "Leo", 
    "Lewis", "Linus", "Marnie", "Maru", "Pam", "Penny", "Pierre", "Robin", "Sam", "Sandy", 
    "Sebastian", "Shane", "Vincent", "Willy", "Wizard", "Dwarf"
  ])

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
      title: "金币",
      value: `${summary.money.toLocaleString()}g`,
      icon: <Coins className="h-5 w-5" />,
      description: `总收益 ${summary.totalMoneyEarned.toLocaleString()}g`,
      color: "text-yellow-500",
    },
    {
      title: "农场等级",
      value: `等级 ${Math.round((summary.farmingLevel + summary.miningLevel + summary.combatLevel + summary.foragingLevel + summary.fishingLevel) / 5) || 1}`,
      icon: <TreePine className="h-5 w-5" />,
      description: `耕种 Lv.${summary.farmingLevel} · 采矿 Lv.${summary.miningLevel}`,
      color: "text-green-500",
    },
    {
      title: "关系进度",
      value: `${maxHeartsCount} / ${totalTracked}`,
      icon: <Heart className="h-5 w-5" />,
      description: "已达满心(8心以上)的村民",
      color: "text-red-400",
    },
    {
      title: "收集进度",
      value: `${Math.round((detail.museumPiecesCount / 95) * 100)}%`,
      icon: <Pickaxe className="h-5 w-5" />,
      description: `博物馆捐赠 ${detail.museumPiecesCount}/95`,
      color: "text-blue-500",
    },
  ]

  // Dynamic tasks generation
  const tasksList: { task: string; done: boolean }[] = []
  const weekdayIdx = (dayOfMonth - 1) % 7
  if (weekdayIdx === 4 || weekdayIdx === 6) {
    tasksList.push({ task: "查看旅行货车 (商车已刷出)", done: false })
  }
  const birthdayNPC = BIRTHDAYS[seasonName]?.[dayOfMonth]
  if (birthdayNPC) {
    tasksList.push({ task: `🎉 送生日礼物给 ${birthdayNPC}!`, done: false })
  }
  if (detail.weatherToday === "Rain" || detail.weatherToday === "Storm" || detail.weatherToday === "GreenRain") {
    tasksList.push({ task: "今天下雨，不用给作物浇水 🌧️", done: true })
  } else {
    tasksList.push({ task: "给全部农作物浇水 💦", done: false })
  }
  if (summary.miningLevel > 0) {
    tasksList.push({ task: `矿洞探索 (当前层数: ${summary.deepestMineLevel}层)`, done: false })
  } else {
    tasksList.push({ task: "前往探索矿洞并收集矿石", done: false })
  }
  if (summary.fishingLevel > 0) {
    tasksList.push({ task: "前往湖边/海边垂钓季节性鱼类", done: false })
  } else {
    tasksList.push({ task: "练习垂钓以提升钓鱼等级", done: false })
  }
  tasksList.push({ task: "清理农场野草并收集纤维", done: true })

  // Dynamic recent activities
  const recentActivitiesList = []
  recentActivitiesList.push({
    icon: <Coins className="h-4 w-4 text-yellow-500" />,
    text: `累计赚取了 ${summary.totalMoneyEarned.toLocaleString()}g 经营金币`,
    time: "最近",
  })
  if (summary.deepestMineLevel > 0) {
    recentActivitiesList.push({
      icon: <Pickaxe className="h-4 w-4 text-blue-400" />,
      text: `在矿洞深处最高探索到了第 ${summary.deepestMineLevel} 层`,
      time: "前天",
    })
  }
  // Find highest friendship NPC
  const npcChineseName: Record<string, string> = {
    Abigail: "阿比盖尔", Alex: "亚历克斯", Caroline: "卡洛琳", Clint: "克林特",
    Demetrius: "德米特里厄斯", Elliott: "艾略特", Emily: "艾米丽", Evelyn: "艾芙琳",
    George: "乔治", Gus: "格斯", Haley: "海莉", Harvey: "哈维", Jas: "贾斯",
    Jodi: "乔迪", Kent: "肯特", Krobus: "科罗布斯", Leah: "莉亚", Leo: "里奥",
    Lewis: "刘易斯", Linus: "莱纳斯", Marnie: "玛妮", Maru: "玛鲁", Pam: "潘姆",
    Penny: "潘妮", Pierre: "皮埃尔", Robin: "罗宾", Sam: "山姆", Sandy: "桑迪",
    Sebastian: "塞巴斯蒂安", Shane: "谢恩", Vincent: "文森特", Willy: "威利",
    Wizard: "法师", Dwarf: "矮人"
  }
  const bestFriend = detail.friendships.reduce((best, current) => {
    if (VILLAGERS.has(current.npcName) && current.points > (best?.points || 0)) {
      return current
    }
    return best
  }, null as FriendshipInfo | null)

  if (bestFriend && bestFriend.points > 0) {
    const cnName = npcChineseName[bestFriend.npcName] || bestFriend.npcName
    const hearts = Math.floor(bestFriend.points / 250)
    recentActivitiesList.push({
      icon: <Heart className="h-4 w-4 text-red-400" />,
      text: `与 ${cnName} 的好感度已提升到了 ${hearts} 心`,
      time: "本周",
    })
  }
  if (detail.museumPiecesCount > 0) {
    recentActivitiesList.push({
      icon: <User className="h-4 w-4 text-purple-400" />,
      text: `向鹈鹕镇博物馆捐赠了共 ${detail.museumPiecesCount} 件文物与矿石`,
      time: "最近",
    })
  }
  recentActivitiesList.push({
    icon: <TreePine className="h-4 w-4 text-green-500" />,
    text: `在星露谷的农场度过了 ${dayOfMonth + (year - 1) * 112} 天的田园生活`,
    time: "今天",
  })

  // 7-day forecast generation
  const forecastRaw = generateForecast(dayOfMonth, summary.season, summary.id, detail.weatherTomorrow)
  forecastRaw[0].weather = detail.weatherToday // override today with actual

  const getForecastDayLabel = (offset: number, currentDay: number) => {
    if (offset === 0) return "今天"
    if (offset === 1) return "明天"
    const targetDay = currentDay + offset
    const weekdayIdx = (targetDay - 1) % 7
    const daysShort = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
    return daysShort[weekdayIdx]
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
    const config = getWeatherConfig(item.weather)
    const DayIcon = config.icon
    return {
      day: getForecastDayLabel(item.dayOffset, dayOfMonth),
      weather: config.label,
      icon: <DayIcon className={`h-6 w-6 ${config.color}`} />,
      temp: getSeasonalTemp(item.weather, summary.season)
    }
  })

  return (
    <div className="p-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-3xl font-bold tracking-tight">仪表盘</h2>
          </div>
          <p className="text-muted-foreground mt-1 font-medium">
            {seasonName} 第 {dayOfMonth} 天 · {weekdayName} (第 {year} 年)
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

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Today's Tasks */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">今日待办</CardTitle>
            <CardDescription>
              已完成 {tasksList.filter((t) => t.done).length}/{tasksList.length} 项任务
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {tasksList.map((item, i) => (
              <div
                key={i}
                className="flex items-center gap-3 p-2 rounded-md hover:bg-accent/50 transition-colors"
              >
                <div
                  className={`h-5 w-5 rounded-full border-2 flex items-center justify-center ${
                    item.done
                      ? "bg-primary border-primary"
                      : "border-muted-foreground/30"
                  }`}
                >
                  {item.done && (
                    <svg className="h-3 w-3 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <span
                  className={`text-sm ${
                    item.done ? "text-muted-foreground line-through" : ""
                  }`}
                >
                  {item.task}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Recent Activities */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">最近活动</CardTitle>
            <CardDescription>你的农场近期发生的事件</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {recentActivitiesList.map((activity, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-accent">
                    {activity.icon}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm">{activity.text}</p>
                    <p className="text-xs text-muted-foreground">{activity.time}</p>
                  </div>
                  {i < recentActivitiesList.length - 1 && (
                    <Separator className="absolute bottom-0 left-11 right-0" />
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Weather Forecast */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">天气预报</CardTitle>
          <CardDescription>未来几天的鹈鹕镇天气</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-3">
            {forecastData.map((d) => (
              <div key={d.day} className="flex flex-col items-center gap-2 p-3 rounded-lg bg-accent/50">
                <span className="text-xs font-medium text-muted-foreground">{d.day}</span>
                {d.icon}
                <span className="text-sm font-medium">{d.weather}</span>
                <span className="text-xs text-muted-foreground">{d.temp}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
