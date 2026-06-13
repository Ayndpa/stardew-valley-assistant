import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  CalendarDays,
  PartyPopper,
  Cake,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Info,
  FileQuestion,
} from "lucide-react"

// Dynamic imports will be done inline inside useEffect/handlers for reliability


interface SaveSummary {
  id: string
  playerName: string
  farmName: string
  dayOfMonth: number
  season: number // 0: Spring, 1: Summer, 2: Fall, 3: Winter
  year: number
}

interface SaveDetail {
  summary: SaveSummary
}

import { getBooksellerDays } from "@/lib/dotnet-random"

interface Festival {
  name: string
  date: string
  day: number
  season: string
  description?: string | null
}

interface Birthday {
  name: string
  date: string
  day: number
  season: string
}

interface CalendarGameData {
  festivals: Festival[]
  birthdays: Birthday[]
}

interface LocalCacheEntry<T> {
  data: T
  fetchedAt: number
}

const SEASONS_LIST = ["春季", "夏季", "秋季", "冬季"]
const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]

const CALENDAR_GAME_DATA_CACHE_KEY = "stardew_calendar_game_data_cache"
const CALENDAR_SAVE_DETAIL_CACHE_KEY = "stardew_calendar_save_detail_cache"

function normalizeGameDir(gameDir: string) {
  return gameDir.trim().toLowerCase()
}

function readCache<T>(key: string): LocalCacheEntry<T> | null {
  if (typeof window === "undefined") return null

  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as LocalCacheEntry<T>
  } catch (error) {
    console.error(`Failed to read cache: ${key}`, error)
    return null
  }
}

function writeCache<T>(key: string, data: T) {
  if (typeof window === "undefined") return

  try {
    const entry: LocalCacheEntry<T> = {
      data,
      fetchedAt: Date.now(),
    }
    window.localStorage.setItem(key, JSON.stringify(entry))
  } catch (error) {
    console.error(`Failed to write cache: ${key}`, error)
  }
}

function getCalendarGameDataCacheKey(gameDir: string) {
  return `${CALENDAR_GAME_DATA_CACHE_KEY}:${normalizeGameDir(gameDir) || "default"}`
}

function getCalendarSaveDetailCacheKey(saveId: string) {
  return `${CALENDAR_SAVE_DETAIL_CACHE_KEY}:${saveId}`
}

interface CalendarProps {
  selectedSaveId: string
}

