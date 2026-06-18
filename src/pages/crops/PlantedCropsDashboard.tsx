import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { Coins, Flame, MapPin, Sprout, Waves } from "lucide-react"
import { CropLookup, PlantedCrop } from "./types"

interface PlantedCropsDashboardProps {
  selectedSaveId: string
  loadingCrops: boolean
  plantedCrops: PlantedCrop[]
  cropLookup: Record<string, CropLookup>
}

interface CropStatusInfo {
  key: string
  name: string
  icon: string | null
  progress: number
  daysRemaining: number
  totalDays: number
  statusText: string
  shortStatusText: string
  statusType: "dead" | "ready" | "growing"
  sellPrice: number
  regrows: boolean
}

interface CropSummary {
  cropKey: string
  name: string
  icon: string | null
  count: number
  sellPrice: number
}

interface StatusGroup {
  key: string
  statusType: CropStatusInfo["statusType"]
  statusText: string
  progress: number
  daysRemaining: number
  regrows: boolean
  wateredCount: number
  count: number
  crops: CropSummary[]
}

function getCropStatus(
  crop: PlantedCrop,
  cropLookup: Record<string, CropLookup>,
  t: any,
): CropStatusInfo {
  const lookup = cropLookup[crop.seedId] || cropLookup[crop.harvestId]
  const key = crop.seedId || crop.harvestId || `${crop.location}-${crop.x}-${crop.y}`
  const name = lookup?.name || t("crops.unknownCrop", { id: crop.seedId || crop.harvestId || "" })
  const sellPrice = lookup?.sellPrice || 0
  const regrows = lookup?.regrows || false
  const icon = lookup?.icon || null

  if (crop.dead) {
    return {
      key,
      name,
      icon,
      progress: 0,
      daysRemaining: 0,
      totalDays: 0,
      statusText: t("crops.status.dead"),
      shortStatusText: t("crops.status.deadShort"),
      statusType: "dead",
      sellPrice,
      regrows,
    }
  }

  if (crop.fullyGrown) {
    return {
      key,
      name,
      icon,
      progress: 100,
      daysRemaining: 0,
      totalDays: 0,
      statusText: regrows ? t("crops.status.readyRegrow") : t("crops.status.readyOnce"),
      shortStatusText: t("crops.status.readyShort"),
      statusType: "ready",
      sellPrice,
      regrows,
    }
  }

  if (crop.phaseDays && crop.phaseDays.length > 1) {
    const phases = crop.phaseDays.slice(0, crop.phaseDays.length - 1)
    const totalDays = phases.reduce((a, b) => a + b, 0)

    let daysRemaining = 0
    if (crop.currentPhase < crop.phaseDays.length - 1) {
      const currentPhaseMax = crop.phaseDays[crop.currentPhase]
      if (crop.dayOfCurrentPhase < currentPhaseMax) {
        daysRemaining += currentPhaseMax - crop.dayOfCurrentPhase
      }
      for (let phaseIndex = crop.currentPhase + 1; phaseIndex < crop.phaseDays.length - 1; phaseIndex += 1) {
        daysRemaining += crop.phaseDays[phaseIndex]
      }
    }

    const daysGrown = Math.max(0, totalDays - daysRemaining)
    const progress = totalDays > 0 ? Math.min(99, Math.round((daysGrown / totalDays) * 100)) : 0

    return {
      key,
      name,
      icon,
      progress,
      daysRemaining,
      totalDays,
      statusText: t("crops.status.growingDetail", { grown: daysGrown, total: totalDays, remaining: daysRemaining }),
      shortStatusText: t("crops.status.growingShort", { remaining: daysRemaining }),
      statusType: "growing",
      sellPrice,
      regrows,
    }
  }

  return {
    key,
    name,
    icon,
    progress: 50,
    daysRemaining: 1,
    totalDays: 2,
    statusText: t("crops.status.growing"),
    shortStatusText: t("crops.status.growing"),
    statusType: "growing",
    sellPrice,
    regrows,
  }
}

