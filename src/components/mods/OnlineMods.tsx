import { useState, useEffect, useMemo } from "react"
import { 
  Search, 
  Download, 
  CheckCircle2, 
  AlertTriangle, 
  ExternalLink, 
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Info
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

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

export function OnlineMods() {
  const [onlineMods, setOnlineMods] = useState<SmapiMod[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // Filters & Search
  const [search, setSearch] = useState("")
  const [selectedStatus, setSelectedStatus] = useState<string>("all")
  
  // Pagination
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 24

  const fetchOnlineModsList = async () => {
    setLoading(true)
    setError(null)
    const invoke = await getTauriInvoke()

    if (invoke) {
      try {
        const list = await invoke("fetch_smapi_compatibility_mods") as SmapiMod[]
        if (list && list.length > 0) {
          setOnlineMods(list)
        } else {
          setOnlineMods(POPULAR_MOCK_MODS)
        }
      } catch (err: any) {
        console.error("Error loading SMAPI compatibility list:", err)
        setError("获取在线模组数据失败，已切换至内置精选模组。原因: " + err)
        setOnlineMods(POPULAR_MOCK_MODS)
      } finally {
        setLoading(false)
      }
    } else {
      // Web preview simulation
      setTimeout(() => {
        setOnlineMods(POPULAR_MOCK_MODS)
        setLoading(false)
      }, 1000)
    }
  }

  useEffect(() => {
    fetchOnlineModsList()
  }, [])

  // Filter and search computation
  const filteredMods = useMemo(() => {
    return onlineMods.filter((mod) => {
      const nameMatch = mod.Name.toLowerCase().includes(search.toLowerCase()) ||
                        (mod.AlternateNames && mod.AlternateNames.toLowerCase().includes(search.toLowerCase())) ||
                        mod.Author.toLowerCase().includes(search.toLowerCase()) ||
                        (mod.Id && mod.Id.some(id => id.toLowerCase().includes(search.toLowerCase())))
      
      const status = mod.Compatibility?.Status || "ok"
      const statusMatch = selectedStatus === "all" || status === selectedStatus
      
      return nameMatch && statusMatch
    })
  }, [onlineMods, search, selectedStatus])

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1)
  }, [search, selectedStatus])

  // Paginated Mods
  const paginatedMods = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage
    return filteredMods.slice(startIndex, startIndex + itemsPerPage)
  }, [filteredMods, currentPage])

  const totalPages = Math.max(1, Math.ceil(filteredMods.length / itemsPerPage))

  // Render Status Badge
  const renderStatusBadge = (status: string) => {
    switch (status) {
      case "ok":
        return <Badge className="bg-green-500/10 text-green-500 border border-green-500/20 rounded-full font-semibold px-2 py-0.5 text-[10px]">完美兼容</Badge>
      case "workaround":
        return <Badge className="bg-amber-500/10 text-amber-500 border border-amber-500/20 rounded-full font-semibold px-2 py-0.5 text-[10px]">有解决方法</Badge>
      case "broken":
        return <Badge className="bg-red-500/10 text-red-500 border border-red-500/20 rounded-full font-semibold px-2 py-0.5 text-[10px]">已损坏</Badge>
      case "unofficial":
        return <Badge className="bg-blue-500/10 text-blue-500 border border-blue-500/20 rounded-full font-semibold px-2 py-0.5 text-[10px]">非官方更新</Badge>
      case "abandoned":
        return <Badge className="bg-gray-500/10 text-gray-500 border border-gray-500/20 rounded-full font-semibold px-2 py-0.5 text-[10px]">已弃用</Badge>
      case "obsolete":
        return <Badge className="bg-slate-500/10 text-slate-500 border border-slate-500/20 rounded-full font-semibold px-2 py-0.5 text-[10px]">已过时</Badge>
      default:
        return <Badge className="bg-green-500/10 text-green-500 border border-green-500/20 rounded-full font-semibold px-2 py-0.5 text-[10px]">兼容</Badge>
    }
  }

  // Helper to extract Nexus Link
  const getNexusLink = (mod: SmapiMod) => {
    return mod.ModPages.find(page => page.Text === "Nexus" || page.Url.includes("nexusmods.com"))?.Url || ""
  }

  return (
    <div className="space-y-6">
      {/* Search and Filters */}
      <div className="flex flex-col md:flex-row gap-4 justify-between items-center bg-card border border-border p-4 rounded-xl shadow-sm">
        <div className="relative w-full md:max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索模组名称、唯一ID、作者..."
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
            onClick={fetchOnlineModsList}
            className="h-8 w-8 rounded-lg shrink-0 cursor-pointer"
            disabled={loading}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

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
                const nexusUrl = getNexusLink(mod)
                const isNexus = !!nexusUrl
                const nexusId = isNexus ? nexusUrl.split("/").pop() : ""

                return (
                  <Card key={mod.Slug} className="border border-border/80 bg-card hover:border-primary/45 hover:shadow-md transition-all duration-300 flex flex-col justify-between overflow-hidden">
                    <CardHeader className="p-4 pb-2 space-y-1.5">
                      <div className="flex justify-between items-start gap-2">
                        <CardTitle className="text-sm font-bold truncate pr-2 text-foreground" title={mod.Name}>
                          {mod.Name}
                        </CardTitle>
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
                        {isNexus ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-1 text-[11px] h-8 rounded-lg gap-1 border-border/85 hover:bg-accent cursor-pointer"
                            onClick={() => window.open(nexusUrl, "_blank")}
                          >
                            <ExternalLink className="h-3 w-3" />
                            <span>Nexus ({nexusId})</span>
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-1 text-[11px] h-8 rounded-lg gap-1 border-border/85 hover:bg-accent cursor-pointer"
                            onClick={() => {
                              const page = mod.ModPages[0]
                              if (page) window.open(page.Url, "_blank")
                            }}
                            disabled={mod.ModPages.length === 0}
                          >
                            <ExternalLink className="h-3 w-3" />
                            <span>查看官网</span>
                          </Button>
                        )}

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
            <div className="flex justify-between items-center bg-card border border-border p-3.5 rounded-xl text-xs shadow-sm">
              <span className="text-muted-foreground font-medium">
                当前第 {currentPage} 页 / 共 {totalPages} 页 (共 {filteredMods.length} 项)
              </span>
              
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                  className="h-8 text-[11px] rounded-lg gap-1 hover:bg-accent cursor-pointer"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  <span>上一页</span>
                </Button>
                
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages}
                  className="h-8 text-[11px] rounded-lg gap-1 hover:bg-accent cursor-pointer"
                >
                  <span>下一页</span>
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
