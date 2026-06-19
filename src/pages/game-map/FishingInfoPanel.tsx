import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { Clock, Fish, Package, Search, Waves, X } from "lucide-react"
import type { FishingArea, FishingAreaFish, SelectedFishingInfo } from "./GameMap.types"

interface FishingInfoPanelProps {
  selectedFishingInfo: SelectedFishingInfo
  panelPosition: { left: number; top: number }
  fishPanelSearch: string
  setFishPanelSearch: (v: string) => void
  fishPanelSeasonFilter: string | null
  setFishPanelSeasonFilter: (v: string | null) => void
  fishPanelWeatherFilter: string | null
  setFishPanelWeatherFilter: (v: string | null) => void
  fishPanelShowTrapOnly: boolean
  setFishPanelShowTrapOnly: (v: boolean) => void
  fishPanelSortBy: "name" | "price"
  setFishPanelSortBy: (v: "name" | "price") => void
  onClose: () => void
}

const seasonColors: Record<string, string> = {
  spring: "bg-green-500/15 text-green-400 border-green-500/30",
  summer: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  fall: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  winter: "bg-blue-400/15 text-blue-400 border-blue-400/30",
}
const seasonActiveColors: Record<string, string> = {
  spring: "bg-green-500 text-white border-green-500",
  summer: "bg-yellow-500 text-white border-yellow-500",
  fall: "bg-orange-500 text-white border-orange-500",
  winter: "bg-blue-400 text-white border-blue-400",
}

function formatTime(n: number) {
  const h = Math.floor(n / 100)
  const m = n % 100
  const hour = h > 12 ? h - 12 : h === 0 ? 12 : h
  const ampm = h >= 12 && h < 24 ? "PM" : "AM"
  return `${hour}:${m.toString().padStart(2, "0")} ${ampm}`
}

function useFilteredFish(
  area: FishingArea | null,
  tileDepth: number,
  search: string,
  seasonFilter: string | null,
  weatherFilter: string | null,
  showTrapOnly: boolean,
  sortBy: "name" | "price",
) {
  return useMemo(() => {
    let fish = (area?.fish ?? []).filter((f: FishingAreaFish) => {
      if (!f.isTrap) {
        const minDist = f.minDistanceFromShore
        const maxDist = f.maxDistanceFromShore
        if (minDist > 0 || maxDist > 0) {
          const fishMinDepth = Math.max(0, minDist - 1)
          const fishMaxDepth = maxDist > 0 ? Math.min(5, maxDist - 1) : 5
          if (tileDepth < fishMinDepth || tileDepth > fishMaxDepth) return false
        }
      }
      if (search) {
        const q = search.toLowerCase()
        if (!f.name.toLowerCase().includes(q) && !f.description.toLowerCase().includes(q)) return false
      }
      if (showTrapOnly && !f.isTrap) return false
      if (seasonFilter && !f.seasons.includes(seasonFilter)) return false
      if (weatherFilter && f.weather !== weatherFilter && !f.isTrap) return false
      return true
    })
    if (sortBy === "price") {
      fish = [...fish].sort((a, b) => b.price - a.price)
    }
    return fish
  }, [area, tileDepth, search, seasonFilter, weatherFilter, showTrapOnly, sortBy])
}

