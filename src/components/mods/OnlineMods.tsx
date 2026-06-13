import { useState, useEffect, useMemo, useRef } from "react"
import { 
  Search, 
  Download, 
  CheckCircle2, 
  AlertTriangle, 
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Info,
  Eye,
  Trophy,
  Database,
  Loader2,
} from "lucide-react"
import { OnlineModDetailModal } from "./OnlineModDetailModal"
import { NexusModsRanking, type NexusRankedMod } from "./NexusModsRanking"
import { syncOnlineModTranslations } from "@/lib/mod-translation-library"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"

// Type Definitions for compatibility mods
export interface SmapiModPage {
  Url: string
  Text: string
}

export interface SmapiModCompatibility {
  Status: string // "ok" | "workaround" | "broken" | "unofficial" | "abandoned" | "obsolete"
  Summary?: string
  BrokeIn?: string
  UnofficialVersion?: {
    Url: string
    Text: string
  }
}

export interface SmapiMod {
  Id: string[]
  Name: string
  AlternateNames?: string
  Author: string
  AlternateAuthors?: string
  GitHubRepo?: string
  SourceUrl?: string
  Compatibility?: SmapiModCompatibility
  ModPages: SmapiModPage[]
  Slug: string
}

const SMAPI_MODS_CACHE_KEY = "smapi_mods_cache"

const readSmapiModsCache = (): SmapiMod[] | null => {
  try {
    const cached = localStorage.getItem(SMAPI_MODS_CACHE_KEY)
    if (!cached) return null
    const parsed = JSON.parse(cached)
    return Array.isArray(parsed) ? parsed as SmapiMod[] : null
  } catch {
    return null
  }
}

const writeSmapiModsCache = (mods: SmapiMod[]) => {
  try {
    localStorage.setItem(SMAPI_MODS_CACHE_KEY, JSON.stringify(mods))
  } catch {}
}

interface OnlineModsProps {
  onNavigate?: (page: "settings") => void
  isGameRunning?: boolean
  onQueueDownload?: (task: { modName: string; author: string; downloadUrl: string }) => { ok: boolean; message: string }
}

// Initial premium popular mods to display if loading fails or in mock preview
const POPULAR_MOCK_MODS: SmapiMod[] = [
  {
    Id: ["Pathoschild.ContentPatcher"],
    Name: "Content Patcher",
    Author: "Pathoschild",
    GitHubRepo: "Pathoschild/StardewMods",
    SourceUrl: "https://github.com/Pathoschild/StardewMods",
    ModPages: [{ Url: "https://www.nexusmods.com/stardewvalley/mods/1915", Text: "Nexus" }],
    Slug: "content-patcher",
    Compatibility: { Status: "ok" }
  },
  {
    Id: ["Annosz.UIInfoSuite2"],
    Name: "UI Info Suite 2",
    Author: "Annosz",
    GitHubRepo: "Annosz/UIInfoSuite2",
    SourceUrl: "https://github.com/Annosz/UIInfoSuite2",
    ModPages: [{ Url: "https://github.com/Annosz/UIInfoSuite2/releases", Text: "GitHub" }],
    Slug: "ui-info-suite-2",
    Compatibility: { Status: "ok" }
  },
  {
    Id: ["FlashShifter.StardewValleyExpanded"],
    Name: "Stardew Valley Expanded",
    Author: "FlashShifter",
    ModPages: [{ Url: "https://www.nexusmods.com/stardewvalley/mods/3753", Text: "Nexus" }],
    Slug: "stardew-valley-expanded",
    Compatibility: { Status: "ok" }
  },
  {
    Id: ["Pathoschild.Automate"],
    Name: "Automate",
    Author: "Pathoschild",
    GitHubRepo: "Pathoschild/StardewMods",
    SourceUrl: "https://github.com/Pathoschild/StardewMods",
    ModPages: [{ Url: "https://www.nexusmods.com/stardewvalley/mods/1063", Text: "Nexus" }],
    Slug: "automate",
    Compatibility: { Status: "ok" }
  },
  {
    Id: ["Pathoschild.TractorMod"],
    Name: "Tractor Mod",
    Author: "Pathoschild",
    GitHubRepo: "Pathoschild/StardewMods",
    SourceUrl: "https://github.com/Pathoschild/StardewMods",
    ModPages: [{ Url: "https://www.nexusmods.com/stardewvalley/mods/1401", Text: "Nexus" }],
    Slug: "tractor-mod",
    Compatibility: { Status: "ok" }
  },
  {
    Id: ["DaisyNiko.EarthyRecolor"],
    Name: "DaisyNiko's Earthy Recolor",
    Author: "DaisyNiko",
    ModPages: [{ Url: "https://www.nexusmods.com/stardewvalley/mods/5255", Text: "Nexus" }],
    Slug: "daisyniko-s-earthy-recolor",
    Compatibility: { Status: "workaround", Summary: "需要安装最新版本的 Content Patcher" }
  },
  {
    Id: ["Bouhm.NPCMapLocations"],
    Name: "NPC Map Locations",
    Author: "Bouhm",
    GitHubRepo: "Bouhm/NPCMapLocations",
    SourceUrl: "https://github.com/Bouhm/NPCMapLocations",
    ModPages: [{ Url: "https://www.nexusmods.com/stardewvalley/mods/239", Text: "Nexus" }],
    Slug: "npc-map-locations",
    Compatibility: { Status: "ok" }
  },
  {
    Id: ["Pathoschild.LookupAnything"],
    Name: "Lookup Anything",
    Author: "Pathoschild",
    GitHubRepo: "Pathoschild/StardewMods",
    SourceUrl: "https://github.com/Pathoschild/StardewMods",
    ModPages: [{ Url: "https://www.nexusmods.com/stardewvalley/mods/541", Text: "Nexus" }],
    Slug: "lookup-anything",
    Compatibility: { Status: "ok" }
  }
]

