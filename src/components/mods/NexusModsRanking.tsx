import { useEffect, useMemo, useRef, useState } from "react"
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
import { useNexusModsRanking, type NexusRankedMod } from "@/hooks/useNexusModsRanking"
import { syncNexusModNameTranslations } from "@/lib/mod-translation-library"

export type { NexusRankedMod }

export interface NexusModsRankingProps {
  onOpenDetail?: (mod: NexusRankedMod) => void
}

export function NexusModsRanking({ onOpenDetail }: NexusModsRankingProps = {}) {
  const {
    sortField,
    setSortField,
    searchInputValue,
    setSearchInputValue,
    authorInputValue,
    setAuthorInputValue,
    uploaderInputValue,
    setUploaderInputValue,
    currentPage,
    setCurrentPage,
    jumpPage,
    setJumpPage,
    totalCount,
    ranking,
    loading,
    isBackgroundRefreshing,
    error,
    scrapeStatus,
    handleSearchSubmit,
    totalPages,
  } = useNexusModsRanking()
  const completedTranslationModIdsRef = useRef<Set<string>>(new Set())
  const syncingTranslationModIdsRef = useRef<Set<string>>(new Set())
  const [translationSyncingModIds, setTranslationSyncingModIds] = useState<Set<string>>(new Set())
  const [translatedNamesByNexusId, setTranslatedNamesByNexusId] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    if (loading || ranking.length === 0) return

    const pendingMods = ranking.filter((mod) => {
      return !completedTranslationModIdsRef.current.has(mod.nexusId) && !syncingTranslationModIdsRef.current.has(mod.nexusId)
    })
    if (pendingMods.length === 0) return

    pendingMods.forEach((mod) => syncingTranslationModIdsRef.current.add(mod.nexusId))
    setTranslationSyncingModIds(new Set(syncingTranslationModIdsRef.current))

    syncNexusModNameTranslations(pendingMods)
      .then(({ mods: translatedMods }) => {
        translatedMods.forEach((mod) => completedTranslationModIdsRef.current.add(mod.nexusId))
        setTranslatedNamesByNexusId((current) => {
          const next = new Map(current)
          translatedMods.forEach((mod) => next.set(mod.nexusId, mod.name))
          return next
        })
      })
      .catch((err) => {
        console.error("Failed to sync Nexus mod name translations:", err)
      })
      .finally(() => {
        pendingMods.forEach((mod) => syncingTranslationModIdsRef.current.delete(mod.nexusId))
        setTranslationSyncingModIds(new Set(syncingTranslationModIdsRef.current))
      })
  }, [loading, ranking])

  const translatedRanking = useMemo(() => {
    return ranking.map((mod) => ({
      ...mod,
      name: translatedNamesByNexusId.get(mod.nexusId) ?? mod.name,
    }))
  }, [ranking, translatedNamesByNexusId])

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
          {translationSyncingModIds.size > 0 && !loading && (
            <span className="flex items-center gap-1 text-[10px] text-sky-600 dark:text-sky-400 font-normal ml-2">
              <Loader2 className="h-3 w-3 animate-spin" />
              翻译库 {translationSyncingModIds.size}
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
        {/* Search Filters */}
        <form onSubmit={handleSearchSubmit} className="flex flex-col md:flex-row gap-2 w-full">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="模组名称..."
              value={searchInputValue}
              onChange={(e) => setSearchInputValue(e.target.value)}
              className="pl-9 bg-accent/10 border-border text-xs rounded-lg h-9"
            />
          </div>
          <div className="relative flex-1">
            <Input
              placeholder="作者..."
              value={authorInputValue}
              onChange={(e) => setAuthorInputValue(e.target.value)}
              className="bg-accent/10 border-border text-xs rounded-lg h-9 px-3"
            />
          </div>
          <div className="relative flex-1">
            <Input
              placeholder="上传者..."
              value={uploaderInputValue}
              onChange={(e) => setUploaderInputValue(e.target.value)}
              className="bg-accent/10 border-border text-xs rounded-lg h-9 px-3"
            />
          </div>
          <Button type="submit" size="sm" className="h-9 px-4 rounded-lg text-xs font-semibold cursor-pointer shrink-0">
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
      {!loading && translatedRanking.length > 0 && (
        <div className="space-y-1.5 animate-in fade-in duration-300">
          {translatedRanking.map((mod) => {
            const isSyncingTranslation = translationSyncingModIds.has(mod.nexusId)
            return (
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
              <div className="group/thumb relative z-10 w-10 h-10 rounded-lg bg-accent/30 border border-border/40 shrink-0 flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
                {mod.imageUrl ? (
                  <>
                    <img
                      src={mod.imageUrl}
                      alt={mod.name}
                      className="w-full h-full rounded-lg object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none"
                      }}
                    />
                    <div className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 hidden h-36 w-36 -translate-y-1/2 scale-95 overflow-hidden rounded-xl border border-border bg-popover p-1 opacity-0 shadow-2xl ring-1 ring-border/50 transition-all duration-150 group-hover/thumb:scale-100 group-hover/thumb:opacity-100 sm:block">
                      <img
                        src={mod.imageUrl}
                        alt=""
                        className="h-full w-full rounded-lg object-cover"
                        aria-hidden="true"
                      />
                    </div>
                  </>
                ) : (
                  <Trophy className="h-4 w-4 text-muted-foreground/40" />
                )}
              </div>

              {/* Name & Author */}
              <div className="flex-1 min-w-0">
                <div className="flex min-w-0 items-center gap-1.5">
                  <p className="text-xs font-bold text-foreground truncate group-hover:text-primary transition-colors">
                    {mod.name}
                  </p>
                  {isSyncingTranslation && (
                    <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-semibold text-sky-600 dark:text-sky-400 bg-sky-500/10 border border-sky-500/20 rounded-md px-1.5 py-0.5">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      翻译库
                    </span>
                  )}
                </div>
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
            )
          })}
        </div>
      )}

      {/* Empty State */}
      {!loading && translatedRanking.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground border border-dashed border-border rounded-xl">
          <Trophy className="h-8 w-8 text-muted-foreground/40 mb-2" />
          <p className="text-xs font-medium">没有找到相关的 NexusMods 模组。</p>
          <p className="text-[11px] text-muted-foreground/70 mt-1">请更换关键词重试，或者确认是否有可用 network。</p>
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
