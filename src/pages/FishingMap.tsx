import type { PointerEvent as ReactPointerEvent, PointerEventHandler, WheelEventHandler } from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import {
  Fish,
  Gauge,
  Layers,
  Loader2,
  Map as MapIcon,
  Minus,
  Package,
  RefreshCw,
  RotateCcw,
  Search,
  Plus,
  Waves,
} from "lucide-react"

interface FishingTile {
  x: number
  y: number
  depth: number
  hidden: boolean
}

interface FishingMapSummary {
  id: string
  name: string
  relativePath: string
  width: number
  height: number
  waterTiles: number
  fishableTiles: number
  maxDepth: number
}

interface FishingMapDetail extends FishingMapSummary {
  tiles: FishingTile[]
  fishingAreas: FishingArea[]
  mapImageDataUrl?: string | null
  mapImageError?: string | null
  cached: boolean
}

interface FishingMapData {
  maps: FishingMapSummary[]
  cached: boolean
}

interface FishingAreaFish {
  id: string
  name: string
  description: string
  icon?: string | null
}

interface FishingArea {
  id: string
  name: string
  x?: number | null
  y?: number | null
  width?: number | null
  height?: number | null
  fish: FishingAreaFish[]
}

interface TileRun {
  x: number
  y: number
  width: number
  depth: number
  hidden: boolean
}

interface HoveredFishingInfo {
  tile: FishingTile
  area: FishingArea | null
  x: number
  y: number
}

const depthColors = ["#38bdf8", "#22c55e", "#facc15", "#fb923c", "#ef4444", "#a855f7"]

function formatCount(value: number) {
  return value.toLocaleString("zh-CN")
}

function tileColor(depth: number) {
  return depthColors[Math.max(0, Math.min(depth, depthColors.length - 1))]
}