// Helper for dynamic Tauri invokes
async function getTauriInvoke() {
  if (typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__) {
    try {
      const mod = await import("@tauri-apps/api/core");
      return mod.invoke;
    } catch (err) {
      console.error("Failed to load Tauri core invoke plugin", err);
    }
  }
  return null;
}

export function OnlineMods({ onNavigate, isGameRunning = false, onQueueDownload }: OnlineModsProps) {
  const [onlineMods, setOnlineMods] = useState<SmapiMod[]>(() => readSmapiModsCache() ?? [])
  const [loading, setLoading] = useState(() => !readSmapiModsCache())
  const [isBackgroundRefreshing, setIsBackgroundRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const completedTranslationModIdsRef = useRef<Set<string>>(new Set())
  const syncingTranslationModIdsRef = useRef<Set<string>>(new Set())
  const [translationSyncingModIds, setTranslationSyncingModIds] = useState<Set<string>>(new Set())
  
  // Modal State
  const [selectedDetailMod, setSelectedDetailMod] = useState<SmapiMod | null>(null)
  const [isDetailOpen, setIsDetailOpen] = useState(false)

  const handleOpenDetail = (mod: SmapiMod) => {
    setSelectedDetailMod(mod)
    setIsDetailOpen(true)
  }

  const handleOpenNexusDetail = (nexusMod: NexusRankedMod) => {
    // Try to find if there's a matching SMAPI mod in onlineMods
    const matchingSmapiMod = onlineMods.find(m => {
      const nexusPage = m.ModPages.find(p => p.Text === "Nexus" || p.Url.includes("nexusmods.com"))
      if (!nexusPage) return false
      const parts = nexusPage.Url.split("/")
      const id = parts.pop() || ""
      return id === nexusMod.nexusId
    })

    if (matchingSmapiMod) {
      handleOpenDetail(matchingSmapiMod)
    } else {
      // Fallback: construct a SmapiMod lookalike with no compatibility summary but pointing to nexus url
      const fallbackMod: SmapiMod = {
        Id: [],
        Name: nexusMod.name,
        Author: nexusMod.author,
        ModPages: [{ Url: nexusMod.nexusUrl, Text: "Nexus" }],
        Slug: `nexus-${nexusMod.nexusId}`,
        Compatibility: undefined // Undefined indicates it's not in the SMAPI database
      }
      handleOpenDetail(fallbackMod)
    }
  }
  
  // Filters & Search
  const [search, setSearch] = useState("")
  const [selectedStatus, setSelectedStatus] = useState<string>("all")
  
  // Pagination
  const [currentPage, setCurrentPage] = useState(1)
  const [jumpPage, setJumpPage] = useState("")
  const itemsPerPage = 24

  const fetchOnlineModsList = async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false
    const cached = readSmapiModsCache()

    if (silent && cached) {
      setIsBackgroundRefreshing(true)
    } else {
      setLoading(true)
    }
    setError(null)
    const invoke = await getTauriInvoke()

    if (invoke) {
      try {
        const list = await invoke("fetch_smapi_compatibility_mods") as SmapiMod[]
        if (list && list.length > 0) {
          setOnlineMods(list)
          writeSmapiModsCache(list)
        } else {
          if (cached) {
            setOnlineMods(cached)
            if (!silent) {
              setError("在线数据为空，已显示上次缓存的模组列表。")
            }
          } else {
            setOnlineMods([])
            setError("未获取到任何模组数据，请检查网络连接后重试。")
          }
        }
      } catch (err: any) {
        console.error("Error loading SMAPI compatibility list:", err)
        if (cached) {
          setOnlineMods(cached)
          if (!silent) {
            setError("获取在线模组数据失败，已显示上次缓存的数据。原因: " + err)
          }
        } else {
          setOnlineMods([])
          setError("获取在线模组数据失败，且无可用缓存。原因: " + err)
        }
      } finally {
        setLoading(false)
        setIsBackgroundRefreshing(false)
      }
    } else {
      // Web preview simulation
      setTimeout(() => {
        setOnlineMods(POPULAR_MOCK_MODS)
        setLoading(false)
        setIsBackgroundRefreshing(false)
      }, 1000)
    }
  }

  // Track active tab so we only fetch SMAPI data on demand
  const [activeTab, setActiveTab] = useState<string>("nexus")
  const smapiFetchedRef = useRef(false)

  useEffect(() => {
    if (activeTab === "smapi" && !smapiFetchedRef.current) {
      smapiFetchedRef.current = true
      fetchOnlineModsList({ silent: true })
    }
  }, [activeTab])

  // Filter and search computation
  const filteredMods = useMemo(() => {
    return onlineMods.filter((mod) => {
      const searchLower = search.toLowerCase()
      // Match by name, alternate names, author, unique ID
      const nameMatch = mod.Name.toLowerCase().includes(searchLower) ||
                        (mod.AlternateNames && mod.AlternateNames.toLowerCase().includes(searchLower)) ||
                        mod.Author.toLowerCase().includes(searchLower) ||
                        (mod.Id && mod.Id.some(id => id.toLowerCase().includes(searchLower)))
      // Also match by Nexus mod ID (from ModPages URL)
      const nexusIdMatch = /^\d+$/.test(search.trim()) && mod.ModPages.some(p => {
        const parts = p.Url.split("/")
        return parts[parts.length - 1] === search.trim()
      })

      const status = mod.Compatibility?.Status || "ok"
      const statusMatch = selectedStatus === "all" || status === selectedStatus

      return (nameMatch || nexusIdMatch) && statusMatch
    })
  }, [onlineMods, search, selectedStatus])

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1)
    setJumpPage("")
  }, [search, selectedStatus])

  // Paginated Mods
  const paginatedMods = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage
    return filteredMods.slice(startIndex, startIndex + itemsPerPage)
  }, [filteredMods, currentPage])

  const totalPages = Math.max(1, Math.ceil(filteredMods.length / itemsPerPage))

  const getTranslationId = (mod: SmapiMod) => mod.Id?.[0] || mod.Slug || mod.Name

  useEffect(() => {
    if (activeTab !== "smapi" || loading) return

    const pendingMods = paginatedMods.filter((mod) => {
      const id = getTranslationId(mod)
      return !completedTranslationModIdsRef.current.has(id) && !syncingTranslationModIdsRef.current.has(id)
    })
    if (pendingMods.length === 0) return

    pendingMods.forEach((mod) => syncingTranslationModIdsRef.current.add(getTranslationId(mod)))
    setTranslationSyncingModIds(new Set(syncingTranslationModIdsRef.current))

    syncOnlineModTranslations(pendingMods)
      .then(({ mods: translatedMods }) => {
        translatedMods.forEach((mod) => completedTranslationModIdsRef.current.add(getTranslationId(mod)))
        const translatedById = new Map(translatedMods.map((mod) => [getTranslationId(mod), mod]))

        setOnlineMods((currentMods) =>
          currentMods.map((mod) => {
            const translated = translatedById.get(getTranslationId(mod))
            if (!translated) return mod
            return {
              ...mod,
              Name: translated.Name,
              Compatibility: translated.Compatibility,
            }
          })
        )

        setSelectedDetailMod((currentMod) => {
          if (!currentMod) return currentMod
          const translated = translatedById.get(getTranslationId(currentMod))
          if (!translated) return currentMod
          return {
            ...currentMod,
            Name: translated.Name,
            Compatibility: translated.Compatibility,
          }
        })
      })
      .catch((err) => {
        console.error("Failed to sync online mod translations:", err)
      })
      .finally(() => {
        pendingMods.forEach((mod) => syncingTranslationModIdsRef.current.delete(getTranslationId(mod)))
        setTranslationSyncingModIds(new Set(syncingTranslationModIdsRef.current))
      })
  }, [activeTab, loading, paginatedMods])

  // Render Status Badge
  const renderStatusBadge = (status: string) => {
    const base = "whitespace-nowrap shrink-0 font-semibold px-2 py-0.5 text-[10px] rounded-full"
    switch (status) {
      case "ok":
        return <Badge className={`bg-green-500/10 text-green-500 border border-green-500/20 ${base}`}>完美兼容</Badge>
      case "workaround":
        return <Badge className={`bg-amber-500/10 text-amber-500 border border-amber-500/20 ${base}`}>有解决方法</Badge>
      case "broken":
        return <Badge className={`bg-red-500/10 text-red-500 border border-red-500/20 ${base}`}>已损坏</Badge>
      case "unofficial":
        return <Badge className={`bg-blue-500/10 text-blue-500 border border-blue-500/20 ${base}`}>非官方更新</Badge>
      case "abandoned":
        return <Badge className={`bg-gray-500/10 text-gray-500 border border-gray-500/20 ${base}`}>已弃用</Badge>
      case "obsolete":
        return <Badge className={`bg-slate-500/10 text-slate-500 border border-slate-500/20 ${base}`}>已过时</Badge>
      default:
        return <Badge className={`bg-green-500/10 text-green-500 border border-green-500/20 ${base}`}>兼容</Badge>
    }
  }


  return (
    <div className="space-y-6">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full space-y-6">
        <div className="flex justify-center border-b border-border/40 pb-4">
          <TabsList className="grid w-full max-w-md grid-cols-2 bg-muted/65 p-1 rounded-xl h-11 border border-border/30 shadow-inner">
            <TabsTrigger 
              value="nexus" 
              className="rounded-lg text-xs font-bold gap-2 data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-md transition-all duration-300 py-2 cursor-pointer"
            >
              <Trophy className="h-4 w-4 text-amber-500" />
              NexusMods 排行榜
            </TabsTrigger>
            <TabsTrigger 
              value="smapi" 
              className="rounded-lg text-xs font-bold gap-2 data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-md transition-all duration-300 py-2 cursor-pointer"
            >
              <Database className="h-4 w-4 text-green-500" />
              SMAPI.io 兼容库
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="nexus" className="space-y-4 outline-none focus-visible:ring-0 animate-in fade-in duration-300">
          <NexusModsRanking onOpenDetail={handleOpenNexusDetail} />
        </TabsContent>

        <TabsContent value="smapi" className="space-y-6 outline-none focus-visible:ring-0 animate-in fade-in duration-300">
          {/* Search and Filters */}
          <div className="flex flex-col md:flex-row gap-4 justify-between items-center bg-card border border-border p-4 rounded-xl shadow-sm">
            <div className="relative w-full md:max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜索模组名称、唯一ID、作者、Nexus ID..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 bg-accent/10 border-border text-xs rounded-lg"
              />
            </div>
            
            <div className="flex flex-wrap gap-2 w-full md:w-auto">
              {[
                { value: "all", label: "全部" },
                { value: "ok", label: "完美兼容" },
                { value: "workaround", label: "有替代/方案" },
                { value: "unofficial", label: "非官方更新" },
                { value: "broken", label: "已损坏" },
              ].map((status) => (
                <Button
                  key={status.value}
                  variant={selectedStatus === status.value ? "default" : "outline"}
                  onClick={() => setSelectedStatus(status.value)}
                  className="h-8 text-[11px] rounded-lg px-3 hover:bg-accent cursor-pointer"
                >
                  {status.label}
                </Button>
              ))}
              
              <Button
                variant="outline"
                size="icon"
                onClick={() => fetchOnlineModsList()}
                className="h-8 w-8 rounded-lg shrink-0 cursor-pointer"
                disabled={loading || isBackgroundRefreshing}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading || isBackgroundRefreshing ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>

          {isBackgroundRefreshing && !loading && (
            <div className="text-[11px] text-muted-foreground flex items-center gap-2">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              <span>正在后台检查 SMAPI.io 缓存更新...</span>
            </div>
          )}

          {translationSyncingModIds.size > 0 && !loading && (
            <div className="text-[11px] text-sky-600 dark:text-sky-400 flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>正在同步当前页翻译库：{translationSyncingModIds.size} 个模组</span>
            </div>
          )}

          {error && (
            <div className="bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 p-3 rounded-xl text-xs flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Card key={i} className="animate-pulse border border-border bg-card">
                  <CardContent className="p-5 space-y-3">
                    <div className="h-4 bg-accent/40 rounded w-2/3"></div>
                    <div className="h-3 bg-accent/30 rounded w-1/3"></div>
                    <div className="h-10 bg-accent/20 rounded"></div>
                    <div className="flex gap-2 pt-2">
                      <div className="h-8 bg-accent/30 rounded w-1/2"></div>
                      <div className="h-8 bg-accent/30 rounded w-1/2"></div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <>
              {/* Mods Grid */}
              {paginatedMods.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 animate-in fade-in duration-300">
                  {paginatedMods.map((mod) => {
                    const isSyncingTranslation = translationSyncingModIds.has(getTranslationId(mod))
                    return (
                      <Card key={mod.Slug} className="border border-border/80 bg-card hover:border-primary/45 hover:shadow-md transition-all duration-300 flex flex-col justify-between overflow-hidden">
                        <CardHeader className="p-4 pb-2 space-y-1.5">
                          <div className="flex justify-between items-start gap-2">
                            <div className="min-w-0 flex items-center gap-1.5 pr-2">
                              <CardTitle className="text-sm font-bold truncate text-foreground" title={mod.Name}>
                                {mod.Name}
                              </CardTitle>
                              {isSyncingTranslation && (
                                <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-semibold text-sky-600 dark:text-sky-400 bg-sky-500/10 border border-sky-500/20 rounded-md px-1.5 py-0.5">
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                  翻译库
                                </span>
                              )}
                            </div>
                            {renderStatusBadge(mod.Compatibility?.Status || "ok")}
                          </div>
                          <CardDescription className="text-[11px] truncate text-muted-foreground font-medium">
                            作者: {mod.Author} {mod.AlternateAuthors ? `(aka ${mod.AlternateAuthors})` : ""}
                          </CardDescription>
                        </CardHeader>
                        
                        <CardContent className="p-4 pt-1 flex-1 flex flex-col justify-between space-y-4">
                          {/* Compatibility Summary */}
                          <div className="bg-accent/20 dark:bg-accent/5 rounded-lg p-2.5 text-xs text-muted-foreground flex-1 flex flex-col justify-center min-h-[55px] border border-border/40 overflow-hidden text-ellipsis">
                            {mod.Compatibility?.Summary ? (
                              <div 
                                className="leading-relaxed smapi-compat-summary max-h-[70px] overflow-y-auto"
                                dangerouslySetInnerHTML={{ __html: mod.Compatibility.Summary }}
                              />
                            ) : (
                              <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400 font-medium text-[11px]">
                                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                                <span>完美兼容，目前没有任何已知问题</span>
                              </div>
                            )}
                            {mod.Compatibility?.BrokeIn && (
                              <p className="text-[10px] text-red-500 mt-1.5 font-semibold">
                                损坏自: {mod.Compatibility.BrokeIn}
                              </p>
                            )}
                          </div>

                          {/* Footer Actions */}
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              className="flex-1 text-[11px] h-8 rounded-lg gap-1 border-border/85 hover:bg-accent cursor-pointer font-semibold"
                              onClick={() => handleOpenDetail(mod)}
                            >
                              <Eye className="h-3 w-3" />
                              <span>模组详情</span>
                            </Button>

                            <Button
                              variant="secondary"
                              size="sm"
                              className="flex-grow text-[11px] h-8 rounded-lg gap-1 bg-accent/80 hover:bg-accent text-foreground cursor-not-allowed group relative"
                              disabled
                            >
                              <Download className="h-3 w-3" />
                              <span>一键安装</span>
                              {/* Tooltip on hover */}
                              <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block bg-popover text-popover-foreground border text-[9px] px-2 py-1 rounded shadow-lg whitespace-nowrap z-50">
                                一键下载安装功能将在下一阶段启用
                              </span>
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground border border-dashed border-border rounded-xl">
                  <Info className="h-8 w-8 text-muted-foreground/60 mb-2" />
                  <p className="text-xs">未找到符合条件的模组，请更换搜索词重新查询。</p>
                </div>
              )}

              {/* Pagination Controls */}
              {totalPages > 1 && (
                <div className="flex flex-col sm:flex-row justify-between items-center gap-3 bg-card border border-border p-3.5 rounded-xl text-xs shadow-sm">
                  <span className="text-muted-foreground font-medium">
                    当前第 {currentPage} 页 / 共 {totalPages} 页 (共 {filteredMods.length} 项)
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
            </>
          )}
        </TabsContent>
      </Tabs>

      {/* Online Mod Detail Modal */}
      <OnlineModDetailModal
        isOpen={isDetailOpen}
        onClose={() => setIsDetailOpen(false)}
        mod={selectedDetailMod}
        onNavigate={onNavigate}
        onQueueDownload={onQueueDownload}
        isGameRunning={isGameRunning}
      />
    </div>
  )
}
