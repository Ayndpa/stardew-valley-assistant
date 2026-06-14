import { useEffect, useMemo, useState, useRef } from "react"
import { useTranslation } from "react-i18next"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { BookOpen, ChevronLeft, ChevronRight, Coins, Gift, Package, Search, Soup, Tag, Trash2 } from "lucide-react"
import {
  ItemEntry,
  ItemGameDataOverview,
  ItemGameDataQueryResult,
  getItemGameDataCacheKey,
  readCache,
  writeCache,
} from "./items/types"

interface ItemsProps {
  navigationTarget?: string | null
  onNavigationHandled?: () => void
}

const PAGE_SIZE = 24

export function Items({ navigationTarget, onNavigationHandled }: ItemsProps) {
  const { t, i18n } = useTranslation()
  const [items, setItems] = useState<ItemEntry[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [itemTypes, setItemTypes] = useState<string[]>([])
  const [searchTerm, setSearchTerm] = useState("")
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("")
  const [highlightedItemId, setHighlightedItemId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)

  const activeLang = i18n.resolvedLanguage || i18n.language || "zh"
  const allLabel = activeLang.toLowerCase().startsWith("zh") ? "全部" : "All"

  const [activeCategory, setActiveCategory] = useState(allLabel)
  const [activeType, setActiveType] = useState(allLabel)

  const prevLangRef = useRef(activeLang)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearchTerm(searchTerm)
    }, 250)

    return () => {
      window.clearTimeout(timer)
    }
  }, [searchTerm])

  // Reset activeCategory/activeType filters to localized default ("全部" / "All") when switching languages
  useEffect(() => {
    if (prevLangRef.current !== activeLang) {
      const oldAllLabel = prevLangRef.current.toLowerCase().startsWith("zh") ? "全部" : "All"
      const newAllLabel = activeLang.toLowerCase().startsWith("zh") ? "全部" : "All"
      if (activeCategory === oldAllLabel) {
        setActiveCategory(newAllLabel)
      }
      if (activeType === oldAllLabel) {
        setActiveType(newAllLabel)
      }
      prevLangRef.current = activeLang
    }
  }, [activeLang, activeCategory, activeType])

  useEffect(() => {
    let canceled = false

    async function loadOverview() {
      const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__
      const gameDir = localStorage.getItem("stardewGameDirectory") || ""
      const cacheKey = getItemGameDataCacheKey(gameDir, activeLang)
      const cached = readCache<ItemGameDataOverview>(cacheKey)

      if (cached && !canceled) {
        setCategories(cached.data.categories)
        setItemTypes(cached.data.itemTypes)
        setTotalCount(cached.data.totalCount)
        setError(null)
      }

      if (!isTauri) {
        if (!canceled) {
          setLoading(false)
          setError(t("items.notTauri", { defaultValue: "当前环境不是 Tauri，无法直接读取游戏目录。" }))
        }
        return
      }

      if (!cached && !canceled) {
        setLoading(true)
        setError(null)
      }

      try {
        const { invoke } = await import("@tauri-apps/api/core")
        const data = await invoke<ItemGameDataOverview>("get_item_game_data_overview", {
          gameDir: gameDir.trim() || undefined,
          lang: activeLang,
        })
        if (!canceled) {
          setCategories(data.categories)
          setItemTypes(data.itemTypes)
          setTotalCount(data.totalCount)
          setError(null)
        }
        writeCache(cacheKey, data)
      } catch (err) {
        console.error("Error loading item game data overview:", err)
        if (!canceled) {
          setLoading(false)
          setError(String(err))
          if (!cached) {
            setCategories([])
            setItemTypes([])
            setTotalCount(0)
          }
        }
      }
    }

    loadOverview()

    return () => {
      canceled = true
    }
  }, [activeLang, t])

  useEffect(() => {
    setPage(1)
  }, [activeCategory, activeType, debouncedSearchTerm])

  useEffect(() => {
    if (!navigationTarget) return

    setSearchTerm(navigationTarget)
    setActiveCategory(allLabel)
    setActiveType(allLabel)
    setPage(1)
    onNavigationHandled?.()
  }, [navigationTarget, onNavigationHandled, allLabel])

  useEffect(() => {
    let canceled = false

    async function loadItems() {
      const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__
      if (!isTauri) return

      const gameDir = localStorage.getItem("stardewGameDirectory") || ""
      setLoading(true)
      setError(null)

      try {
        const { invoke } = await import("@tauri-apps/api/core")
        const data = await invoke<ItemGameDataQueryResult>("query_item_game_data", {
          gameDir: gameDir.trim() || undefined,
          searchTerm: debouncedSearchTerm || undefined,
          activeCategory,
          activeType,
          page,
          pageSize: PAGE_SIZE,
          lang: activeLang,
        })

        if (!canceled) {
          setItems(data.items)
          setTotalCount(data.totalCount)
          setHighlightedItemId(null)
        }
      } catch (err) {
        console.error("Error querying item game data:", err)
        if (!canceled) {
          setItems([])
          setTotalCount(0)
          setError(String(err))
        }
      } finally {
        if (!canceled) {
          setLoading(false)
        }
      }
    }

    loadItems()

    return () => {
      canceled = true
    }
  }, [activeCategory, activeType, debouncedSearchTerm, page, activeLang])

  useEffect(() => {
    if (!navigationTarget || items.length === 0) return

    const normalizedTarget = navigationTarget.trim().toLowerCase()
    const exactMatch = items.find((item) => item.name.toLowerCase() === normalizedTarget)
    const partialMatch = exactMatch || items.find((item) => item.name.toLowerCase().includes(normalizedTarget))

    if (!partialMatch) {
      setHighlightedItemId(null)
      return
    }

    setHighlightedItemId(partialMatch.id)
    requestAnimationFrame(() => {
      document.getElementById(`item-card-${partialMatch.id}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      })
    })
  }, [items, navigationTarget])

  const totalPages = useMemo(() => Math.max(1, Math.ceil(totalCount / PAGE_SIZE)), [totalCount])
  const pageStart = totalCount === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const pageEnd = Math.min(totalCount, page * PAGE_SIZE)

  return (
    <div className="p-8 space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">{t("items.title")}</h2>
        <p className="text-muted-foreground mt-1">
          {t("items.description")}
        </p>
      </div>

      <div className="space-y-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-10"
            placeholder={t("items.searchPlaceholder")}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.currentTarget.value)}
          />
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {itemTypes.map((itemType) => (
              <Button
                key={itemType}
                size="sm"
                variant={activeType === itemType ? "default" : "outline"}
                onClick={() => setActiveType(itemType)}
              >
                {itemType}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {categories.map((category) => (
              <Button
                key={category}
                size="sm"
                variant={activeCategory === category ? "default" : "outline"}
                onClick={() => setActiveCategory(category)}
              >
                {category}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>
            {totalCount === 0 ? t("items.noResults") : t("items.itemsCountLabel", { start: pageStart, end: pageEnd, total: totalCount })}
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={loading || page <= 1}
            >
              <ChevronLeft className="h-4 w-4" />
              {t("items.prevPage")}
            </Button>
            <span className="min-w-20 text-center text-xs">
              {page} / {totalPages}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={loading || page >= totalPages}
            >
              {t("items.nextPage")}
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {(loading || error) && (
        <div className="text-xs text-muted-foreground">
          {loading
            ? t("items.loadingOverview")
            : t("items.loadError", { error })}
        </div>
      )}

      {items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Package className="mb-4 h-12 w-12 text-muted-foreground/40" />
            <p className="text-lg font-semibold">
              {totalCount === 0 ? t("items.noData") : t("items.noMatches")}
            </p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              {totalCount === 0
                ? t("items.noDataDesc")
                : t("items.noMatchesDesc")}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <Card
              key={item.id}
              id={`item-card-${item.id}`}
              className={`transition-all ${
                highlightedItemId === item.id
                  ? "ring-2 ring-primary shadow-md"
                  : "hover:shadow-md"
              }`}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border bg-accent/40">
                      {item.icon ? (
                        <img
                          src={item.icon}
                          alt=""
                          className="h-9 w-9 object-contain"
                          style={{ imageRendering: "pixelated" }}
                        />
                      ) : (
                        <Package className="h-5 w-5 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <CardTitle className="truncate text-base">{item.name}</CardTitle>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        #{item.id} · {item.internalName}
                      </p>
                    </div>
                  </div>
                  <Badge variant="secondary">{item.category}</Badge>
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                <p className="line-clamp-3 min-h-[3.75rem] text-sm leading-6 text-muted-foreground">
                  {item.description}
                </p>

                {item.recipeSources.length > 0 && (
                  <div className="space-y-2 rounded-md border border-border/70 bg-accent/20 px-3 py-2">
                    <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                      <BookOpen className="h-3.5 w-3.5" />
                      <span>{t("items.recipeSourcesLabel")}</span>
                    </div>
                    <div className="space-y-1">
                      {item.recipeSources.map((source) => (
                        <p key={source} className="text-xs leading-5 text-muted-foreground">
                          {source}
                        </p>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Tag className="h-3.5 w-3.5" />
                    <span className="truncate">{item.itemType}</span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Coins className="h-3.5 w-3.5" />
                    <span>{item.sellPrice}g</span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Soup className="h-3.5 w-3.5" />
                    <span>{item.edibility == null ? t("items.inedible") : t("items.edibleLabel", { energy: item.edibility })}</span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Gift className="h-3.5 w-3.5" />
                    <span>{item.canBeGivenAsGift ? t("items.giftable") : t("items.ungiftable")}</span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">{item.itemType}</Badge>
                  <Badge variant="outline">
                    <Trash2 className="mr-1 h-3 w-3" />
                    {item.canBeTrashed ? t("items.trashable") : t("items.untrashable")}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
