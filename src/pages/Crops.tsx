import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  Search,
  Sprout,
  Droplets,
  Calendar as CalendarIcon,
  Coins,
  Filter,
  MapPin,
  Flame,
} from "lucide-react"

// Dynamic imports will be done inline inside useEffect/handlers for reliability


interface CropLookup {
  name: string
  sellPrice: number
  regrows: boolean
  regrowDays?: number
}

// Comprehensive crop database mapping seedIndex or harvestIndex to metadata
const cropDb: Record<string, CropLookup> = {
  "472": { name: "防风草", sellPrice: 35, regrows: false },
  "24": { name: "防风草", sellPrice: 35, regrows: false },
  "475": { name: "土豆", sellPrice: 80, regrows: false },
  "192": { name: "土豆", sellPrice: 80, regrows: false },
  "474": { name: "花椰菜", sellPrice: 175, regrows: false },
  "190": { name: "花椰菜", sellPrice: 175, regrows: false },
  "745": { name: "草莓", sellPrice: 120, regrows: true, regrowDays: 4 },
  "400": { name: "草莓", sellPrice: 120, regrows: true, regrowDays: 4 },
  "478": { name: "大黄", sellPrice: 220, regrows: false },
  "252": { name: "大黄", sellPrice: 220, regrows: false },
  "479": { name: "甜瓜", sellPrice: 250, regrows: false },
  "254": { name: "甜瓜", sellPrice: 250, regrows: false },
  "480": { name: "番茄", sellPrice: 60, regrows: true, regrowDays: 4 },
  "256": { name: "番茄", sellPrice: 60, regrows: true, regrowDays: 4 },
  "481": { name: "蓝莓", sellPrice: 50, regrows: true, regrowDays: 4 },
  "258": { name: "蓝莓", sellPrice: 50, regrows: true, regrowDays: 4 },
  "482": { name: "辣椒", sellPrice: 40, regrows: true, regrowDays: 3 },
  "260": { name: "辣椒", sellPrice: 40, regrows: true, regrowDays: 3 },
  "485": { name: "杨桃", sellPrice: 750, regrows: false },
  "268": { name: "杨桃", sellPrice: 750, regrows: false },
  "486": { name: "玉米", sellPrice: 50, regrows: true, regrowDays: 4 },
  "270": { name: "玉米", sellPrice: 50, regrows: true, regrowDays: 4 },
  "490": { name: "南瓜", sellPrice: 320, regrows: false },
  "276": { name: "南瓜", sellPrice: 320, regrows: false },
  "493": { name: "蔓越莓", sellPrice: 75, regrows: true, regrowDays: 5 },
  "282": { name: "蔓越莓", sellPrice: 75, regrows: true, regrowDays: 5 },
  "424": { name: "葡萄", sellPrice: 80, regrows: true, regrowDays: 3 },
  "301": { name: "葡萄", sellPrice: 80, regrows: true, regrowDays: 3 },
  "495": { name: "古代水果", sellPrice: 550, regrows: true, regrowDays: 7 },
  "300": { name: "古代水果", sellPrice: 550, regrows: true, regrowDays: 7 },
  "499": { name: "苋菜", sellPrice: 150, regrows: false },
  "74": { name: "仙人掌果", sellPrice: 75, regrows: true, regrowDays: 3 },
  "90": { name: "仙人掌果", sellPrice: 75, regrows: true, regrowDays: 3 },
  "833": { name: "菠萝", sellPrice: 300, regrows: true, regrowDays: 7 },
  "834": { name: "菠萝", sellPrice: 300, regrows: true, regrowDays: 7 },
  "831": { name: "芋头", sellPrice: 150, regrows: false },
  "830": { name: "芋头", sellPrice: 150, regrows: false },
  "889": { name: "齐瓜", sellPrice: 1, regrows: false },
  "890": { name: "齐瓜", sellPrice: 1, regrows: false },
  "473": { name: "四季豆", sellPrice: 40, regrows: true, regrowDays: 3 },
  "188": { name: "四季豆", sellPrice: 40, regrows: true, regrowDays: 3 },
  "476": { name: "大蒜", sellPrice: 60, regrows: false },
  "248": { name: "大蒜", sellPrice: 60, regrows: false },
  "477": { name: "甘蓝", sellPrice: 110, regrows: false },
  "250": { name: "甘蓝", sellPrice: 110, regrows: false },
  "429": { name: "蓝色爵士乐", sellPrice: 50, regrows: false },
  "597": { name: "蓝色爵士乐", sellPrice: 50, regrows: false },
  "433": { name: "咖啡豆", sellPrice: 15, regrows: true, regrowDays: 2 },
  "CarrotSeeds": { name: "胡萝卜", sellPrice: 35, regrows: false },
  "Carrot": { name: "胡萝卜", sellPrice: 35, regrows: false },
  "SummerSquashSeeds": { name: "夏瓜", sellPrice: 45, regrows: true, regrowDays: 3 },
  "SummerSquash": { name: "夏瓜", sellPrice: 45, regrows: true, regrowDays: 3 },
  "BroccoliSeeds": { name: "西兰花", sellPrice: 70, regrows: true, regrowDays: 4 },
  "Broccoli": { name: "西兰花", sellPrice: 70, regrows: true, regrowDays: 4 },
  "PowdermelonSeeds": { name: "霜瓜", sellPrice: 60, regrows: false },
  "Powdermelon": { name: "霜瓜", sellPrice: 60, regrows: false },
  "487": { name: "红卷心菜", sellPrice: 260, regrows: false },
  "266": { name: "红卷心菜", sellPrice: 260, regrows: false },
  "484": { name: "萝卜", sellPrice: 90, regrows: false },
  "264": { name: "萝卜", sellPrice: 90, regrows: false },
  "483": { name: "小麦", sellPrice: 25, regrows: false },
  "262": { name: "小麦", sellPrice: 25, regrows: false },
  "427": { name: "啤酒花", sellPrice: 25, regrows: true, regrowDays: 1 },
  "304": { name: "啤酒花", sellPrice: 25, regrows: true, regrowDays: 1 },
  "431": { name: "夏日亮星", sellPrice: 90, regrows: false },
  "593": { name: "夏日亮星", sellPrice: 90, regrows: false },
  "425": { name: "向日葵", sellPrice: 80, regrows: false },
  "421": { name: "向日葵", sellPrice: 80, regrows: false },
  "488": { name: "茄子", sellPrice: 60, regrows: true, regrowDays: 5 },
  "272": { name: "茄子", sellPrice: 60, regrows: true, regrowDays: 5 },
  "489": { name: "朝鲜蓟", sellPrice: 160, regrows: false },
  "274": { name: "朝鲜蓟", sellPrice: 160, regrows: false },
  "491": { name: "小白菜", sellPrice: 80, regrows: false },
  "278": { name: "小白菜", sellPrice: 80, regrows: false },
  "492": { name: "山药", sellPrice: 150, regrows: false },
  "280": { name: "山药", sellPrice: 150, regrows: false },
  "494": { name: "甜菜", sellPrice: 100, regrows: false },
  "284": { name: "甜菜", sellPrice: 100, regrows: false },
  "426": { name: "仙女玫瑰", sellPrice: 290, regrows: false },
  "595": { name: "仙女玫瑰", sellPrice: 290, regrows: false },
  "347": { name: "宝石甜莓", sellPrice: 3000, regrows: false },
  "417": { name: "宝石甜莓", sellPrice: 3000, regrows: false },
  // Wild Seeds
  "SpringSeeds": { name: "春季种子 (野生)", sellPrice: 35, regrows: false },
  "SummerSeeds": { name: "夏季种子 (野生)", sellPrice: 55, regrows: false },
  "FallSeeds": { name: "秋季种子 (野生)", sellPrice: 45, regrows: false },
  "WinterSeeds": { name: "冬季种子 (野生)", sellPrice: 30, regrows: false },
}