export function Calendar({ selectedSaveId }: CalendarProps) {
  const [detail, setDetail] = useState<SaveDetail | null>(null)
  const [festivals, setFestivals] = useState<Festival[]>([])
  const [birthdays, setBirthdays] = useState<Birthday[]>([])
  const [loadingCalendarData, setLoadingCalendarData] = useState(false)
  const [calendarDataError, setCalendarDataError] = useState<string | null>(null)
  const [viewSeason, setViewSeason] = useState(0) // 0: Spring, 1: Summer, 2: Fall, 3: Winter
  const [selectedDay, setSelectedDay] = useState<number | null>(null)

  useEffect(() => {
    let canceled = false

    async function loadCalendarGameData() {
      const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__
      const gameDir = localStorage.getItem("stardewGameDirectory") || ""
      const cacheKey = getCalendarGameDataCacheKey(gameDir)
      const cached = readCache<CalendarGameData>(cacheKey)

      if (cached && !canceled) {
        setFestivals(cached.data.festivals)
        setBirthdays(cached.data.birthdays)
        setLoadingCalendarData(false)
        setCalendarDataError(null)
      }

      if (!isTauri) {
        if (!canceled) {
          setCalendarDataError("当前环境不是 Tauri，无法直接读取游戏目录。")
        }
        return
      }

      if (!cached && !canceled) {
        setLoadingCalendarData(true)
        setCalendarDataError(null)
      }

      try {
        const { invoke } = await import("@tauri-apps/api/core")
        const data = await invoke("get_calendar_game_data", {
          gameDir: gameDir.trim() || undefined,
        }) as CalendarGameData
        if (!canceled) {
          setFestivals(data.festivals)
          setBirthdays(data.birthdays)
          setCalendarDataError(null)
        }
        writeCache(cacheKey, data)
      } catch (err) {
        console.error("Error loading calendar game data:", err)
        if (!canceled) {
          setCalendarDataError(String(err))
          if (!cached) {
            setFestivals([])
            setBirthdays([])
          }
        }
      } finally {
        if (!canceled) {
          setLoadingCalendarData(false)
        }
      }
    }

    loadCalendarGameData()

    return () => {
      canceled = true
    }
  }, [])

  // Fetch save details
  useEffect(() => {
    let canceled = false

    async function loadDetail() {
      if (!selectedSaveId) {
        if (!canceled) {
          setDetail(null)
        }
        return
      }

      const cacheKey = getCalendarSaveDetailCacheKey(selectedSaveId)
      const cached = readCache<SaveDetail>(cacheKey)

      if (cached && !canceled) {
        setDetail(cached.data)
        setViewSeason(cached.data.summary.season)
      }

      const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__
      if (isTauri) {
        try {
          const { invoke } = await import("@tauri-apps/api/core")
          const d: SaveDetail = await invoke("get_save_detail", { id: selectedSaveId })
          if (!canceled) {
            setDetail(d)
            setViewSeason(d.summary.season)
          }
          writeCache(cacheKey, d)
        } catch (err) {
          console.error("Error loading save detail:", err)
          if (!cached && !canceled) {
            setDetail(null)
          }
        }
      }
    }
    loadDetail()

    return () => {
      canceled = true
    }
  }, [selectedSaveId])


  // For grid view: need save data for current day/season
  const hasSaveData = !!selectedSaveId && !!detail
  const summary = detail?.summary

  // Dynamic bookseller days
  const booksellerDays = summary ? getBooksellerDays(summary.year, summary.id, viewSeason) : []

  const activeSeasonName = SEASONS_LIST[viewSeason]

  // Get events on a specific day
  const getDayEvents = (day: number) => {
    const dayBirthdays = birthdays.filter(b => b.season === activeSeasonName && b.day === day)
    const dayFestivals = festivals.filter(f => f.season === activeSeasonName && f.day === day)
    const isBookseller = booksellerDays.includes(day)
    return {
      birthdays: dayBirthdays,
      festivals: dayFestivals,
      isBookseller,
    }
  }

  // Handle seasonal navigation
  const prevSeason = () => {
    setViewSeason(prev => (prev === 0 ? 3 : prev - 1))
    setSelectedDay(null)
  }

  const nextSeason = () => {
    setViewSeason(prev => (prev === 3 ? 0 : prev + 1))
    setSelectedDay(null)
  }

  const currentDayEvents = selectedDay ? getDayEvents(selectedDay) : null

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-3xl font-bold tracking-tight">节日日历</h2>
        <p className="text-muted-foreground mt-1">
          {summary
            ? `当前进度：第 ${summary.year} 年 · ${SEASONS_LIST[summary.season]} 第 ${summary.dayOfMonth} 天`
            : "浏览星露谷全年的节日、生日和特殊事件"}
        </p>
      </div>

      {(loadingCalendarData || calendarDataError) && (
        <div className="text-xs text-muted-foreground">
          {loadingCalendarData
            ? "正在从游戏内容解析节日与生日数据..."
            : `未能读取游戏目录中的日历数据：${calendarDataError}`}
        </div>
      )}

      <Tabs defaultValue="grid-view" className="space-y-6">
        <TabsList>
          <TabsTrigger value="grid-view">日历视图</TabsTrigger>
          <TabsTrigger value="list-view">节日与生日表</TabsTrigger>
        </TabsList>

        <TabsContent value="grid-view" className="space-y-6">
          {!hasSaveData ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-20 text-center">
                <FileQuestion className="h-12 w-12 text-muted-foreground/30 mb-4" />
                <p className="font-semibold text-lg">未选择游戏存档</p>
                <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                  请先通过侧边栏选择一个游戏存档文件，日历视图将根据您的游戏进度显示当天的高亮标记和书商来访日期。
                </p>
                <p className="text-xs text-muted-foreground/70 mt-3">
                  您也可以切换到“节日与生日表”查看完整的静态事件列表。
                </p>
              </CardContent>
            </Card>
          ) : (
          <div className="flex flex-col xl:flex-row gap-6">
            {/* Interactive Calendar Grid */}
            <Card className="flex-1">
              <CardHeader className="flex flex-row items-center justify-between pb-4 border-b">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <CalendarDays className="h-5 w-5 text-primary" />
                    {activeSeasonName} 日历
                  </CardTitle>
                  <CardDescription>28天的季节循环</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="icon" onClick={prevSeason}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="font-bold text-sm min-w-[50px] text-center">{activeSeasonName}</span>
                  <Button variant="outline" size="icon" onClick={nextSeason}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-4">
                {/* Weekday Labels */}
                <div className="grid grid-cols-7 gap-2 mb-2 text-center text-xs font-bold text-muted-foreground bg-accent/40 py-1.5 rounded-md">
                  {WEEKDAYS.map(w => (
                    <div key={w}>{w}</div>
                  ))}
                </div>

                {/* Grid Cells */}
                <div className="grid grid-cols-7 gap-2">
                  {Array.from({ length: 28 }).map((_, i) => {
                    const day = i + 1
                    const isToday = summary && summary.season === viewSeason && summary.dayOfMonth === day
                    const events = getDayEvents(day)
                    const isSelected = selectedDay === day

                    return (
                      <button
                        key={day}
                        onClick={() => setSelectedDay(day)}
                        className={`h-24 flex flex-col justify-between p-2 rounded-lg border text-left transition-all ${
                          isToday
                            ? "border-primary bg-primary/5 ring-1 ring-primary"
                            : isSelected
                            ? "border-foreground bg-accent"
                            : "hover:bg-accent/40 bg-background"
                        }`}
                      >
                        <div className="flex justify-between items-center w-full">
                          <span className={`text-sm font-bold ${isToday ? "text-primary font-extrabold" : ""}`}>
                            {day}
                          </span>
                          {isToday && (
                            <Badge className="text-[9px] px-1 py-0 h-4 font-semibold">今天</Badge>
                          )}
                        </div>

                        {/* Event Icons inside grid cell */}
                        <div className="flex flex-col gap-1 w-full overflow-hidden">
                          {events.festivals.map((f, idx) => (
                            <div key={idx} className="text-[10px] truncate bg-rose-500/10 text-rose-500 dark:text-rose-400 px-1 rounded flex items-center gap-0.5 font-medium">
                              <PartyPopper className="h-2.5 w-2.5 shrink-0" />
                              <span>{f.name}</span>
                            </div>
                          ))}
                          {events.birthdays.map((b, idx) => (
                            <div key={idx} className="text-[10px] truncate bg-green-500/10 text-green-500 dark:text-green-400 px-1 rounded flex items-center gap-0.5 font-medium">
                              <Cake className="h-2.5 w-2.5 shrink-0" />
                              <span>{b.name.split(" ")[0]}</span>
                            </div>
                          ))}
                          {events.isBookseller && (
                            <div className="text-[10px] truncate bg-blue-500/10 text-blue-500 dark:text-blue-400 px-1 rounded flex items-center gap-0.5 font-medium">
                              <BookOpen className="h-2.5 w-2.5 shrink-0" />
                              <span>图书交易</span>
                            </div>
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Event Detail Panel */}
            <Card className="w-full xl:w-80 shrink-0">
              <CardHeader className="pb-4 border-b">
                <CardTitle className="text-base flex items-center gap-2">
                  <Info className="h-4 w-4 text-primary" />
                  日历详情
                </CardTitle>
                <CardDescription>
                  {selectedDay
                    ? `${activeSeasonName} 第 ${selectedDay} 天 (${WEEKDAYS[(selectedDay - 1) % 7]})`
                    : "点击日历单元格查看当天事件"}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                {selectedDay && currentDayEvents ? (
                  <>
                    {/* Festivals */}
                    {currentDayEvents.festivals.length > 0 && (
                      <div className="space-y-2">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-rose-500 flex items-center gap-1.5">
                          <PartyPopper className="h-3.5 w-3.5" /> 节日活动
                        </h4>
                        {currentDayEvents.festivals.map((f, idx) => (
                          <div key={idx} className="bg-rose-500/5 border border-rose-500/10 p-3 rounded-lg space-y-1">
                            <p className="font-bold text-sm text-rose-500">{f.name}</p>
                            {f.description ? (
                              <p className="text-xs text-muted-foreground">{f.description}</p>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Birthdays */}
                    {currentDayEvents.birthdays.length > 0 && (
                      <div className="space-y-2">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-green-500 flex items-center gap-1.5">
                          <Cake className="h-3.5 w-3.5" /> 角色生日
                        </h4>
                        {currentDayEvents.birthdays.map((b, idx) => (
                          <div key={idx} className="bg-green-500/5 border border-green-500/10 p-3 rounded-lg space-y-1">
                            <p className="font-bold text-sm text-green-500">{b.name} 生日</p>
                            <p className="text-xs text-muted-foreground">送给他最爱或喜欢的物品，会获得 8 倍的好感度加成！</p>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Bookseller */}
                    {currentDayEvents.isBookseller && (
                      <div className="space-y-2">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-blue-500 flex items-center gap-1.5">
                          <BookOpen className="h-3.5 w-3.5" /> 书商来访
                        </h4>
                        <div className="bg-blue-500/5 border border-blue-500/10 p-3 rounded-lg space-y-1">
                          <p className="font-bold text-sm text-blue-500">图书交易员</p>
                          <p className="text-xs text-muted-foreground">
                            在小镇东北边（Joja超市后面）售卖技能书及配方。营业一整天，请注意带足金币！
                          </p>
                        </div>
                      </div>
                    )}

                    {/* No Events */}
                    {currentDayEvents.festivals.length === 0 &&
                      currentDayEvents.birthdays.length === 0 &&
                      !currentDayEvents.isBookseller && (
                        <div className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground">
                          <CalendarDays className="h-8 w-8 text-muted-foreground/35 mb-2" />
                          <p className="text-sm">这一天没有任何节日或生日事件</p>
                          <p className="text-xs text-muted-foreground/75 mt-1">是个专注农活或下矿的好日子！</p>
                        </div>
                      )}
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
                    <CalendarDays className="h-8 w-8 text-muted-foreground/30 mb-2 animate-pulse" />
                    <p className="text-sm font-medium">请选择一个日期</p>
                    <p className="text-xs text-muted-foreground/80 mt-1">以查看星露谷每日事件的详细信息</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
          )}
        </TabsContent>

        <TabsContent value="list-view">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Festivals List */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">节日活动清单</CardTitle>
                <CardDescription>星露谷全年的节日与特殊天气</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 max-h-[60vh] overflow-y-auto">
                {festivals.map((f, i) => (
                  <div key={i} className="flex flex-col p-3 rounded-lg border bg-accent/20 space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-sm">{f.name}</span>
                      <Badge variant="secondary">{f.date}</Badge>
                    </div>
                    {f.description ? (
                      <p className="text-xs text-muted-foreground">{f.description}</p>
                    ) : null}
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Birthdays List */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">村民生日表</CardTitle>
                <CardDescription>所有鹈鹕镇居民的生日汇总</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3 max-h-[60vh] overflow-y-auto">
                {birthdays.map((b, i) => (
                  <div key={i} className="flex justify-between items-center p-2.5 rounded-lg border bg-accent/20">
                    <span className="font-medium text-sm">{b.name.split(" ")[0]}</span>
                    <Badge variant="outline" className="text-xs">{b.date}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
