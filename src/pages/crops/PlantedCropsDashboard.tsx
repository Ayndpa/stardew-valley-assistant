import { useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Sprout, MapPin, Flame, Coins } from "lucide-react"
import { PlantedCrop, CropLookup, locationMap } from "./types"

interface PlantedCropsDashboardProps {
  selectedSaveId: string
  loadingCrops: boolean
  plantedCrops: PlantedCrop[]
  cropLookup: Record<string, CropLookup>
}

export function PlantedCropsDashboard({
  selectedSaveId,
  loadingCrops,
  plantedCrops,
  cropLookup,
}: PlantedCropsDashboardProps) {
  // Group planted crops by location
  const cropsByLocation = useMemo(() => {
    const grouped: Record<string, PlantedCrop[]> = {}
    plantedCrops.forEach((crop) => {
      const loc = crop.location || "Farm"
      if (!grouped[loc]) {
        grouped[loc] = []
      }
      grouped[loc].push(crop)
    })
    return grouped
  }, [plantedCrops])

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
          daysRemaining += curPhaseMax - crop.dayOfCurrentPhase
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

  if (!selectedSaveId) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Sprout className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <p className="font-semibold text-lg">未选择游戏存档</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm">
            请先通过侧边栏选择一个游戏存档文件，系统将读取您农场中种植的作物信息并在此处实时显示。
          </p>
        </CardContent>
      </Card>
    )
  }

  if (loadingCrops) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-2">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
        <p className="text-sm text-muted-foreground">正在加载农田作物...</p>
      </div>
    )
  }

  if (plantedCrops.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Sprout className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <p className="font-semibold text-lg">当前存档中未找到生长的作物</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm">
            在你的农场、温室或姜岛上播种并浇水后，作物状态将在此处实时显示。
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-8">
      {Object.keys(cropsByLocation).map((loc) => {
        const locName = locationMap[loc] || loc
        const crops = cropsByLocation[loc]
        const wateredCount = crops.filter((c) => c.isWatered).length
        const matureCount = crops.filter((c) => c.fullyGrown).length
        const deadCount = crops.filter((c) => c.dead).length

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
                        <div className="min-w-0">
                          <CardTitle className="text-base flex items-center gap-1.5 font-bold truncate">
                            {info.icon ? (
                              <img
                                src={info.icon}
                                alt=""
                                className="h-5 w-5 shrink-0 object-contain"
                                style={{ imageRendering: "pixelated" }}
                              />
                            ) : (
                              <Sprout
                                className={`h-4 w-4 shrink-0 ${
                                  crop.dead
                                    ? "text-red-400"
                                    : crop.fullyGrown
                                    ? "text-green-500 animate-bounce"
                                    : "text-emerald-500"
                                }`}
                              />
                            )}
                            <span className="truncate">{info.name}</span>
                          </CardTitle>
                          <CardDescription className="text-xs mt-0.5">
                            坐标 ({crop.x}, {crop.y})
                          </CardDescription>
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          {crop.isWatered ? (
                            <Badge className="bg-blue-500 hover:bg-blue-600 text-xs font-semibold px-2 py-0">
                              已浇水 💧
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-xs font-semibold px-2 py-0">
                              干燥 🏜️
                            </Badge>
                          )}
                          {info.regrows && (
                            <Badge
                              variant="outline"
                              className="text-indigo-400 border-indigo-400/20 text-[10px] font-semibold mt-0.5"
                            >
                              可再生
                            </Badge>
                          )}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3 pt-2">
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs font-medium">
                          <span className="text-muted-foreground">生长进度</span>
                          <span
                            className={
                              crop.dead
                                ? "text-red-400 font-semibold"
                                : crop.fullyGrown
                                ? "text-green-500 font-bold"
                                : "text-primary"
                            }
                          >
                            {info.statusText}
                          </span>
                        </div>
                        <div
                          className={`w-full bg-muted rounded-full h-2 overflow-hidden ${
                            crop.dead ? "bg-red-950/20" : crop.fullyGrown ? "bg-green-100 dark:bg-green-950/20" : ""
                          }`}
                        >
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${
                              crop.dead ? "bg-red-500" : crop.fullyGrown ? "bg-green-500" : "bg-primary"
                            }`}
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
  )
}
