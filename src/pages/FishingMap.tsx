import { useEffect, useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import {
  Fish,
  Gauge,
  Layers,
  Loader2,
  Map as MapIcon,
  RefreshCw,
  Search,
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
  mapImageDataUrl?: string | null
  mapImageError?: string | null
  cached: boolean
}

interface FishingMapData {
  maps: FishingMapSummary[]
  cached: boolean
}

interface TileRun {
  x: number
  y: number
  width: number
  depth: number
  hidden: boolean
}

const depthColors = [
  "#38bdf8",
  "#22c55e",
  "#eab308",
  "#f97316",
  "#ef4444",
  "#a855f7",
]

function formatCount(value: number) {
  return value.toLocaleString("zh-CN")
}

function tileColor(depth: number) {
  return depthColors[Math.max(0, Math.min(depth, depthColors.length - 1))]
}

export function FishingMap() {
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

  const loadMaps = async (forceRefresh = false) => {
    setLoading(true)
    setError(null)
    setDetailError(null)

    const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__
    if (!isTauri) {
      setData({ maps: [], cached: false })
      setError("当前 Web 预览无法读取本地游戏地图，请在桌面应用中打开。")
      setLoading(false)
      return
    }

    try {
      const { invoke } = await import("@tauri-apps/api/core")
      const gameDir = localStorage.getItem("stardewGameDirectory") || ""
      const result: FishingMapData = await invoke("get_fishing_map_data", {
        gameDir: gameDir.trim() || undefined,
        forceRefresh,
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
  }, [selectedId])

  const filteredMaps = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    if (!term) return data.maps
    return data.maps.filter((map) => {
      return (
        map.name.toLowerCase().includes(term) ||
        map.id.toLowerCase().includes(term) ||
        map.relativePath.toLowerCase().includes(term)
      )
    })
  }, [data.maps, searchTerm])

  const selectedSummary = useMemo(() => {
    return data.maps.find((map) => map.id === selectedId) || data.maps[0] || null
  }, [data.maps, selectedId])

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

  return (
    <div className="p-8 space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">钓鱼地图</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {loading ? "正在解析地图..." : `${formatCount(data.maps.length)} 张地图 · ${formatCount(totalFishable)} 个可钓鱼格`}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => loadMaps(true)} disabled={loading}>
          {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          重新解析
        </Button>
      </div>

      {error && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="py-4 text-sm text-amber-700 dark:text-amber-200">
            {error}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[340px_minmax(0,1fr)] gap-6">
        <Card className="xl:sticky xl:top-8 xl:self-start">
          <CardHeader className="pb-4">
            <CardTitle className="text-base flex items-center gap-2">
              <MapIcon className="h-4 w-4 text-primary" />
              地图
            </CardTitle>
            <div className="relative pt-2">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.currentTarget.value)}
                placeholder="搜索地图"
                className="pl-9"
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-2 max-h-[calc(100vh-260px)] overflow-y-auto pr-3">
            {loading ? (
              <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                解析中
              </div>
            ) : filteredMaps.length === 0 ? (
              <div className="py-8 text-sm text-muted-foreground">没有匹配的地图</div>
            ) : (
              filteredMaps.map((map) => (
                <button
                  key={map.id}
                  type="button"
                  onClick={() => setSelectedId(map.id)}
                  className={cn(
                    "w-full rounded-md border px-3 py-2 text-left transition-colors",
                    selectedSummary?.id === map.id
                      ? "border-primary/50 bg-primary/10"
                      : "border-border hover:bg-accent/50"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-semibold">{map.name}</span>
                    <Badge variant="secondary" className="shrink-0 text-[10px]">
                      {formatCount(map.fishableTiles)}
                    </Badge>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                    <span className="truncate">{map.id}</span>
                    <span className="shrink-0">{map.width}x{map.height}</span>
                  </div>
                </button>
              ))
            )}
          </CardContent>
        </Card>

        <div className="space-y-6 min-w-0">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                  <Waves className="h-4 w-4 text-sky-500" />
                  水域格
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatCount(selectedSummary?.waterTiles || 0)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                  <Fish className="h-4 w-4 text-emerald-500" />
                  可钓鱼格
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {loadingDetail ? "..." : formatCount(visibleFishableCount)}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                  <Gauge className="h-4 w-4 text-orange-500" />
                  最深距离
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{maxDepth}</div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="gap-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <CardTitle className="text-xl truncate">
                    {selectedSummary?.name || "未选择地图"}
                  </CardTitle>
                  {selectedSummary && (
                    <p className="text-xs text-muted-foreground mt-1 truncate">
                      {selectedSummary.relativePath}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={minDepth}
                    onChange={(event) => setMinDepth(Number(event.currentTarget.value))}
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    {Array.from({ length: Math.max(1, maxDepth + 1) }, (_, depth) => (
                      <option key={depth} value={depth}>
                        {`深度 >= ${depth}`}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant={showFishingOverlay ? "default" : "outline"}
                    size="sm"
                    onClick={() => setShowFishingOverlay((value) => !value)}
                  >
                    <Layers className="h-4 w-4" />
                    钓点叠层
                  </Button>
                  <Button
                    type="button"
                    variant={showHidden ? "default" : "outline"}
                    size="sm"
                    onClick={() => setShowHidden((value) => !value)}
                  >
                    {showHidden ? "包含隐藏水域" : "排除隐藏水域"}
                  </Button>
                </div>
              </div>
              {depthSummary.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {depthSummary.map(([depth, count]) => (
                    <Badge key={depth} variant="outline" className="gap-1.5">
                      <span
                        className="h-2.5 w-2.5 rounded-sm"
                        style={{ backgroundColor: tileColor(depth) }}
                      />
                      {depth}: {formatCount(count)}
                    </Badge>
                  ))}
                </div>
              )}
            </CardHeader>
            <CardContent>
              {detailError && (
                <div className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-700 dark:text-amber-200">
                  {detailError}
                </div>
              )}
              {selectedMap?.mapImageError && (
                <div className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-700 dark:text-amber-200">
                  游戏底图渲染失败：{selectedMap.mapImageError}
                </div>
              )}
              <div className="overflow-auto rounded-md border bg-slate-950">
                {loadingDetail ? (
                  <div className="flex min-h-[420px] items-center justify-center gap-2 text-sm text-slate-300">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    正在加载当前地图钓点
                  </div>
                ) : selectedMap ? (
                  <div
                    className="relative min-h-[420px] w-full overflow-hidden bg-slate-950"
                    role="img"
                    aria-label={`${selectedMap.name} 地图与钓鱼地点`}
                    style={{
                      aspectRatio: `${selectedMap.width} / ${selectedMap.height}`,
                      minWidth: Math.min(Math.max(selectedMap.width * 8, 720), 1400),
                    }}
                  >
                    {selectedMap.mapImageDataUrl ? (
                      <img
                        src={selectedMap.mapImageDataUrl}
                        alt=""
                        className="absolute inset-0 h-full w-full object-fill [image-rendering:pixelated]"
                        draggable={false}
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
                            <path d="M 8 0 L 0 0 0 8" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="0.4" />
                          </pattern>
                        </defs>
                        <rect width={selectedMap.width} height={selectedMap.height} fill="#0f172a" />
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
                            opacity={tile.hidden ? 0.25 : 0.42}
                          >
                            <title>
                              {`(${tile.x}, ${tile.y}) 深度 ${tile.depth}${tile.hidden ? " · 隐藏水域" : ""}`}
                            </title>
                          </rect>
                        ))}
                      </svg>
                    )}
                  </div>
                ) : (
                  <div className="flex min-h-[420px] items-center justify-center text-sm text-slate-300">
                    没有可显示的地图
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
