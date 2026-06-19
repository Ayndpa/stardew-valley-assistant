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
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Waves,
} from "lucide-react"

import type {
  FishingArea,
  FishingMapData,
  FishingMapDetail,
  FishingMapSummary,
  FishingTile,
  NpcLocationInfo,
  NpcSchedulePoint,
  SelectedFishingInfo,
  TileRun,
} from "./game-map/GameMap.types"
import { formatCount, tileColor, formatGameTime, resolveFishingArea as resolveFishingAreaUtil } from "./game-map/game-map-utils"
import { FishingInfoPanel } from "./game-map/FishingInfoPanel"
import { NpcOverlayPanel } from "./game-map/NpcOverlayPanel"

export interface GameMapProps {
  selectedSaveId?: string
}

export function GameMap({ selectedSaveId }: GameMapProps) {
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

  // ── Refs ──────────────────────────────────────────────────────────────

  const viewportRef = useRef<HTMLDivElement | null>(null)
  const dragStateRef = useRef<{ pointerId: number; x: number; y: number; startX: number; startY: number; startTime: number } | null>(null)
  const npcDropdownRef = useRef<HTMLDivElement | null>(null)

  // ── Map / fishing state ───────────────────────────────────────────────

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
  const [selectedFishingInfo, setSelectedFishingInfo] = useState<SelectedFishingInfo | null>(null)
  const [fishPanelSearch, setFishPanelSearch] = useState("")
  const [fishPanelSeasonFilter, setFishPanelSeasonFilter] = useState<string | null>(null)
  const [fishPanelWeatherFilter, setFishPanelWeatherFilter] = useState<string | null>(null)
  const [fishPanelShowTrapOnly, setFishPanelShowTrapOnly] = useState(false)
  const [fishPanelSortBy, setFishPanelSortBy] = useState<"name" | "price">("name")

  // ── NPC / schedule state ──────────────────────────────────────────────

  const [saveSeason, setSaveSeason] = useState<number>(0)
  const [saveDay, setSaveDay] = useState<number>(1)
  const [npcList, setNpcList] = useState<any[]>([])
  const [npcPortraits, setNpcPortraits] = useState<Record<string, string>>({})
  const [selectedNpcId, setSelectedNpcId] = useState<string>("")
  const [showNpcRoute, setShowNpcRoute] = useState<boolean>(false)
  const [showNpcLocations, setShowNpcLocations] = useState<boolean>(true)
  const [npcLocations, setNpcLocations] = useState<NpcLocationInfo[]>([])
  const [schedulePoints, setSchedulePoints] = useState<NpcSchedulePoint[]>([])
  const [loadingSchedule, setLoadingSchedule] = useState<boolean>(false)
  const [loadingLocations, setLoadingLocations] = useState<boolean>(false)
  const [npcLocationError, setNpcLocationError] = useState<string | null>(null)
  const [isGameRunning, setIsGameRunning] = useState<boolean>(true)
  const [pipeConnected, setPipeConnected] = useState<boolean>(false)
  const [pendingFocus, setPendingFocus] = useState<{ mapId: string; x: number; y: number } | null>(null)
  const [isNpcDropdownOpen, setIsNpcDropdownOpen] = useState(false)
  const [npcSearchTerm, setNpcSearchTerm] = useState("")

  // ── Effects ───────────────────────────────────────────────────────────

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (npcDropdownRef.current && !npcDropdownRef.current.contains(event.target as Node)) {
        setIsNpcDropdownOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  useEffect(() => {
    const checkStatus = async () => {
      const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__
      if (!isTauri) return
      try {
        const { invoke } = await import("@tauri-apps/api/core")
        const status = await invoke<{ pipeConnected: boolean; gameRunning: boolean }>("check_pipe_status")
        setPipeConnected(status.pipeConnected)
        setIsGameRunning(status.gameRunning)
      } catch (err) {
        console.error("Failed to check pipe status:", err)
        setPipeConnected(false)
        setIsGameRunning(false)
      }
    }
    checkStatus()
    const timer = setInterval(checkStatus, 5000)
    return () => clearInterval(timer)
  }, [])

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
        if (current && result.maps.some((map) => map.id === current)) return current
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

  useEffect(() => { loadMaps() }, [])

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
    if (!selectedId) { setSelectedMap(null); return }
    let canceled = false
    async function loadDetail() {
      setLoadingDetail(true)
      setDetailError(null)
      const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__
      if (!isTauri) { setLoadingDetail(false); return }
      try {
        const { invoke } = await import("@tauri-apps/api/core")
        const gameDir = localStorage.getItem("stardewGameDirectory") || ""
        const detail: FishingMapDetail = await invoke("get_fishing_map_detail", {
          gameDir: gameDir.trim() || undefined,
          mapId: selectedId,
          forceRefresh: false,
          lang: activeLang,
        })
        if (!canceled) setSelectedMap(detail)
      } catch (err) {
        console.error("get_fishing_map_detail failed:", err)
        if (!canceled) { setSelectedMap(null); setDetailError(String(err)) }
      } finally {
        if (!canceled) setLoadingDetail(false)
      }
    }
    loadDetail()
    return () => { canceled = true }
  }, [selectedId, activeLang])

  const filteredMaps = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    if (!term) return data.maps
    return data.maps.filter((map) => {
      const displayName = getMapDisplayName(map).toLowerCase()
      return displayName.includes(term) || map.name.toLowerCase().includes(term) || map.id.toLowerCase().includes(term) || map.relativePath.toLowerCase().includes(term)
    })
  }, [data.maps, searchTerm, getMapDisplayName])

  const selectedSummary = useMemo(() => {
    return data.maps.find((map) => map.id === selectedId) || filteredMaps[0] || data.maps[0] || null
  }, [data.maps, filteredMaps, selectedId])

  useEffect(() => {
    if (!selectedId && filteredMaps[0]) { setSelectedId(filteredMaps[0].id); return }
    if (selectedId && filteredMaps.length > 0 && !filteredMaps.some((map) => map.id === selectedId)) {
      setSelectedId(filteredMaps[0].id)
    }
  }, [filteredMaps, selectedId])

  const resetFishPanel = useCallback(() => {
    setSelectedFishingInfo(null)
    setFishPanelSearch("")
    setFishPanelSeasonFilter(null)
    setFishPanelWeatherFilter(null)
    setFishPanelShowTrapOnly(false)
    setFishPanelSortBy("name")
  }, [])

  useEffect(() => {
    setZoom(1)
    setOffset({ x: 0, y: 0 })
    dragStateRef.current = null
    setIsDragging(false)
    resetFishPanel()
  }, [selectedId, resetFishPanel])

  useEffect(() => { resetFishPanel() }, [minDepth, showHidden, showFishingOverlay, resetFishPanel])

  // ── Tile rendering ────────────────────────────────────────────────────

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
      if (previous && previous.y === tile.y && previous.x + previous.width === tile.x && previous.depth === tile.depth && previous.hidden === tile.hidden) {
        previous.width += 1
      } else {
        runs.push({ x: tile.x, y: tile.y, width: 1, depth: tile.depth, hidden: tile.hidden })
      }
    }
    return runs
  }, [selectedMap, visibleTiles])

  const visibleTileLookup = useMemo(() => {
    const lookup = new globalThis.Map<string, FishingTile>()
    for (const tile of visibleTiles) lookup.set(`${tile.x}:${tile.y}`, tile)
    return lookup
  }, [visibleTiles])

  const depthSummary = useMemo(() => {
    const counts = new globalThis.Map<number, number>()
    for (const tile of selectedMap?.tiles || []) counts.set(tile.depth, (counts.get(tile.depth) || 0) + 1)
    return [...counts.entries()].sort((a, b) => a[0] - b[0])
  }, [selectedMap])

  const totalFishable = data.maps.reduce((sum, map) => sum + map.fishableTiles, 0)
  const maxDepth = selectedSummary?.maxDepth ?? selectedMap?.maxDepth ?? 0
  const visibleFishableCount = selectedMap ? visibleTiles.length : selectedSummary?.fishableTiles || 0
  const sceneSize = useMemo(() => {
    if (!selectedMap || viewportSize.width <= 0 || viewportSize.height <= 0) return { width: 0, height: 0 }
    const availableWidth = Math.max(0, viewportSize.width - 80)
    const availableHeight = Math.max(0, viewportSize.height - 80)
    const fitScale = Math.min(availableWidth / selectedMap.width, availableHeight / selectedMap.height)
    return { width: Math.max(240, selectedMap.width * fitScale), height: Math.max(180, selectedMap.height * fitScale) }
  }, [selectedMap, viewportSize])

  // ── Viewport interaction ──────────────────────────────────────────────

  const clampZoom = (value: number) => Math.max(0.6, value)

  const selectFishingTile = (clientX: number, clientY: number) => {
    const viewport = viewportRef.current
    if (!viewport || !selectedMap || sceneSize.width <= 0 || sceneSize.height <= 0) { setSelectedFishingInfo(null); return }
    const rect = viewport.getBoundingClientRect()
    const sceneLeft = rect.left + rect.width / 2 - (sceneSize.width * zoom) / 2 + offset.x
    const sceneTop = rect.top + rect.height / 2 - (sceneSize.height * zoom) / 2 + offset.y
    const localX = (clientX - sceneLeft) / zoom
    const localY = (clientY - sceneTop) / zoom
    if (localX < 0 || localY < 0 || localX >= sceneSize.width || localY >= sceneSize.height) { setSelectedFishingInfo(null); return }
    const tileX = Math.floor((localX / sceneSize.width) * selectedMap.width)
    const tileY = Math.floor((localY / sceneSize.height) * selectedMap.height)
    const tile = visibleTileLookup.get(`${tileX}:${tileY}`)
    if (!tile) { setSelectedFishingInfo(null); return }
    setSelectedFishingInfo({ tile, area: resolveFishingAreaUtil(selectedMap.fishingAreas, tileX, tileY) as FishingArea | null, tileX, tileY })
  }

  const zoomAtPoint = (nextZoom: number, clientX?: number, clientY?: number) => {
    const viewport = viewportRef.current
    if (!viewport) { setZoom(clampZoom(nextZoom)); return }
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
      return { x: pointerX - worldX * clamped, y: pointerY - worldY * clamped }
    })
    setZoom(clamped)
  }

  const handleWheel: WheelEventHandler<HTMLDivElement> = (event) => {
    event.preventDefault()
    zoomAtPoint(zoom * (event.deltaY < 0 ? 1.12 : 0.9), event.clientX, event.clientY)
  }

  const handlePointerDown: PointerEventHandler<HTMLDivElement> = (event) => {
    if (event.button !== 0) return
    event.preventDefault()
    dragStateRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, startTime: Date.now() }
    event.currentTarget.setPointerCapture(event.pointerId)
    setIsDragging(true)
  }

  const handlePointerMove: PointerEventHandler<HTMLDivElement> = (event) => {
    const dragState = dragStateRef.current
    if (dragState && dragState.pointerId === event.pointerId) {
      event.preventDefault()
      const deltaX = event.clientX - dragState.x
      const deltaY = event.clientY - dragState.y
      dragStateRef.current = { ...dragState, x: event.clientX, y: event.clientY }
      setOffset((current) => ({ x: current.x + deltaX, y: current.y + deltaY }))
    }
  }

  const endDrag = (event?: ReactPointerEvent<HTMLDivElement>) => {
    if (event && dragStateRef.current && event.currentTarget.hasPointerCapture(dragStateRef.current.pointerId)) {
      event.currentTarget.releasePointerCapture(dragStateRef.current.pointerId)
    }
    const dragState = dragStateRef.current
    dragStateRef.current = null
    setIsDragging(false)
    if (event && dragState) {
      const dx = event.clientX - dragState.startX
      const dy = event.clientY - dragState.startY
      if (Math.sqrt(dx * dx + dy * dy) < 6 && Date.now() - dragState.startTime < 400) {
        selectFishingTile(event.clientX, event.clientY)
      }
    }
  }

  // ── Save / NPC data loading ───────────────────────────────────────────

  useEffect(() => {
    let canceled = false
    async function loadSaveDetail() {
      if (!selectedSaveId) return
      try {
        const { invoke } = await import("@tauri-apps/api/core")
        const detail: any = await invoke("get_save_detail", { id: selectedSaveId })
        if (!canceled && detail?.summary) {
          if (typeof detail.summary.season === "number") setSaveSeason(detail.summary.season)
          if (typeof detail.summary.dayOfMonth === "number") setSaveDay(detail.summary.dayOfMonth)
        }
      } catch (err) { console.error("Failed to load save detail in GameMap:", err) }
    }
    loadSaveDetail()
    return () => { canceled = true }
  }, [selectedSaveId])

  useEffect(() => {
    let canceled = false
    async function loadNpcs() {
      const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__
      if (!isTauri) return
      try {
        const { invoke } = await import("@tauri-apps/api/core")
        const gameDir = localStorage.getItem("stardewGameDirectory") || ""
        const data: any = await invoke("get_npc_game_data", { gameDir: gameDir.trim() || undefined, lang: activeLang })
        if (!canceled && data?.npcs) {
          setNpcList(data.npcs)
          const portraits = await invoke<Record<string, string>>("get_npc_portraits", { npcIds: data.npcs.map((n: any) => n.id), gameDir: gameDir.trim() || undefined })
          if (!canceled) setNpcPortraits(portraits)
        }
      } catch (err) { console.error("Failed to load NPC game data in GameMap:", err) }
    }
    loadNpcs()
    return () => { canceled = true }
  }, [activeLang])

  const fetchNpcLocations = useCallback(async () => {
    const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__
    if (!isTauri || !selectedSaveId) return
    setLoadingLocations(true)
    setNpcLocationError(null)
    try {
      const { invoke } = await import("@tauri-apps/api/core")
      const gameDir = localStorage.getItem("stardewGameDirectory") || ""
      const source = localStorage.getItem("stardew_npc_location_source") || "estimate"
      const result: any = await invoke("get_npc_locations", { saveId: selectedSaveId, gameDir: gameDir.trim() || undefined, source, season: saveSeason, day: saveDay, time: undefined })
      if (result?.locations) setNpcLocations(result.locations)
    } catch (err) {
      console.error("Failed to fetch NPC locations:", err)
      setNpcLocations([])
      setNpcLocationError(err instanceof Error ? err.message : String(err))
    } finally { setLoadingLocations(false) }
  }, [selectedSaveId, saveSeason, saveDay])

  useEffect(() => {
    const source = localStorage.getItem("stardew_npc_location_source") || "estimate"
    if (!showNpcLocations || (!isGameRunning && source === "mod")) { setNpcLocations([]); return }
    fetchNpcLocations()
    const timer = setInterval(fetchNpcLocations, 10000)
    return () => clearInterval(timer)
  }, [showNpcLocations, isGameRunning, fetchNpcLocations])

  useEffect(() => {
    let canceled = false
    async function loadSchedule() {
      if (!showNpcRoute || !selectedNpcId || !selectedSaveId) { setSchedulePoints([]); return }
      setLoadingSchedule(true)
      try {
        const { invoke } = await import("@tauri-apps/api/core")
        const gameDir = localStorage.getItem("stardewGameDirectory") || ""
        const points = await invoke<NpcSchedulePoint[]>("get_npc_schedule", { saveId: selectedSaveId, gameDir: gameDir.trim() || undefined, npcName: selectedNpcId, season: saveSeason, day: saveDay })
        if (!canceled) setSchedulePoints(points)
      } catch (err) {
        console.error("Failed to load NPC schedule:", err)
        if (!canceled) setSchedulePoints([])
      } finally { if (!canceled) setLoadingSchedule(false) }
    }
    loadSchedule()
    return () => { canceled = true }
  }, [showNpcRoute, selectedNpcId, selectedSaveId, saveSeason, saveDay])

  // ── Navigation helpers ────────────────────────────────────────────────

  const centerOnTile = useCallback((tileX: number, tileY: number, targetZoom = 1.8) => {
    if (!selectedMap || sceneSize.width <= 0 || sceneSize.height <= 0) return
    const localX = ((tileX + 0.5) / selectedMap.width) * sceneSize.width
    const localY = ((tileY + 0.5) / selectedMap.height) * sceneSize.height
    setOffset({ x: (sceneSize.width / 2 - localX) * targetZoom, y: (sceneSize.height / 2 - localY) * targetZoom })
    setZoom(targetZoom)
  }, [selectedMap, sceneSize])

  useEffect(() => {
    if (selectedMap && pendingFocus && selectedMap.id === pendingFocus.mapId) {
      const timer = setTimeout(() => { centerOnTile(pendingFocus.x, pendingFocus.y); setPendingFocus(null) }, 300)
      return () => clearTimeout(timer)
    }
  }, [selectedMap, pendingFocus, centerOnTile])

  const handleSchedulePointClick = (point: NpcSchedulePoint) => {
    if (!selectedMap) return
    const isOnCurrentMap = point.location.toLowerCase() === selectedMap.id.toLowerCase()
    if (isOnCurrentMap) {
      centerOnTile(point.tileX, point.tileY)
    } else {
      const foundMap = data.maps.find((m) => m.id.toLowerCase() === point.location.toLowerCase())
      if (foundMap) { setPendingFocus({ mapId: foundMap.id, x: point.tileX, y: point.tileY }); setSelectedId(foundMap.id) }
    }
  }

  // ── Derived NPC values ────────────────────────────────────────────────

  const currentMapNpcs = useMemo(() => {
    if (!selectedMap || !showNpcLocations) return []
    return npcLocations.filter((loc) => loc.location.toLowerCase() === selectedMap.id.toLowerCase() && loc.tileX != null && loc.tileY != null)
  }, [npcLocations, selectedMap, showNpcLocations])

  const sourceVal = (typeof window !== "undefined" && localStorage.getItem("stardew_npc_location_source")) || "estimate"
  const isModSource = sourceVal === "mod"

  // ── Fishing panel positioning ─────────────────────────────────────────

  const fishPanelPosition = useMemo(() => {
    if (!selectedFishingInfo || !selectedMap || sceneSize.width <= 0) return { left: 0, top: 0 }
    const vpEl = viewportRef.current
    const vpRect = vpEl?.getBoundingClientRect()
    const vpW = vpRect ? vpRect.width : viewportSize.width
    const vpH = vpRect ? vpRect.height : viewportSize.height
    const tilePixelX = ((selectedFishingInfo.tileX + 0.5) / selectedMap.width) * sceneSize.width
    const tilePixelY = ((selectedFishingInfo.tileY + 0.5) / selectedMap.height) * sceneSize.height
    const screenX = vpW / 2 + (tilePixelX - sceneSize.width / 2) * zoom + offset.x
    const screenY = vpH / 2 + (tilePixelY - sceneSize.height / 2) * zoom + offset.y
    const panelW = 380
    const panelH = 460
    const margin = 12
    let left = screenX + 16
    let top = screenY - panelH / 2
    if (left + panelW > vpW - margin) left = screenX - panelW - 16
    if (left < margin) left = margin
    if (top < margin) top = margin
    if (top + panelH > vpH - margin) top = vpH - panelH - margin
    return { left, top }
  }, [selectedFishingInfo, selectedMap, sceneSize, viewportSize, zoom, offset])

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <section className="relative h-full min-h-[720px] overflow-hidden select-none bg-background text-foreground">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,color-mix(in_oklab,var(--primary)_10%,transparent)_0%,transparent_58%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,color-mix(in_oklab,var(--background)_78%,transparent)_0%,var(--background)_100%)]" />

      {/* ── Top Toolbar ────────────────────────────────────────────────── */}
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
                    {loading ? t("fishingMap.loadingMaps") : `${t("fishingMap.mapsCount", { count: formatCount(data.maps.length) })} · ${t("fishingMap.fishableTilesCount", { count: formatCount(totalFishable) })}`}
                  </div>
                </div>
              </div>
              <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_220px_132px]">
                <div className="relative min-w-0">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input value={searchTerm} onChange={(e) => setSearchTerm(e.currentTarget.value)} placeholder={t("fishingMap.searchPlaceholder")} className="h-10 border-border/70 bg-background/50 pl-9 placeholder:text-muted-foreground" />
                </div>
                <select value={selectedId} onChange={(e) => setSelectedId(e.currentTarget.value)} className="h-10 min-w-0 rounded-md border border-border/70 bg-background/80 px-3 text-sm text-foreground outline-none">
                  {filteredMaps.length === 0 ? <option value="">{t("fishingMap.noMatchingMaps")}</option> : filteredMaps.map((map) => <option key={map.id} value={map.id}>{getMapDisplayName(map)}</option>)}
                </select>
                <select value={minDepth} onChange={(e) => setMinDepth(Number(e.currentTarget.value))} className="h-10 rounded-md border border-border/70 bg-background/80 px-3 text-sm text-foreground outline-none">
                  {Array.from({ length: Math.max(1, maxDepth + 1) }, (_, depth) => <option key={depth} value={depth}>{t("fishingMap.depthFilter", { depth })}</option>)}
                </select>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 rounded-md border border-border/70 bg-background/80 p-1">
                <Button variant="ghost" size="icon" type="button" onClick={() => zoomAtPoint(zoom / 1.12)} className="h-8 w-8 text-foreground hover:bg-accent hover:text-accent-foreground"><Minus className="h-4 w-4" /></Button>
                <div className="min-w-12 text-center text-xs font-medium text-muted-foreground">{Math.round(zoom * 100)}%</div>
                <Button variant="ghost" size="icon" type="button" onClick={() => zoomAtPoint(zoom * 1.12)} className="h-8 w-8 text-foreground hover:bg-accent hover:text-accent-foreground"><Plus className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" type="button" onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }) }} className="h-8 w-8 text-foreground hover:bg-accent hover:text-accent-foreground"><RotateCcw className="h-4 w-4" /></Button>
              </div>
              <label className="flex h-10 items-center gap-2 rounded-md border border-border/70 bg-background/80 px-3 text-sm text-foreground">
                <Checkbox checked={showFishingOverlay} onCheckedChange={(v) => setShowFishingOverlay(Boolean(v))} className="border-border data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground" />
                <Layers className="h-4 w-4 text-primary" />{t("fishingMap.overlay")}
              </label>
              <label className="flex h-10 items-center gap-2 rounded-md border border-border/70 bg-background/80 px-3 text-sm text-foreground">
                <Checkbox checked={showHidden} onCheckedChange={(v) => setShowHidden(Boolean(v))} className="border-border data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground" />
                {t("fishingMap.hiddenWater")}
              </label>
              <Button variant="outline" size="sm" onClick={() => loadMaps(true)} disabled={loading} className="h-10 border-border/70 bg-background/80 px-3">
                {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}{t("fishingMap.refresh")}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Viewport ───────────────────────────────────────────────────── */}
      <div className="absolute inset-0 flex items-center justify-center px-4 pb-4 pt-28">
        <div className="relative h-full w-full overflow-hidden rounded-lg border border-border/70 bg-card shadow-2xl">
          <div
            ref={viewportRef}
            className={cn("absolute inset-0 overflow-hidden touch-none select-none", isDragging ? "cursor-grabbing" : "cursor-grab")}
            onWheel={handleWheel}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onPointerLeave={(e) => { if (dragStateRef.current?.pointerId === e.pointerId) endDrag(e) }}
          >
            {selectedMap && sceneSize.width > 0 && sceneSize.height > 0 && (
              <div
                className="absolute left-1/2 top-1/2"
                style={{ width: `${sceneSize.width}px`, height: `${sceneSize.height}px`, transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) scale(${zoom})`, transformOrigin: "center center" }}
              >
                {/* Map image */}
                {selectedMap.mapImageDataUrl ? (
                  <img src={selectedMap.mapImageDataUrl} alt="" className="absolute inset-0 h-full w-full object-fill [image-rendering:pixelated]" draggable={false} onDragStart={(e) => e.preventDefault()} />
                ) : (
                  <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${selectedMap.width} ${selectedMap.height}`} preserveAspectRatio="none" aria-hidden="true">
                    <defs><pattern id="fishing-map-grid" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M 8 0 L 0 0 0 8" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="0.4" /></pattern></defs>
                    <rect width={selectedMap.width} height={selectedMap.height} fill="color-mix(in oklab, var(--card) 82%, black)" />
                    <rect width={selectedMap.width} height={selectedMap.height} fill="url(#fishing-map-grid)" />
                  </svg>
                )}

                {/* Fishing overlay */}
                {showFishingOverlay && (
                  <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${selectedMap.width} ${selectedMap.height}`} preserveAspectRatio="none" aria-hidden="true">
                    {visibleRuns.map((tile) => (
                      <rect key={`${tile.x}:${tile.y}:${tile.width}:${tile.depth}:${tile.hidden}`} x={tile.x} y={tile.y} width={tile.width} height="1" fill={tileColor(tile.depth)} opacity={tile.hidden ? 0.26 : 0.46}>
                        <title>{tile.hidden ? t("fishingMap.svgTileTitleHidden", { x: tile.x, y: tile.y, depth: tile.depth }) : t("fishingMap.svgTileTitle", { x: tile.x, y: tile.y, depth: tile.depth })}</title>
                      </rect>
                    ))}
                  </svg>
                )}

                {/* NPC Route Layer */}
                {selectedMap && (showNpcRoute || showNpcLocations) && (
                  <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox={`0 0 ${selectedMap.width} ${selectedMap.height}`} preserveAspectRatio="none" aria-hidden="true">
                    <defs>
                      <marker id="npc-route-arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="1.5" markerHeight="1.5" orient="auto-start-reverse">
                        <path d="M 0 2 L 10 5 L 0 8 z" fill="#eab308" />
                      </marker>
                    </defs>

                    {showNpcRoute && (
                      <g className="npc-route-lines">
                        {schedulePoints.map((p, idx) => {
                          if (idx === schedulePoints.length - 1) return null
                          const next = schedulePoints[idx + 1]
                          if (p.location.toLowerCase() !== selectedMap.id.toLowerCase() || next.location.toLowerCase() !== selectedMap.id.toLowerCase()) return null
                          return <line key={`route-line-${idx}`} x1={p.tileX + 0.5} y1={p.tileY + 0.5} x2={next.tileX + 0.5} y2={next.tileY + 0.5} stroke="#eab308" strokeWidth="0.25" strokeDasharray="0.4 0.2" markerEnd="url(#npc-route-arrow)" />
                        })}
                      </g>
                    )}

                    {showNpcRoute && (
                      <g className="npc-route-markers">
                        {schedulePoints.map((p, idx) => ({ ...p, originalIndex: idx })).filter((p) => p.location.toLowerCase() === selectedMap.id.toLowerCase()).map((p) => {
                          const w = 12.0, h = 3.6
                          const x = p.tileX + 0.5 - w / 2, y = p.tileY + 0.5 - h / 2
                          const portrait = npcPortraits[selectedNpcId] || ""
                          const npcName = npcList.find((n) => n.id === selectedNpcId)?.name || selectedNpcId
                          return (
                            <foreignObject key={`route-point-${p.originalIndex}`} x={x} y={y} width={w} height={h} className="overflow-visible">
                              <div className="flex h-full w-full items-center justify-center pointer-events-none" style={{ transform: `scale(${1 / zoom})`, transformOrigin: 'center center' }}>
                                <div onClick={() => centerOnTile(p.tileX, p.tileY)} className="pointer-events-auto group flex items-center bg-background/90 rounded-full cursor-pointer select-none z-10 transition-all hover:scale-105 hover:bg-background" style={{ borderWidth: '0.12px', borderColor: '#eab308', padding: '0.18px 0.45px', gap: '0.22px', fontSize: '0.8px', boxShadow: '0 0.08px 0.16px rgba(0,0,0,0.15)' }}>
                                  {portrait ? <img src={portrait} alt="" className="rounded-full object-cover shrink-0" style={{ width: '2.4px', height: '2.4px', borderWidth: '0.04px', borderColor: 'rgba(234, 179, 8, 0.2)', imageRendering: "pixelated" }} /> : <div className="rounded-full bg-yellow-500/10 flex items-center justify-center font-bold text-yellow-500 shrink-0" style={{ width: '2.4px', height: '2.4px', fontSize: '0.75px' }}>{npcName.charAt(0)}</div>}
                                  <span className="font-semibold text-foreground" style={{ lineHeight: 1 }}>{npcName}</span>
                                  <span className="text-yellow-600 font-bold text-[0.7px]" style={{ lineHeight: 1 }}>{formatGameTime(p.time)}</span>
                                </div>
                              </div>
                            </foreignObject>
                          )
                        })}
                      </g>
                    )}

                    {showNpcLocations && (
                      <g className="npc-locations">
                        {currentMapNpcs.map((loc) => {
                          const portrait = npcPortraits[loc.npcName] || ""
                          const w = 12.0, h = 3.6
                          const x = loc.tileX! + 0.5 - w / 2, y = loc.tileY! + 0.5 - h / 2
                          return (
                            <foreignObject key={loc.npcName} x={x} y={y} width={w} height={h} className="overflow-visible">
                              <div className="flex h-full w-full items-center justify-center pointer-events-none" style={{ transform: `scale(${1 / zoom})`, transformOrigin: 'center center' }}>
                                <div onClick={() => centerOnTile(loc.tileX!, loc.tileY!)} className="pointer-events-auto group flex items-center bg-background/90 rounded-full cursor-pointer select-none z-20 transition-all hover:scale-105 hover:bg-background" style={{ borderWidth: '0.12px', borderColor: 'var(--primary)', padding: '0.18px 0.45px', gap: '0.22px', fontSize: '0.8px', boxShadow: '0 0.08px 0.16px rgba(0,0,0,0.15)' }}>
                                  {portrait ? <img src={portrait} alt="" className="rounded-full object-cover shrink-0" style={{ width: '2.4px', height: '2.4px', borderWidth: '0.04px', borderColor: 'color-mix(in oklab, var(--primary) 20%, transparent)', imageRendering: "pixelated" }} /> : <div className="rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary shrink-0" style={{ width: '2.4px', height: '2.4px', fontSize: '0.75px' }}>{loc.npcName.charAt(0)}</div>}
                                  <span className="font-semibold text-foreground" style={{ lineHeight: 1 }}>{loc.npcName}</span>
                                </div>
                              </div>
                            </foreignObject>
                          )
                        })}
                      </g>
                    )}
                  </svg>
                )}
              </div>
            )}

            {/* Fishing Info Panel */}
            {selectedFishingInfo && (
              <FishingInfoPanel
                selectedFishingInfo={selectedFishingInfo}
                panelPosition={fishPanelPosition}
                fishPanelSearch={fishPanelSearch}
                setFishPanelSearch={setFishPanelSearch}
                fishPanelSeasonFilter={fishPanelSeasonFilter}
                setFishPanelSeasonFilter={setFishPanelSeasonFilter}
                fishPanelWeatherFilter={fishPanelWeatherFilter}
                setFishPanelWeatherFilter={setFishPanelWeatherFilter}
                fishPanelShowTrapOnly={fishPanelShowTrapOnly}
                setFishPanelShowTrapOnly={setFishPanelShowTrapOnly}
                fishPanelSortBy={fishPanelSortBy}
                setFishPanelSortBy={setFishPanelSortBy}
                onClose={resetFishPanel}
              />
            )}
          </div>

          {/* NPC Overlay Panel */}
          <NpcOverlayPanel
            showNpcLocations={showNpcLocations}
            setShowNpcLocations={setShowNpcLocations}
            showNpcRoute={showNpcRoute}
            setShowNpcRoute={setShowNpcRoute}
            isGameRunning={isGameRunning}
            pipeConnected={pipeConnected}
            isModSource={isModSource}
            loadingLocations={loadingLocations}
            npcLocationError={npcLocationError}
            npcDropdownRef={npcDropdownRef}
            isNpcDropdownOpen={isNpcDropdownOpen}
            setIsNpcDropdownOpen={setIsNpcDropdownOpen}
            npcSearchTerm={npcSearchTerm}
            setNpcSearchTerm={setNpcSearchTerm}
            selectedNpcId={selectedNpcId}
            setSelectedNpcId={setSelectedNpcId}
            npcList={npcList}
            npcPortraits={npcPortraits}
            selectedSaveId={selectedSaveId}
            saveSeason={saveSeason}
            setSaveSeason={setSaveSeason}
            saveDay={saveDay}
            setSaveDay={setSaveDay}
            schedulePoints={schedulePoints}
            loadingSchedule={loadingSchedule}
            onSchedulePointClick={handleSchedulePointClick}
            selectedMapId={selectedMap?.id}
          />

          {/* Loading overlay */}
          {(loadingDetail || loading) && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/45 backdrop-blur-[2px]">
              <div className="flex items-center gap-3 rounded-md border border-border/70 bg-popover/92 px-4 py-3 text-sm text-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />{t("fishingMap.loadingMap")}
              </div>
            </div>
          )}

          {/* Empty state */}
          {!loading && !selectedMap && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="rounded-md border border-border/70 bg-popover/92 px-4 py-3 text-sm text-muted-foreground">{t("fishingMap.noMapToDisplay")}</div>
            </div>
          )}

          {/* Bottom info bar */}
          <div className="pointer-events-none absolute inset-x-4 bottom-4 z-10 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
            <div className="pointer-events-auto max-w-[min(540px,100%)] rounded-lg border border-border/70 bg-background/86 px-4 py-3 shadow-xl backdrop-blur-xl">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-lg font-semibold">{selectedSummary ? getMapDisplayName(selectedSummary) : t("fishingMap.noMapSelected")}</div>
                  {selectedSummary && <div className="mt-1 truncate text-xs text-muted-foreground">{selectedSummary.relativePath}</div>}
                </div>
                <Badge variant="secondary" className="border border-border/60 bg-secondary/80 text-secondary-foreground">{selectedSummary ? `${selectedSummary.width} x ${selectedSummary.height}` : t("fishingMap.noSize")}</Badge>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <div className="rounded-md border border-border/60 bg-card/70 px-3 py-2">
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground"><Waves className="h-3.5 w-3.5 text-primary" />{t("fishingMap.waterTiles")}</div>
                  <div className="mt-1 text-lg font-semibold">{formatCount(selectedSummary?.waterTiles || 0)}</div>
                </div>
                <div className="rounded-md border border-border/60 bg-card/70 px-3 py-2">
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground"><Fish className="h-3.5 w-3.5 text-primary" />{t("fishingMap.fishableTiles")}</div>
                  <div className="mt-1 text-lg font-semibold">{formatCount(visibleFishableCount)}</div>
                </div>
                <div className="rounded-md border border-border/60 bg-card/70 px-3 py-2">
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground"><Gauge className="h-3.5 w-3.5 text-primary" />{t("fishingMap.maxDepth")}</div>
                  <div className="mt-1 text-lg font-semibold">{maxDepth}</div>
                </div>
              </div>
            </div>

            {depthSummary.length > 0 && (
              <div className="pointer-events-auto max-w-full rounded-lg border border-border/70 bg-background/86 px-3 py-3 shadow-xl backdrop-blur-xl">
                <div className="mb-2 text-xs text-muted-foreground">{t("fishingMap.depthLegend")}</div>
                <div className="flex max-w-full flex-wrap gap-2">
                  {depthSummary.map(([depth, count]) => (
                    <Badge key={depth} variant="outline" className={cn("gap-1.5 border-border/70 bg-card/70 text-foreground", minDepth === depth && "border-primary/60 bg-primary/10")}>
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: tileColor(depth) }} />{depth}: {formatCount(count)}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {selectedMap && showFishingOverlay && (
              <div className="pointer-events-auto max-w-full rounded-lg border border-border/70 bg-background/86 px-3 py-2 shadow-xl backdrop-blur-xl">
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Fish className="h-3 w-3 shrink-0" />{t("fishingMap.clickTileToView")}</div>
              </div>
            )}
          </div>

          {/* Error banners */}
          {(error || detailError || selectedMap?.mapImageError) && (
            <div className="absolute left-4 right-4 top-4 z-10 space-y-2">
              {error && <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-200">{error}</div>}
              {detailError && <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-200">{detailError}</div>}
              {selectedMap?.mapImageError && <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-200">{t("fishingMap.mapImageError", { error: selectedMap.mapImageError })}</div>}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