interface PlantedCrop {
  location: string
  x: number
  y: number
  seedId: string
  harvestId: string
  currentPhase: number
  dayOfCurrentPhase: number
  fullyGrown: boolean
  dead: boolean
  isWatered: boolean
  phaseDays: number[]
}

interface Crop {
  name: string
  season: string
  growDays: number
  sellPrice: number
  regrows: boolean
  waterNeeds: string
}

const ENCYCLOPEDIA_CROPS: Crop[] = [
  { name: "防风草", season: "春季", growDays: 4, sellPrice: 35, regrows: false, waterNeeds: "每天" },
  { name: "土豆", season: "春季", growDays: 6, sellPrice: 80, regrows: false, waterNeeds: "每天" },
  { name: "花椰菜", season: "春季", growDays: 12, sellPrice: 175, regrows: false, waterNeeds: "每天" },
  { name: "草莓", season: "春季", growDays: 8, sellPrice: 120, regrows: true, waterNeeds: "每天" },
  { name: "大黄", season: "春季", growDays: 13, sellPrice: 220, regrows: false, waterNeeds: "每天" },
  { name: "四季豆", season: "春季", growDays: 10, sellPrice: 40, regrows: true, waterNeeds: "每天" },
  { name: "胡萝卜", season: "春季", growDays: 3, sellPrice: 35, regrows: false, waterNeeds: "每天" },
  { name: "甜瓜", season: "夏季", growDays: 12, sellPrice: 250, regrows: false, waterNeeds: "每天" },
  { name: "番茄", season: "夏季", growDays: 11, sellPrice: 60, regrows: true, waterNeeds: "每天" },
  { name: "蓝莓", season: "夏季", growDays: 13, sellPrice: 50, regrows: true, waterNeeds: "每天" },
  { name: "辣椒", season: "夏季", growDays: 5, sellPrice: 40, regrows: true, waterNeeds: "每天" },
  { name: "杨桃", season: "夏季", growDays: 13, sellPrice: 750, regrows: false, waterNeeds: "每天" },
  { name: "玉米", season: "夏秋", growDays: 14, sellPrice: 50, regrows: true, waterNeeds: "每天" },
  { name: "夏瓜", season: "夏季", growDays: 6, sellPrice: 45, regrows: true, waterNeeds: "每天" },
  { name: "南瓜", season: "秋季", growDays: 13, sellPrice: 320, regrows: false, waterNeeds: "每天" },
  { name: "蔓越莓", season: "秋季", growDays: 7, sellPrice: 75, regrows: true, waterNeeds: "每天" },
  { name: "葡萄", season: "秋季", growDays: 10, sellPrice: 80, regrows: true, waterNeeds: "每天" },
  { name: "西兰花", season: "秋季", growDays: 8, sellPrice: 70, regrows: true, waterNeeds: "每天" },
  { name: "霜瓜", season: "冬季", growDays: 7, sellPrice: 60, regrows: false, waterNeeds: "每天" },
  { name: "古代水果", season: "春夏秋", growDays: 28, sellPrice: 550, regrows: true, waterNeeds: "每天" },
  { name: "宝石甜莓", season: "秋季", growDays: 24, sellPrice: 3000, regrows: false, waterNeeds: "每天" },
  { name: "菠萝", season: "全季", growDays: 14, sellPrice: 300, regrows: true, waterNeeds: "每天" },
]

