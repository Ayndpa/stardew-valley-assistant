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

interface Festival {
  name: string
  date: string
  day: number
  season: string
  description: string
}

const FESTIVALS: Festival[] = [
  { name: "复活节 (蛋节)", date: "春季 13日", day: 13, season: "春季", description: "在镇中心参加彩蛋大寻宝！可以向皮埃尔购买草莓种子。" },
  { name: "沙漠节", date: "春季 15-17日", day: 15, season: "春季", description: "春季15-17日，前往沙漠参加节日活动，兑换独特奖励！" },
  { name: "沙漠节", date: "春季 15-17日", day: 16, season: "春季", description: "春季15-17日，前往沙漠参加节日活动，兑换独特奖励！" },
  { name: "沙漠节", date: "春季 15-17日", day: 17, season: "春季", description: "春季15-17日，前往沙漠参加节日活动，兑换独特奖励！" },
  { name: "花舞节", date: "春季 24日", day: 24, season: "春季", description: "在煤矿森林南部举行。邀请一位村民共舞以增加 1 心（250点）好感度。" },
  
  { name: "夏威夷宴会", date: "夏季 11日", day: 11, season: "夏季", description: "在沙滩上向百乐汤中加入食材。优质食材能提升全体镇民的好感度。" },
  { name: "绿雨天气", date: "夏季 约14-16日", day: 14, season: "夏季", description: "天空降下绿色酸雨，野外长满巨型杂草和苔藓，非常适合收集纤维和木材。" },
  { name: "月光水母起舞", date: "夏季 28日", season: "夏季", day: 28, description: "晚上10点在沙滩观赏绿色的月光水母，宣告夏季的结束。" },
  
  { name: "星露谷展览会", date: "秋季 16日", day: 16, season: "秋季", description: "在小镇广场展示9件农产品。根据评分获得星星币以兑换星之果实。" },
  { name: "万灵节", date: "秋季 27日", day: 27, season: "秋季", description: "在镇中心晚上10点举行。探索黄金南瓜迷宫，感受万圣节氛围。" },
  
  { name: "冰雪节", date: "冬季 8日", day: 8, season: "冬季", description: "在煤矿森林上午9点举行。参加冰钓比赛，赢得冰钓冠军奖励。" },
  { name: "鱿鱼节", date: "冬季 12-13日", day: 12, season: "冬季", description: "冬季12-13日，在沙滩进行钓鱿鱼挑战，获取丰厚海洋奖品！" },
  { name: "鱿鱼节", date: "冬季 12-13日", day: 13, season: "冬季", description: "冬季12-13日，在沙滩进行钓鱿鱼挑战，获取丰厚海洋奖品！" },
  { name: "夜市", date: "冬季 15-17日", day: 15, season: "冬季", description: "冬季15-17日傍晚5点在沙滩。购买稀有画作、种子，体验深海垂钓。" },
  { name: "夜市", date: "冬季 15-17日", day: 16, season: "冬季", description: "冬季15-17日傍晚5点在沙滩。购买稀有画作、种子，体验深海垂钓。" },
  { name: "夜市", date: "冬季 15-17日", day: 17, season: "冬季", description: "冬季15-17日傍晚5点在沙滩。购买稀有画作、种子，体验深海垂钓。" },
  { name: "冬日星盛宴", date: "冬季 25日", day: 25, season: "冬季", description: "星露谷的圣诞节。与你的神秘互赠礼友交换礼物，获取5倍好感度加成！" },
]

interface Birthday {
  name: string
  date: string
  day: number
  season: string
}

