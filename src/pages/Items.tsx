import { useEffect, useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ChevronLeft, ChevronRight, Coins, Gift, Package, Search, Soup, Tag, Trash2 } from "lucide-react"
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
  const [items, setItems] = useState<ItemEntry[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [itemTypes, setItemTypes] = useState<string[]>([])
  const [searchTerm, setSearchTerm] = useState("")
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("")
  const [activeCategory, setActiveCategory] = useState("全部")
  const [activeType, setActiveType] = useState("全部")
  const [highlightedItemId, setHighlightedItemId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearchTerm(searchTerm)
    }, 250)

    return () => {
      window.clearTimeout(timer)
    }
  }, [searchTerm])

  useEffect(() => {
    let canceled = false

    async function loadOverview() {
      const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__
      const gameDir = localStorage.getItem("stardewGameDirectory") || ""
      const cacheKey = getItemGameDataCacheKey(gameDir)
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
          setError("当前环境不是 Tauri，无法直接读取游戏目录。")
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
  }, [])

  useEffect(() => {
    setPage(1)
  }, [activeCategory, activeType, debouncedSearchTerm])

  useEffect(() => {
    if (!navigationTarget) return

    setSearchTerm(navigationTarget)
    setActiveCategory("全部")
    setActiveType("全部")
    setPage(1)
    onNavigationHandled?.()
  }, [navigationTarget, onNavigationHandled])

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
  }, [activeCategory, activeType, debouncedSearchTerm, page])

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
        <h2 className="text-3xl font-bold tracking-tight">物品百科</h2>
        <p className="text-muted-foreground mt-1">
          按需读取当前筛选页的物品名称、描述、分类、售价和图标
        </p>
      </div>

      <div className="space-y-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-10"
            placeholder="搜索物品名、内部名、ID 或描述..."
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
            {totalCount === 0 ? "暂无结果" : `第 ${pageStart}-${pageEnd} 项，共 ${totalCount} 项`}
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={loading || page <= 1}
            >
              <ChevronLeft className="h-4 w-4" />
              上一页
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
              下一页
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {(loading || error) && (
        <div className="text-xs text-muted-foreground">
          {loading
            ? "正在读取当前筛选页的物品数据..."
            : `未能读取游戏目录中的物品数据：${error}`}
        </div>
      )}

      {items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Package className="mb-4 h-12 w-12 text-muted-foreground/40" />
            <p className="text-lg font-semibold">
              {totalCount === 0 ? "未读取到物品百科数据" : "没有符合条件的物品"}
            </p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              {totalCount === 0
                ? "请在设置中确认星露谷安装目录可用，程序会直接从游戏内容目录解析物品信息。"
                : "调整搜索词、类型或分类筛选后再试。"}
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
                    <span>{item.edibility == null ? "不可食用" : `${item.edibility} 能量`}</span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Gift className="h-3.5 w-3.5" />
                    <span>{item.canBeGivenAsGift ? "可送礼" : "不可送礼"}</span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">{item.itemType}</Badge>
                  <Badge variant="outline">
                    <Trash2 className="mr-1 h-3 w-3" />
                    {item.canBeTrashed ? "可丢弃" : "不可丢弃"}
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
