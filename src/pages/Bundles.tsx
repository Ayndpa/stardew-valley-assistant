import { useState, useEffect, useMemo } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useTranslation } from "react-i18next"
import { invoke } from "@tauri-apps/api/core"
import {
  PackageOpen,
  Gift,
  Loader2,
  AlertCircle,
  Hammer,
  Leaf,
  Fish,
  Flame,
  Coins,
  ClipboardList,
  Store,
} from "lucide-react"

// ─── Types ───────────────────────────────────────────────────────────────────

interface BundleIngredient {
  itemId: string
  name: string
  icon: string | null
  stack: number
  quality: number
  isCategory: boolean
}

interface RewardItem {
  itemId: string
  name: string
  icon: string | null
  stack: number
  isGold: boolean
}

interface BundleEntry {
  key: string
  room: string
  roomDisplayName: string
  name: string
  displayName: string
  color: string
  pick: number
  reward: string
  rewardItem: RewardItem | null
  ingredients: BundleIngredient[]
}

interface BundleGameData {
  bundles: BundleEntry[]
}

interface LocalCacheEntry<T> {
  data: T
  fetchedAt: number
}

// ─── Constants ───────────────────────────────────────────────────────────────

const CACHE_KEY = "stardew_bundle_game_data"
const CACHE_TTL = 24 * 60 * 60 * 1000

const ROOM_ICONS: Record<string, React.ReactNode> = {
  "Crafts Room": <Hammer className="h-4 w-4" />,
  "Pantry": <Leaf className="h-4 w-4" />,
  "Fish Tank": <Fish className="h-4 w-4" />,
  "Boiler Room": <Flame className="h-4 w-4" />,
  "Vault": <Coins className="h-4 w-4" />,
  "Bulletin Board": <ClipboardList className="h-4 w-4" />,
  "Abandoned Joja Mart": <Store className="h-4 w-4" />,
}

const COLOR_THEME: Record<string, { bg: string; border: string; text: string; ring: string }> = {
  Green:  { bg: "bg-emerald-500/10", border: "border-emerald-500/30", text: "text-emerald-600 dark:text-emerald-400", ring: "ring-emerald-500/20" },
  Purple: { bg: "bg-purple-500/10",  border: "border-purple-500/30",  text: "text-purple-600 dark:text-purple-400",   ring: "ring-purple-500/20" },
  Orange: { bg: "bg-orange-500/10",  border: "border-orange-500/30",  text: "text-orange-600 dark:text-orange-400",   ring: "ring-orange-500/20" },
  Yellow: { bg: "bg-amber-500/10",   border: "border-amber-500/30",   text: "text-amber-600 dark:text-amber-400",     ring: "ring-amber-500/20" },
  Red:    { bg: "bg-red-500/10",     border: "border-red-500/30",     text: "text-red-600 dark:text-red-400",         ring: "ring-red-500/20" },
  Blue:   { bg: "bg-sky-500/10",     border: "border-sky-500/30",     text: "text-sky-600 dark:text-sky-400",         ring: "ring-sky-500/20" },
  Teal:   { bg: "bg-teal-500/10",    border: "border-teal-500/30",    text: "text-teal-600 dark:text-teal-400",       ring: "ring-teal-500/20" },
}

const QUALITY_THEME: Record<number, { bg: string; text: string; label: string }> = {
  1: { bg: "bg-gray-400/15", text: "text-gray-500 dark:text-gray-400", label: "" },
  2: { bg: "bg-amber-400/15", text: "text-amber-600 dark:text-amber-400", label: "" },
  3: { bg: "bg-violet-400/15", text: "text-violet-600 dark:text-violet-400", label: "" },
}

// ─── Cache helpers ───────────────────────────────────────────────────────────

function readCache<T>(key: string): LocalCacheEntry<T> | null {
  if (typeof window === "undefined") return null
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const entry = JSON.parse(raw) as LocalCacheEntry<T>
    if (Date.now() - entry.fetchedAt > CACHE_TTL) return null
    return entry
  } catch { return null }
}