const BIRTHDAYS: Birthday[] = [
  { name: "肯特 (Kent)", date: "春季 4日", day: 4, season: "春季" },
  { name: "刘易斯 (Lewis)", date: "春季 7日", day: 7, season: "春季" },
  { name: "文森特 (Vincent)", date: "春季 10日", day: 10, season: "春季" },
  { name: "海莉 (Haley)", date: "春季 14日", day: 14, season: "春季" },
  { name: "潘姆 (Pam)", date: "春季 18日", day: 18, season: "春季" },
  { name: "谢恩 (Shane)", date: "春季 20日", day: 20, season: "春季" },
  { name: "皮埃尔 (Pierre)", date: "春季 26日", day: 26, season: "春季" },
  
  { name: "贾斯 (Jas)", date: "夏季 4日", day: 4, season: "夏季" },
  { name: "格斯 (Gus)", date: "夏季 8日", day: 8, season: "夏季" },
  { name: "玛鲁 (Maru)", date: "夏季 10日", day: 10, season: "夏季" },
  { name: "亚历克斯 (Alex)", date: "夏季 13日", day: 13, season: "夏季" },
  { name: "山姆 (Sam)", date: "夏季 17日", day: 17, season: "夏季" },
  { name: "德米特里厄斯 (Demetrius)", date: "夏季 19日", day: 19, season: "夏季" },
  { name: "矮人 (Dwarf)", date: "夏季 22日", day: 22, season: "夏季" },
  { name: "威利 (Willy)", date: "夏季 24日", day: 24, season: "夏季" },
  { name: "里奥 (Leo)", date: "夏季 26日", day: 26, season: "夏季" },
  
  { name: "潘妮 (Penny)", date: "秋季 2日", day: 2, season: "秋季" },
  { name: "艾略特 (Elliott)", date: "秋季 5日", day: 5, season: "秋季" },
  { name: "乔迪 (Jodi)", date: "秋季 11日", day: 11, season: "秋季" },
  { name: "阿比盖尔 (Abigail)", date: "秋季 13日", day: 13, season: "秋季" },
  { name: "桑迪 (Sandy)", date: "秋季 15日", day: 15, season: "秋季" },
  { name: "玛妮 (Marnie)", date: "秋季 18日", day: 18, season: "秋季" },
  { name: "罗宾 (Robin)", date: "秋季 21日", day: 21, season: "秋季" },
  { name: "乔治 (George)", date: "秋季 24日", day: 24, season: "秋季" },
  
  { name: "科罗布斯 (Krobus)", date: "冬季 3日", day: 3, season: "冬季" },
  { name: "莱纳斯 (Linus)", date: "冬季 7日", day: 7, season: "冬季" },
  { name: "塞巴斯蒂安 (Sebastian)", date: "冬季 10日", day: 10, season: "冬季" },
  { name: "哈维 (Harvey)", date: "冬季 14日", day: 14, season: "冬季" },
  { name: "法师 (Wizard)", date: "冬季 17日", day: 17, season: "冬季" },
  { name: "艾芙琳 (Evelyn)", date: "冬季 20日", day: 20, season: "冬季" },
  { name: "莉亚 (Leah)", date: "冬季 23日", day: 23, season: "冬季" },
  { name: "克林特 (Clint)", date: "冬季 26日", day: 26, season: "冬季" },
]

const SEASONS_LIST = ["春季", "夏季", "秋季", "冬季"]
const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]

// Knuth's subtractive PRNG port from .NET Framework for Bookseller schedule calculation
class DotNetRandom {
  private inext: number = 0
  private inextp: number = 0
  private SeedArray: number[] = new Array(56)

  constructor(seed: number) {
    let ii = 0
    let mj = 0
    let mk = 0

    const subtraction = (seed === -2147483648) ? 2147483647 : Math.abs(seed)
    mj = 161803398 - subtraction
    this.SeedArray[55] = mj
    mk = 1
    for (let i = 1; i < 55; i++) {
      ii = (21 * i) % 55
      this.SeedArray[ii] = mk
      mk = mj - mk
      if (mk < 0) mk += 2147483647
      mj = this.SeedArray[ii]
    }
    for (let k = 1; k < 5; k++) {
      for (let i = 1; i < 56; i++) {
        this.SeedArray[i] -= this.SeedArray[1 + (i + 30) % 55]
        if (this.SeedArray[i] < 0) this.SeedArray[i] += 2147483647
      }
    }
    this.inext = 0
    this.inextp = 21
  }

