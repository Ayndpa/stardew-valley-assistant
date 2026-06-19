import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import {
  Search,
  Heart,
  Info,
  Users,
  Sparkles,
  Gift,
  MapPin,
  Radar,
  PackagePlus,
} from "lucide-react"

interface FriendshipInfo {
  npcName: string
  points: number
  giftsThisWeek: number
  giftsToday: number
  talkedToToday: boolean
  status: string
}

interface SaveSummary {
  id: string
  playerName: string
  farmName: string
  dayOfMonth?: number
  season?: number
}

interface SaveDetail {
  summary: SaveSummary
  friendships: FriendshipInfo[]
}

interface NpcProfile {
  id: string
  name: string
  birthday?: string | null
  gender: "marriageable_male" | "marriageable_female" | "other"
  marriageCandidate: boolean
  lovedItems: string[]
  hatedItems: string[]
}

interface NpcGameData {
  npcs: NpcProfile[]
}

type NpcLocationSource = "estimate" | "mod"

interface NpcLocationInfo {
  npcName: string
  location: string
  locationDisplayName: string
  tileX?: number | null
  tileY?: number | null
  direction?: number | null
  scheduleKey?: string | null
  scheduleTime?: number | null
  source: NpcLocationSource
  confidence: string
  updatedAt?: string | null
}

interface NpcLocationsResult {
  source: NpcLocationSource
  saveId?: string | null
  gameTime?: number | null
  locations: NpcLocationInfo[]
  error?: string | null
}

interface LocalCacheEntry<T> {
  data: T
  fetchedAt: number
}

const NPC_PROFILES_CACHE_KEY = "stardew_npc_profiles_cache_v2"
const NPC_PORTRAITS_CACHE_KEY = "stardew_npc_portraits_cache"
const NPC_FRIENDSHIPS_CACHE_KEY = "stardew_npc_friendships_cache"
const NPC_LOCATION_SOURCE_KEY = "stardew_npc_location_source"

function normalizeGameDir(gameDir: string) {
  return gameDir.trim().toLowerCase()
}

function readCache<T>(key: string): LocalCacheEntry<T> | null {
  if (typeof window === "undefined") return null

  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as LocalCacheEntry<T>
  } catch (error) {
    console.error(`Failed to read cache: ${key}`, error)
    return null
  }
}

function writeCache<T>(key: string, data: T) {
  if (typeof window === "undefined") return

  try {
    const entry: LocalCacheEntry<T> = {
      data,
      fetchedAt: Date.now(),
    }
    window.localStorage.setItem(key, JSON.stringify(entry))
  } catch (error) {
    console.error(`Failed to write cache: ${key}`, error)
  }
}

function getProfilesCacheKey(gameDir: string, lang: string) {
  return `${NPC_PROFILES_CACHE_KEY}:${normalizeGameDir(gameDir) || "default"}:${lang}`
}

function getPortraitsCacheKey(gameDir: string, npcIds: string[]) {
  return `${NPC_PORTRAITS_CACHE_KEY}:${normalizeGameDir(gameDir) || "default"}:${npcIds.join(",")}`
}

function getFriendshipsCacheKey(saveId: string) {
  return `${NPC_FRIENDSHIPS_CACHE_KEY}:${saveId}`
}

function HeartBar({ hearts, maxHearts }: { hearts: number; maxHearts: number }) {
  return (
    <div className="flex items-center gap-0.5 flex-wrap">
      {Array.from({ length: maxHearts }).map((_, i) => (
        <Heart
          key={i}
          className={`h-3.5 w-3.5 ${
            i < hearts ? "fill-red-500 text-red-500" : "text-muted-foreground/30"
          }`}
        />
      ))}
    </div>
  )
}

interface NPCsProps {
  selectedSaveId: string
  onNavigateToItem: (itemName: string) => void
  onInstallNpcLocationsMod: () => void | Promise<void>
}