function getStatusStyles(statusType: CropStatusInfo["statusType"]) {
  if (statusType === "dead") {
    return {
      badgeClassName: "text-red-500 bg-red-500/5 border-red-500/20",
      progressClassName: "bg-red-500",
      panelClassName: "border-red-500/15 bg-red-500/[0.03]",
      textClassName: "text-red-500",
    }
  }

  if (statusType === "ready") {
    return {
      badgeClassName: "text-green-600 bg-green-500/5 border-green-500/20",
      progressClassName: "bg-green-500",
      panelClassName: "border-green-500/15 bg-green-500/[0.03]",
      textClassName: "text-green-600",
    }
  }

  return {
    badgeClassName: "text-primary bg-primary/5 border-primary/20",
    progressClassName: "bg-primary",
    panelClassName: "border-border bg-muted/20",
    textClassName: "text-primary",
  }
}

export function PlantedCropsDashboard({
  selectedSaveId,
  loadingCrops,
  plantedCrops,
  cropLookup,
}: PlantedCropsDashboardProps) {
  const { t } = useTranslation()
  const [activeLocation, setActiveLocation] = useState<string>("all")

  const locationSections = useMemo(() => {
    const grouped = new Map<string, PlantedCrop[]>()

    plantedCrops.forEach((crop) => {
      const locationKey = crop.location || "Farm"
      const list = grouped.get(locationKey)
      if (list) {
        list.push(crop)
      } else {
        grouped.set(locationKey, [crop])
      }
    })

    return Array.from(grouped.entries()).map(([locationKey, crops]) => {
      const cropTotals = new Map<string, CropSummary>()
      const statusGroups = new Map<string, StatusGroup>()

      crops.forEach((crop) => {
        const info = getCropStatus(crop, cropLookup, t)

        const existingSummary = cropTotals.get(info.key)
        if (existingSummary) {
          existingSummary.count += 1
        } else {
          cropTotals.set(info.key, {
            cropKey: info.key,
            name: info.name,
            icon: info.icon,
            count: 1,
            sellPrice: info.sellPrice,
          })
        }

        const groupKey = [
          info.key,
          info.statusType,
          info.progress,
          info.daysRemaining,
          crop.isWatered ? "watered" : "dry",
        ].join(":")

        const existingGroup = statusGroups.get(groupKey)
        if (existingGroup) {
          existingGroup.count += 1
          existingGroup.wateredCount += crop.isWatered ? 1 : 0
          const cropSummary = existingGroup.crops.find((item) => item.cropKey === info.key)
          if (cropSummary) {
            cropSummary.count += 1
          } else {
            existingGroup.crops.push({
              cropKey: info.key,
              name: info.name,
              icon: info.icon,
              count: 1,
              sellPrice: info.sellPrice,
            })
          }
        } else {
          statusGroups.set(groupKey, {
            key: groupKey,
            statusType: info.statusType,
            statusText: info.statusText,
            progress: info.progress,
            daysRemaining: info.daysRemaining,
            regrows: info.regrows,
            wateredCount: crop.isWatered ? 1 : 0,
            count: 1,
            crops: [
              {
                cropKey: info.key,
                name: info.name,
                icon: info.icon,
                count: 1,
                sellPrice: info.sellPrice,
              },
            ],
          })
        }
      })

      return {
        locationKey,
        locationName: t("crops.locations." + locationKey, { defaultValue: locationKey }),
        totalCount: crops.length,
        wateredCount: crops.filter((crop) => crop.isWatered).length,
        matureCount: crops.filter((crop) => crop.fullyGrown).length,
        deadCount: crops.filter((crop) => crop.dead).length,
        cropTotals: Array.from(cropTotals.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
        statusGroups: Array.from(statusGroups.values())
          .map((group) => ({
            ...group,
            crops: [...group.crops].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
          }))
          .sort((a, b) => {
            const priority = { dead: 0, ready: 1, growing: 2 }
            return (
              priority[a.statusType] - priority[b.statusType] ||
              a.daysRemaining - b.daysRemaining ||
              b.count - a.count
            )
          }),
      }
    })
  }, [cropLookup, plantedCrops, t])

  const locationFilters = useMemo(
    () => [
      { key: "all", label: t("crops.filterAll") },
      ...locationSections.map((section) => ({
        key: section.locationKey,
        label: section.locationName,
      })),
    ],
    [locationSections]
  )

  const allLocationsSummary = useMemo(() => {
    if (locationSections.length === 0) return null

    const totalCount = locationSections.reduce((sum, s) => sum + s.totalCount, 0)
    const wateredCount = locationSections.reduce((sum, s) => sum + s.wateredCount, 0)
    const matureCount = locationSections.reduce((sum, s) => sum + s.matureCount, 0)
    const deadCount = locationSections.reduce((sum, s) => sum + s.deadCount, 0)

    const cropTotalsMap = new Map<string, CropSummary>()
    locationSections.forEach((section) => {
      section.cropTotals.forEach((crop) => {
        const existing = cropTotalsMap.get(crop.cropKey)
        if (existing) {
          existing.count += crop.count
        } else {
          cropTotalsMap.set(crop.cropKey, { ...crop })
        }
      })
    })

    const statusGroupsMap = new Map<string, StatusGroup>()
    locationSections.forEach((section) => {
      section.statusGroups.forEach((group) => {
        const existing = statusGroupsMap.get(group.key)
        if (existing) {
          existing.count += group.count
          existing.wateredCount += group.wateredCount
          group.crops.forEach((crop) => {
            const existingCrop = existing.crops.find((c) => c.cropKey === crop.cropKey)
            if (existingCrop) {
              existingCrop.count += crop.count
            } else {
              existing.crops.push({ ...crop })
            }
          })
        } else {
          statusGroupsMap.set(group.key, {
            ...group,
            crops: group.crops.map((c) => ({ ...c })),
          })
        }
      })
    })

    return {
      locationKey: "all",
      locationName: t("crops.allLocations"),
      totalCount,
      wateredCount,
      matureCount,
      deadCount,
      cropTotals: Array.from(cropTotalsMap.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      statusGroups: Array.from(statusGroupsMap.values())
        .map((group) => ({
          ...group,
          crops: [...group.crops].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
        }))
        .sort((a, b) => {
          const priority = { dead: 0, ready: 1, growing: 2 }
          return (
            priority[a.statusType] - priority[b.statusType] ||
            a.daysRemaining - b.daysRemaining ||
            b.count - a.count
          )
        }),
    }
  }, [locationSections, t])

  const visibleSections = useMemo(() => {
    if (activeLocation === "all") {
      return allLocationsSummary ? [allLocationsSummary] : []
    }
    return locationSections.filter((section) => section.locationKey === activeLocation)
  }, [activeLocation, allLocationsSummary, locationSections])

  if (!selectedSaveId) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Sprout className="mb-4 h-12 w-12 text-muted-foreground/40" />
          <p className="text-lg font-semibold">{t("crops.saveNotSelected")}</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            {t("crops.saveNotSelectedDesc")}
          </p>
        </CardContent>
      </Card>
    )
  }

  if (loadingCrops) {
    return (
      <div className="flex flex-col items-center justify-center space-y-2 py-20">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">{t("crops.loadingPlantedCrops")}</p>
      </div>
    )
  }

  if (plantedCrops.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Sprout className="mb-4 h-12 w-12 text-muted-foreground/40" />
          <p className="text-lg font-semibold">{t("crops.noCropsPlanted")}</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            {t("crops.noCropsPlantedDesc")}
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-8">
      <Card>
        <CardContent className="flex flex-wrap gap-2 p-4">
          {locationFilters.map((filter) => (
            <Button
              key={filter.key}
              variant={activeLocation === filter.key ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveLocation(filter.key)}
            >
              {filter.label}
            </Button>
          ))}
        </CardContent>
      </Card>

      {visibleSections.map((section) => (
        <section key={section.locationKey} className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-2">
            <div className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-primary" />
              <h3 className="text-lg font-bold">{section.locationName}</h3>
              <Badge variant="secondary" className="ml-1 text-xs font-semibold">
                {t("crops.totalCountBadge", { count: section.totalCount })}
              </Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="border-blue-500/20 bg-blue-500/5 font-medium text-blue-500">
                {t("crops.wateredCountBadge", { watered: section.wateredCount, total: section.totalCount })}
              </Badge>
              {section.matureCount > 0 && (
                <Badge variant="outline" className="border-green-500/20 bg-green-500/5 font-medium text-green-600">
                  {t("crops.matureCountBadge", { count: section.matureCount })}
                </Badge>
              )}
              {section.deadCount > 0 && (
                <Badge variant="outline" className="border-red-500/20 bg-red-500/5 font-medium text-red-500">
                  {t("crops.deadCountBadge", { count: section.deadCount })}
                </Badge>
              )}
            </div>
          </div>

          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-base">{t("crops.locationSummaryTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {section.cropTotals.map((crop) => (
                  <div
                    key={`${section.locationKey}-${crop.cropKey}`}
                    className="flex items-center justify-between rounded-lg border px-4 py-3"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      {crop.icon ? (
                        <img
                          src={crop.icon}
                          alt=""
                          className="h-5 w-5 shrink-0 object-contain"
                          style={{ imageRendering: "pixelated" }}
                        />
                      ) : (
                        <Sprout className="h-4 w-4 shrink-0 text-emerald-500" />
                      )}
                      <span className="truncate text-sm font-medium">{crop.name}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground">{t("crops.plantCount", { count: crop.count })}</span>
                      {crop.sellPrice > 0 && (
                        <span className="flex items-center gap-1">
                          <Coins className="h-3.5 w-3.5" />
                          {crop.sellPrice}g
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="space-y-3">
            {section.statusGroups.map((group) => {
              const styles = getStatusStyles(group.statusType)

              return (
                <Card key={group.key} className={styles.panelClassName}>
                  <CardContent className="space-y-4 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className={styles.badgeClassName}>
                            {group.statusText}
                          </Badge>
                          <Badge variant="secondary" className="text-xs font-semibold">
                            {t("crops.plantCount", { count: group.count })}
                          </Badge>
                          {group.regrows && (
                            <Badge variant="outline" className="border-indigo-400/20 text-indigo-500">
                              {t("crops.regrowable")}
                            </Badge>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Waves className="h-3.5 w-3.5" />
                            {t("crops.wateredCountBadge", { watered: group.wateredCount, total: group.count })}
                          </span>
                          {group.statusType === "ready" && <span className={styles.textClassName}>{t("crops.matureHint")}</span>}
                          {group.statusType === "dead" && (
                            <span className={cn("flex items-center gap-1", styles.textClassName)}>
                              <Flame className="h-3.5 w-3.5" />
                              {t("crops.deadHint")}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="w-full max-w-48">
                        <div className="mb-1 flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">{t("crops.progressLabel")}</span>
                          <span className={cn("font-medium", styles.textClassName)}>{group.progress}%</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-muted">
                          <div className={cn("h-full rounded-full transition-all", styles.progressClassName)} style={{ width: `${group.progress}%` }} />
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {group.crops.map((crop) => (
                        <div
                          key={`${group.key}-${crop.cropKey}`}
                          className="flex items-center gap-2 rounded-md border bg-background/80 px-3 py-2 text-sm"
                        >
                          {crop.icon ? (
                            <img
                              src={crop.icon}
                              alt=""
                              className="h-4 w-4 shrink-0 object-contain"
                              style={{ imageRendering: "pixelated" }}
                            />
                          ) : (
                            <Sprout className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                          )}
                          <span>{crop.name}</span>
                          <span className="font-semibold text-muted-foreground">x{crop.count}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