  private Sample(): number {
    let retVal = 0
    let locINext = this.inext + 1
    let locINextp = this.inextp + 1
    if (locINext >= 56) locINext = 1
    if (locINextp >= 56) locINextp = 1
    retVal = this.SeedArray[locINext] - this.SeedArray[locINextp]
    if (retVal < 0) retVal += 2147483647
    this.SeedArray[locINext] = retVal
    this.inext = locINext
    this.inextp = locINextp
    return retVal * 4.6566128752457969E-10
  }

  public Next(max: number): number {
    return Math.floor(this.Sample() * max)
  }
}

// Calculate the two bookseller visit days for a given year, unique ID, and season
const getBooksellerDays = (year: number, uniqueIdStr: string, seasonIndex: number) => {
  let uniqueID = 0
  const match = uniqueIdStr.match(/\d+/)
  if (match) {
    uniqueID = parseInt(match[0]) || 0
  }

  const seedA = year * 11
  const seedB = uniqueID
  const seedC = seasonIndex

  const combinedSeed = (seedA % 2147483647 + seedB % 2147483647 + seedC % 2147483647) % 2147483647
  
  let array: number[] = []
  switch (seasonIndex) {
    case 0: // Spring
      array = [11, 12, 21, 22, 25]
      break;
    case 1: // Summer
      array = [9, 12, 18, 25, 27]
      break;
    case 2: // Fall
      array = [4, 7, 8, 9, 12, 19, 22, 25]
      break;
    case 3: // Winter
      array = [5, 11, 12, 19, 22, 24]
      break;
  }

  if (array.length === 0) return []

  const rand = new DotNetRandom(combinedSeed)
  const num = rand.Next(array.length)
  const list: number[] = []
  list.push(array[num])
  list.push(array[(num + Math.floor(array.length / 2)) % array.length])
  return list.sort((a, b) => a - b)
}

interface CalendarProps {
  selectedSaveId: string
}

export function Calendar({ selectedSaveId }: CalendarProps) {
  const [detail, setDetail] = useState<SaveDetail | null>(null)
  const [viewSeason, setViewSeason] = useState(0) // 0: Spring, 1: Summer, 2: Fall, 3: Winter
  const [selectedDay, setSelectedDay] = useState<number | null>(null)

  // Fetch save details
  useEffect(() => {
    async function loadDetail() {
      if (!selectedSaveId) return

      const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
      if (isTauri) {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          const d: SaveDetail = await invoke("get_save_detail", { id: selectedSaveId })
          setDetail(d)
          setViewSeason(d.summary.season)
        } catch (err) {
          console.error("Error loading save detail:", err)
          setDetail(null)
        }
      }
    }
    loadDetail()
  }, [selectedSaveId])


  // For grid view: need save data for current day/season
  const hasSaveData = !!selectedSaveId && !!detail
  const summary = detail?.summary

  // Dynamic bookseller days
  const booksellerDays = summary ? getBooksellerDays(summary.year, summary.id, viewSeason) : []

  const activeSeasonName = SEASONS_LIST[viewSeason]

  // Get events on a specific day
  const getDayEvents = (day: number) => {
    const dayBirthdays = BIRTHDAYS.filter(b => b.season === activeSeasonName && b.day === day)
    const dayFestivals = FESTIVALS.filter(f => f.season === activeSeasonName && f.day === day)
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
                            <p className="text-xs text-muted-foreground">{f.description}</p>
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
                {FESTIVALS.map((f, i) => (
                  <div key={i} className="flex flex-col p-3 rounded-lg border bg-accent/20 space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-sm">{f.name}</span>
                      <Badge variant="secondary">{f.date}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{f.description}</p>
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
                {BIRTHDAYS.map((b, i) => (
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