function NPCPortrait({
  name,
  portrait,
  size,
  selected = false,
}: {
  name: string
  portrait?: string
  size: "sm" | "lg"
  selected?: boolean
}) {
  const sizeClass = size === "lg" ? "h-16 w-16" : "h-9 w-9"
  const textClass = size === "lg" ? "text-2xl" : "text-sm"

  if (portrait) {
    return (
      <div className={`${sizeClass} shrink-0 overflow-hidden rounded-md border bg-background ${selected ? "border-primary-foreground/40" : "border-primary/20"}`}>
        <img
          src={portrait}
          alt={`${name}头像`}
          className="h-full w-full object-cover"
          style={{ imageRendering: "pixelated" }}
        />
      </div>
    )
  }

  return (
    <div className={`${sizeClass} shrink-0 rounded-md flex items-center justify-center font-bold ${textClass} ${selected ? "bg-primary-foreground/20 text-primary-foreground" : "bg-primary/10 text-primary"}`}>
      {name.charAt(0)}
    </div>
  )
}

export function NPCs({ selectedSaveId, onNavigateToItem, onInstallNpcLocationsMod }: NPCsProps) {
  const { t, i18n } = useTranslation()
  const [searchTerm, setSearchTerm] = useState("")
  const [selectedNpcId, setSelectedNpcId] = useState<string | null>(null)
  const [friendships, setFriendships] = useState<Record<string, FriendshipInfo>>({})
  const [npcProfiles, setNpcProfiles] = useState<NpcProfile[]>([])
  const [npcPortraits, setNpcPortraits] = useState<Record<string, string>>({})
  const [loadingProfiles, setLoadingProfiles] = useState(true)
  const [loadingFriendships, setLoadingFriendships] = useState(true)
  const [npcLocations, setNpcLocations] = useState<Record<string, NpcLocationInfo>>({})
  const [locationSource, setLocationSource] = useState<NpcLocationSource>(() => {
    if (typeof window === "undefined") return "estimate"
    return window.localStorage.getItem(NPC_LOCATION_SOURCE_KEY) === "mod" ? "mod" : "estimate"
  })
  const [loadingLocations, setLoadingLocations] = useState(false)
  const [locationError, setLocationError] = useState<string | null>(null)
  const [locationGameTime, setLocationGameTime] = useState<number | null>(null)
  const [pipeConnected, setPipeConnected] = useState<boolean>(false)
  const [gameRunning, setGameRunning] = useState<boolean>(false)
  const [estimateSeason, setEstimateSeason] = useState(0)
  const [estimateDay, setEstimateDay] = useState(1)
  const [estimateTime, setEstimateTime] = useState<number | null>(null)

  const activeLang = i18n.resolvedLanguage || i18n.language || "zh"

  const relationshipStatusLabels: Record<string, string> = {
    Friendly: t("npcs.relationships.friendly", { defaultValue: "友好" }),
    Dating: t("npcs.relationships.dating", { defaultValue: "恋爱中" }),
    Engaged: t("npcs.relationships.engaged", { defaultValue: "已订婚" }),
    Married: t("npcs.relationships.married", { defaultValue: "配偶" }),
    Divorced: t("npcs.relationships.divorced", { defaultValue: "离异" }),
  }

  const seasonOptions = useMemo(() => [
    { value: 0, label: t("npcs.seasons.spring", { defaultValue: "春季" }) },
    { value: 1, label: t("npcs.seasons.summer", { defaultValue: "夏季" }) },
    { value: 2, label: t("npcs.seasons.fall", { defaultValue: "秋季" }) },
    { value: 3, label: t("npcs.seasons.winter", { defaultValue: "冬季" }) },
  ], [t])

  function formatGameTime(time?: number | null) {
    if (!time) return t("npcs.unknownTime", { defaultValue: "未知时间" })
    const hour = Math.floor(time / 100)
    const minute = time % 100
    return `${hour}:${minute.toString().padStart(2, "0")}`
  }

  function formatTile(location?: NpcLocationInfo) {
    if (!location || location.tileX == null || location.tileY == null) return t("npcs.unknownCoordinates", { defaultValue: "坐标未知" })
    return `${location.tileX}, ${location.tileY}`
  }

  function getLocalizedLocationName(locationInfo?: NpcLocationInfo) {
    if (!locationInfo) return ""
    const key = `maps.${locationInfo.location}`
    const localized = t(key)
    if (localized !== key) {
      return localized
    }
    if (i18n.language.startsWith("zh")) {
      return locationInfo.locationDisplayName || locationInfo.location
    }
    return locationInfo.location
  }

  function gameTimeOptions() {
    const options: number[] = []
    for (let hour = 6; hour <= 26; hour += 1) {
      for (let minute = 0; minute <= 50; minute += 10) {
        const time = hour * 100 + minute
        if (time >= 600 && time <= 2600) {
          options.push(time)
        }
      }
    }
    return options
  }

  useEffect(() => {
    const checkStatus = async () => {
      const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__
      if (!isTauri) return
      try {
        const { invoke } = await import("@tauri-apps/api/core")
        const status = await invoke<{ pipeConnected: boolean; gameRunning: boolean }>("check_pipe_status")
        setPipeConnected(status.pipeConnected)
        setGameRunning(status.gameRunning)
      } catch {
        setPipeConnected(false)
        setGameRunning(false)
      }
    }
    checkStatus()
    const timer = setInterval(checkStatus, 5000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    let canceled = false

    async function loadNpcProfiles() {
      const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__
      const gameDir = localStorage.getItem("stardewGameDirectory") || ""
      const cacheKey = getProfilesCacheKey(gameDir, activeLang)
      const cached = readCache<NpcProfile[]>(cacheKey)

      if (cached && !canceled) {
        setNpcProfiles(cached.data)
        setLoadingProfiles(false)
      }

      if (!isTauri) {
        if (!canceled) {
          setLoadingProfiles(false)
        }
        return
      }

      if (!cached && !canceled) {
        setLoadingProfiles(true)
      }

      try {
        const { invoke } = await import("@tauri-apps/api/core")
        const data = await invoke("get_npc_game_data", {
          gameDir: gameDir.trim() || undefined,
          lang: activeLang,
        }) as NpcGameData
        if (!canceled) {
          setNpcProfiles(data.npcs)
        }
        writeCache(cacheKey, data.npcs)
      } catch (err) {
        console.error("Error loading NPC game data:", err)
        if (!cached && !canceled) {
          setNpcProfiles([])
        }
      } finally {
        if (!canceled) {
          setLoadingProfiles(false)
        }
      }
    }

    loadNpcProfiles()

    return () => {
      canceled = true
    }
  }, [activeLang])

  useEffect(() => {
    let canceled = false

    async function loadPortraits() {
      const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__
      if (!isTauri || npcProfiles.length === 0) return

      const gameDir = localStorage.getItem("stardewGameDirectory") || ""
      const cacheKey = getPortraitsCacheKey(gameDir, npcProfiles.map((npc) => npc.id))
      const cached = readCache<Record<string, string>>(cacheKey)

      if (cached && !canceled) {
        setNpcPortraits(cached.data)
        return
      }

      try {
        const { invoke } = await import("@tauri-apps/api/core")
        const portraits = await invoke<Record<string, string>>("get_npc_portraits", {
          npcIds: npcProfiles.map((npc) => npc.id),
          gameDir: gameDir.trim() || undefined,
        })
        if (!canceled) {
          setNpcPortraits(portraits)
        }
        writeCache(cacheKey, portraits)
      } catch (err) {
        console.error("Error loading NPC portraits:", err)
        if (!canceled) {
          setNpcPortraits({})
        }
      }
    }

    loadPortraits()

    return () => {
      canceled = true
    }
  }, [npcProfiles])

  useEffect(() => {
    let canceled = false

    async function loadFriendships() {
      if (!selectedSaveId) {
        setFriendships({})
        setLoadingFriendships(false)
        return
      }

      const cacheKey = getFriendshipsCacheKey(selectedSaveId)
      const cached = readCache<Record<string, FriendshipInfo>>(cacheKey)

      if (cached && !canceled) {
        setFriendships(cached.data)
        setLoadingFriendships(false)
      } else {
        setLoadingFriendships(true)
      }

      const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__
      if (!isTauri) {
        if (!canceled) {
          setLoadingFriendships(false)
        }
        return
      }

      try {
        const { invoke } = await import("@tauri-apps/api/core")
        const detail: SaveDetail = await invoke("get_save_detail", { id: selectedSaveId })
        const map: Record<string, FriendshipInfo> = {}
        detail.friendships.forEach((f) => {
          map[f.npcName] = f
        })
        if (!canceled) {
          setFriendships(map)
          if (typeof detail.summary.season === "number") {
            setEstimateSeason(detail.summary.season)
          }
          if (typeof detail.summary.dayOfMonth === "number") {
            setEstimateDay(Math.min(28, Math.max(1, detail.summary.dayOfMonth)))
          }
        }
        writeCache(cacheKey, map)
      } catch (err) {
        console.error("Error loading friendships:", err)
        if (!cached && !canceled) {
          setFriendships({})
        }
      } finally {
        if (!canceled) {
          setLoadingFriendships(false)
        }
      }
    }

    loadFriendships()

    return () => {
      canceled = true
    }
  }, [selectedSaveId])

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(NPC_LOCATION_SOURCE_KEY, locationSource)
    }

    let canceled = false

    async function loadNpcLocations() {
      if (!selectedSaveId) {
        setNpcLocations({})
        setLocationError(null)
        setLocationGameTime(null)
        setLoadingLocations(false)
        return
      }

      const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__
      if (!isTauri) {
        setLoadingLocations(false)
        setLocationError(t("npcs.desktopAppRequired", { defaultValue: "桌面应用中才能读取 NPC 位置。" }))
        return
      }

      setLoadingLocations(true)
      setLocationError(null)

      try {
        const { invoke } = await import("@tauri-apps/api/core")
        const gameDir = localStorage.getItem("stardewGameDirectory") || ""
        const result = await invoke<NpcLocationsResult>("get_npc_locations", {
          saveId: selectedSaveId,
          gameDir: gameDir.trim() || undefined,
          source: locationSource,
          season: estimateSeason,
          day: estimateDay,
          time: estimateTime ?? undefined,
        })
        const map: Record<string, NpcLocationInfo> = {}
        result.locations.forEach((location) => {
          map[location.npcName] = location
        })
        if (!canceled) {
          setNpcLocations(map)
          setLocationGameTime(result.gameTime ?? null)
          setLocationError(result.error ?? null)
        }
      } catch (err) {
        console.error("Error loading NPC locations:", err)
        if (!canceled) {
          setNpcLocations({})
          setLocationGameTime(null)
          setLocationError(err instanceof Error ? err.message : String(err))
        }
      } finally {
        if (!canceled) {
          setLoadingLocations(false)
        }
      }
    }

    loadNpcLocations()

    return () => {
      canceled = true
    }
  }, [estimateDay, estimateSeason, estimateTime, locationSource, selectedSaveId, t])

  const npcList = useMemo(() => {
    const profileMap = new Map(npcProfiles.map((npc) => [npc.id, npc]))

    Object.values(friendships).forEach((friendship) => {
      if (!profileMap.has(friendship.npcName)) {
        profileMap.set(friendship.npcName, {
          id: friendship.npcName,
          name: friendship.npcName,
          birthday: null,
          gender: "other",
          marriageCandidate: false,
          lovedItems: [],
          hatedItems: [],
        })
      }
    })

    return Array.from(profileMap.values()).map((npc) => {
      const friendData = friendships[npc.id]
      const points = friendData?.points || 0
      const hearts = Math.floor(points / 250)
      const maxHearts = npc.gender !== "other" && friendData?.status === "Married" ? 14 : 10

      return {
        ...npc,
        points,
        hearts,
        maxHearts,
        giftsThisWeek: friendData?.giftsThisWeek || 0,
        giftsToday: friendData?.giftsToday || 0,
        talkedToToday: friendData?.talkedToToday || false,
        status: friendData?.status || "Friendly",
        isMet: !!friendData,
        portrait: npcPortraits[npc.id],
        locationInfo: npcLocations[npc.id],
      }
    })
  }, [friendships, npcLocations, npcPortraits, npcProfiles])

  const timeOptions = useMemo(() => gameTimeOptions(), [])

  const filteredNPCs = useMemo(() => {
    return npcList
      .filter((npc) =>
        npc.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        npc.id.toLowerCase().includes(searchTerm.toLowerCase()),
      )
      .sort((a, b) => {
        if (a.isMet && !b.isMet) return -1
        if (!a.isMet && b.isMet) return 1
        if (b.points !== a.points) return b.points - a.points
        return a.name.localeCompare(b.name)
      })
  }, [npcList, searchTerm])

  useEffect(() => {
    if (filteredNPCs.length === 0) {
      if (selectedNpcId) {
        setSelectedNpcId(null)
      }
      return
    }

    const stillVisible = selectedNpcId && filteredNPCs.some((npc) => npc.id === selectedNpcId)
    if (!stillVisible) {
      setSelectedNpcId(filteredNPCs[0].id)
    }
  }, [filteredNPCs, selectedNpcId])

  const activeNPC = selectedNpcId
    ? npcList.find((npc) => npc.id === selectedNpcId) || null
    : null

  const loading = loadingProfiles || loadingFriendships

  return (
    <div className="p-8 space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">{t("npcs.title")}</h2>
        <p className="text-muted-foreground mt-1">
          {t("npcs.description")}
        </p>
      </div>

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 rounded-lg border bg-background p-3">
        <div className="flex items-center gap-2 min-w-0">
          <Radar className="h-4 w-4 text-primary shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold">{t("npcs.locationSource")}</p>
            <p className="text-xs text-muted-foreground truncate">
              {locationSource === "estimate"
                ? `${t("npcs.locationSourceEstimate")}${locationGameTime ? ` · ${formatGameTime(locationGameTime)}` : ""}`
                : t("npcs.locationSourceMod")}
              {loadingLocations ? ` · ${t("npcs.refreshing")}` : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant={locationSource === "estimate" ? "default" : "secondary"}
            size="sm"
            onClick={() => setLocationSource("estimate")}
          >
            {t("npcs.gameLogicEstimateButton")}
          </Button>
          <Button
            type="button"
            variant={locationSource === "mod" ? "default" : "secondary"}
            size="sm"
            onClick={() => setLocationSource("mod")}
          >
            {t("npcs.modRealtimeButton")}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 rounded-lg border bg-background p-3">
        <label className="space-y-1">
          <span className="text-xs font-semibold text-muted-foreground">{t("npcs.estimateSeasonLabel")}</span>
          <select
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={estimateSeason}
            onChange={(event) => setEstimateSeason(Number(event.currentTarget.value))}
          >
            {seasonOptions.map((season) => (
              <option key={season.value} value={season.value}>
                {season.label}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className="text-xs font-semibold text-muted-foreground">{t("npcs.estimateDayLabel")}</span>
          <Input
            type="number"
            min={1}
            max={28}
            value={estimateDay}
            onChange={(event) => {
              const next = Number(event.currentTarget.value)
              if (Number.isFinite(next)) {
                setEstimateDay(Math.min(28, Math.max(1, next)))
              }
            }}
          />
        </label>

        <label className="space-y-1">
          <span className="text-xs font-semibold text-muted-foreground">{t("npcs.estimateTimeLabel")}</span>
          <select
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={estimateTime ?? ""}
            onChange={(event) => {
              const value = event.currentTarget.value
              setEstimateTime(value ? Number(value) : null)
            }}
          >
            <option value="">{t("npcs.saveCurrentTimeOption")}</option>
            {timeOptions.map((time) => (
              <option key={time} value={time}>
                {formatGameTime(time)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {locationSource === "mod" && !pipeConnected ? (
        <div className="flex flex-col gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-sm text-amber-700 dark:text-amber-300 md:flex-row md:items-center md:justify-between">
          <span>{t("fishingMap.pipeNotConnected", { defaultValue: "助手应用未运行，实时位置不可用。" })}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 shrink-0 gap-2 border-amber-500/40 bg-background/80 text-amber-700 hover:bg-amber-500/10 dark:text-amber-300"
            onClick={() => void onInstallNpcLocationsMod()}
          >
            <PackagePlus className="h-4 w-4" />
            {t("npcs.installLocationsModButton")}
          </Button>
        </div>
      ) : locationSource === "mod" && pipeConnected && !gameRunning ? (
        <div className="flex flex-col gap-3 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-3 text-sm text-blue-700 dark:text-blue-300">
          <span>{t("fishingMap.pipeConnectedNoData", { defaultValue: "Mod 已连接，请加载存档以启用实时位置。" })}</span>
        </div>
      ) : locationError && (
        <div className="flex flex-col gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-sm text-amber-700 dark:text-amber-300 md:flex-row md:items-center md:justify-between">
          <span>{locationError}</span>
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-6">
        <div className="w-full lg:w-80 space-y-4 shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t("npcs.searchPlaceholder")}
              className="pl-10"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.currentTarget.value)}
            />
          </div>

          <div className="h-[60vh] overflow-y-auto border rounded-lg p-2 space-y-1 bg-accent/10">
            {loadingProfiles ? (
              <div className="flex flex-col items-center justify-center h-full space-y-2">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
                <p className="text-xs text-muted-foreground">{t("npcs.loadingProfiles")}</p>
              </div>
            ) : filteredNPCs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full space-y-3 text-center px-4">
                <Users className="h-10 w-10 text-muted-foreground/30" />
                <p className="text-sm font-semibold text-muted-foreground">{t("npcs.noProfilesFound")}</p>
                <p className="text-xs text-muted-foreground/70">
                  {t("npcs.noProfilesFoundDesc")}
                </p>
              </div>
            ) : filteredNPCs.map((npc) => (
              <button
                key={npc.id}
                className={`w-full flex items-center gap-3 p-2.5 rounded-lg text-left transition-colors ${
                  selectedNpcId === npc.id
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-accent/50"
                }`}
                onClick={() => setSelectedNpcId(npc.id)}
              >
                <NPCPortrait
                  name={npc.name}
                  portrait={npc.portrait}
                  size="sm"
                  selected={selectedNpcId === npc.id}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-center gap-2">
                    <p className="text-sm font-semibold truncate">{npc.name}</p>
                    {npc.status !== "Friendly" && (
                      <span className={`text-[10px] whitespace-nowrap ${selectedNpcId === npc.id ? "text-primary-foreground/80" : "text-primary"}`}>
                        {relationshipStatusLabels[npc.status] || npc.status}
                      </span>
                    )}
                  </div>
                  <HeartBar hearts={npc.hearts} maxHearts={npc.maxHearts} />
                  <p className={`mt-1 flex items-center gap-1 text-[11px] truncate ${selectedNpcId === npc.id ? "text-primary-foreground/75" : "text-muted-foreground"}`}>
                    <MapPin className="h-3 w-3 shrink-0" />
                    {getLocalizedLocationName(npc.locationInfo) || t("npcs.unknownLocation")}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1">
          {activeNPC ? (
            <Card className="h-full">
              <CardHeader className="pb-4 border-b bg-accent/5">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <NPCPortrait
                      name={activeNPC.name}
                      portrait={activeNPC.portrait}
                      size="lg"
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-2xl font-bold">{activeNPC.name}</CardTitle>
                        {activeNPC.marriageCandidate && (
                          <Badge variant="secondary" className="text-xs font-semibold">
                            {t("npcs.marriageCandidate")}
                          </Badge>
                        )}
                        {activeNPC.locationInfo && (
                          <Badge variant="secondary" className="text-xs font-semibold">
                            {t("npcs.confidence." + activeNPC.locationInfo.confidence, { defaultValue: activeNPC.locationInfo.confidence })}
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        {t("npcs.birthdayLabel", { birthday: activeNPC.birthday || t("npcs.birthdayNotProvided", { defaultValue: "游戏中未提供" }), id: activeNPC.id })}
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-2 flex-wrap">
                    {selectedSaveId ? (
                      <>
                        {activeNPC.talkedToToday ? (
                          <Badge className="bg-green-500 hover:bg-green-600 text-xs font-medium py-1 px-2.5">
                            {t("npcs.talkedToToday")}
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs font-medium py-1 px-2.5">
                            {t("npcs.notTalkedToToday")}
                          </Badge>
                        )}

                        {activeNPC.giftsToday > 0 ? (
                          <Badge className="bg-amber-500 hover:bg-amber-600 text-xs font-medium py-1 px-2.5">
                            {t("npcs.giftedToday")}
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs font-medium py-1 px-2.5">
                            {t("npcs.notGiftedToday")}
                          </Badge>
                        )}
                      </>
                    ) : (
                      <Badge variant="secondary" className="text-xs font-medium py-1 px-2.5">
                        {t("npcs.interactionStatusSaveNeeded")}
                      </Badge>
                    )}
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-6 pt-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-accent/20 p-4 rounded-lg">
                  <div>
                    <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                      <Heart className="h-4 w-4 text-red-500 fill-red-500" />
                      {t("npcs.friendshipProgress")}
                    </h3>
                    <div className="flex items-center gap-2">
                      <HeartBar hearts={activeNPC.hearts} maxHearts={activeNPC.maxHearts} />
                      <span className="text-sm font-bold">
                        {t("npcs.heartsCount", { current: activeNPC.hearts, max: activeNPC.maxHearts })}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t("npcs.heartsPoints", { current: activeNPC.points, max: activeNPC.maxHearts * 250 })}
                    </p>
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                      <Gift className="h-4 w-4 text-amber-500" />
                      {t("npcs.weeklyGiftLimit")}
                    </h3>
                    <div className="flex items-center gap-2">
                      <div className="w-full bg-muted rounded-full h-2 overflow-hidden flex-1">
                        <div
                          className="h-full rounded-full bg-amber-500 transition-all duration-300"
                          style={{ width: `${Math.min(activeNPC.giftsThisWeek, 2) / 2 * 100}%` }}
                        />
                      </div>
                      <span className="text-sm font-bold">{t("npcs.giftsCount", { count: activeNPC.giftsThisWeek })}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {selectedSaveId
                        ? activeNPC.giftsThisWeek >= 2
                          ? t("npcs.giftsLimitReached")
                          : t("npcs.giftsLimitRemaining", { count: Math.max(0, 2 - activeNPC.giftsThisWeek) })
                        : t("npcs.giftProgressSaveNeeded")}
                    </p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    <h4 className="text-sm font-bold">{t("npcs.villagerStatus")}</h4>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                    <div className="border p-2.5 rounded-md bg-background">
                      <p className="text-muted-foreground">{t("npcs.relationshipStatus")}</p>
                      <p className="font-semibold text-sm mt-0.5">
                        {relationshipStatusLabels[activeNPC.status] || activeNPC.status}
                      </p>
                    </div>
                    <div className="border p-2.5 rounded-md bg-background">
                      <p className="text-muted-foreground">{t("npcs.isMetLabel")}</p>
                      <p className="font-semibold text-sm mt-0.5">
                        {activeNPC.isMet ? t("npcs.isMet") : t("npcs.notMet")}
                      </p>
                    </div>
                    <div className="border p-2.5 rounded-md bg-background">
                      <p className="text-muted-foreground">{t("npcs.socialType")}</p>
                      <p className="font-semibold text-sm mt-0.5">
                        {activeNPC.gender === "marriageable_female"
                          ? t("npcs.gender.marriageableFemale")
                          : activeNPC.gender === "marriageable_male"
                            ? t("npcs.gender.marriageableMale")
                            : t("npcs.gender.other")}
                      </p>
                    </div>
                    <div className="border p-2.5 rounded-md bg-background">
                      <p className="text-muted-foreground">{t("npcs.socialPoints")}</p>
                      <p className="font-semibold text-sm mt-0.5">{t("npcs.heartsPoints", { current: activeNPC.points, max: activeNPC.maxHearts * 250 })}</p>
                    </div>
                    <div className="border p-2.5 rounded-md bg-background">
                      <p className="text-muted-foreground">{t("npcs.currentLocation")}</p>
                      <p className="font-semibold text-sm mt-0.5 truncate">
                        {getLocalizedLocationName(activeNPC.locationInfo) || t("npcs.unknown")}
                      </p>
                      {activeNPC.locationInfo && i18n.language.startsWith("zh") && activeNPC.locationInfo.locationDisplayName !== activeNPC.locationInfo.location && (
                        <p className="text-[11px] text-muted-foreground truncate">
                          {activeNPC.locationInfo.location}
                        </p>
                      )}
                    </div>
                    <div className="border p-2.5 rounded-md bg-background">
                      <p className="text-muted-foreground">{t("npcs.locationCoordinates")}</p>
                      <p className="font-semibold text-sm mt-0.5">
                        {formatTile(activeNPC.locationInfo)}
                      </p>
                    </div>
                    <div className="border p-2.5 rounded-md bg-background">
                      <p className="text-muted-foreground">{t("npcs.scheduleTime")}</p>
                      <p className="font-semibold text-sm mt-0.5">
                        {formatGameTime(activeNPC.locationInfo?.scheduleTime)}
                      </p>
                    </div>
                    <div className="border p-2.5 rounded-md bg-background">
                      <p className="text-muted-foreground">{t("npcs.scheduleKey")}</p>
                      <p className="font-semibold text-sm mt-0.5 truncate">
                        {activeNPC.locationInfo?.scheduleKey || (locationSource === "mod" ? t("npcs.realTime") : t("npcs.unknown"))}
                      </p>
                    </div>
                  </div>
                </div>

                <Separator />

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  <div className="rounded-lg border bg-background p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Gift className="h-4 w-4 text-emerald-600" />
                      <h3 className="text-sm font-bold">{t("npcs.lovedItems")}</h3>
                    </div>
                    {activeNPC.lovedItems.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {activeNPC.lovedItems.map((item) => (
                          <Button
                            key={item}
                            type="button"
                            variant="secondary"
                            size="sm"
                            className="h-7 px-2.5 text-xs"
                            onClick={() => onNavigateToItem(item)}
                            title={t("npcs.viewItemEncyclopedia", { item })}
                          >
                            {item}
                          </Button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">{t("npcs.noLovedItems")}</p>
                    )}
                  </div>

                  <div className="rounded-lg border bg-background p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Gift className="h-4 w-4 text-rose-600" />
                      <h3 className="text-sm font-bold">{t("npcs.hatedItems")}</h3>
                    </div>
                    {activeNPC.hatedItems.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {activeNPC.hatedItems.map((item) => (
                          <Button
                            key={item}
                            type="button"
                            variant="secondary"
                            size="sm"
                            className="h-7 px-2.5 text-xs"
                            onClick={() => onNavigateToItem(item)}
                            title={t("npcs.viewItemEncyclopedia", { item })}
                          >
                            {item}
                          </Button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">{t("npcs.noHatedItems")}</p>
                    )}
                  </div>
                </div>

              </CardContent>
            </Card>
          ) : (
            <Card className="h-full">
              <CardContent className="flex flex-col items-center justify-center py-20">
                <Info className="h-12 w-12 text-muted-foreground/40 mb-4" />
                <p className="text-muted-foreground">
                  {loading ? t("npcs.loadingPanel") : t("npcs.noNpcSelected")}
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