export function FishingMap() {
  const { t, i18n } = useTranslation()
  const activeLang = i18n.resolvedLanguage || i18n.language || "zh"

  const getMapDisplayName = useCallback(
    (map: FishingMapSummary) => {
      const keys = [`maps.${map.id}`, `fishingMap.locations.${map.id}`]
      for (const key of keys) {
        if (i18n.exists(key, { lng: i18n.language })) {
          return t(key, { lng: i18n.language })
        }
      }
      return map.name
    },
    [i18n, i18n.language, t]
  )

  const viewportRef = useRef<HTMLDivElement | null>(null)
  const dragStateRef = useRef<{ pointerId: number; x: number; y: number } | null>(null)
  const [data, setData] = useState<FishingMapData>({ maps: [], cached: false })
  const [selectedMap, setSelectedMap] = useState<FishingMapDetail | null>(null)
  const [selectedId, setSelectedId] = useState("")
  const [searchTerm, setSearchTerm] = useState("")
  const [minDepth, setMinDepth] = useState(0)
  const [showHidden, setShowHidden] = useState(true)
  const [showFishingOverlay, setShowFishingOverlay] = useState(true)
  const [loading, setLoading] = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 })
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [hoveredFishingInfo, setHoveredFishingInfo] = useState<HoveredFishingInfo | null>(null)

  const loadMaps = async (forceRefresh = false) => {
    setLoading(true)
    setError(null)
    setDetailError(null)

    const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__
    if (!isTauri) {
      setData({ maps: [], cached: false })
      setError(t("fishingMap.webPreviewError"))
      setLoading(false)
      return
    }

    try {
      const { invoke } = await import("@tauri-apps/api/core")
      const gameDir = localStorage.getItem("stardewGameDirectory") || ""
      const result: FishingMapData = await invoke("get_fishing_map_data", {
        gameDir: gameDir.trim() || undefined,
        forceRefresh,
        lang: activeLang,
      })
      setData(result)
      setSelectedMap(null)
      setSelectedId((current) => {
        if (current && result.maps.some((map) => map.id === current)) {
          return current
        }
        return result.maps[0]?.id || ""
      })
    } catch (err) {
      console.error("get_fishing_map_data failed:", err)
      setData({ maps: [], cached: false })
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadMaps()
  }, [])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (!rect) return
      setViewportSize({ width: rect.width, height: rect.height })
    })

    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!selectedId) {
      setSelectedMap(null)
      return
    }

    let canceled = false

    async function loadDetail() {
      setLoadingDetail(true)
      setDetailError(null)
      const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__
      if (!isTauri) {
        setLoadingDetail(false)
        return
      }

      try {
        const { invoke } = await import("@tauri-apps/api/core")
        const gameDir = localStorage.getItem("stardewGameDirectory") || ""
        const detail: FishingMapDetail = await invoke("get_fishing_map_detail", {
          gameDir: gameDir.trim() || undefined,
          mapId: selectedId,
          forceRefresh: false,
          lang: activeLang,
        })
        if (!canceled) {
          setSelectedMap(detail)
        }
      } catch (err) {
        console.error("get_fishing_map_detail failed:", err)
        if (!canceled) {
          setSelectedMap(null)
          setDetailError(String(err))
        }
      } finally {
        if (!canceled) {
          setLoadingDetail(false)
        }
      }
    }

    loadDetail()

    return () => {
      canceled = true
    }
  }, [selectedId, activeLang])

  const filteredMaps = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    if (!term) return data.maps
    return data.maps.filter((map) => {
      const displayName = getMapDisplayName(map).toLowerCase()
      return (
        displayName.includes(term) ||
        map.name.toLowerCase().includes(term) ||
        map.id.toLowerCase().includes(term) ||
        map.relativePath.toLowerCase().includes(term)
      )
    })
  }, [data.maps, searchTerm, getMapDisplayName])

  const selectedSummary = useMemo(() => {
    return data.maps.find((map) => map.id === selectedId) || filteredMaps[0] || data.maps[0] || null
  }, [data.maps, filteredMaps, selectedId])

  useEffect(() => {
    if (!selectedId && filteredMaps[0]) {
      setSelectedId(filteredMaps[0].id)
      return
    }

    if (selectedId && filteredMaps.length > 0 && !filteredMaps.some((map) => map.id === selectedId)) {
      setSelectedId(filteredMaps[0].id)
    }
  }, [filteredMaps, selectedId])

  useEffect(() => {
    setZoom(1)
    setOffset({ x: 0, y: 0 })
    dragStateRef.current = null
    setIsDragging(false)
    setHoveredFishingInfo(null)
  }, [selectedId])

  useEffect(() => {
    setHoveredFishingInfo(null)
  }, [minDepth, showHidden, showFishingOverlay])

  const visibleTiles = useMemo(() => {
    if (!selectedMap) return []
    return selectedMap.tiles.filter((tile) => {
      if (tile.depth < minDepth) return false
      if (!showHidden && tile.hidden) return false
      return true
    })
  }, [selectedMap, minDepth, showHidden])

  const visibleRuns = useMemo(() => {
    if (!selectedMap) return []
    const sorted = [...visibleTiles].sort((a, b) => a.y - b.y || a.x - b.x)
    const runs: TileRun[] = []

    for (const tile of sorted) {
      const previous = runs[runs.length - 1]
      if (
        previous &&
        previous.y === tile.y &&
        previous.x + previous.width === tile.x &&
        previous.depth === tile.depth &&
        previous.hidden === tile.hidden
      ) {
        previous.width += 1
      } else {
        runs.push({
          x: tile.x,
          y: tile.y,
          width: 1,
          depth: tile.depth,
          hidden: tile.hidden,
        })
      }
    }

    return runs
  }, [selectedMap, visibleTiles])

  const visibleTileLookup = useMemo(() => {
    const lookup = new globalThis.Map<string, FishingTile>()
    for (const tile of visibleTiles) {
      lookup.set(`${tile.x}:${tile.y}`, tile)
    }
    return lookup
  }, [visibleTiles])

  const depthSummary = useMemo(() => {
    const counts = new globalThis.Map<number, number>()
    for (const tile of selectedMap?.tiles || []) {
      counts.set(tile.depth, (counts.get(tile.depth) || 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => a[0] - b[0])
  }, [selectedMap])

  const totalFishable = data.maps.reduce((sum, map) => sum + map.fishableTiles, 0)
  const maxDepth = selectedSummary?.maxDepth ?? selectedMap?.maxDepth ?? 0
  const visibleFishableCount = selectedMap ? visibleTiles.length : selectedSummary?.fishableTiles || 0
  const sceneSize = useMemo(() => {
    if (!selectedMap || viewportSize.width <= 0 || viewportSize.height <= 0) {
      return { width: 0, height: 0 }
    }

    const availableWidth = Math.max(0, viewportSize.width - 80)
    const availableHeight = Math.max(0, viewportSize.height - 80)
    const widthRatio = availableWidth / selectedMap.width
    const heightRatio = availableHeight / selectedMap.height
    const fitScale = Math.min(widthRatio, heightRatio)

    return {
      width: Math.max(240, selectedMap.width * fitScale),
      height: Math.max(180, selectedMap.height * fitScale),
    }
  }, [selectedMap, viewportSize])

  const clampZoom = (value: number) => Math.max(0.6, value)

  const resolveFishingArea = (tileX: number, tileY: number) => {
    if (!selectedMap) return null

    let fallback: FishingArea | null = null
    for (const area of selectedMap.fishingAreas) {
      const hasRect =
        area.x !== null &&
        area.x !== undefined &&
        area.y !== null &&
        area.y !== undefined &&
        area.width !== null &&
        area.width !== undefined &&
        area.height !== null &&
        area.height !== undefined

      if (!hasRect) {
        fallback ||= area
        continue
      }

      if (
        tileX >= area.x! &&
        tileY >= area.y! &&
        tileX < area.x! + area.width! &&
        tileY < area.y! + area.height!
      ) {
        return area
      }
    }

    return fallback
  }

  const updateHoveredFishingInfo = (clientX: number, clientY: number) => {
    const viewport = viewportRef.current
    if (!viewport || !selectedMap || sceneSize.width <= 0 || sceneSize.height <= 0) {
      setHoveredFishingInfo(null)
      return
    }

    const rect = viewport.getBoundingClientRect()
    const sceneLeft = rect.left + rect.width / 2 - (sceneSize.width * zoom) / 2 + offset.x
    const sceneTop = rect.top + rect.height / 2 - (sceneSize.height * zoom) / 2 + offset.y
    const localX = (clientX - sceneLeft) / zoom
    const localY = (clientY - sceneTop) / zoom

    if (localX < 0 || localY < 0 || localX >= sceneSize.width || localY >= sceneSize.height) {
      setHoveredFishingInfo(null)
      return
    }

    const tileX = Math.floor((localX / sceneSize.width) * selectedMap.width)
    const tileY = Math.floor((localY / sceneSize.height) * selectedMap.height)
    const tile = visibleTileLookup.get(`${tileX}:${tileY}`)
    if (!tile) {
      setHoveredFishingInfo(null)
      return
    }

    setHoveredFishingInfo({
      tile,
      area: resolveFishingArea(tileX, tileY),
      x: clientX - rect.left,
      y: clientY - rect.top,
    })
  }

  const zoomAtPoint = (nextZoom: number, clientX?: number, clientY?: number) => {
    const viewport = viewportRef.current
    if (!viewport) {
      setZoom(clampZoom(nextZoom))
      setHoveredFishingInfo(null)
      return
    }

    const clamped = clampZoom(nextZoom)
    const rect = viewport.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2
    const anchorX = clientX ?? centerX
    const anchorY = clientY ?? centerY
    const pointerX = anchorX - centerX
    const pointerY = anchorY - centerY

    setOffset((current) => {
      const worldX = (pointerX - current.x) / zoom
      const worldY = (pointerY - current.y) / zoom
      return {
        x: pointerX - worldX * clamped,
        y: pointerY - worldY * clamped,
      }
    })
    setZoom(clamped)
    setHoveredFishingInfo(null)
  }

  const handleWheel: WheelEventHandler<HTMLDivElement> = (event) => {
    event.preventDefault()
    const factor = event.deltaY < 0 ? 1.12 : 0.9
    zoomAtPoint(zoom * factor, event.clientX, event.clientY)
  }

  const handlePointerDown: PointerEventHandler<HTMLDivElement> = (event) => {
    if (event.button !== 0) return
    event.preventDefault()
    dragStateRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
    event.currentTarget.setPointerCapture(event.pointerId)
    setIsDragging(true)
    setHoveredFishingInfo(null)
  }

  const handlePointerMove: PointerEventHandler<HTMLDivElement> = (event) => {
    const dragState = dragStateRef.current
    if (dragState && dragState.pointerId === event.pointerId) {
      event.preventDefault()

      const deltaX = event.clientX - dragState.x
      const deltaY = event.clientY - dragState.y
      dragStateRef.current = { ...dragState, x: event.clientX, y: event.clientY }

      setOffset((current) => ({
        x: current.x + deltaX,
        y: current.y + deltaY,
      }))
      setHoveredFishingInfo(null)
      return
    }

    updateHoveredFishingInfo(event.clientX, event.clientY)
  }

  const endDrag = (event?: ReactPointerEvent<HTMLDivElement>) => {
    if (event && dragStateRef.current && event.currentTarget.hasPointerCapture(dragStateRef.current.pointerId)) {
      event.currentTarget.releasePointerCapture(dragStateRef.current.pointerId)
    }
    dragStateRef.current = null
    setIsDragging(false)
    if (event) {
      updateHoveredFishingInfo(event.clientX, event.clientY)
    }
  }

  return (
    <section className="relative h-full min-h-[720px] overflow-hidden select-none bg-background text-foreground">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,color-mix(in_oklab,var(--primary)_10%,transparent)_0%,transparent_58%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,color-mix(in_oklab,var(--background)_78%,transparent)_0%,var(--background)_100%)]" />

      <div className="absolute left-4 right-4 top-4 z-20">
        <div className="rounded-lg border border-border/70 bg-background/82 px-3 py-3 shadow-2xl backdrop-blur-xl">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 flex-1 flex-col gap-3 lg:flex-row lg:items-center">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/12 text-primary">
                  <MapIcon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-base font-semibold">{t("fishingMap.title")}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {loading
                      ? t("fishingMap.loadingMaps")
                      : `${t("fishingMap.mapsCount", { count: formatCount(data.maps.length) })} · ${t("fishingMap.fishableTilesCount", { count: formatCount(totalFishable) })}`}
                  </div>
                </div>
              </div>

              <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_220px_132px]">
                <div className="relative min-w-0">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.currentTarget.value)}
                    placeholder={t("fishingMap.searchPlaceholder")}
                    className="h-10 border-border/70 bg-background/80 pl-9 placeholder:text-muted-foreground"
                  />
                </div>

                <select
                  value={selectedId}
                  onChange={(event) => setSelectedId(event.currentTarget.value)}
                  className="h-10 min-w-0 rounded-md border border-border/70 bg-background/80 px-3 text-sm text-foreground outline-none"
                >
                  {filteredMaps.length === 0 ? (
                    <option value="">{t("fishingMap.noMatchingMaps")}</option>
                  ) : (
                    filteredMaps.map((map) => (
                      <option key={map.id} value={map.id}>
                        {getMapDisplayName(map)}
                      </option>
                    ))
                  )}
                </select>

                <select
                  value={minDepth}
                  onChange={(event) => setMinDepth(Number(event.currentTarget.value))}
                  className="h-10 rounded-md border border-border/70 bg-background/80 px-3 text-sm text-foreground outline-none"
                >
                  {Array.from({ length: Math.max(1, maxDepth + 1) }, (_, depth) => (
                    <option key={depth} value={depth}>
                      {t("fishingMap.depthFilter", { depth })}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 rounded-md border border-border/70 bg-background/80 p-1">
                <Button
                  variant="ghost"
                  size="icon"
                  type="button"
                  onClick={() => zoomAtPoint(zoom / 1.12)}
                  className="h-8 w-8 text-foreground hover:bg-accent hover:text-accent-foreground"
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <div className="min-w-12 text-center text-xs font-medium text-muted-foreground">
                  {Math.round(zoom * 100)}%
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  type="button"
                  onClick={() => zoomAtPoint(zoom * 1.12)}
                  className="h-8 w-8 text-foreground hover:bg-accent hover:text-accent-foreground"
                >
                  <Plus className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  type="button"
                  onClick={() => {
                    setZoom(1)
                    setOffset({ x: 0, y: 0 })
                  }}
                  className="h-8 w-8 text-foreground hover:bg-accent hover:text-accent-foreground"
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
              </div>
              <label className="flex h-10 items-center gap-2 rounded-md border border-border/70 bg-background/80 px-3 text-sm text-foreground">
                <Checkbox checked={showFishingOverlay} onCheckedChange={(value) => setShowFishingOverlay(Boolean(value))} className="border-border data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground" />
                <Layers className="h-4 w-4 text-primary" />
                {t("fishingMap.overlay")}
              </label>
              <label className="flex h-10 items-center gap-2 rounded-md border border-border/70 bg-background/80 px-3 text-sm text-foreground">
                <Checkbox checked={showHidden} onCheckedChange={(value) => setShowHidden(Boolean(value))} className="border-border data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground" />
                {t("fishingMap.hiddenWater")}
              </label>
              <Button
                variant="outline"
                size="sm"
                onClick={() => loadMaps(true)}
                disabled={loading}
                className="h-10 border-border/70 bg-background/80 px-3"
              >
                {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                {t("fishingMap.refresh")}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute inset-0 flex items-center justify-center px-4 pb-4 pt-28">
        <div className="relative h-full w-full overflow-hidden rounded-lg border border-border/70 bg-card shadow-2xl">
          <div
            ref={viewportRef}
            className={cn(
              "absolute inset-0 overflow-hidden touch-none select-none",
              isDragging ? "cursor-grabbing" : "cursor-grab"
            )}
            onWheel={handleWheel}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onPointerLeave={(event) => {
              if (dragStateRef.current?.pointerId === event.pointerId) {
                endDrag(event)
                return
              }
              setHoveredFishingInfo(null)
            }}
          >
            {selectedMap && sceneSize.width > 0 && sceneSize.height > 0 && (
              <div
                className="absolute left-1/2 top-1/2"
                style={{
                  width: `${sceneSize.width}px`,
                  height: `${sceneSize.height}px`,
                  transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) scale(${zoom})`,
                  transformOrigin: "center center",
                }}
              >
                {selectedMap.mapImageDataUrl ? (
                  <img
                    src={selectedMap.mapImageDataUrl}
                    alt=""
                    className="absolute inset-0 h-full w-full object-fill [image-rendering:pixelated]"
                    draggable={false}
                    onDragStart={(event) => event.preventDefault()}
                  />
                ) : (
                  <svg
                    className="absolute inset-0 h-full w-full"
                    viewBox={`0 0 ${selectedMap.width} ${selectedMap.height}`}
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    <defs>
                      <pattern id="fishing-map-grid" width="8" height="8" patternUnits="userSpaceOnUse">
                        <path d="M 8 0 L 0 0 0 8" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="0.4" />
                      </pattern>
                    </defs>
                    <rect width={selectedMap.width} height={selectedMap.height} fill="color-mix(in oklab, var(--card) 82%, black)" />
                    <rect width={selectedMap.width} height={selectedMap.height} fill="url(#fishing-map-grid)" />
                  </svg>
                )}

                {showFishingOverlay && (
                  <svg
                    className="absolute inset-0 h-full w-full"
                    viewBox={`0 0 ${selectedMap.width} ${selectedMap.height}`}
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    {visibleRuns.map((tile) => (
                      <rect
                        key={`${tile.x}:${tile.y}:${tile.width}:${tile.depth}:${tile.hidden}`}
                        x={tile.x}
                        y={tile.y}
                        width={tile.width}
                        height="1"
                        fill={tileColor(tile.depth)}
                        opacity={tile.hidden ? 0.26 : 0.46}
                      >
                        <title>
                          {tile.hidden
                            ? t("fishingMap.svgTileTitleHidden", { x: tile.x, y: tile.y, depth: tile.depth })
                            : t("fishingMap.svgTileTitle", { x: tile.x, y: tile.y, depth: tile.depth })}
                        </title>
                      </rect>
                    ))}
                  </svg>
                )}
              </div>
            )}

            {hoveredFishingInfo && !isDragging && (
              <div
                className="pointer-events-none absolute z-20 w-[min(380px,calc(100%-24px))] rounded-lg border border-border/70 bg-background/94 px-3 py-3 shadow-2xl backdrop-blur-xl"
                style={{
                  left: `${Math.min(hoveredFishingInfo.x + 18, Math.max(12, viewportSize.width - 392))}px`,
                  top: `${Math.min(hoveredFishingInfo.y + 18, Math.max(12, viewportSize.height - 320))}px`,
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">
                      {hoveredFishingInfo.area?.name || t("fishingMap.currentWaterArea")}
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {hoveredFishingInfo.tile.hidden
                        ? t("fishingMap.tileCoordDepthHidden", { x: hoveredFishingInfo.tile.x, y: hoveredFishingInfo.tile.y, depth: hoveredFishingInfo.tile.depth })
                        : t("fishingMap.tileCoordDepth", { x: hoveredFishingInfo.tile.x, y: hoveredFishingInfo.tile.y, depth: hoveredFishingInfo.tile.depth })}
                    </div>
                  </div>
                  <Badge variant="secondary" className="shrink-0 border border-border/60 bg-secondary/80 text-secondary-foreground">
                    {t("fishingMap.fishCount", { count: hoveredFishingInfo.area?.fish.length || 0 })}
                  </Badge>
                </div>

                {hoveredFishingInfo.area?.fish.length ? (
                  <div className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
                    {hoveredFishingInfo.area.fish.map((fish) => (
                      <div
                        key={fish.id}
                        className="rounded-md border border-border/60 bg-card/80 px-2.5 py-2"
                      >
                        <div className="flex items-start gap-2.5">
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border bg-accent/30">
                            {fish.icon ? (
                              <img
                                src={fish.icon}
                                alt=""
                                className="h-8 w-8 object-contain"
                                style={{ imageRendering: "pixelated" }}
                              />
                            ) : (
                              <Package className="h-4 w-4 text-muted-foreground" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-foreground">{fish.name}</div>
                            <div className="mt-1 line-clamp-2 text-[11px] leading-5 text-muted-foreground">
                              {fish.description}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-3 text-xs text-muted-foreground">{t("fishingMap.noFishData")}</div>
                )}
              </div>
            )}
          </div>

          {(loadingDetail || loading) && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/45 backdrop-blur-[2px]">
              <div className="flex items-center gap-3 rounded-md border border-border/70 bg-popover/92 px-4 py-3 text-sm text-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("fishingMap.loadingMap")}
              </div>
            </div>
          )}

          {!loading && !selectedMap && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="rounded-md border border-border/70 bg-popover/92 px-4 py-3 text-sm text-muted-foreground">
                {t("fishingMap.noMapToDisplay")}
              </div>
            </div>
          )}

          <div className="pointer-events-none absolute inset-x-4 bottom-4 z-10 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
            <div className="pointer-events-auto max-w-[min(540px,100%)] rounded-lg border border-border/70 bg-background/86 px-4 py-3 shadow-xl backdrop-blur-xl">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-lg font-semibold">
                    {selectedSummary ? getMapDisplayName(selectedSummary) : t("fishingMap.noMapSelected")}
                  </div>
                  {selectedSummary && (
                    <div className="mt-1 truncate text-xs text-muted-foreground">
                      {selectedSummary.relativePath}
                    </div>
                  )}
                </div>
                <Badge variant="secondary" className="border border-border/60 bg-secondary/80 text-secondary-foreground">
                  {selectedSummary ? `${selectedSummary.width} x ${selectedSummary.height}` : t("fishingMap.noSize")}
                </Badge>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2">
                <div className="rounded-md border border-border/60 bg-card/70 px-3 py-2">
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <Waves className="h-3.5 w-3.5 text-primary" />
                    {t("fishingMap.waterTiles")}
                  </div>
                  <div className="mt-1 text-lg font-semibold">{formatCount(selectedSummary?.waterTiles || 0)}</div>
                </div>
                <div className="rounded-md border border-border/60 bg-card/70 px-3 py-2">
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <Fish className="h-3.5 w-3.5 text-primary" />
                    {t("fishingMap.fishableTiles")}
                  </div>
                  <div className="mt-1 text-lg font-semibold">{formatCount(visibleFishableCount)}</div>
                </div>
                <div className="rounded-md border border-border/60 bg-card/70 px-3 py-2">
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <Gauge className="h-3.5 w-3.5 text-primary" />
                    {t("fishingMap.maxDepth")}
                  </div>
                  <div className="mt-1 text-lg font-semibold">{maxDepth}</div>
                </div>
              </div>
            </div>

            {depthSummary.length > 0 && (
              <div className="pointer-events-auto max-w-full rounded-lg border border-border/70 bg-background/86 px-3 py-3 shadow-xl backdrop-blur-xl">
                <div className="mb-2 text-xs text-muted-foreground">{t("fishingMap.depthLegend")}</div>
                <div className="flex max-w-full flex-wrap gap-2">
                  {depthSummary.map(([depth, count]) => (
                    <Badge
                      key={depth}
                      variant="outline"
                      className={cn(
                        "gap-1.5 border-border/70 bg-card/70 text-foreground",
                        minDepth === depth && "border-primary/60 bg-primary/10"
                      )}
                    >
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: tileColor(depth) }} />
                      {depth}: {formatCount(count)}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>

          {(error || detailError || selectedMap?.mapImageError) && (
            <div className="absolute left-4 right-4 top-4 z-10 space-y-2">
              {error && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-200">
                  {error}
                </div>
              )}
              {detailError && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-200">
                  {detailError}
                </div>
              )}
              {selectedMap?.mapImageError && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-200">
                  {t("fishingMap.mapImageError", { error: selectedMap.mapImageError })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