function writeCache<T>(key: string, data: T) {
  try { localStorage.setItem(key, JSON.stringify({ data, fetchedAt: Date.now() })) } catch { /* */ }
}

function getCacheKey(gameDir: string, lang: string) {
  return `${CACHE_KEY}:${(gameDir || "").trim().toLowerCase() || "default"}:${lang}`
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function QualityDot({ quality }: { quality: number }) {
  if (quality === 0) return null
  const theme = QUALITY_THEME[quality]
  if (!theme) return null
  return (
    <span className={`inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full text-[9px] font-bold leading-none ${theme.bg} ${theme.text}`}>
      {quality === 1 ? "S" : quality === 2 ? "G" : "I"}
    </span>
  )
}

function IngredientRow({ ingredient }: { ingredient: BundleIngredient }) {
  return (
    <div className="group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-accent/50">
      {/* Icon */}
      <div className="relative flex-shrink-0">
        {ingredient.icon ? (
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-amber-100/60 dark:bg-amber-900/20 ring-1 ring-amber-200/50 dark:ring-amber-800/30">
            <img src={ingredient.icon} alt="" className="h-6 w-6 object-contain pixelated" />
          </div>
        ) : ingredient.isCategory ? (
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-violet-100/60 dark:bg-violet-900/20 ring-1 ring-violet-200/50 dark:ring-violet-800/30">
            <PackageOpen className="h-4 w-4 text-violet-500 dark:text-violet-400" />
          </div>
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted ring-1 ring-border">
            <span className="text-xs text-muted-foreground">?</span>
          </div>
        )}
      </div>
      {/* Name + quantity */}
      <span className="flex-1 min-w-0 truncate text-sm">{ingredient.name}</span>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {ingredient.stack > 1 && (
          <span className="text-xs font-medium text-muted-foreground tabular-nums">×{ingredient.stack}</span>
        )}
        <QualityDot quality={ingredient.quality} />
      </div>
    </div>
  )
}

function RewardBar({ reward }: { reward: RewardItem }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-amber-50/80 to-yellow-50/80 dark:from-amber-950/30 dark:to-yellow-950/30 px-3 py-2 ring-1 ring-amber-200/50 dark:ring-amber-800/30">
      <Gift className="h-4 w-4 flex-shrink-0 text-amber-500" />
      {reward.icon ? (
        <div className="flex h-6 w-6 items-center justify-center rounded bg-amber-100/60 dark:bg-amber-900/20">
          <img src={reward.icon} alt="" className="h-5 w-5 object-contain pixelated" />
        </div>
      ) : reward.isGold ? (
        <Coins className="h-5 w-5 text-amber-500" />
      ) : null}
      <span className="flex-1 min-w-0 truncate text-sm font-medium text-amber-700 dark:text-amber-300">{reward.name}</span>
      {reward.stack > 1 && (
        <span className="text-xs font-semibold text-amber-600 dark:text-amber-400 tabular-nums">×{reward.stack}</span>
      )}
    </div>
  )
}

