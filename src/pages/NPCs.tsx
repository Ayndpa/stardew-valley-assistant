import { useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import {
  Search,
  Heart,
  Info,
  Users,
  Sparkles,
  Gift,
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

interface LocalCacheEntry<T> {
  data: T
  fetchedAt: number
}

const relationshipStatusMap: Record<string, string> = {
  Friendly: "友好",
  Dating: "恋爱中",
  Engaged: "已订婚",
  Married: "配偶",
  Divorced: "离异",
}

const NPC_PROFILES_CACHE_KEY = "stardew_npc_profiles_cache_v2"
const NPC_PORTRAITS_CACHE_KEY = "stardew_npc_portraits_cache"
const NPC_FRIENDSHIPS_CACHE_KEY = "stardew_npc_friendships_cache"

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

function getProfilesCacheKey(gameDir: string) {
  return `${NPC_PROFILES_CACHE_KEY}:${normalizeGameDir(gameDir) || "default"}`
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

export function NPCs({ selectedSaveId }: NPCsProps) {
  const [searchTerm, setSearchTerm] = useState("")
  const [selectedNpcId, setSelectedNpcId] = useState<string | null>(null)
  const [friendships, setFriendships] = useState<Record<string, FriendshipInfo>>({})
  const [npcProfiles, setNpcProfiles] = useState<NpcProfile[]>([])
  const [npcPortraits, setNpcPortraits] = useState<Record<string, string>>({})
  const [loadingProfiles, setLoadingProfiles] = useState(true)
  const [loadingFriendships, setLoadingFriendships] = useState(true)

  useEffect(() => {
    let canceled = false

    async function loadNpcProfiles() {
      const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__
      const gameDir = localStorage.getItem("stardewGameDirectory") || ""
      const cacheKey = getProfilesCacheKey(gameDir)
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
  }, [])

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
      }
    })
  }, [friendships, npcPortraits, npcProfiles])

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
        <h2 className="text-3xl font-bold tracking-tight">村民关系</h2>
        <p className="text-muted-foreground mt-1">
          从游戏内容与存档自动解析村民资料、生日和当前好感度
        </p>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        <div className="w-full lg:w-80 space-y-4 shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="搜索村民姓名或内部 ID..."
              className="pl-10"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.currentTarget.value)}
            />
          </div>

          <div className="h-[60vh] overflow-y-auto border rounded-lg p-2 space-y-1 bg-accent/10">
            {loadingProfiles ? (
              <div className="flex flex-col items-center justify-center h-full space-y-2">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
                <p className="text-xs text-muted-foreground">正在从游戏内容解析村民资料...</p>
              </div>
            ) : filteredNPCs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full space-y-3 text-center px-4">
                <Users className="h-10 w-10 text-muted-foreground/30" />
                <p className="text-sm font-semibold text-muted-foreground">未找到村民资料</p>
                <p className="text-xs text-muted-foreground/70">
                  请确认游戏目录配置正确，或稍后重新加载当前页面。
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
                        {relationshipStatusMap[npc.status] || npc.status}
                      </span>
                    )}
                  </div>
                  <HeartBar hearts={npc.hearts} maxHearts={npc.maxHearts} />
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
                            可结婚角色
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        生日: {activeNPC.birthday || "游戏中未提供"} · 内部标识: {activeNPC.id}
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-2 flex-wrap">
                    {selectedSaveId ? (
                      <>
                        {activeNPC.talkedToToday ? (
                          <Badge className="bg-green-500 hover:bg-green-600 text-xs font-medium py-1 px-2.5">
                            今天已交谈
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs font-medium py-1 px-2.5">
                            今天未交谈
                          </Badge>
                        )}

                        {activeNPC.giftsToday > 0 ? (
                          <Badge className="bg-amber-500 hover:bg-amber-600 text-xs font-medium py-1 px-2.5">
                            今天已送礼
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs font-medium py-1 px-2.5">
                            今天未送礼
                          </Badge>
                        )}
                      </>
                    ) : (
                      <Badge variant="secondary" className="text-xs font-medium py-1 px-2.5">
                        选择存档后显示互动状态
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
                      好感度进度
                    </h3>
                    <div className="flex items-center gap-2">
                      <HeartBar hearts={activeNPC.hearts} maxHearts={activeNPC.maxHearts} />
                      <span className="text-sm font-bold">
                        {activeNPC.hearts} / {activeNPC.maxHearts} 心
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      当前点数: {activeNPC.points} 点 / {activeNPC.maxHearts * 250} 点
                    </p>
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                      <Gift className="h-4 w-4 text-amber-500" />
                      本周送礼限制
                    </h3>
                    <div className="flex items-center gap-2">
                      <div className="w-full bg-muted rounded-full h-2 overflow-hidden flex-1">
                        <div
                          className="h-full rounded-full bg-amber-500 transition-all duration-300"
                          style={{ width: `${Math.min(activeNPC.giftsThisWeek, 2) / 2 * 100}%` }}
                        />
                      </div>
                      <span className="text-sm font-bold">{activeNPC.giftsThisWeek} / 2 次</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {selectedSaveId
                        ? activeNPC.giftsThisWeek >= 2
                          ? "本周送礼已达上限，周日后重置。"
                          : `本周还可送礼 ${Math.max(0, 2 - activeNPC.giftsThisWeek)} 次。`
                        : "选择存档后显示当前周送礼进度。"}
                    </p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    <h4 className="text-sm font-bold">村民状态</h4>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                    <div className="border p-2.5 rounded-md bg-background">
                      <p className="text-muted-foreground">关系状态</p>
                      <p className="font-semibold text-sm mt-0.5">
                        {relationshipStatusMap[activeNPC.status] || activeNPC.status}
                      </p>
                    </div>
                    <div className="border p-2.5 rounded-md bg-background">
                      <p className="text-muted-foreground">是否结识</p>
                      <p className="font-semibold text-sm mt-0.5">
                        {activeNPC.isMet ? "已结识" : "未结识"}
                      </p>
                    </div>
                    <div className="border p-2.5 rounded-md bg-background">
                      <p className="text-muted-foreground">社交类型</p>
                      <p className="font-semibold text-sm mt-0.5">
                        {activeNPC.gender === "marriageable_female"
                          ? "单身女性"
                          : activeNPC.gender === "marriageable_male"
                            ? "单身男性"
                            : "普通居民"}
                      </p>
                    </div>
                    <div className="border p-2.5 rounded-md bg-background">
                      <p className="text-muted-foreground">社交成就点</p>
                      <p className="font-semibold text-sm mt-0.5">{activeNPC.points} 点</p>
                    </div>
                  </div>
                </div>

                <Separator />

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  <div className="rounded-lg border bg-background p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Gift className="h-4 w-4 text-emerald-600" />
                      <h3 className="text-sm font-bold">喜爱物品</h3>
                    </div>
                    {activeNPC.lovedItems.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {activeNPC.lovedItems.map((item) => (
                          <Badge key={item} variant="secondary" className="text-xs font-medium">
                            {item}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">游戏内容中未提供该村民的喜爱物品。</p>
                    )}
                  </div>

                  <div className="rounded-lg border bg-background p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Gift className="h-4 w-4 text-rose-600" />
                      <h3 className="text-sm font-bold">讨厌物品</h3>
                    </div>
                    {activeNPC.hatedItems.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {activeNPC.hatedItems.map((item) => (
                          <Badge key={item} variant="secondary" className="text-xs font-medium">
                            {item}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">游戏内容中未提供该村民的讨厌物品。</p>
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
                  {loading ? "正在加载村民关系面板..." : "暂无可显示的村民资料"}
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
