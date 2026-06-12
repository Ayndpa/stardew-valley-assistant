import { useState, useEffect, useRef } from "react"
import { openUrl } from "@tauri-apps/plugin-opener"
import {
  Trophy,
  Download,
  ThumbsUp,
  Loader2,
  AlertTriangle,
  ExternalLink,
  TrendingUp,
  Medal,
  Crown,
  Star,
  Search,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Clock,
  Eye
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

// Type for a ranked mod entry
export interface NexusRankedMod {
  rank: number
  name: string
  author: string
  imageUrl: string
  downloads: string
  endorsements: string
  nexusUrl: string
  nexusId: string
}

// Cache interface structures
interface CachePage {
  mods: NexusRankedMod[]
  totalCount: number
  fetchedAt: number
}

interface QueryCache {
  pages: { [pageNum: number]: CachePage }
}

interface SystemCache {
  [queryKey: string]: QueryCache
}

// Local cache helper functions
const getCacheKey = (sortField: string, sortDirection: string, searchQuery: string) => {
  return `${sortField}_${sortDirection}_${searchQuery.trim().toLowerCase()}`
}

const getCachedPage = (queryKey: string, pageNum: number): CachePage | null => {
  try {
    const raw = localStorage.getItem("nexus_mods_browse_cache")
    if (!raw) return null
    const cache: SystemCache = JSON.parse(raw)
    return cache[queryKey]?.pages[pageNum] || null
  } catch {
    return null
  }
}

const setCachedPage = (queryKey: string, pageNum: number, mods: NexusRankedMod[], totalCount: number) => {
  try {
    const raw = localStorage.getItem("nexus_mods_browse_cache")
    const cache: SystemCache = raw ? JSON.parse(raw) : {}
    if (!cache[queryKey]) {
      cache[queryKey] = { pages: {} }
    }
    cache[queryKey].pages[pageNum] = {
      mods,
      totalCount,
      fetchedAt: Date.now()
    }
    localStorage.setItem("nexus_mods_browse_cache", JSON.stringify(cache))
  } catch (e) {
    console.error("Failed to write nexus cache:", e)
  }
}

const invalidateSubsequentPages = (queryKey: string) => {
  try {
    const raw = localStorage.getItem("nexus_mods_browse_cache")
    if (!raw) return
    const cache: SystemCache = JSON.parse(raw)
    if (cache[queryKey]) {
      const page1 = cache[queryKey].pages[1]
      cache[queryKey].pages = {}
      if (page1) {
        cache[queryKey].pages[1] = page1
      }
      localStorage.setItem("nexus_mods_browse_cache", JSON.stringify(cache))
    }
  } catch {}
}

// Helper for dynamic Tauri imports
async function getTauriInvoke() {
  if (typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__) {
    try {
      const mod = await import("@tauri-apps/api/core")
      return mod.invoke
    } catch (err) {
      console.error("Failed to load Tauri core invoke plugin", err)
    }
  }
  return null
}

async function getTauriListen() {
  if (typeof window !== "undefined" && !!(window as any).__TAIGN_INTERNALS__) {
    // Note: fallback or standard internal check
  }
  if (typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__) {
    try {
      const mod = await import("@tauri-apps/api/event")
      return mod.listen
    } catch (err) {
      console.error("Failed to load Tauri event listen plugin", err)
    }
  }
  return null
}

// Mock data for web preview
const MOCK_ALL_MODS = Array.from({ length: 85 }).map((_, idx) => ({
  rank: idx + 1,
  name: `Stardew Mod ${idx + 1} - ${["Expansion", "Helper", "UI Toolkit", "Retexture", "Cheats Menu", "Automation"][idx % 6]}`,
  author: ["FlashShifter", "Pathoschild", "Annosz", "Bouhm", "DaisyNiko"][idx % 5],
  imageUrl: "",
  downloads: `${(100 - idx * 1.1).toFixed(1)}K`,
  endorsements: `${(5000 - idx * 55)}`,
  nexusUrl: `https://www.nexusmods.com/stardewvalley/mods/${1000 + idx}`,
  nexusId: String(1000 + idx),
  createdAt: Date.now() - idx * 24 * 3600 * 1000,
  updatedAt: Date.now() - (idx % 3) * 24 * 3600 * 1000,
}))

// Format a number into a human-readable string (e.g. 12500 -> "12.5K")
function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M"
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K"
  return n.toString()
}