const SEASONS = ["全部", "春季", "夏季", "秋季", "冬季", "春夏秋", "全季"]

const locationMap: Record<string, string> = {
  "Farm": "主要农场",
  "Greenhouse": "温室大棚",
  "IslandWest": "姜岛农场 (西)",
  "IslandNorth": "姜岛农场 (北)",
  "Forest": "煤矿森林",
}

interface CropsProps {
  selectedSaveId: string
}

export function Crops({ selectedSaveId }: CropsProps) {
  const [searchTerm, setSearchTerm] = useState("")
  const [activeSeason, setActiveSeason] = useState("全部")
  const [plantedCrops, setPlantedCrops] = useState<PlantedCrop[]>([])
  const [loadingCrops, setLoadingCrops] = useState(true)

  // Fetch real crops
  useEffect(() => {
    async function loadCrops() {
      if (!selectedSaveId) {
        setLoadingCrops(false)
        return
      }
      setLoadingCrops(true)
      
      const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
      if (isTauri) {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          const crops: PlantedCrop[] = await invoke("get_planted_crops", { id: selectedSaveId })
          setPlantedCrops(crops)
        } catch (err) {
          console.error("Error loading planted crops:", err)
          setPlantedCrops([])
        } finally {
          setLoadingCrops(false)
        }
      } else {
        setLoadingCrops(false)
      }
    }
    loadCrops()
  }, [selectedSaveId])

  const filteredEncyclopedia = ENCYCLOPEDIA_CROPS.filter((crop) => {
    const matchesSearch = crop.name.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesSeason = activeSeason === "全部" || crop.season === activeSeason
    return matchesSearch && matchesSeason
  })

  // Group planted crops by location
  const cropsByLocation: Record<string, PlantedCrop[]> = {}
  plantedCrops.forEach((crop) => {
    const loc = crop.location || "Farm"
    if (!cropsByLocation[loc]) {
      cropsByLocation[loc] = []
    }
    cropsByLocation[loc].push(crop)
  })

  // Helper to get crop progress details
  const getCropStatus = (crop: PlantedCrop) => {
    const lookup = cropDb[crop.seedId] || cropDb[crop.harvestId]
    const name = lookup?.name || `未知作物 (${crop.seedId || crop.harvestId})`
    const sellPrice = lookup?.sellPrice || 0
    const regrows = lookup?.regrows || false

    if (crop.dead) {
      return { name, progress: 0, daysRemaining: 0, totalDays: 0, statusText: "已枯萎 🍂", sellPrice, regrows }
    }
    if (crop.fullyGrown) {
      return { name, progress: 100, daysRemaining: 0, totalDays: 0, statusText: "已成熟 🧺", sellPrice, regrows }
    }

    if (crop.phaseDays && crop.phaseDays.length > 1) {
      const phases = crop.phaseDays.slice(0, crop.phaseDays.length - 1)
      const totalDays = phases.reduce((a, b) => a + b, 0)
      
      let daysRemaining = 0
      if (crop.currentPhase < crop.phaseDays.length - 1) {
        const curPhaseMax = crop.phaseDays[crop.currentPhase]
        if (crop.dayOfCurrentPhase < curPhaseMax) {
          daysRemaining += (curPhaseMax - crop.dayOfCurrentPhase)
        }
        for (let p = crop.currentPhase + 1; p < crop.phaseDays.length - 1; p++) {
          daysRemaining += crop.phaseDays[p]
        }
      }

      const daysGrown = Math.max(0, totalDays - daysRemaining)
      const progress = Math.min(99, Math.round((daysGrown / totalDays) * 100))
      return {
        name,
        progress,
        daysRemaining,
        totalDays,
        statusText: `成长中 (第 ${daysGrown}/${totalDays} 天, 剩 ${daysRemaining} 天)`,
        sellPrice,
        regrows
      }
    }

    return { name, progress: 50, daysRemaining: 1, totalDays: 2, statusText: "成长中", sellPrice, regrows }
  }

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-3xl font-bold tracking-tight">作物管理</h2>
        <p className="text-muted-foreground mt-1">
          实时监测你的农地状态并规划收获方案
        </p>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="my-farm" className="space-y-4">
        <TabsList>
          <TabsTrigger value="my-farm">我的农地</TabsTrigger>
          <TabsTrigger value="all">作物图鉴</TabsTrigger>
          <TabsTrigger value="profit">收益计算</TabsTrigger>
        </TabsList>

        <TabsContent value="my-farm" className="space-y-6">
          {!selectedSaveId ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <Sprout className="h-12 w-12 text-muted-foreground/40 mb-4" />
                <p className="font-semibold text-lg">未选择游戏存档</p>
                <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                  请先通过侧边栏选择一个游戏存档文件，系统将读取您农场中种植的作物信息并在此处实时显示。
                </p>
              </CardContent>
            </Card>
          ) : loadingCrops ? (
            <div className="flex flex-col items-center justify-center py-20 space-y-2">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
              <p className="text-sm text-muted-foreground">正在加载农田作物...</p>
            </div>
          ) : plantedCrops.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <Sprout className="h-12 w-12 text-muted-foreground/40 mb-4" />
                <p className="font-semibold text-lg">当前存档中未找到生长的作物</p>
                <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                  在你的农场、温室或姜岛上播种并浇水后，作物状态将在此处实时显示。
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-8">
              {Object.keys(cropsByLocation).map((loc) => {
                const locName = locationMap[loc] || loc
                const crops = cropsByLocation[loc]
                const wateredCount = crops.filter(c => c.isWatered).length
                const matureCount = crops.filter(c => c.fullyGrown).length
                const deadCount = crops.filter(c => c.dead).length

                return (
                  <div key={loc} className="space-y-4">
                    {/* Location Section Header */}
                    <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-2">
                      <div className="flex items-center gap-2">
                        <MapPin className="h-5 w-5 text-primary" />
                        <h3 className="text-lg font-bold">{locName}</h3>
                        <Badge variant="secondary" className="font-semibold text-xs ml-1">
                          共 {crops.length} 个作物
                        </Badge>
                      </div>
                      <div className="flex gap-2">
                        <Badge variant="outline" className="text-blue-500 bg-blue-500/5 border-blue-500/20 font-medium">
                          已浇水 {wateredCount}/{crops.length}
                        </Badge>
                        {matureCount > 0 && (
                          <Badge variant="outline" className="text-green-500 bg-green-500/5 border-green-500/20 font-medium">
                            已成熟 {matureCount}
                          </Badge>
                        )}
                        {deadCount > 0 && (
                          <Badge variant="outline" className="text-red-500 bg-red-500/5 border-red-500/20 font-medium">
                            已枯萎 {deadCount}
                          </Badge>
                        )}
                      </div>
                    </div>

                    {/* Crops Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {crops.map((crop, idx) => {
                        const info = getCropStatus(crop)
                        return (
                          <Card key={`${loc}-${idx}`} className={crop.dead ? "opacity-75 border-red-500/10" : ""}>
                            <CardHeader className="pb-2">
                              <div className="flex items-start justify-between">
                                <div>
                                  <CardTitle className="text-base flex items-center gap-1.5 font-bold">
                                    <Sprout className={`h-4 w-4 ${crop.dead ? "text-red-400" : crop.fullyGrown ? "text-green-500 animate-bounce" : "text-emerald-500"}`} />
                                    {info.name}
                                  </CardTitle>
                                  <CardDescription className="text-xs mt-0.5">
                                    坐标 ({crop.x}, {crop.y})
                                  </CardDescription>
                                </div>
                                <div className="flex flex-col items-end gap-1">
                                  {crop.isWatered ? (
                                    <Badge className="bg-blue-500 hover:bg-blue-600 text-xs font-semibold px-2 py-0">已浇水 💧</Badge>
                                  ) : (
                                    <Badge variant="secondary" className="text-xs font-semibold px-2 py-0">干燥 🏜️</Badge>
                                  )}
                                  {info.regrows && (
                                    <Badge variant="outline" className="text-indigo-400 border-indigo-400/20 text-[10px] font-semibold mt-0.5">可再生</Badge>
                                  )}
                                </div>
                              </div>
                            </CardHeader>
                            <CardContent className="space-y-3 pt-2">
                              <div className="space-y-1">
                                <div className="flex items-center justify-between text-xs font-medium">
                                  <span className="text-muted-foreground">生长进度</span>
                                  <span className={crop.dead ? "text-red-400" : crop.fullyGrown ? "text-green-500 font-bold" : "text-primary"}>
                                    {info.statusText}
                                  </span>
                                </div>
                                <div className={`w-full bg-muted rounded-full h-2 overflow-hidden ${crop.dead ? "bg-red-950/20" : crop.fullyGrown ? "bg-green-100 dark:bg-green-950/20" : ""}`}>
                                  <div
                                    className={`h-full rounded-full transition-all duration-300 ${crop.dead ? "bg-red-500" : crop.fullyGrown ? "bg-green-500" : "bg-primary"}`}
                                    style={{ width: `${info.progress}%` }}
                                  />
                                </div>
                              </div>

                              <div className="flex justify-between items-center text-xs border-t pt-2 mt-2">
                                <div className="flex items-center gap-1 text-muted-foreground">
                                  <Coins className="h-3.5 w-3.5" />
                                  <span>单价: {info.sellPrice}g</span>
                                </div>
                                {!crop.dead && !crop.fullyGrown && info.daysRemaining > 0 && (
                                  <div className="text-[10px] text-muted-foreground font-medium bg-accent/40 px-2 py-0.5 rounded-md">
                                    预计在 {info.daysRemaining} 天后收获
                                  </div>
                                )}
                                {crop.fullyGrown && (
                                  <div className="text-[10px] text-green-500 font-semibold bg-green-500/10 px-2 py-0.5 rounded-md animate-pulse">
                                    可立即收获！
                                  </div>
                                )}
                                {crop.dead && (
                                  <div className="text-[10px] text-red-400 font-semibold bg-red-500/10 px-2 py-0.5 rounded-md flex items-center gap-0.5">
                                    <Flame className="h-3 w-3" /> 需清理
                                  </div>
                                )}
                              </div>
                            </CardContent>
                          </Card>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="all" className="space-y-4">
          {/* Season Filter */}
          <div className="flex gap-2 flex-wrap">
            {SEASONS.map((season) => (
              <Button
                key={season}
                variant={activeSeason === season ? "default" : "outline"}
                size="sm"
                onClick={() => setActiveSeason(season)}
              >
                {season}
              </Button>
            ))}
          </div>

          {/* Toolbar */}
          <div className="flex items-center gap-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜索作物..."
                className="pl-10"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.currentTarget.value)}
              />
            </div>
            <Button variant="outline" size="sm" className="gap-2">
              <Filter className="h-4 w-4" />
              筛选
            </Button>
          </div>

          {/* Crop Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredEncyclopedia.map((crop) => (
              <Card key={crop.name} className="hover:shadow-md transition-shadow">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Sprout className="h-4 w-4 text-green-500" />
                      {crop.name}
                    </CardTitle>
                    <Badge variant="secondary">{crop.season}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <CalendarIcon className="h-3.5 w-3.5" />
                      <span>生长: {crop.growDays}天</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Coins className="h-3.5 w-3.5" />
                      <span>售价: {crop.sellPrice}g</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Droplets className="h-3.5 w-3.5" />
                      <span>浇水: {crop.waterNeeds}</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Sprout className="h-3.5 w-3.5" />
                      <span>{crop.regrows ? "可再生" : "一次性"}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="profit">
          <Card>
            <CardHeader>
              <CardTitle>收益计算器</CardTitle>
              <CardDescription>计算不同作物的收益</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  以下是按照单次收获的售价与生长期计算的每日理论平均收益：
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {ENCYCLOPEDIA_CROPS.map((crop) => {
                    const dailyProfit = Math.round((crop.sellPrice / crop.growDays) * 10) / 10
                    return (
                      <div key={crop.name} className="flex justify-between items-center p-3 rounded-lg border bg-accent/30">
                        <div>
                          <p className="font-semibold text-sm">{crop.name}</p>
                          <p className="text-xs text-muted-foreground">{crop.season} · 生长 {crop.growDays} 天</p>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-sm text-yellow-500">{dailyProfit} g/天</p>
                          <p className="text-[10px] text-muted-foreground">单价 {crop.sellPrice}g</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