function BundleCard({ bundle }: { bundle: BundleEntry }) {
  const theme = COLOR_THEME[bundle.color] || COLOR_THEME.Green

  return (
    <Card className={`group overflow-hidden transition-all duration-200 hover:shadow-md hover:ring-1 ${theme.ring} ${theme.border} border`}>
      {/* Header bar with color accent */}
      <div className={`flex items-center gap-2.5 px-4 py-2.5 ${theme.bg}`}>
        <div className={`h-2.5 w-2.5 rounded-full ${theme.text} bg-current`} />
        <h3 className={`text-sm font-semibold ${theme.text}`}>{bundle.displayName}</h3>
        {bundle.pick > 0 && bundle.pick < bundle.ingredients.length && (
          <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 py-0 h-5 font-normal opacity-80">
            {bundle.pick}/{bundle.ingredients.length}
          </Badge>
        )}
      </div>

      <CardContent className="p-3 space-y-1.5">
        {/* Ingredients */}
        {bundle.ingredients.map((ing, i) => (
          <IngredientRow key={`${ing.itemId}-${i}`} ingredient={ing} />
        ))}

        {/* Reward */}
        {bundle.rewardItem && (
          <div className="pt-1.5 mt-1 border-t border-dashed border-border/50">
            <RewardBar reward={bundle.rewardItem} />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function RoomIcon({ room }: { room: string }) {
  return ROOM_ICONS[room] || <PackageOpen className="h-4 w-4" />
}

// ─── Main component ──────────────────────────────────────────────────────────

export function Bundles({ onNavigateToItem: _onNavigateToItem }: { onNavigateToItem?: (itemName: string) => void }) {
  const { t, i18n } = useTranslation()
  const [bundles, setBundles] = useState<BundleEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let canceled = false
    async function fetchData() {
      setLoading(true)
      setError(null)
      const activeLang = i18n.language || "zh"
      const gameDir = localStorage.getItem("stardewGameDirectory") || ""
      const cacheKey = getCacheKey(gameDir, activeLang)
      const cached = readCache<BundleGameData>(cacheKey)

      if (cached && !canceled) {
        setBundles(cached.data.bundles)
        setLoading(false)
        return
      }
      try {
        const data = await invoke("get_bundle_game_data", {
          gameDir: gameDir.trim() || undefined,
          lang: activeLang,
        }) as BundleGameData
        if (!canceled) {
          setBundles(data.bundles)
          writeCache(cacheKey, data)
        }
      } catch (err) {
        if (!canceled) setError(String(err))
      } finally {
        if (!canceled) setLoading(false)
      }
    }
    fetchData()
    return () => { canceled = true }
  }, [i18n.language])

  const roomOrder = ["Crafts Room", "Pantry", "Fish Tank", "Boiler Room", "Vault", "Bulletin Board", "Abandoned Joja Mart"]

  const rooms = useMemo(() => {
    const grouped = new Map<string, BundleEntry[]>()
    for (const bundle of bundles) {
      const arr = grouped.get(bundle.room) || []
      arr.push(bundle)
      grouped.set(bundle.room, arr)
    }
    return roomOrder
      .filter((r) => grouped.has(r))
      .map((r) => ({
        room: r,
        displayName: grouped.get(r)?.[0]?.roomDisplayName || r,
        bundles: grouped.get(r) || [],
      }))
  }, [bundles])

  // ─── Loading / Error states ──────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">{t("bundles.loading")}</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-center">
          <AlertCircle className="h-8 w-8 text-destructive" />
          <p className="text-sm font-medium text-destructive">{t("bundles.error")}</p>
          <p className="text-xs text-muted-foreground max-w-md">{error}</p>
        </div>
      </div>
    )
  }

  // ─── Main render ─────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-5">
      {/* Page header */}
      <div className="space-y-1">
        <h2 className="text-2xl font-bold tracking-tight">
          {t("bundles.title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {bundles.length} {t("bundles.title").includes("Bundle") ? "bundles total" : "个收集包"}
        </p>
      </div>

      {rooms.length > 0 ? (
        <Tabs defaultValue={rooms[0].room} className="w-full">
          <TabsList className="h-auto flex-wrap gap-1 bg-muted/50 p-1">
            {rooms.map((room) => (
              <TabsTrigger
                key={room.room}
                value={room.room}
                className="gap-1.5 text-sm data-[state=active]:bg-background data-[state=active]:shadow-sm"
              >
                <RoomIcon room={room.room} />
                {room.displayName}
                <span className="ml-0.5 text-[10px] text-muted-foreground tabular-nums">
                  {room.bundles.length}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>

          {rooms.map((room) => (
            <TabsContent key={room.room} value={room.room} className="mt-4">
              <div className="grid gap-3 items-start sm:grid-cols-2 xl:grid-cols-3">
                {room.bundles.map((bundle) => (
                  <BundleCard key={bundle.key} bundle={bundle} />
                ))}
              </div>
            </TabsContent>
          ))}
        </Tabs>
      ) : (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed py-16">
          <PackageOpen className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">{t("bundles.noData")}</p>
        </div>
      )}
    </div>
  )
}