// Map GraphQL ModsListing response nodes to NexusRankedMod[]
function mapGraphQLToRanking(graphqlData: any, offset: number): NexusRankedMod[] {
  const nodes: any[] = graphqlData?.data?.mods?.nodes ?? graphqlData?.mods?.nodes ?? []
  return nodes
    .filter((n: any) => n.modId && n.name)
    .map((node: any, idx: number) => ({
      rank: offset + idx + 1,
      name: node.name || "Unknown",
      author: node.uploader?.name || "Unknown",
      imageUrl: node.thumbnailUrl || "",
      downloads: formatNumber(node.downloads || 0),
      endorsements: formatNumber(node.endorsements || 0),
      nexusUrl: `https://www.nexusmods.com/stardewvalley/mods/${node.modId}`,
      nexusId: String(node.modId),
    }))
}

// Persistent set of query keys that have been verified in the current session
const verifiedKeysInSession = new Set<string>()

// Persistent session browsing state
let sessionCurrentPage = 1
let sessionSortField = "downloads"
let sessionSearchQuery = ""

export interface NexusModsRankingProps {
  onOpenDetail?: (mod: NexusRankedMod) => void
}

export function NexusModsRanking({ onOpenDetail }: NexusModsRankingProps = {}) {
  // Browsing Options from Session
  const [sortField, setSortField] = useState<string>(() => sessionSortField)
  const [sortDirection] = useState<string>("DESC")
  const [searchQuery, setSearchQuery] = useState<string>(() => sessionSearchQuery)
  const [searchInputValue, setSearchInputValue] = useState<string>(() => sessionSearchQuery)
  
  // Pagination from Session
  const [currentPage, setCurrentPage] = useState<number>(() => sessionCurrentPage)
  const [totalCount, setTotalCount] = useState<number>(() => {
    const qKey = getCacheKey(sessionSortField, "DESC", sessionSearchQuery)
    const cached = getCachedPage(qKey, sessionCurrentPage)
    return cached ? cached.totalCount : 0
  })
  const [jumpPage, setJumpPage] = useState<string>("")
  const itemsPerPage = 20

  const [ranking, setRanking] = useState<NexusRankedMod[]>(() => {
    const qKey = getCacheKey(sessionSortField, "DESC", sessionSearchQuery)
    const cached = getCachedPage(qKey, sessionCurrentPage)
    return cached ? cached.mods : []
  })

  const [loading, setLoading] = useState(() => {
    const qKey = getCacheKey(sessionSortField, "DESC", sessionSearchQuery)
    const cached = getCachedPage(qKey, sessionCurrentPage)
    return !cached
  })

  const [isBackgroundRefreshing, setIsBackgroundRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scrapeStatus, setScrapeStatus] = useState<"idle" | "loading" | "challenge">("idle")
  
  const unlistenRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    sessionCurrentPage = currentPage
    sessionSortField = sortField
    sessionSearchQuery = searchQuery
  }, [currentPage, sortField, searchQuery])

  const fetchRanking = async (
    targetPage: number,
    targetSortField: string,
    targetSortDirection: string,
    targetSearchQuery: string,
    isSilent: boolean
  ) => {
    if (isSilent) {
      setIsBackgroundRefreshing(true)
    } else {
      setLoading(true)
    }
    setError(null)
    setScrapeStatus("loading")

    const targetOffset = (targetPage - 1) * itemsPerPage
    const qKey = getCacheKey(targetSortField, targetSortDirection, targetSearchQuery)

    const invoke = await getTauriInvoke()
    const listen = await getTauriListen()

    if (invoke && listen) {
      try {
        // Clean up previous listener
        if (unlistenRef.current) {
          unlistenRef.current()
          unlistenRef.current = null
        }

        const unlisten = await listen<{
          mods?: any
          error?: string
          status?: string
          offset?: number
          sort_field?: string
          search_query?: string
        }>("respond-nexus-ranking-html", (event) => {
          // Verify that this event corresponds to our active request to prevent race conditions
          if (event.payload.offset !== undefined && event.payload.offset !== targetOffset) return
          if (event.payload.sort_field !== undefined && event.payload.sort_field !== targetSortField) return
          if (event.payload.search_query !== undefined && event.payload.search_query !== targetSearchQuery) return

          if (event.payload.status === "challenge") {
            setScrapeStatus("challenge")
            return
          }
          if (event.payload.status === "loading") {
            setScrapeStatus("loading")
            return
          }

          if (event.payload.error) {
            setError(event.payload.error)
            setLoading(false)
            setIsBackgroundRefreshing(false)
            if (unlistenRef.current) {
              unlistenRef.current()
              unlistenRef.current = null
            }
            return
          }

          if (!event.payload.mods) {
            setError("未收到 Nexus GraphQL 数据，请重试。")
            setLoading(false)
            setIsBackgroundRefreshing(false)
            if (unlistenRef.current) {
              unlistenRef.current()
              unlistenRef.current = null
            }
            return
          }

          console.log("[Ranking] Successfully intercepted GraphQL response!")
          const parsed = mapGraphQLToRanking(event.payload.mods, targetOffset)
          const total = event.payload.mods?.data?.mods?.totalCount ?? event.payload.mods?.mods?.totalCount ?? parsed.length
          
          verifiedKeysInSession.add(`${qKey}_p${targetPage}`)

          if (targetPage === 1) {
            const cachedPage1 = getCachedPage(qKey, 1)
            if (cachedPage1) {
              const isSame = cachedPage1.mods.length === parsed.length &&
                cachedPage1.mods.every((m, idx) => m.nexusId === parsed[idx]?.nexusId)
              
              if (isSame) {
                // Keep cache pages, just refresh page 1 timestamp
                setCachedPage(qKey, 1, parsed, total)
                console.log("[Ranking] Page 1 matches cache, subsequent cache pages kept.")
              } else {
                // Invalidate subsequent pages, show fresh
                console.log("[Ranking] Page 1 changed, invalidating subsequent pages.")
                setCachedPage(qKey, 1, parsed, total)
                invalidateSubsequentPages(qKey)
                setRanking(parsed)
                setTotalCount(total)
              }
            } else {
              setCachedPage(qKey, 1, parsed, total)
              setRanking(parsed)
              setTotalCount(total)
            }
          } else {
            setCachedPage(qKey, targetPage, parsed, total)
            setRanking(parsed)
            setTotalCount(total)
          }

          setLoading(false)
          setIsBackgroundRefreshing(false)
          setScrapeStatus("idle")

          if (unlistenRef.current) {
            unlistenRef.current()
            unlistenRef.current = null
          }
        })

        unlistenRef.current = unlisten

        // Call backend to open ranking scraper with filters/sorting
        await invoke("open_nexus_ranking_scraper", {
          offset: targetOffset,
          sortField: targetSortField,
          sortDirection: targetSortDirection,
          searchQuery: targetSearchQuery
        })

        // Safety timeout
        setTimeout(() => {
          if (unlistenRef.current) {
            setError("加载超时。这可能是由于网络不稳定或验证未能通过。")
            setLoading(false)
            setIsBackgroundRefreshing(false)
            setScrapeStatus("idle")
            unlistenRef.current()
            unlistenRef.current = null
          }
        }, 185000)
      } catch (err: any) {
        console.error("[Ranking] Scraper invocation error:", err)
        setError("启动排行榜抓取器失败: " + err)
        setLoading(false)
        setIsBackgroundRefreshing(false)
        setScrapeStatus("idle")
      }
    } else {
      // Web preview mock simulation
      setTimeout(() => {
        let filtered = [...MOCK_ALL_MODS]
        
        if (targetSearchQuery) {
          const s = targetSearchQuery.toLowerCase()
          filtered = filtered.filter(m => 
            m.name.toLowerCase().includes(s) || 
            m.author.toLowerCase().includes(s)
          )
        }
        
        if (targetSortField === "downloads") {
          filtered.sort((a, b) => parseFloat(b.downloads) - parseFloat(a.downloads))
        } else if (targetSortField === "endorsements") {
          filtered.sort((a, b) => parseInt(b.endorsements) - parseInt(a.endorsements))
        } else if (targetSortField === "createdAt") {
          filtered.sort((a, b) => b.createdAt - a.createdAt)
        } else if (targetSortField === "updatedAt") {
          filtered.sort((a, b) => b.updatedAt - a.updatedAt)
        }
        
        const mapped = filtered.map((m, idx) => ({
          ...m,
          rank: targetOffset + idx + 1
        }))
        
        const pageMods = mapped.slice(targetOffset, targetOffset + itemsPerPage)
        const total = filtered.length
        
        verifiedKeysInSession.add(`${qKey}_p${targetPage}`)

        if (targetPage === 1) {
          const cachedPage1 = getCachedPage(qKey, 1)
          if (cachedPage1) {
            const isSame = cachedPage1.mods.length === pageMods.length &&
              cachedPage1.mods.every((m, idx) => m.nexusId === pageMods[idx]?.nexusId)
            
            if (isSame) {
              setCachedPage(qKey, 1, pageMods, total)
            } else {
              setCachedPage(qKey, 1, pageMods, total)
              invalidateSubsequentPages(qKey)
              setRanking(pageMods)
              setTotalCount(total)
            }
          } else {
            setCachedPage(qKey, 1, pageMods, total)
            setRanking(pageMods)
            setTotalCount(total)
          }
        } else {
          setCachedPage(qKey, targetPage, pageMods, total)
          setRanking(pageMods)
          setTotalCount(total)
        }
        
        setLoading(false)
        setIsBackgroundRefreshing(false)
        setScrapeStatus("idle")
      }, 1000)
    }
  }

  // Auto load or refresh when parameters change
  useEffect(() => {
    // Sync browsing state to session variables
    sessionCurrentPage = currentPage
    sessionSortField = sortField
    sessionSearchQuery = searchQuery

    const qKey = getCacheKey(sortField, sortDirection, searchQuery)
    const cached = getCachedPage(qKey, currentPage)
    const sessionKey = `${qKey}_p${currentPage}`

    if (cached) {
      setRanking(cached.mods)
      setTotalCount(cached.totalCount)
      setError(null)
      setLoading(false)

      if (currentPage === 1 && !verifiedKeysInSession.has(sessionKey)) {
        // Silent update for page 1 in the background only if not yet verified in this session
        fetchRanking(1, sortField, sortDirection, searchQuery, true)
      }
    } else {
      fetchRanking(currentPage, sortField, sortDirection, searchQuery, false)
    }
  }, [currentPage, sortField, searchQuery])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (unlistenRef.current) {
        unlistenRef.current()
        unlistenRef.current = null
      }
    }
  }, [])

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setSearchQuery(searchInputValue)
    setCurrentPage(1)
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / itemsPerPage))

  const getRankIcon = (rank: number) => {
    if (rank === 1) return <Crown className="h-4 w-4 text-amber-500" />
    if (rank === 2) return <Medal className="h-4 w-4 text-gray-400" />
    if (rank === 3) return <Medal className="h-4 w-4 text-amber-700" />
    if (rank <= 10) return <Star className="h-3.5 w-3.5 text-primary/60" />
    return <span className="text-[11px] font-bold text-muted-foreground w-4 text-center">{rank}</span>
  }

  const getRankBg = (rank: number) => {
    if (rank === 1) return "bg-amber-500/10 border-amber-500/30"
    if (rank === 2) return "bg-gray-400/10 border-gray-400/30"
    if (rank === 3) return "bg-amber-700/10 border-amber-700/30"
    return "bg-card border-border/60"
  }

  return (
    <div className="space-y-4">
      {/* Subtitle & Status indicator */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-foreground flex items-center gap-1.5">
          <TrendingUp className="h-4 w-4 text-primary" />
          NexusMods 模组浏览
          {isBackgroundRefreshing && (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground font-normal ml-2">
              <Loader2 className="h-3 w-3 animate-spin" />
              后台校验中...
            </span>
          )}
        </h3>
        {totalCount > 0 && (
          <span className="text-[11px] text-muted-foreground">
            共找到 {totalCount} 个模组
          </span>
        )}
      </div>

      {/* Control Panel: Search & Sorting */}
      <div className="flex flex-col md:flex-row gap-4 justify-between items-center bg-card border border-border p-4 rounded-xl shadow-sm">
        {/* Search */}
        <form onSubmit={handleSearchSubmit} className="relative w-full md:max-w-xs flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="搜索 Nexus 模组..."
              value={searchInputValue}
              onChange={(e) => setSearchInputValue(e.target.value)}
              className="pl-9 bg-accent/10 border-border text-xs rounded-lg h-9"
            />
          </div>
          <Button type="submit" size="sm" className="h-9 px-3 rounded-lg text-xs font-semibold cursor-pointer">
            搜索
          </Button>
        </form>

        {/* Sort triggers */}
        <div className="flex flex-wrap gap-2 w-full md:w-auto">
          {[
            { field: "downloads", label: "热门下载", icon: <Trophy className="h-3 w-3 text-amber-500" /> },
            { field: "endorsements", label: "推荐排行", icon: <ThumbsUp className="h-3 w-3 text-red-500" /> },
            { field: "createdAt", label: "最新发布", icon: <Sparkles className="h-3 w-3 text-blue-500" /> },
            { field: "updatedAt", label: "最近更新", icon: <Clock className="h-3 w-3 text-green-500" /> },
          ].map((item) => (
            <Button
              key={item.field}
              variant={sortField === item.field ? "default" : "outline"}
              onClick={() => {
                if (sortField !== item.field) {
                  setSortField(item.field)
                  setCurrentPage(1)
                }
              }}
              className="h-9 text-[11px] rounded-lg px-3 hover:bg-accent cursor-pointer flex items-center gap-1.5 font-semibold"
            >
              {item.icon}
              {item.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Cloudflare Challenge Warning */}
      {loading && scrapeStatus === "challenge" && (
        <div className="bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 p-3 rounded-xl text-xs flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" />
          <span>Nexus 需要完成 Cloudflare 人机验证，验证窗口已弹出。请在验证窗口中完成验证后等待自动加载。</span>
        </div>
      )}

      {/* Error Alert */}
      {error && (
        <div className="bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 p-3 rounded-xl text-xs flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Loading Skeleton */}
      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i} className="animate-pulse border border-border bg-card">
              <CardContent className="p-3 flex items-center gap-3">
                <div className="h-8 w-8 bg-accent/40 rounded-lg shrink-0" />
                <div className="h-4 w-4 bg-accent/30 rounded" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 bg-accent/40 rounded w-1/3" />
                  <div className="h-2.5 bg-accent/30 rounded w-1/5" />
                </div>
                <div className="h-3 bg-accent/30 rounded w-16" />
                <div className="h-3 bg-accent/30 rounded w-12" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Ranking / Browsing List */}
      {!loading && ranking.length > 0 && (
        <div className="space-y-1.5 animate-in fade-in duration-300">
          {ranking.map((mod) => (
            <div
              key={mod.nexusId + mod.rank}
              className={`flex items-center gap-3 p-3 rounded-xl border transition-all hover:shadow-sm hover:border-primary/30 group ${getRankBg(mod.rank)} cursor-pointer`}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest("button")) return
                onOpenDetail?.(mod)
              }}
            >
              {/* Rank */}
              <div className="flex items-center justify-center w-8 h-8 shrink-0">
                {getRankIcon(mod.rank)}
              </div>

              {/* Thumbnail */}
              <div className="w-10 h-10 rounded-lg overflow-hidden bg-accent/30 border border-border/40 shrink-0 flex items-center justify-center">
                {mod.imageUrl ? (
                  <img
                    src={mod.imageUrl}
                    alt={mod.name}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none"
                    }}
                  />
                ) : (
                  <Trophy className="h-4 w-4 text-muted-foreground/40" />
                )}
              </div>

              {/* Name & Author */}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-foreground truncate group-hover:text-primary transition-colors">
                  {mod.name}
                </p>
                <p className="text-[10px] text-muted-foreground truncate">
                  {mod.author}
                </p>
              </div>

              {/* Stats */}
              <div className="flex items-center gap-4 shrink-0">
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground" title="下载量">
                  <Download className="h-3 w-3" />
                  <span className="font-semibold text-foreground">{mod.downloads}</span>
                </div>
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground" title="推荐数">
                  <ThumbsUp className="h-3 w-3" />
                  <span className="font-semibold text-foreground">{mod.endorsements}</span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                {onOpenDetail && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 cursor-pointer hover:bg-accent"
                    onClick={() => onOpenDetail(mod)}
                    title="查看模组详情"
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 cursor-pointer hover:bg-accent"
                  onClick={() => openUrl(mod.nexusUrl)}
                  title="在浏览器中打开"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!loading && ranking.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground border border-dashed border-border rounded-xl">
          <Trophy className="h-8 w-8 text-muted-foreground/40 mb-2" />
          <p className="text-xs font-medium">没有找到相关的 NexusMods 模组。</p>
          <p className="text-[11px] text-muted-foreground/70 mt-1">请更换关键词重试，或者确认是否有可用网络。</p>
        </div>
      )}

      {/* Pagination Controls */}
      {!loading && totalPages > 1 && (
        <div className="flex flex-col sm:flex-row justify-between items-center gap-3 bg-card border border-border p-3.5 rounded-xl text-xs shadow-sm mt-4">
          <span className="text-muted-foreground font-medium">
            当前第 {currentPage} 页 / 共 {totalPages} 页 (共 {totalCount} 项)
          </span>
          
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              className="h-8 text-[11px] rounded-lg gap-1 px-2 hover:bg-accent cursor-pointer"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              <span>上一页</span>
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(1)}
              disabled={currentPage === 1}
              className="h-8 w-8 p-0 text-[11px] rounded-lg hover:bg-accent cursor-pointer"
            >
              1
            </Button>
            {currentPage > 3 && <span className="text-muted-foreground px-1">...</span>}
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter(p => p !== 1 && p !== totalPages && Math.abs(p - currentPage) <= 1)
              .map(p => (
                <Button
                  key={p}
                  variant={p === currentPage ? "default" : "outline"}
                  size="sm"
                  onClick={() => setCurrentPage(p)}
                  className={`h-8 w-8 p-0 text-[11px] rounded-lg cursor-pointer ${p === currentPage ? "" : "hover:bg-accent"}`}
                >
                  {p}
                </Button>
              ))
            }
            {currentPage < totalPages - 2 && <span className="text-muted-foreground px-1">...</span>}
            {totalPages > 1 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages}
                className="h-8 w-8 p-0 text-[11px] rounded-lg hover:bg-accent cursor-pointer"
              >
                {totalPages}
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages}
              className="h-8 text-[11px] rounded-lg gap-1 px-2 hover:bg-accent cursor-pointer"
            >
              <span>下一页</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-muted-foreground whitespace-nowrap">跳转到</span>
            <Input
              type="text"
              inputMode="numeric"
              value={jumpPage}
              onChange={(e) => setJumpPage(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const page = parseInt(jumpPage)
                  if (page >= 1 && page <= totalPages) {
                    setCurrentPage(page)
                    setJumpPage("")
                  }
                }
              }}
              className="h-8 w-20 text-center text-[11px] rounded-lg bg-accent/10 border-border"
              placeholder="页码"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const page = parseInt(jumpPage)
                if (page >= 1 && page <= totalPages) {
                  setCurrentPage(page)
                  setJumpPage("")
                }
              }}
              className="h-8 text-[11px] rounded-lg px-3 hover:bg-accent cursor-pointer whitespace-nowrap"
            >
              跳转
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
