import { useState, useEffect, useRef } from "react"
import { openUrl } from "@tauri-apps/plugin-opener"
import {
  Trophy,
  Download,
  ThumbsUp,
  Loader2,
  AlertTriangle,
  RefreshCw,
  ExternalLink,
  TrendingUp,
  Medal,
  Crown,
  Star
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

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
const MOCK_RANKING: NexusRankedMod[] = [
  { rank: 1, name: "Stardew Valley Expanded", author: "FlashShifter", imageUrl: "", downloads: "12.5M", endorsements: "89,420", nexusUrl: "https://www.nexusmods.com/stardewvalley/mods/3753", nexusId: "3753" },
  { rank: 2, name: "Content Patcher", author: "Pathoschild", imageUrl: "", downloads: "45.2M", endorsements: "156,300", nexusUrl: "https://www.nexusmods.com/stardewvalley/mods/1915", nexusId: "1915" },
  { rank: 3, name: "UI Info Suite 2", author: "Annosz", imageUrl: "", downloads: "8.7M", endorsements: "52,100", nexusUrl: "https://www.nexusmods.com/stardewvalley/mods/3222", nexusId: "3222" },
  { rank: 4, name: "Automate", author: "Pathoschild", imageUrl: "", downloads: "15.3M", endorsements: "78,900", nexusUrl: "https://www.nexusmods.com/stardewvalley/mods/1063", nexusId: "1063" },
  { rank: 5, name: "Tractor Mod", author: "Pathoschild", imageUrl: "", downloads: "10.1M", endorsements: "65,200", nexusUrl: "https://www.nexusmods.com/stardewvalley/mods/1401", nexusId: "1401" },
  { rank: 6, name: "Lookup Anything", author: "Pathoschild", imageUrl: "", downloads: "9.8M", endorsements: "61,400", nexusUrl: "https://www.nexusmods.com/stardewvalley/mods/541", nexusId: "541" },
  { rank: 7, name: "NPC Map Locations", author: "Bouhm", imageUrl: "", downloads: "6.2M", endorsements: "42,800", nexusUrl: "https://www.nexusmods.com/stardewvalley/mods/239", nexusId: "239" },
  { rank: 8, name: "DaisyNiko's Earthy Recolor", author: "DaisyNiko", imageUrl: "", downloads: "5.4M", endorsements: "38,500", nexusUrl: "https://www.nexusmods.com/stardewvalley/mods/5255", nexusId: "5255" },
  { rank: 9, name: "Farm Type Manager", author: "Esca", imageUrl: "", downloads: "7.1M", endorsements: "45,600", nexusUrl: "https://www.nexusmods.com/stardewvalley/mods/3231", nexusId: "3231" },
  { rank: 10, name: "CJB Cheats Menu", author: "CJBok", imageUrl: "", downloads: "4.8M", endorsements: "35,200", nexusUrl: "https://www.nexusmods.com/stardewvalley/mods/4", nexusId: "4" },
]

// Parse the NexusMods mods grid HTML to extract ranked mod list
// New NexusMods structure uses data-e2eid attributes and .mods-grid container
function parseRankingHtml(html: string): NexusRankedMod[] {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, "text/html")
  const results: NexusRankedMod[] = []

  // Strategy 1: New NexusMods structure with data-e2eid="mod-tile"
  const modTiles = doc.querySelectorAll('[data-e2eid="mod-tile"]')

  let rank = 1
  modTiles.forEach((el) => {
    // Extract title and URL from [data-e2eid="mod-tile-title"]
    const titleEl = el.querySelector('[data-e2eid="mod-tile-title"]')
    const name = titleEl?.textContent?.trim() || ""
    if (!name) return

    const titleHref = titleEl?.getAttribute("href") || ""
    const idMatch = titleHref.match(/\/mods\/(\d+)/)
    const nexusId = idMatch ? idMatch[1] : ""
    if (!nexusId) return

    const fullUrl = titleHref.startsWith("http")
      ? titleHref
      : `https://www.nexusmods.com${titleHref}`

    // Extract author from [data-e2eid="user-link"]
    const authorEl = el.querySelector('[data-e2eid="user-link"] span')
    const author = authorEl?.textContent?.trim() || "Unknown"

    // Extract thumbnail image
    const imgEl = el.querySelector("img[src*='staticdelivery'], img[src*='nexusmods']")
    const imageUrl = imgEl?.getAttribute("src") || ""

    // Try to extract download/endorsement stats if present
    let downloads = "—"
    let endorsements = "—"

    // Look for stat-like elements with download/endorsement numbers
    const allText = el.textContent || ""
    const dlMatch = allText.match(/([\d,.]+[KMB]?)\s*(?:unique\s*)?downloads?/i)
    if (dlMatch) downloads = dlMatch[1]
    const endMatch = allText.match(/([\d,.]+[KMB]?)\s*endorsements?/i)
    if (endMatch) endorsements = endMatch[1]

    // Also try data-e2eid based stat selectors
    const statEls = el.querySelectorAll("[data-e2eid]")
    statEls.forEach((statEl) => {
      const eid = statEl.getAttribute("data-e2eid") || ""
      const text = statEl.textContent?.trim() || ""
      if (eid.includes("download") && text) downloads = text
      if (eid.includes("endorsement") && text) endorsements = text
    })

    results.push({
      rank: rank++,
      name,
      author,
      imageUrl,
      downloads,
      endorsements,
      nexusUrl: fullUrl,
      nexusId
    })
  })

  // Strategy 2: Fallback - look for links to /stardewvalley/mods/{id} in generic containers
  if (results.length === 0) {
    const genericLinks = doc.querySelectorAll("a[href*='/stardewvalley/mods/']")
    const seenIds = new Set<string>()
    genericLinks.forEach((link) => {
      const href = link.getAttribute("href") || ""
      const idMatch = href.match(/\/mods\/(\d+)/)
      if (!idMatch || seenIds.has(idMatch[1])) return
      seenIds.add(idMatch[1])

      const name = link.textContent?.trim() || ""
      if (!name || name.length < 2 || name.length > 200) return

      // Try to find parent tile container
      const parent = link.closest('[data-e2eid], [class*="mod-tile"], [class*="mod-item"], article, li')
      const authorEl = parent?.querySelector('[data-e2eid="user-link"] span, .author, [class*="author"]')
      const author = authorEl?.textContent?.trim()?.replace(/^by\s+/i, "") || "—"

      const imgEl = parent?.querySelector("img[src*='staticdelivery'], img[src*='nexusmods'], img")
      const imageUrl = imgEl?.getAttribute("src") || ""

      results.push({
        rank: rank++,
        name,
        author,
        imageUrl,
        downloads: "—",
        endorsements: "—",
        nexusUrl: href.startsWith("http") ? href : `https://www.nexusmods.com${href}`,
        nexusId: idMatch[1]
      })
    })
  }

  return results.slice(0, 50) // Limit to top 50
}