export function FishingInfoPanel({
  selectedFishingInfo,
  panelPosition,
  fishPanelSearch,
  setFishPanelSearch,
  fishPanelSeasonFilter,
  setFishPanelSeasonFilter,
  fishPanelWeatherFilter,
  setFishPanelWeatherFilter,
  fishPanelShowTrapOnly,
  setFishPanelShowTrapOnly,
  fishPanelSortBy,
  setFishPanelSortBy,
  onClose,
}: FishingInfoPanelProps) {
  const { t } = useTranslation()
  const { area, tile, tileX, tileY } = selectedFishingInfo
  const tileDepth = tile.depth

  const visibleFish = useFilteredFish(
    area,
    tileDepth,
    fishPanelSearch,
    fishPanelSeasonFilter,
    fishPanelWeatherFilter,
    fishPanelShowTrapOnly,
    fishPanelSortBy,
  )

  const totalFish = area?.fish.length ?? 0
  const allSeasons = ["spring", "summer", "fall", "winter"]
  const availableSeasons = allSeasons.filter((s) => area?.fish.some((f) => f.seasons.includes(s)))
  const hasRainy = area?.fish.some((f) => f.weather === "rainy") ?? false
  const hasSunny = area?.fish.some((f) => f.weather === "sunny") ?? false
  const hasTrap = area?.fish.some((f) => f.isTrap) ?? false

  const panelW = 380
  const panelH = 460

  return (
    <div
      className="absolute z-20 flex flex-col rounded-xl border border-border/60 bg-background/96 shadow-2xl backdrop-blur-xl"
      style={{ left: `${panelPosition.left}px`, top: `${panelPosition.top}px`, width: `${panelW}px`, maxHeight: `${panelH}px` }}
      onWheel={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex shrink-0 items-start justify-between gap-2 border-b border-border/50 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Waves className="h-3.5 w-3.5 shrink-0 text-primary" />
            <div className="truncate text-sm font-semibold leading-tight">
              {area?.name || t("fishingMap.currentWaterArea")}
            </div>
            <Badge
              variant="secondary"
              className="shrink-0 border border-border/60 bg-secondary/80 text-[10px] text-secondary-foreground"
            >
              {t("fishingMap.fishCount", { count: visibleFish.length })}{visibleFish.length < totalFish ? ` / ${totalFish}` : ""}
            </Badge>
          </div>
          <div className="mt-1 text-[10px] text-muted-foreground">
            {tile.hidden
              ? t("fishingMap.tileCoordDepthHidden", { x: tileX, y: tileY, depth: tileDepth })
              : t("fishingMap.tileCoordDepth", { x: tileX, y: tileY, depth: tileDepth })}
          </div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onClose() }}
          className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label={t("fishingMap.closeFishInfo")}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Search + Sort bar */}
      <div className="shrink-0 flex items-center gap-2 border-b border-border/40 px-3 py-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={fishPanelSearch}
            onChange={(e) => setFishPanelSearch(e.target.value)}
            placeholder={t("fishingMap.fishPanelSearch")}
            className="w-full rounded-md border border-border/50 bg-muted/30 py-1 pl-6 pr-2 text-[11px] text-foreground placeholder:text-muted-foreground/60 focus:border-primary/50 focus:outline-none focus:ring-0"
          />
        </div>
        <button
          onClick={() => setFishPanelSortBy(fishPanelSortBy === "name" ? "price" : "name")}
          className={cn(
            "shrink-0 rounded-md border px-2 py-1 text-[10px] font-medium transition-colors",
            fishPanelSortBy === "price"
              ? "border-primary/50 bg-primary/15 text-primary"
              : "border-border/50 bg-muted/30 text-muted-foreground hover:text-foreground"
          )}
          title={fishPanelSortBy === "name" ? t("fishingMap.sortByPrice") : t("fishingMap.sortByName")}
        >
          {fishPanelSortBy === "price" ? "💰" : "🔤"}
        </button>
      </div>

      {/* Filter chips */}
      <div className="shrink-0 flex flex-wrap gap-1 border-b border-border/40 px-3 py-2">
        {availableSeasons.map((season) => (
          <button
            key={season}
            onClick={() => setFishPanelSeasonFilter(fishPanelSeasonFilter === season ? null : season)}
            className={cn(
              "rounded-full border px-2 py-0.5 text-[9px] font-medium transition-colors",
              fishPanelSeasonFilter === season
                ? seasonActiveColors[season]
                : (seasonColors[season] ?? "bg-muted/30 text-muted-foreground border-border/40") + " hover:opacity-80"
            )}
          >
            {t(`fishingMap.${season}`, { defaultValue: season })}
          </button>
        ))}
        {hasRainy && (
          <button
            onClick={() => setFishPanelWeatherFilter(fishPanelWeatherFilter === "rainy" ? null : "rainy")}
            className={cn(
              "rounded-full border px-2 py-0.5 text-[9px] font-medium transition-colors",
              fishPanelWeatherFilter === "rainy"
                ? "bg-blue-500 text-white border-blue-500"
                : "bg-blue-500/15 text-blue-400 border-blue-500/30 hover:opacity-80"
            )}
          >
            {t("fishingMap.rainy")}
          </button>
        )}
        {hasSunny && (
          <button
            onClick={() => setFishPanelWeatherFilter(fishPanelWeatherFilter === "sunny" ? null : "sunny")}
            className={cn(
              "rounded-full border px-2 py-0.5 text-[9px] font-medium transition-colors",
              fishPanelWeatherFilter === "sunny"
                ? "bg-amber-400 text-white border-amber-400"
                : "bg-amber-400/15 text-amber-400 border-amber-400/30 hover:opacity-80"
            )}
          >
            {t("fishingMap.sunny")}
          </button>
        )}
        {hasTrap && (
          <button
            onClick={() => setFishPanelShowTrapOnly(!fishPanelShowTrapOnly)}
            className={cn(
              "rounded-full border px-2 py-0.5 text-[9px] font-medium transition-colors",
              fishPanelShowTrapOnly
                ? "bg-teal-500 text-white border-teal-500"
                : "bg-teal-500/15 text-teal-400 border-teal-500/30 hover:opacity-80"
            )}
          >
            {t("fishingMap.crabPot")}
          </button>
        )}
      </div>

      {/* Fish List */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {visibleFish.length > 0 ? (
          <div className="space-y-1.5 p-3">
            {visibleFish.map((fish) => (
              <div
                key={fish.id}
                className="rounded-lg border border-border/50 bg-card/70 p-2.5 transition-colors hover:bg-card"
              >
                <div className="flex items-start gap-2.5">
                  <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border/50 bg-accent/20">
                    {fish.icon ? (
                      <img
                        src={fish.icon}
                        alt=""
                        className="h-7 w-7 object-contain"
                        style={{ imageRendering: "pixelated" }}
                      />
                    ) : (
                      <Package className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                        <span className="text-sm font-semibold text-foreground leading-tight">{fish.name}</span>
                        {fish.isTrap && (
                          <span className="inline-flex items-center rounded-full border border-teal-500/30 bg-teal-500/15 px-1.5 py-0.5 text-[9px] font-medium text-teal-400">
                            {t("fishingMap.crabPot")}
                          </span>
                        )}
                        {fish.minLevel > 0 && (
                          <span className="inline-flex items-center rounded-full border border-purple-500/30 bg-purple-500/15 px-1.5 py-0.5 text-[9px] font-medium text-purple-400">
                            {t("fishingMap.minLevel", { level: fish.minLevel })}
                          </span>
                        )}
                      </div>
                      {fish.price > 0 && (
                        <span className="shrink-0 inline-flex items-center gap-0.5 rounded-full border border-yellow-500/30 bg-yellow-500/10 px-1.5 py-0.5 text-[9px] font-bold text-yellow-500">
                          🪙 {fish.price}{t("fishingMap.priceLabel")}
                          {fish.priceSource === "mod" && (
                            <span className="ml-0.5 text-orange-500">Mod</span>
                          )}
                          {fish.priceSource === "export" && (
                            <span className="ml-0.5 text-blue-500">导出</span>
                          )}
                        </span>
                      )}
                    </div>
                    {fish.description && (
                      <div className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-muted-foreground">
                        {fish.description}
                      </div>
                    )}
                  </div>
                </div>

                {!fish.isTrap && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {fish.seasons.map((season) => (
                      <span
                        key={season}
                        className={cn(
                          "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-medium",
                          seasonColors[season] ?? "bg-muted/30 text-muted-foreground border-border/40"
                        )}
                      >
                        {t(`fishingMap.${season}`, { defaultValue: season })}
                      </span>
                    ))}
                    {fish.weather && fish.weather !== "both" && (
                      <span className={cn(
                        "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-medium",
                        fish.weather === "rainy"
                          ? "bg-blue-500/15 text-blue-400 border-blue-500/30"
                          : "bg-amber-400/15 text-amber-400 border-amber-400/30"
                      )}>
                        {t(`fishingMap.${fish.weather}`, { defaultValue: fish.weather })}
                      </span>
                    )}
                    {fish.timeRanges.map(([start, end], idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center gap-0.5 rounded-full border border-border/40 bg-muted/30 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground"
                      >
                        <Clock className="h-2.5 w-2.5" />
                        {formatTime(start)}–{formatTime(end)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : totalFish > 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
            <Search className="h-8 w-8 text-muted-foreground/40" />
            <div className="text-xs text-muted-foreground">{t("fishingMap.noMatchingFish")}</div>
            <button
              onClick={() => { setFishPanelSearch(""); setFishPanelSeasonFilter(null); setFishPanelWeatherFilter(null); setFishPanelShowTrapOnly(false) }}
              className="text-[11px] text-primary hover:underline"
            >
              {t("fishingMap.filterAll")}
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
            <Fish className="h-8 w-8 text-muted-foreground/40" />
            <div className="text-xs text-muted-foreground">{t("fishingMap.noFishData")}</div>
          </div>
        )}
      </div>
    </div>
  )
}
