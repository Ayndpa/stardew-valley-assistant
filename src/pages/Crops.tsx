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
  ArrowUpDown,
  ArrowDownAZ,
  ArrowUpAZ,
} from "lucide-react"

// Dynamic imports will be done inline inside useEffect/handlers for reliability

interface CropsProps {
  selectedSaveId: string
}

interface CropLookup {
  name: string
  sellPrice: number
  regrows: boolean
  regrowDays?: number
  icon?: string | null
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
  seedId?: string
  harvestId?: string
  name: string
  icon?: string | null
  season: string
  seasons?: string[]
  growDays: number
  sellPrice: number
  regrows: boolean
  regrowDays?: number
  needsWatering?: boolean
  waterNeeds: string
}

interface CropGameData {
  encyclopedia: Crop[]
  lookup: Record<string, CropLookup>
  seasons: string[]
}

type ProfitSortField = "dailyProfit" | "sellPrice" | "growDays" | "name"
type ProfitSortDirection = "asc" | "desc"

const locationMap: Record<string, string> = {
  Farm: "主要农场",
  Greenhouse: "温室大棚",
  IslandWest: "姜岛农场 (西)",
  IslandNorth: "姜岛农场 (北)",
  Forest: "煤矿森林",
}

export function Crops({ selectedSaveId }: CropsProps) {
  const [searchTerm, setSearchTerm] = useState("")
  const [activeSeason, setActiveSeason] = useState("全部")
  const [plantedCrops, setPlantedCrops] = useState<PlantedCrop[]>([])
  const [loadingCrops, setLoadingCrops] = useState(true)
  const [cropLookup, setCropLookup] = useState<Record<string, CropLookup>>({})
  const [encyclopediaCrops, setEncyclopediaCrops] = useState<Crop[]>([])
  const [seasonFilters, setSeasonFilters] = useState<string[]>(["全部"])
  const [loadingGameData, setLoadingGameData] = useState(false)
  const [gameDataError, setGameDataError] = useState<string | null>(null)
  const [profitSortField, setProfitSortField] = useState<ProfitSortField>("dailyProfit")
  const [profitSortDirection, setProfitSortDirection] = useState<ProfitSortDirection>("desc")

  useEffect(() => {
    async function loadCropGameData() {
      const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__
      if (!isTauri) {
        setGameDataError("当前环境不是 Tauri，无法直接读取游戏目录。")
        return
      }

      setLoadingGameData(true)
      setGameDataError(null)
      try {
        const { invoke } = await import("@tauri-apps/api/core")
        const gameDir = localStorage.getItem("stardewGameDirectory") || ""
        const data = await invoke("get_crop_game_data", {
          gameDir: gameDir.trim() || undefined,
        }) as CropGameData

        setEncyclopediaCrops(data.encyclopedia)
        setCropLookup(data.lookup)

        const filterSet = new Set<string>(["全部"])
        const sourceFilters = data.seasons.length > 0 ? data.seasons : ["全部"]
        sourceFilters.forEach((season) => filterSet.add(season))
        data.encyclopedia.forEach((crop) => {
          filterSet.add(crop.season)
          crop.seasons?.forEach((season) => filterSet.add(season))
        })
        const nextFilters = Array.from(filterSet)
        setSeasonFilters(nextFilters)
        setActiveSeason((current) => nextFilters.includes(current) ? current : "全部")
      } catch (err) {
        console.error("Error loading crop game data:", err)
        setGameDataError(String(err))
        setEncyclopediaCrops([])
        setCropLookup({})
        setSeasonFilters(["全部"])
        setActiveSeason("全部")
      } finally {
        setLoadingGameData(false)
      }
    }

    loadCropGameData()
  }, [])

  // Fetch real crops
  useEffect(() => {
    async function loadCrops() {
      if (!selectedSaveId) {
        setLoadingCrops(false)
        return
      }
      setLoadingCrops(true)
      
      const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__
      if (isTauri) {
        try {
          const { invoke } = await import("@tauri-apps/api/core")
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

  const filteredEncyclopedia = encyclopediaCrops.filter((crop) => {
    const matchesSearch = crop.name.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesSeason = activeSeason === "全部" || crop.season === activeSeason || crop.seasons?.includes(activeSeason)
    return matchesSearch && matchesSeason
  })

  const profitSortedCrops = [...encyclopediaCrops].sort((a, b) => {
    const getDailyProfit = (crop: Crop) => crop.growDays > 0 ? Math.round((crop.sellPrice / crop.growDays) * 10) / 10 : 0

    const compareValue = (() => {
      switch (profitSortField) {
        case "sellPrice":
          return a.sellPrice - b.sellPrice
        case "growDays":
          return a.growDays - b.growDays
        case "name":
          return a.name.localeCompare(b.name, "zh-CN")
        case "dailyProfit":
        default:
          return getDailyProfit(a) - getDailyProfit(b)
      }
    })()

    return profitSortDirection === "asc" ? compareValue : -compareValue
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
    const lookup = cropLookup[crop.seedId] || cropLookup[crop.harvestId]
    const name = lookup?.name || `未知作物 (${crop.seedId || crop.harvestId})`
    const sellPrice = lookup?.sellPrice || 0
    const regrows = lookup?.regrows || false
    const icon = lookup?.icon || null

    if (crop.dead) {
      return { name, icon, progress: 0, daysRemaining: 0, totalDays: 0, statusText: "已枯萎 🍂", sellPrice, regrows }
    }
    if (crop.fullyGrown) {
      return { name, icon, progress: 100, daysRemaining: 0, totalDays: 0, statusText: "已成熟 🧺", sellPrice, regrows }
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
        regrows,
        icon,
      }
    }

    return { name, icon, progress: 50, daysRemaining: 1, totalDays: 2, statusText: "成长中", sellPrice, regrows }
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
                                    {info.icon ? (
                                      <img
                                        src={info.icon}
                                        alt=""
                                        className="h-5 w-5 shrink-0 object-contain"
                                        style={{ imageRendering: "pixelated" }}
                                      />
                                    ) : (
                                      <Sprout className={`h-4 w-4 ${crop.dead ? "text-red-400" : crop.fullyGrown ? "text-green-500 animate-bounce" : "text-emerald-500"}`} />
                                    )}
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
            {seasonFilters.map((season) => (
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

          {(loadingGameData || gameDataError) && (
            <div className="text-xs text-muted-foreground">
              {loadingGameData
                ? "正在从游戏内容解析作物图标..."
                : `未能读取游戏目录中的作物数据：${gameDataError}`}
            </div>
          )}

          {/* Crop Grid */}
          {filteredEncyclopedia.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <Sprout className="h-12 w-12 text-muted-foreground/40 mb-4" />
                <p className="font-semibold text-lg">未读取到作物图鉴数据</p>
                <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                  请在设置中确认星露谷安装目录可用，程序会直接从游戏内容目录解析作物信息。
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredEncyclopedia.map((crop) => (
                <Card key={crop.harvestId || crop.seedId || crop.name} className="hover:shadow-md transition-shadow">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border bg-accent/40">
                          {crop.icon ? (
                            <img
                              src={crop.icon}
                              alt=""
                              className="h-8 w-8 object-contain"
                              style={{ imageRendering: "pixelated" }}
                            />
                          ) : (
                            <Sprout className="h-5 w-5 text-green-500" />
                          )}
                        </div>
                        <CardTitle className="truncate text-base">
                          {crop.name}
                        </CardTitle>
                      </div>
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
          )}
        </TabsContent>

        <TabsContent value="profit">
          <Card>
            <CardHeader>
              <CardTitle>收益计算器</CardTitle>
              <CardDescription>计算不同作物的收益</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <p className="text-sm text-muted-foreground">
                    以下是按照单次收获的售价与生长期计算的每日理论平均收益：
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant={profitSortField === "dailyProfit" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setProfitSortField("dailyProfit")}
                    >
                      日收益
                    </Button>
                    <Button
                      variant={profitSortField === "sellPrice" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setProfitSortField("sellPrice")}
                    >
                      单价
                    </Button>
                    <Button
                      variant={profitSortField === "growDays" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setProfitSortField("growDays")}
                    >
                      生长天数
                    </Button>
                    <Button
                      variant={profitSortField === "name" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setProfitSortField("name")}
                    >
                      名称
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      onClick={() => setProfitSortDirection((current) => current === "desc" ? "asc" : "desc")}
                    >
                      {profitSortDirection === "desc" ? (
                        <ArrowDownAZ className="h-4 w-4" />
                      ) : (
                        <ArrowUpAZ className="h-4 w-4" />
                      )}
                      {profitSortDirection === "desc" ? "降序" : "升序"}
                    </Button>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <ArrowUpDown className="h-3.5 w-3.5" />
                  当前按
                  <span className="font-medium text-foreground">
                    {profitSortField === "dailyProfit" && "日收益"}
                    {profitSortField === "sellPrice" && "单价"}
                    {profitSortField === "growDays" && "生长天数"}
                    {profitSortField === "name" && "名称"}
                  </span>
                  {profitSortDirection === "desc" ? "从高到低" : "从低到高"}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {profitSortedCrops.map((crop) => {
                    const dailyProfit = crop.growDays > 0 ? Math.round((crop.sellPrice / crop.growDays) * 10) / 10 : 0
                    return (
                      <div key={crop.harvestId || crop.seedId || crop.name} className="flex justify-between items-center gap-3 p-3 rounded-lg border bg-accent/30">
                        <div className="flex items-center gap-3 min-w-0">
                          {crop.icon ? (
                            <img
                              src={crop.icon}
                              alt=""
                              className="h-7 w-7 shrink-0 object-contain"
                              style={{ imageRendering: "pixelated" }}
                            />
                          ) : (
                            <Sprout className="h-5 w-5 shrink-0 text-green-500" />
                          )}
                          <div className="min-w-0">
                          <p className="font-semibold text-sm">{crop.name}</p>
                          <p className="text-xs text-muted-foreground">{crop.season} · 生长 {crop.growDays} 天</p>
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
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

