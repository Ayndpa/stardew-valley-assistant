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
  X,
  Clock,
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
  seasons: string[]
  timeRanges: [number, number][]
  weather: string
  minLevel: number
  isTrap: boolean
  price: number
  minDistanceFromShore: number
  maxDistanceFromShore: number
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

interface SelectedFishingInfo {
  tile: FishingTile
  area: FishingArea | null
  tileX: number
  tileY: number
}

interface NpcSchedulePoint {
  time: number
  location: string
  locationDisplayName: string
  tileX: number
  tileY: number
  direction: number
}

interface NpcLocationInfo {
  npcName: string
  location: string
  locationDisplayName: string
  tileX?: number | null
  tileY?: number | null
  direction?: number | null
  scheduleKey?: string | null
  scheduleTime?: number | null
  source: string
  confidence: string
  updatedAt?: string | null
}

const depthColors = ["#38bdf8", "#22c55e", "#facc15", "#fb923c", "#ef4444", "#a855f7"]

function formatCount(value: number) {
  return value.toLocaleString("zh-CN")
}

function tileColor(depth: number) {
  return depthColors[Math.max(0, Math.min(depth, depthColors.length - 1))]
}

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

  const viewportRef = useRef<HTMLDivElement | null>(null)
  const dragStateRef = useRef<{ pointerId: number; x: number; y: number; startX: number; startY: number; startTime: number } | null>(null)
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
  // Fish panel search & filter state
  const [fishPanelSearch, setFishPanelSearch] = useState("")
  const [fishPanelSeasonFilter, setFishPanelSeasonFilter] = useState<string | null>(null)
  const [fishPanelWeatherFilter, setFishPanelWeatherFilter] = useState<string | null>(null)
  const [fishPanelShowTrapOnly, setFishPanelShowTrapOnly] = useState(false)
  const [fishPanelSortBy, setFishPanelSortBy] = useState<"name" | "price">("name")

  // NPC and Schedule related states
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
  const [pendingFocus, setPendingFocus] = useState<{ mapId: string; x: number; y: number } | null>(null)

  const npcDropdownRef = useRef<HTMLDivElement | null>(null)
  const [isNpcDropdownOpen, setIsNpcDropdownOpen] = useState(false)
  const [npcSearchTerm, setNpcSearchTerm] = useState("")

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
    const checkRunning = async () => {
      const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__
      if (!isTauri) return
      try {
        const { invoke } = await import("@tauri-apps/api/core")
        const running = await invoke<boolean>("check_game_running")
        setIsGameRunning(running)
      } catch (err) {
        console.error("Failed to check if game is running:", err)
        setIsGameRunning(false)
      }
    }

    checkRunning()
    const timer = setInterval(checkRunning, 10000)
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

  const resetFishPanel = () => {
    setSelectedFishingInfo(null)
    setFishPanelSearch("")
    setFishPanelSeasonFilter(null)
    setFishPanelWeatherFilter(null)
    setFishPanelShowTrapOnly(false)
    setFishPanelSortBy("name")
  }

  useEffect(() => {
    setZoom(1)
    setOffset({ x: 0, y: 0 })
    dragStateRef.current = null
    setIsDragging(false)
    resetFishPanel()
  }, [selectedId])

  useEffect(() => {
    resetFishPanel()
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

  const selectFishingTile = (clientX: number, clientY: number) => {
    const viewport = viewportRef.current
    if (!viewport || !selectedMap || sceneSize.width <= 0 || sceneSize.height <= 0) {
      setSelectedFishingInfo(null)
      return
    }

    const rect = viewport.getBoundingClientRect()
    const sceneLeft = rect.left + rect.width / 2 - (sceneSize.width * zoom) / 2 + offset.x
    const sceneTop = rect.top + rect.height / 2 - (sceneSize.height * zoom) / 2 + offset.y
    const localX = (clientX - sceneLeft) / zoom
    const localY = (clientY - sceneTop) / zoom

    if (localX < 0 || localY < 0 || localX >= sceneSize.width || localY >= sceneSize.height) {
      setSelectedFishingInfo(null)
      return
    }

    const tileX = Math.floor((localX / sceneSize.width) * selectedMap.width)
    const tileY = Math.floor((localY / sceneSize.height) * selectedMap.height)
    const tile = visibleTileLookup.get(`${tileX}:${tileY}`)
    if (!tile) {
      setSelectedFishingInfo(null)
      return
    }

    setSelectedFishingInfo({
      tile,
      area: resolveFishingArea(tileX, tileY),
      tileX,
      tileY,
    })
  }

  const zoomAtPoint = (nextZoom: number, clientX?: number, clientY?: number) => {
    const viewport = viewportRef.current
    if (!viewport) {
      setZoom(clampZoom(nextZoom))
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
  }

  const handleWheel: WheelEventHandler<HTMLDivElement> = (event) => {
    event.preventDefault()
    const factor = event.deltaY < 0 ? 1.12 : 0.9
    zoomAtPoint(zoom * factor, event.clientX, event.clientY)
  }

  const handlePointerDown: PointerEventHandler<HTMLDivElement> = (event) => {
    if (event.button !== 0) return
    event.preventDefault()
    dragStateRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      startTime: Date.now(),
    }
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

      setOffset((current) => ({
        x: current.x + deltaX,
        y: current.y + deltaY,
      }))
      return
    }
  }

  const endDrag = (event?: ReactPointerEvent<HTMLDivElement>) => {
    if (event && dragStateRef.current && event.currentTarget.hasPointerCapture(dragStateRef.current.pointerId)) {
      event.currentTarget.releasePointerCapture(dragStateRef.current.pointerId)
    }
    const dragState = dragStateRef.current
    dragStateRef.current = null
    setIsDragging(false)

    // Detect click: small movement and short duration
    if (event && dragState) {
      const dx = event.clientX - dragState.startX
      const dy = event.clientY - dragState.startY
      const distance = Math.sqrt(dx * dx + dy * dy)
      const duration = Date.now() - dragState.startTime
      if (distance < 6 && duration < 400) {
        // It's a click — select or deselect fishing tile
        selectFishingTile(event.clientX, event.clientY)
      }
    }
  }

  // Load save details to get current date
  useEffect(() => {
    let canceled = false
    async function loadSaveDetail() {
      if (!selectedSaveId) return
      try {
        const { invoke } = await import("@tauri-apps/api/core")
        const detail: any = await invoke("get_save_detail", { id: selectedSaveId })
        if (!canceled && detail?.summary) {
          if (typeof detail.summary.season === "number") {
            setSaveSeason(detail.summary.season)
          }
          if (typeof detail.summary.dayOfMonth === "number") {
            setSaveDay(detail.summary.dayOfMonth)
          }
        }
      } catch (err) {
        console.error("Failed to load save detail in GameMap:", err)
      }
    }
    loadSaveDetail()
    return () => {
      canceled = true
    }
  }, [selectedSaveId])

  // Load NPC profiles and portraits
  useEffect(() => {
    let canceled = false
    async function loadNpcs() {
      const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__
      if (!isTauri) return
      try {
        const { invoke } = await import("@tauri-apps/api/core")
        const gameDir = localStorage.getItem("stardewGameDirectory") || ""
        const data: any = await invoke("get_npc_game_data", {
          gameDir: gameDir.trim() || undefined,
          lang: activeLang,
        })
        if (!canceled && data?.npcs) {
          setNpcList(data.npcs)
          
          const portraits = await invoke<Record<string, string>>("get_npc_portraits", {
            npcIds: data.npcs.map((n: any) => n.id),
            gameDir: gameDir.trim() || undefined,
          })
          if (!canceled) {
            setNpcPortraits(portraits)
          }
        }
      } catch (err) {
        console.error("Failed to load NPC game data in GameMap:", err)
      }
    }
    loadNpcs()
    return () => {
      canceled = true
    }
  }, [activeLang])

  // Fetch all NPC locations
  const fetchNpcLocations = useCallback(async () => {
    const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__
    if (!isTauri || !selectedSaveId) return
    setLoadingLocations(true)
    setNpcLocationError(null)
    try {
      const { invoke } = await import("@tauri-apps/api/core")
      const gameDir = localStorage.getItem("stardewGameDirectory") || ""
      const source = localStorage.getItem("stardew_npc_location_source") || "estimate"
      
      const result: any = await invoke("get_npc_locations", {
        saveId: selectedSaveId,
        gameDir: gameDir.trim() || undefined,
        source: source,
        season: saveSeason,
        day: saveDay,
        time: undefined,
      })
      if (result?.locations) {
        setNpcLocations(result.locations)
      }
    } catch (err) {
      console.error("Failed to fetch NPC locations:", err)
      setNpcLocations([])
      setNpcLocationError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingLocations(false)
    }
  }, [selectedSaveId, saveSeason, saveDay])

  // Poll locations if showNpcLocations is checked
  useEffect(() => {
    const source = localStorage.getItem("stardew_npc_location_source") || "estimate"
    if (!showNpcLocations || (!isGameRunning && source === "mod")) {
      setNpcLocations([])
      return
    }
    fetchNpcLocations()
    const timer = setInterval(fetchNpcLocations, 10000)
    return () => clearInterval(timer)
  }, [showNpcLocations, isGameRunning, fetchNpcLocations])

  // Load schedule for selected NPC
  useEffect(() => {
    let canceled = false
    async function loadSchedule() {
      if (!showNpcRoute || !selectedNpcId || !selectedSaveId) {
        setSchedulePoints([])
        return
      }
      setLoadingSchedule(true)
      try {
        const { invoke } = await import("@tauri-apps/api/core")
        const gameDir = localStorage.getItem("stardewGameDirectory") || ""
        const points = await invoke<NpcSchedulePoint[]>("get_npc_schedule", {
          saveId: selectedSaveId,
          gameDir: gameDir.trim() || undefined,
          npcName: selectedNpcId,
          season: saveSeason,
          day: saveDay,
        })
        if (!canceled) {
          setSchedulePoints(points)
        }
      } catch (err) {
        console.error("Failed to load NPC schedule:", err)
        if (!canceled) {
          setSchedulePoints([])
        }
      } finally {
        if (!canceled) {
          setLoadingSchedule(false)
        }
      }
    }
    loadSchedule()
    return () => {
      canceled = true
    }
  }, [showNpcRoute, selectedNpcId, selectedSaveId, saveSeason, saveDay])

  // Helper to center view on a specific tile coordinate
  const centerOnTile = useCallback((tileX: number, tileY: number, targetZoom = 1.8) => {
    if (!selectedMap || sceneSize.width <= 0 || sceneSize.height <= 0) return
    const centerX = sceneSize.width / 2
    const centerY = sceneSize.height / 2
    const localX = ((tileX + 0.5) / selectedMap.width) * sceneSize.width
    const localY = ((tileY + 0.5) / selectedMap.height) * sceneSize.height
    setOffset({
      x: (centerX - localX) * targetZoom,
      y: (centerY - localY) * targetZoom,
    })
    setZoom(targetZoom)
  }, [selectedMap, sceneSize])

  // Wait for map load if pendingFocus exists
  useEffect(() => {
    if (selectedMap && pendingFocus && selectedMap.id === pendingFocus.mapId) {
      const timer = setTimeout(() => {
        centerOnTile(pendingFocus.x, pendingFocus.y)
        setPendingFocus(null)
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [selectedMap, pendingFocus, centerOnTile])

  // Click handler for schedule point list
  const handleSchedulePointClick = (point: NpcSchedulePoint) => {
    if (!selectedMap) return
    const targetMapId = point.location
    const isOnCurrentMap = targetMapId.toLowerCase() === selectedMap.id.toLowerCase()
    
    if (isOnCurrentMap) {
      centerOnTile(point.tileX, point.tileY)
    } else {
      const foundMap = data.maps.find((m) => m.id.toLowerCase() === targetMapId.toLowerCase())
      if (foundMap) {
        setPendingFocus({ mapId: foundMap.id, x: point.tileX, y: point.tileY })
        setSelectedId(foundMap.id)
      } else {
        console.warn(`Map ${targetMapId} not found in maps list`)
      }
    }
  }

  function formatGameTime(time?: number | null) {
    if (!time) return "未知时间"
    const hour = Math.floor(time / 100)
    const minute = time % 100
    return `${hour}:${minute.toString().padStart(2, "0")}`
  }

  // Filter NPCs on the current map
  const currentMapNpcs = useMemo(() => {
    if (!selectedMap || !showNpcLocations) return []
    return npcLocations.filter(
      (loc) => loc.location.toLowerCase() === selectedMap.id.toLowerCase() && loc.tileX != null && loc.tileY != null
    )
  }, [npcLocations, selectedMap, showNpcLocations])

  const sourceVal = (typeof window !== "undefined" && localStorage.getItem("stardew_npc_location_source")) || "estimate"
  const isModSource = sourceVal === "mod"

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
                    className="h-10 border-border/70 bg-background/50 pl-9 placeholder:text-muted-foreground"
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
              }
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

                {/* NPC Route Layer */}
                {selectedMap && (showNpcRoute || showNpcLocations) && (
                  <svg
                    className="absolute inset-0 h-full w-full overflow-visible"
                    viewBox={`0 0 ${selectedMap.width} ${selectedMap.height}`}
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    <defs>
                      <marker
                        id="npc-route-arrow"
                        viewBox="0 0 10 10"
                        refX="6"
                        refY="5"
                        markerWidth="1.5"
                        markerHeight="1.5"
                        orient="auto-start-reverse"
                      >
                        <path d="M 0 2 L 10 5 L 0 8 z" fill="#eab308" />
                      </marker>
                    </defs>

                    {/* NPC Route Lines */}
                    {showNpcRoute && (
                      <g className="npc-route-lines">
                        {schedulePoints.map((p, idx) => {
                          if (idx === schedulePoints.length - 1) return null
                          const next = schedulePoints[idx + 1]
                          const isCurrentMap = p.location.toLowerCase() === selectedMap.id.toLowerCase()
                          const isNextCurrentMap = next.location.toLowerCase() === selectedMap.id.toLowerCase()
                          if (!isCurrentMap || !isNextCurrentMap) return null
                          
                          return (
                            <line
                              key={`route-line-${idx}`}
                              x1={p.tileX + 0.5}
                              y1={p.tileY + 0.5}
                              x2={next.tileX + 0.5}
                              y2={next.tileY + 0.5}
                              stroke="#eab308"
                              strokeWidth="0.25"
                              strokeDasharray="0.4 0.2"
                              markerEnd="url(#npc-route-arrow)"
                            />
                          )
                        })}
                      </g>
                    )}

                    {/* NPC Route Node Markers */}
                    {showNpcRoute && (
                      <g className="npc-route-markers">
                        {schedulePoints
                          .map((p, idx) => ({ ...p, originalIndex: idx }))
                          .filter((p) => p.location.toLowerCase() === selectedMap.id.toLowerCase())
                          .map((p) => {
                            const width = 12.0
                            const height = 3.6
                            const x = p.tileX + 0.5 - width / 2
                            const y = p.tileY + 0.5 - height / 2
                            const portrait = npcPortraits[selectedNpcId] || ""
                            const npcName = npcList.find((n) => n.id === selectedNpcId)?.name || selectedNpcId

                            return (
                              <foreignObject
                                key={`route-point-${p.originalIndex}`}
                                x={x}
                                y={y}
                                width={width}
                                height={height}
                                className="overflow-visible"
                              >
                                <div className="flex h-full w-full items-center justify-center pointer-events-none" style={{ transform: `scale(${1 / zoom})`, transformOrigin: 'center center' }}>
                                  <div
                                    onClick={() => centerOnTile(p.tileX, p.tileY)}
                                    className="pointer-events-auto group flex items-center bg-background/90 rounded-full cursor-pointer select-none z-10 transition-all hover:scale-105 hover:bg-background"
                                    style={{
                                      borderWidth: '0.12px',
                                      borderColor: '#eab308',
                                      padding: '0.18px 0.45px',
                                      gap: '0.22px',
                                      fontSize: '0.8px',
                                      boxShadow: '0 0.08px 0.16px rgba(0,0,0,0.15)'
                                    }}
                                  >
                                    {portrait ? (
                                      <img
                                        src={portrait}
                                        alt=""
                                        className="rounded-full object-cover shrink-0"
                                        style={{
                                          width: '2.4px',
                                          height: '2.4px',
                                          borderWidth: '0.04px',
                                          borderColor: 'rgba(234, 179, 8, 0.2)',
                                          imageRendering: "pixelated"
                                        }}
                                      />
                                    ) : (
                                      <div className="rounded-full bg-yellow-500/10 flex items-center justify-center font-bold text-yellow-500 shrink-0"
                                           style={{
                                             width: '2.4px',
                                             height: '2.4px',
                                             fontSize: '0.75px'
                                           }}
                                      >
                                        {npcName.charAt(0)}
                                      </div>
                                    )}
                                    <span className="font-semibold text-foreground" style={{ lineHeight: 1 }}>{npcName}</span>
                                    <span className="text-yellow-600 font-bold text-[0.7px]" style={{ lineHeight: 1 }}>{formatGameTime(p.time)}</span>
                                  </div>
                                </div>
                              </foreignObject>
                            )
                          })}
                      </g>
                    )}

                    {/* NPC Real-time/Estimate Locations */}
                    {showNpcLocations && (
                      <g className="npc-locations">
                        {currentMapNpcs.map((loc) => {
                          const portrait = npcPortraits[loc.npcName] || ""
                          const width = 12.0
                          const height = 3.6
                          const x = loc.tileX! + 0.5 - width / 2
                          const y = loc.tileY! + 0.5 - height / 2

                          return (
                            <foreignObject
                              key={loc.npcName}
                              x={x}
                              y={y}
                              width={width}
                              height={height}
                              className="overflow-visible"
                            >
                              <div className="flex h-full w-full items-center justify-center pointer-events-none" style={{ transform: `scale(${1 / zoom})`, transformOrigin: 'center center' }}>
                                <div
                                  onClick={() => centerOnTile(loc.tileX!, loc.tileY!)}
                                  className="pointer-events-auto group flex items-center bg-background/90 rounded-full cursor-pointer select-none z-20 transition-all hover:scale-105 hover:bg-background"
                                  style={{
                                    borderWidth: '0.12px',
                                    borderColor: 'var(--primary)',
                                    padding: '0.18px 0.45px',
                                    gap: '0.22px',
                                    fontSize: '0.8px',
                                    boxShadow: '0 0.08px 0.16px rgba(0,0,0,0.15)'
                                  }}
                                >
                                  {portrait ? (
                                    <img
                                      src={portrait}
                                      alt=""
                                      className="rounded-full object-cover shrink-0"
                                      style={{
                                        width: '2.4px',
                                        height: '2.4px',
                                        borderWidth: '0.04px',
                                        borderColor: 'color-mix(in oklab, var(--primary) 20%, transparent)',
                                        imageRendering: "pixelated"
                                      }}
                                    />
                                  ) : (
                                    <div className="rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary shrink-0"
                                         style={{
                                           width: '2.4px',
                                           height: '2.4px',
                                           fontSize: '0.75px'
                                         }}
                                    >
                                      {loc.npcName.charAt(0)}
                                    </div>
                                  )}
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

            {selectedFishingInfo && (() => {
              // Compute screen position of the selected tile center
              const vpEl = viewportRef.current
              const vpRect = vpEl?.getBoundingClientRect()
              const vpW = vpRect ? vpRect.width : viewportSize.width
              const vpH = vpRect ? vpRect.height : viewportSize.height
              const tilePixelX = ((selectedFishingInfo.tileX + 0.5) / (selectedMap?.width ?? 1)) * sceneSize.width
              const tilePixelY = ((selectedFishingInfo.tileY + 0.5) / (selectedMap?.height ?? 1)) * sceneSize.height
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

              const formatTime = (n: number) => {
                const h = Math.floor(n / 100)
                const m = n % 100
                const hour = h > 12 ? h - 12 : h === 0 ? 12 : h
                const ampm = h >= 12 && h < 24 ? "PM" : "AM"
                return `${hour}:${m.toString().padStart(2, "0")} ${ampm}`
              }

              // Collect seasons available in this area for filter chips
              const allSeasons = ["spring", "summer", "fall", "winter"]
              const availableSeasons = allSeasons.filter((s) =>
                selectedFishingInfo.area?.fish.some((f) => f.seasons.includes(s))
              )
              const hasRainy = selectedFishingInfo.area?.fish.some((f) => f.weather === "rainy") ?? false
              const hasSunny = selectedFishingInfo.area?.fish.some((f) => f.weather === "sunny") ?? false
              const hasTrap = selectedFishingInfo.area?.fish.some((f) => f.isTrap) ?? false
              const tileDepth = selectedFishingInfo.tile.depth

              // Filter + search + sort
              let visibleFish = (selectedFishingInfo.area?.fish ?? []).filter((fish) => {
                // Depth/distance filter: skip fish that can't appear at this tile's depth
                if (!fish.isTrap) {
                  const minDist = fish.minDistanceFromShore
                  const maxDist = fish.maxDistanceFromShore
                  if (minDist > 0 || maxDist > 0) {
                    const fishMinDepth = Math.max(0, minDist - 1)
                    const fishMaxDepth = maxDist > 0 ? Math.min(5, maxDist - 1) : 5
                    if (tileDepth < fishMinDepth || tileDepth > fishMaxDepth) return false
                  }
                }
                if (fishPanelSearch) {
                  const q = fishPanelSearch.toLowerCase()
                  if (!fish.name.toLowerCase().includes(q) && !fish.description.toLowerCase().includes(q)) return false
                }
                if (fishPanelShowTrapOnly && !fish.isTrap) return false
                if (fishPanelSeasonFilter && !fish.seasons.includes(fishPanelSeasonFilter)) return false
                if (fishPanelWeatherFilter && fish.weather !== fishPanelWeatherFilter && !fish.isTrap) return false
                return true
              })
              if (fishPanelSortBy === "price") {
                visibleFish = [...visibleFish].sort((a, b) => b.price - a.price)
              }

              const totalFish = selectedFishingInfo.area?.fish.length ?? 0

              return (
                <div
                  className="absolute z-20 flex flex-col rounded-xl border border-border/60 bg-background/96 shadow-2xl backdrop-blur-xl"
                  style={{ left: `${left}px`, top: `${top}px`, width: `${panelW}px`, maxHeight: `${panelH}px` }}
                  onWheel={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  {/* Header */}
                  <div className="flex shrink-0 items-start justify-between gap-2 border-b border-border/50 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Waves className="h-3.5 w-3.5 shrink-0 text-primary" />
                        <div className="truncate text-sm font-semibold leading-tight">
                          {selectedFishingInfo.area?.name || t("fishingMap.currentWaterArea")}
                        </div>
                        <Badge
                          variant="secondary"
                          className="shrink-0 border border-border/60 bg-secondary/80 text-[10px] text-secondary-foreground"
                        >
                          {t("fishingMap.fishCount", { count: visibleFish.length })}{visibleFish.length < totalFish ? ` / ${totalFish}` : ""}
                        </Badge>
                      </div>
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        {selectedFishingInfo.tile.hidden
                          ? t("fishingMap.tileCoordDepthHidden", {
                              x: selectedFishingInfo.tile.x,
                              y: selectedFishingInfo.tile.y,
                              depth: selectedFishingInfo.tile.depth,
                            })
                          : t("fishingMap.tileCoordDepth", {
                              x: selectedFishingInfo.tile.x,
                              y: selectedFishingInfo.tile.y,
                              depth: selectedFishingInfo.tile.depth,
                            })}
                      </div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); resetFishPanel() }}
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
                    {/* Sort toggle */}
                    <button
                      onClick={() => setFishPanelSortBy((s) => s === "name" ? "price" : "name")}
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
                    {/* Season filters */}
                    {availableSeasons.map((season) => (
                      <button
                        key={season}
                        onClick={() => setFishPanelSeasonFilter((s) => s === season ? null : season)}
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
                    {/* Weather filters */}
                    {hasRainy && (
                      <button
                        onClick={() => setFishPanelWeatherFilter((w) => w === "rainy" ? null : "rainy")}
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
                        onClick={() => setFishPanelWeatherFilter((w) => w === "sunny" ? null : "sunny")}
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
                    {/* Crab pot filter */}
                    {hasTrap && (
                      <button
                        onClick={() => setFishPanelShowTrapOnly((v) => !v)}
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
                            {/* Fish header row */}
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
                                  {/* Price badge */}
                                  {fish.price > 0 && (
                                    <span className="shrink-0 inline-flex items-center gap-0.5 rounded-full border border-yellow-500/30 bg-yellow-500/10 px-1.5 py-0.5 text-[9px] font-bold text-yellow-500">
                                      🪙 {fish.price}{t("fishingMap.priceLabel")}
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

                            {/* Conditions row */}
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
            })()}
          </div>

          {/* Right side floating panel for NPC overlays */}
          <div className="absolute right-4 top-4 z-30 max-h-[80%] w-72 overflow-y-auto rounded-lg border border-border/70 bg-background/88 p-4 shadow-2xl backdrop-blur-xl pointer-events-auto">
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b pb-2">
                <h3 className="text-sm font-semibold flex items-center gap-1.5">
                  <MapIcon className="h-4 w-4 text-primary" />
                  {t("fishingMap.npcOverlay", { defaultValue: "NPC 图层" })}
                </h3>
              </div>
              
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className={cn(
                    "flex items-center gap-2 text-xs cursor-pointer w-full",
                    (!isGameRunning && isModSource) && "opacity-50 cursor-not-allowed text-muted-foreground"
                  )}>
                    <Checkbox
                      checked={showNpcLocations}
                      onCheckedChange={(value) => setShowNpcLocations(Boolean(value))}
                      disabled={!isGameRunning && isModSource}
                    />
                    <span>{t("fishingMap.showNpcLocation", { defaultValue: "显示 NPC 实时位置" })}</span>
                    {loadingLocations && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-auto" />}
                  </label>
                  {(!isGameRunning && isModSource) ? (
                    <div className="text-[10px] text-red-500 font-medium pl-6">
                      游戏未启动，实时位置不可用。
                    </div>
                  ) : (
                    npcLocationError && (
                      <div className="text-[10px] text-red-500 font-medium pl-6">
                        {npcLocationError}
                      </div>
                    )
                  )}
                </div>
                
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <Checkbox
                    checked={showNpcRoute}
                    onCheckedChange={(value) => setShowNpcRoute(Boolean(value))}
                  />
                  <span>{t("fishingMap.showNpcRoute", { defaultValue: "显示 NPC 行动路线" })}</span>
                </label>
              </div>
              
              {showNpcRoute && (
                <div className="space-y-3 pt-3 border-t">
                  <div className="space-y-1" ref={npcDropdownRef}>
                    <span className="text-[11px] font-semibold text-muted-foreground">
                      {t("fishingMap.selectNpc", { defaultValue: "选择 NPC" })}
                    </span>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setIsNpcDropdownOpen(!isNpcDropdownOpen)}
                        className="flex h-9 w-full items-center justify-between rounded-md border border-border/70 bg-background/50 px-2.5 text-xs text-foreground outline-none hover:bg-background/80 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          {selectedNpcId ? (
                            <>
                              {npcPortraits[selectedNpcId] ? (
                                <img
                                  src={npcPortraits[selectedNpcId]}
                                  alt=""
                                  className="h-5 w-5 rounded-full object-cover border border-primary/20 shrink-0"
                                  style={{ imageRendering: "pixelated" }}
                                />
                              ) : (
                                <div className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary shrink-0">
                                  {selectedNpcId.charAt(0)}
                                </div>
                              )}
                              <span>{npcList.find(n => n.id === selectedNpcId)?.name || selectedNpcId}</span>
                            </>
                          ) : (
                            <span className="text-muted-foreground">-- 选择村民 --</span>
                          )}
                        </div>
                        <span className="text-muted-foreground text-[10px]">▼</span>
                      </button>
                      
                      {isNpcDropdownOpen && (
                        <div className="mt-1.5 max-h-48 overflow-y-auto rounded-md border border-border bg-popover/50 pb-1">
                          <div className="w-full px-2 py-1.5 border-b sticky top-0 bg-popover/70 z-10 backdrop-blur-md">
                            <Input
                              placeholder="搜索村民..."
                              value={npcSearchTerm}
                              onChange={(e) => setNpcSearchTerm(e.target.value)}
                              className="h-7 text-xs px-2 bg-background/50 border-border/70"
                            />
                          </div>
                          {npcList
                            .filter(npc => npc.name.toLowerCase().includes(npcSearchTerm.toLowerCase()) || npc.id.toLowerCase().includes(npcSearchTerm.toLowerCase()))
                            .map((npc) => {
                              const portrait = npcPortraits[npc.id]
                              const isSelected = npc.id === selectedNpcId
                              return (
                                <button
                                  key={npc.id}
                                  type="button"
                                  onClick={() => {
                                    setSelectedNpcId(npc.id)
                                    setIsNpcDropdownOpen(false)
                                    setNpcSearchTerm("")
                                  }}
                                  className={cn(
                                    "w-full flex items-center gap-2.5 px-2.5 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer",
                                    isSelected && "bg-accent/50 text-accent-foreground font-semibold"
                                  )}
                                >
                                  {portrait ? (
                                    <img
                                      src={portrait}
                                      alt=""
                                      className="h-5 w-5 rounded-full object-cover border border-primary/20 shrink-0"
                                      style={{ imageRendering: "pixelated" }}
                                    />
                                  ) : (
                                    <div className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary shrink-0">
                                      {npc.name.charAt(0)}
                                    </div>
                                  )}
                                  <span className="truncate">{npc.name}</span>
                                </button>
                              )
                            })}
                        </div>
                      )}
                    </div>
                  </div>

                  {selectedSaveId && (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <span className="text-[10px] font-semibold text-muted-foreground">季节</span>
                        <select
                          value={saveSeason}
                          onChange={(e) => setSaveSeason(Number(e.target.value))}
                          className="h-8 w-full rounded-md border border-border/70 bg-background/50 px-2 text-[11px] text-foreground outline-none"
                        >
                          <option value={0}>春季</option>
                          <option value={1}>夏季</option>
                          <option value={2}>秋季</option>
                          <option value={3}>冬季</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <span className="text-[10px] font-semibold text-muted-foreground">天数</span>
                        <Input
                          type="number"
                          min={1}
                          max={28}
                          value={saveDay}
                          onChange={(e) => {
                            const next = Number(e.target.value)
                            if (Number.isFinite(next)) {
                              setSaveDay(Math.min(28, Math.max(1, next)))
                            }
                          }}
                          className="h-8 px-2 text-[11px] bg-background/50 border-border/70"
                        />
                      </div>
                    </div>
                  )}
                  
                  {selectedNpcId && (
                    <div className="space-y-1.5 pt-2 border-t">
                      <span className="text-[11px] font-semibold text-muted-foreground">
                        {t("fishingMap.npcScheduleTitle", { defaultValue: "日程路线点" })}
                      </span>
                      
                      {loadingSchedule ? (
                        <div className="flex items-center justify-center py-4">
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        </div>
                      ) : schedulePoints.length === 0 ? (
                        <p className="text-[10px] text-muted-foreground text-center py-2">
                          {t("fishingMap.noSchedulePoints", { defaultValue: "今日无日程或不在当前地图" })}
                        </p>
                      ) : (
                        <div className="max-h-40 overflow-y-auto pr-1 space-y-1">
                          {schedulePoints.map((p, idx) => {
                            const isOnCurrentMap = p.location.toLowerCase() === selectedMap?.id.toLowerCase()
                            return (
                              <button
                                key={`list-point-${idx}`}
                                type="button"
                                onClick={() => handleSchedulePointClick(p)}
                                className={cn(
                                  "w-full text-left p-1.5 rounded text-[11px] border transition-colors flex items-center justify-between",
                                  isOnCurrentMap
                                    ? "bg-primary/5 border-primary/20 hover:bg-primary/10 text-foreground"
                                    : "bg-muted/30 border-border/40 hover:bg-muted/50 text-muted-foreground"
                                )}
                                title={isOnCurrentMap ? t("fishingMap.scheduleClickLocate", { defaultValue: "点击定位到此坐标" }) : t("fishingMap.scheduleClickSwitch", { defaultValue: "点击切换地图并定位", location: p.locationDisplayName })}
                              >
                                <div className="truncate">
                                  <span className="font-semibold text-primary/80 mr-1.5">
                                    {formatGameTime(p.time)}
                                  </span>
                                  <span>
                                    {(() => {
                                      const keys = [`maps.${p.location}`, `fishingMap.locations.${p.location}`]
                                      for (const key of keys) {
                                        if (i18n.exists(key, { lng: i18n.language })) {
                                          return t(key, { lng: i18n.language })
                                        }
                                      }
                                      return p.locationDisplayName
                                    })()}
                                  </span>
                                </div>
                                <div className="text-[9px] shrink-0 opacity-80">
                                  {isOnCurrentMap ? `(${p.tileX}, ${p.tileY})` : "➔"}
                                </div>
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
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

            {selectedMap && showFishingOverlay && (
              <div className="pointer-events-auto max-w-full rounded-lg border border-border/70 bg-background/86 px-3 py-2 shadow-xl backdrop-blur-xl">
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Fish className="h-3 w-3 shrink-0" />
                  {t("fishingMap.clickTileToView")}
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
