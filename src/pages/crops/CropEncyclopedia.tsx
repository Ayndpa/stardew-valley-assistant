import { useState, useMemo } from "react"
import { useTranslation } from "react-i18next"
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
  const { t } = useTranslation()
  const [searchTerm, setSearchTerm] = useState("")
  const [activeSeason, setActiveSeason] = useState("全部")

  // Generate season filters dynamically
  const seasonFilters = useMemo(() => {
    const filterSet = new Set<string>([t("crops.filterAll")])
    const sourceFilters = seasons && seasons.length > 0 ? seasons : [t("crops.filterAll")]
    sourceFilters.forEach((season) => filterSet.add(season))
    encyclopediaCrops.forEach((crop) => {
      if (crop.season) filterSet.add(crop.season)
      crop.seasons?.forEach((season) => filterSet.add(season))
    })
    return Array.from(filterSet)
  }, [encyclopediaCrops, seasons, t])

  // Reset activeSeason if it is no longer valid
  const currentActiveSeason = useMemo(() => {
    return seasonFilters.includes(activeSeason) ? activeSeason : t("crops.filterAll")
  }, [seasonFilters, activeSeason, t])

  const filteredEncyclopedia = useMemo(() => {
    return encyclopediaCrops.filter((crop) => {
      const matchesSearch = crop.name.toLowerCase().includes(searchTerm.toLowerCase())
      const matchesSeason =
        currentActiveSeason === t("crops.filterAll") ||
        crop.season === currentActiveSeason ||
        crop.seasons?.includes(currentActiveSeason)
      return matchesSearch && matchesSeason
    })
  }, [encyclopediaCrops, searchTerm, currentActiveSeason, t])

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
            placeholder={t("crops.encyclopedia.searchPlaceholder")}
            className="pl-10"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.currentTarget.value)}
          />
        </div>
        <Button variant="outline" size="sm" className="gap-2">
          <Filter className="h-4 w-4" />
          {t("crops.encyclopedia.filterLabel")}
        </Button>
      </div>

      {(loadingGameData || gameDataError) && (
        <div className="text-xs text-muted-foreground">
          {loadingGameData
            ? t("crops.encyclopedia.parsingIcons")
            : t("crops.encyclopedia.loadError", { error: gameDataError })}
        </div>
      )}

      {/* Crop Grid */}
      {filteredEncyclopedia.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Sprout className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <p className="font-semibold text-lg">{t("crops.encyclopedia.noData")}</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              {t("crops.encyclopedia.noDataDesc")}
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
                    <span>{t("crops.encyclopedia.metrics.growth", { days: crop.growDays })}</span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Coins className="h-3.5 w-3.5" />
                    <span>{t("crops.encyclopedia.metrics.sellPrice", { price: crop.sellPrice })}</span>
                    {crop.priceSource === "mod" && (
                      <span className="text-xs px-1 py-0.5 rounded bg-orange-500/10 text-orange-500">Mod</span>
                    )}
                    {crop.priceSource === "export" && (
                      <span className="text-xs px-1 py-0.5 rounded bg-blue-500/10 text-blue-500">导出</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Droplets className="h-3.5 w-3.5" />
                    <span>{t("crops.encyclopedia.metrics.watering", { needs: crop.waterNeeds })}</span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Sprout className="h-3.5 w-3.5" />
                    <span>{crop.regrows ? t("crops.encyclopedia.metrics.regrows") : t("crops.encyclopedia.metrics.singleUse")}</span>
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