export function NexusModsRanking() {
  const [ranking, setRanking] = useState<NexusRankedMod[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scrapeStatus, setScrapeStatus] = useState<"idle" | "loading" | "challenge">("idle")
  const unlistenRef = useRef<(() => void) | null>(null)

  const fetchRanking = async () => {
    setLoading(true)
    setError(null)
    setRanking([])
    setScrapeStatus("loading")

    const invoke = await getTauriInvoke()
    const listen = await getTauriListen()

    if (invoke && listen) {
      try {
        // Clean up previous listener
        if (unlistenRef.current) {
          unlistenRef.current()
          unlistenRef.current = null
        }

        const unlisten = await listen<{ html?: string; error?: string; status?: string }>("respond-nexus-ranking-html", (event) => {
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
            if (unlistenRef.current) {
              unlistenRef.current()
              unlistenRef.current = null
            }
            return
          }

          if (!event.payload.html) {
            setError("未收到 Nexus 排行榜页面内容，请重试。")
            setLoading(false)
            if (unlistenRef.current) {
              unlistenRef.current()
              unlistenRef.current = null
            }
            return
          }

          console.log("[Ranking] Successfully received HTML payload!")
          const parsed = parseRankingHtml(event.payload.html)
          if (parsed.length > 0) {
            setRanking(parsed)
            try {
              localStorage.setItem("nexus_ranking_cache", JSON.stringify(parsed))
            } catch {}
          } else {
            setError("成功获取页面但未能解析出排行榜数据。NexusMods 页面结构可能已变更。")
            // Try cache
            const cached = localStorage.getItem("nexus_ranking_cache")
            if (cached) {
              try {
                setRanking(JSON.parse(cached))
              } catch {}
            }
          }
          setLoading(false)
          setScrapeStatus("idle")

          if (unlistenRef.current) {
            unlistenRef.current()
            unlistenRef.current = null
          }
        })

        unlistenRef.current = unlisten

        // Call backend to open ranking scraper
        await invoke("open_nexus_ranking_scraper")

        // Safety timeout
        setTimeout(() => {
          if (unlistenRef.current) {
            setError("加载超时。这可能是由于网络不稳定或验证未能通过。请尝试重新获取。")
            setLoading(false)
            setScrapeStatus("idle")
            unlistenRef.current()
            unlistenRef.current = null
          }
        }, 185000)
      } catch (err: any) {
        console.error("[Ranking] Scraper invocation error:", err)
        setError("启动排行榜抓取器失败: " + err)
        setLoading(false)
        setScrapeStatus("idle")
      }
    } else {
      // Web preview mock
      setTimeout(() => {
        setRanking(MOCK_RANKING)
        setLoading(false)
        setScrapeStatus("idle")
      }, 1500)
    }
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (unlistenRef.current) {
        unlistenRef.current()
        unlistenRef.current = null
      }
    }
  }, [])

  // Load cached ranking on mount
  useEffect(() => {
    const cached = localStorage.getItem("nexus_ranking_cache")
    if (cached) {
      try {
        setRanking(JSON.parse(cached))
      } catch {}
    }
  }, [])

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
      {/* Header with fetch button */}
      <div className="flex items-center justify-between bg-gradient-to-r from-primary/10 to-accent/20 border border-border p-4 rounded-xl">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/15">
            <Trophy className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-foreground flex items-center gap-1.5">
              <TrendingUp className="h-4 w-4 text-primary" />
              NexusMods 下载量排行榜
            </h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              获取 Stardew Valley 模组在 NexusMods 上的热门下载排行
              {ranking.length > 0 && !loading && (
                <span className="ml-1 text-primary font-medium">· 已缓存 {ranking.length} 个模组</span>
              )}
            </p>
          </div>
        </div>
        <Button
          variant={ranking.length === 0 ? "default" : "outline"}
          size="sm"
          onClick={fetchRanking}
          disabled={loading}
          className="h-9 text-xs rounded-lg gap-1.5 shrink-0 cursor-pointer"
        >
          {loading ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>获取中...</span>
            </>
          ) : (
            <>
              <RefreshCw className="h-3.5 w-3.5" />
              <span>{ranking.length > 0 ? "刷新排行" : "获取排行榜"}</span>
            </>
          )}
        </Button>
      </div>

      {/* Status messages */}
      {loading && scrapeStatus === "challenge" && (
        <div className="bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 p-3 rounded-xl text-xs flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" />
          <span>Nexus 需要完成 Cloudflare 人机验证，验证窗口已弹出。请在验证窗口中完成验证后等待自动加载。</span>
        </div>
      )}

      {error && (
        <div className="bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 p-3 rounded-xl text-xs flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && ranking.length === 0 && (
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

      {/* Ranking list */}
      {!loading && ranking.length > 0 && (
        <div className="space-y-1.5 animate-in fade-in duration-300">
          {ranking.map((mod) => (
            <div
              key={mod.nexusId + mod.rank}
              className={`flex items-center gap-3 p-3 rounded-xl border transition-all hover:shadow-sm hover:border-primary/30 group ${getRankBg(mod.rank)}`}
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

              {/* Open link */}
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer hover:bg-accent"
                onClick={() => openUrl(mod.nexusUrl)}
                title="在浏览器中打开"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && ranking.length === 0 && !error && scrapeStatus === "idle" && (
        <div className="flex flex-col items-center justify-center py-8 text-muted-foreground border border-dashed border-border rounded-xl">
          <Trophy className="h-8 w-8 text-muted-foreground/40 mb-2" />
          <p className="text-xs font-medium">点击上方「获取排行榜」按钮</p>
          <p className="text-[11px] text-muted-foreground/70 mt-1">将通过安全解析通道获取 NexusMods 热门下载排行</p>
        </div>
      )}
    </div>
  )
}
