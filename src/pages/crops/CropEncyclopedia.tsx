import { useState, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Search, Sprout, Calendar as CalendarIcon, Coins, Droplets, Filter } from "lucide-react"
import { Crop } from "./types"

interface CropEncyclopediaProps {
  encyclopediaCrops: Crop[]
  seasons: string[]
  loadingGameData: boolean
  gameDataError: string | null
}

export function CropEncyclopedia({
  encyclopediaCrops,
  seasons,
  loadingGameData,
  gameDataError,
}: CropEncyclopediaProps) {
  const [searchTerm, setSearchTerm] = useState("")
  const [activeSeason, setActiveSeason] = useState("全部")

  // Generate season filters dynamically
  const seasonFilters = useMemo(() => {
    const filterSet = new Set<string>(["全部"])
    const sourceFilters = seasons && seasons.length > 0 ? seasons : ["全部"]
    sourceFilters.forEach((season) => filterSet.add(season))
    encyclopediaCrops.forEach((crop) => {
      if (crop.season) filterSet.add(crop.season)
      crop.seasons?.forEach((season) => filterSet.add(season))
    })
    return Array.from(filterSet)
  }, [encyclopediaCrops, seasons])

  // Reset activeSeason if it is no longer valid
  const currentActiveSeason = useMemo(() => {
    return seasonFilters.includes(activeSeason) ? activeSeason : "全部"
  }, [seasonFilters, activeSeason])

  const filteredEncyclopedia = useMemo(() => {
    return encyclopediaCrops.filter((crop) => {
      const matchesSearch = crop.name.toLowerCase().includes(searchTerm.toLowerCase())
      const matchesSeason =
        currentActiveSeason === "全部" ||
        crop.season === currentActiveSeason ||
        crop.seasons?.includes(currentActiveSeason)
      return matchesSearch && matchesSeason
    })
  }, [encyclopediaCrops, searchTerm, currentActiveSeason])

  return (
    <div className="space-y-4">
      {/* Season Filter */}
      <div className="flex gap-2 flex-wrap">
        {seasonFilters.map((season) => (
          <Button
            key={season}
            variant={currentActiveSeason === season ? "default" : "outline"}
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
                    <CardTitle className="truncate text-base font-bold">
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
    </div>
  )
}
