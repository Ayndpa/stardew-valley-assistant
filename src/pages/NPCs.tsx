import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import {
  Search,
  Heart,
  Gift,
  Star,
  Sparkles,
  Info,
  Users,
} from "lucide-react"

// Dynamic imports will be done inline inside useEffect/handlers for reliability


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

import {
  NPC,
  ALL_NPCS,
  relationshipStatusMap
} from "@/data/npcs"

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
  const [selectedNPC, setSelectedNPC] = useState<NPC | null>(null)
  const [friendships, setFriendships] = useState<Record<string, FriendshipInfo>>({})
  const [npcPortraits, setNpcPortraits] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadPortraits() {
      const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
      if (!isTauri) return

      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const gameDir = localStorage.getItem("stardewGameDirectory") || ""
        const portraits = await invoke<Record<string, string>>("get_npc_portraits", {
          npcIds: ALL_NPCS.map((npc) => npc.id),
          gameDir: gameDir.trim() || undefined,
        })
        setNpcPortraits(portraits)
      } catch (err) {
        console.error("Error loading NPC portraits:", err)
        setNpcPortraits({})
      }
    }

    loadPortraits()
  }, [])

  // Fetch real relationships
  useEffect(() => {
    async function loadFriendships() {
      if (!selectedSaveId) {
        setLoading(false)
        return
      }
      setLoading(true)

      const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
      if (isTauri) {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          const detail: SaveDetail = await invoke("get_save_detail", { id: selectedSaveId })
          const map: Record<string, FriendshipInfo> = {}
          detail.friendships.forEach((f) => {
            map[f.npcName] = f
          })
          setFriendships(map)
        } catch (err) {
          console.error("Error loading friendships:", err)
          setFriendships({})
        } finally {
          setLoading(false)
        }
      } else {
        setLoading(false)
      }
    }
    loadFriendships()
  }, [selectedSaveId])

  // Map and sort NPCs
  const npcList = ALL_NPCS.map((npc) => {
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

  // Filter list by search term
  const filteredNPCs = npcList.filter((npc) =>
    npc.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    npc.id.toLowerCase().includes(searchTerm.toLowerCase())
  ).sort((a, b) => {
    // met first, then sort by points desc, then by name
    if (a.isMet && !b.isMet) return -1
    if (!a.isMet && b.isMet) return 1
    if (b.points !== a.points) return b.points - a.points
    return a.name.localeCompare(b.name)
  })

  // Set default selected NPC
  useEffect(() => {
    if (filteredNPCs.length > 0 && !selectedNPC) {
      setSelectedNPC(ALL_NPCS.find(n => n.id === filteredNPCs[0].id) || null)
    }
  }, [filteredNPCs, selectedNPC])

  // Get active selected NPC details
  const activeNPC = selectedNPC ? npcList.find(n => n.id === selectedNPC.id) : null

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-3xl font-bold tracking-tight">村民关系</h2>
        <p className="text-muted-foreground mt-1">
          管理你与鹈鹕镇村民的关系、送礼进度和喜好偏好
        </p>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* NPC List */}
        <div className="w-full lg:w-80 space-y-4 shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="搜索村民姓名或拼音..."
              className="pl-10"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.currentTarget.value)}
            />
          </div>

          <div className="h-[60vh] overflow-y-auto border rounded-lg p-2 space-y-1 bg-accent/10">
            {!selectedSaveId ? (
              <div className="flex flex-col items-center justify-center h-full space-y-3 text-center px-4">
                <Users className="h-10 w-10 text-muted-foreground/30" />
                <p className="text-sm font-semibold text-muted-foreground">未选择游戏存档</p>
                <p className="text-xs text-muted-foreground/70">
                  请先通过侧边栏选择存档文件，系统将加载您与村民的好感度数据。
                </p>
              </div>
            ) : loading ? (
              <div className="flex flex-col items-center justify-center h-full space-y-2">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
                <p className="text-xs text-muted-foreground">正在加载好感度...</p>
              </div>
            ) : filteredNPCs.map((npc) => (
              <button
                key={npc.id}
                className={`w-full flex items-center gap-3 p-2.5 rounded-lg text-left transition-colors ${
                  selectedNPC?.id === npc.id
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-accent/50"
                }`}
                onClick={() => setSelectedNPC(ALL_NPCS.find(n => n.id === npc.id) || null)}
              >
                <NPCPortrait
                  name={npc.name}
                  portrait={npc.portrait}
                  size="sm"
                  selected={selectedNPC?.id === npc.id}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-center">
                    <p className="text-sm font-semibold truncate">{npc.name}</p>
                    {npc.status !== "Friendly" && (
                      <span className={`text-[10px] ${selectedNPC?.id === npc.id ? "text-primary-foreground/80" : "text-primary"}`}>
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

        {/* NPC Detail */}
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
                        <Badge variant="secondary" className="text-xs font-semibold">{activeNPC.personality}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        生日: {activeNPC.birthday} · 内部标识: {activeNPC.id}
                      </p>
                    </div>
                  </div>

                  {/* Talked and Gifted Indicators */}
                  <div className="flex gap-2">
                    {activeNPC.talkedToToday ? (
                      <Badge className="bg-green-500 hover:bg-green-600 text-xs font-medium py-1 px-2.5">
                        今天已交谈 💬
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs font-medium py-1 px-2.5">
                        今天未交谈 🤫
                      </Badge>
                    )}

                    {activeNPC.giftsToday > 0 ? (
                      <Badge className="bg-amber-500 hover:bg-amber-600 text-xs font-medium py-1 px-2.5">
                        今天已送礼 🎁
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs font-medium py-1 px-2.5">
                        今天未送礼 📦
                      </Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6 pt-6">
                {/* Friendship Heart Stats */}
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
                      当前点数: {activeNPC.points}g / {(activeNPC.maxHearts * 250)}g (250点/心)
                    </p>
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                      <Gift className="h-4 w-4 text-amber-500" />
                      本周送礼限制 (限2次)
                    </h3>
                    <div className="flex items-center gap-2">
                      <div className="w-full bg-muted rounded-full h-2 overflow-hidden flex-1">
                        <div
                          className="h-full rounded-full bg-amber-500 transition-all duration-300"
                          style={{ width: `${(activeNPC.giftsThisWeek / 2) * 100}%` }}
                        />
                      </div>
                      <span className="text-sm font-bold">{activeNPC.giftsThisWeek} / 2 次</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {activeNPC.giftsThisWeek >= 2 ? "⚠️ 本周送礼已达上限，周日将重置计数" : "本周还可送礼 " + (2 - activeNPC.giftsThisWeek) + " 次"}
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
                      <p className="font-semibold text-sm mt-0.5">{relationshipStatusMap[activeNPC.status] || activeNPC.status}</p>
                    </div>
                    <div className="border p-2.5 rounded-md bg-background">
                      <p className="text-muted-foreground">是否结识</p>
                      <p className="font-semibold text-sm mt-0.5">{activeNPC.isMet ? "已结识" : "未结识 ❓"}</p>
                    </div>
                    <div className="border p-2.5 rounded-md bg-background">
                      <p className="text-muted-foreground">社交类型</p>
                      <p className="font-semibold text-sm mt-0.5">
                        {activeNPC.gender === "marriageable_female" ? "单身女性" : activeNPC.gender === "marriageable_male" ? "单身男性" : "鹈鹕镇居民"}
                      </p>
                    </div>
                    <div className="border p-2.5 rounded-md bg-background">
                      <p className="text-muted-foreground">社交成就点</p>
                      <p className="font-semibold text-sm mt-0.5">{activeNPC.points} 点</p>
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Loved Gifts */}
                <div>
                  <h3 className="text-sm font-bold mb-3 flex items-center gap-2 text-red-500">
                    <Heart className="h-4 w-4 fill-red-500 text-red-500" />
                    最爱礼物 (Loved) - 好感度增加 80 点
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {activeNPC.lovedGifts.map((gift) => (
                      <Badge key={gift} className="gap-1 bg-red-500/10 text-red-500 border border-red-500/20 font-semibold text-xs py-1">
                        <Star className="h-3.5 w-3.5 fill-red-500" />
                        {gift}
                      </Badge>
                    ))}
                  </div>
                </div>

                {/* Liked Gifts */}
                <div>
                  <h3 className="text-sm font-bold mb-3 flex items-center gap-2 text-emerald-500">
                    <Gift className="h-4 w-4 text-emerald-500" />
                    喜欢礼物 (Liked) - 好感度增加 45 点
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {activeNPC.likedGifts.map((gift) => (
                      <Badge key={gift} variant="secondary" className="gap-1 bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 font-semibold text-xs py-1">
                        {gift}
                      </Badge>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="h-full">
              <CardContent className="flex flex-col items-center justify-center py-20">
                <Info className="h-12 w-12 text-muted-foreground/40 mb-4" />
                <p className="text-muted-foreground">正在加载村民关系面板...</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

