import { useState, useEffect, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useTranslation } from "react-i18next"
import { invoke } from "@tauri-apps/api/core"
import {
  PackageOpen,
  Gift,
  Loader2,
  AlertCircle,
} from "lucide-react"

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

const CACHE_KEY = "stardew_bundle_game_data"
const CACHE_TTL = 24 * 60 * 60 * 1000 // 24 hours

function normalizeGameDir(gameDir: string) {
  return gameDir.trim().toLowerCase()
}

function readCache<T>(key: string): LocalCacheEntry<T> | null {
  if (typeof window === "undefined") return null
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const entry = JSON.parse(raw) as LocalCacheEntry<T>
    if (Date.now() - entry.fetchedAt > CACHE_TTL) return null
    return entry
  } catch {
    return null
  }
}

function writeCache<T>(key: string, data: T) {
  try {
    localStorage.setItem(key, JSON.stringify({ data, fetchedAt: Date.now() }))
  } catch {
    // ignore
  }
}

function getCacheKey(gameDir: string, lang: string) {
  return `${CACHE_KEY}:${normalizeGameDir(gameDir) || "default"}:${lang}`
}

const COLOR_MAP: Record<string, string> = {
  Green: "bg-green-500",
  Purple: "bg-purple-500",
  Orange: "bg-orange-500",
  Yellow: "bg-yellow-500",
  Red: "bg-red-500",
  Blue: "bg-blue-500",
  Teal: "bg-teal-500",
}

const COLOR_BORDER_MAP: Record<string, string> = {
  Green: "border-green-500",
  Purple: "border-purple-500",
  Orange: "border-orange-500",
  Yellow: "border-yellow-500",
  Red: "border-red-500",
  Blue: "border-blue-500",
  Teal: "border-teal-500",
}

const QUALITY_COLORS: Record<number, string> = {
  0: "",
  1: "text-gray-400",
  2: "text-yellow-500",
  3: "text-purple-500",
}

function QualityBadge({ quality, t }: { quality: number; t: (key: string) => string }) {
  if (quality === 0) return null
  const labels: Record<number, string> = {
    1: t("bundles.quality.silver"),
    2: t("bundles.quality.gold"),
    3: t("bundles.quality.iridium"),
  }
  return (
    <Badge variant="outline" className={`text-[10px] px-1 py-0 h-4 ${QUALITY_COLORS[quality]}`}>
      {labels[quality] || ""}
    </Badge>
  )
}

function IngredientCard({ ingredient, t }: { ingredient: BundleIngredient; t: (key: string) => string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border bg-card/50 px-2 py-1.5 text-sm">
      {ingredient.icon ? (
        <img src={ingredient.icon} alt={ingredient.name} className="h-6 w-6 object-contain" />
      ) : ingredient.isCategory ? (
        <div className="flex h-6 w-6 items-center justify-center rounded bg-accent">
          <PackageOpen className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
      ) : (
        <div className="flex h-6 w-6 items-center justify-center rounded bg-accent">
          <span className="text-[10px] text-muted-foreground">?</span>
        </div>
      )}
      <span className="flex-1 truncate">{ingredient.name}</span>
      {ingredient.stack > 1 && (
        <span className="text-xs text-muted-foreground">x{ingredient.stack}</span>
      )}
      <QualityBadge quality={ingredient.quality} t={t} />
    </div>
  )
}

function BundleCard({ bundle, t }: { bundle: BundleEntry; t: (key: string, options?: Record<string, unknown>) => string }) {
  const colorClass = COLOR_MAP[bundle.color] || "bg-gray-500"
  const borderClass = COLOR_BORDER_MAP[bundle.color] || "border-gray-500"

  return (
    <Card className={`border-l-4 ${borderClass}`}>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <div className={`h-3 w-3 rounded-full ${colorClass}`} />
          <CardTitle className="text-base">{bundle.displayName}</CardTitle>
        </div>
        {bundle.pick > 0 && bundle.pick < bundle.ingredients.length && (
          <p className="text-xs text-muted-foreground">
            {t("bundles.pickAny", { count: bundle.pick })}
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="grid gap-1.5">
          {bundle.ingredients.map((ing, i) => (
            <IngredientCard key={`${ing.itemId}-${i}`} ingredient={ing} t={t} />
          ))}
        </div>
        {bundle.rewardItem && (
          <div className="flex items-center gap-1.5 rounded-md border border-dashed bg-accent/30 px-2 py-1.5 text-xs text-muted-foreground">
            <Gift className="h-3.5 w-3.5 shrink-0" />
            {bundle.rewardItem.icon ? (
              <img src={bundle.rewardItem.icon} alt={bundle.rewardItem.name} className="h-5 w-5 object-contain" />
            ) : bundle.rewardItem.isGold ? (
              <span className="text-yellow-500">💰</span>
            ) : null}
            <span className="flex-1">{bundle.rewardItem.name}</span>
            {bundle.rewardItem.stack > 1 && (
              <span>x{bundle.rewardItem.stack}</span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

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
        if (!canceled) {
          setError(String(err))
        }
      } finally {
        if (!canceled) {
          setLoading(false)
        }
      }
    }

    fetchData()
    return () => { canceled = true }
  }, [i18n.language])

  // Group bundles by room
  const roomOrder = ["Crafts Room", "Pantry", "Fish Tank", "Boiler Room", "Vault", "Bulletin Board", "Abandoned Joja Mart"]

  const rooms = useMemo(() => {
    const grouped = new Map<string, BundleEntry[]>()
    for (const bundle of bundles) {
      const existing = grouped.get(bundle.room) || []
      existing.push(bundle)
      grouped.set(bundle.room, existing)
    }
    // Sort rooms by predefined order
    return roomOrder
      .filter((room) => grouped.has(room))
      .map((room) => ({
        room,
        displayName: grouped.get(room)?.[0]?.roomDisplayName || room,
        bundles: grouped.get(room) || [],
      }))
  }, [bundles])

  if (loading) {
    return (
      <div className="p-8">
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 rounded-lg border bg-accent/10">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">{t("bundles.loading")}</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 rounded-lg border bg-accent/10">
          <AlertCircle className="h-6 w-6 text-destructive" />
          <p className="text-sm text-destructive">{t("bundles.error")}</p>
          <p className="text-xs text-muted-foreground">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8 space-y-6">
      <div>
        <h2 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-primary to-green-600 bg-clip-text text-transparent">
          {t("bundles.title")}
        </h2>
      </div>

      {rooms.length > 0 ? (
        <Tabs defaultValue={rooms[0].room} className="w-full">
          <TabsList className="flex flex-wrap h-auto gap-1">
            {rooms.map((room) => (
              <TabsTrigger key={room.room} value={room.room} className="text-sm">
                {room.displayName}
              </TabsTrigger>
            ))}
          </TabsList>
          {rooms.map((room) => (
            <TabsContent key={room.room} value={room.room} className="mt-4">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {room.bundles.map((bundle) => (
                  <BundleCard key={bundle.key} bundle={bundle} t={t} />
                ))}
              </div>
            </TabsContent>
          ))}
        </Tabs>
      ) : (
        <div className="flex min-h-[30vh] flex-col items-center justify-center gap-3 rounded-lg border bg-accent/10">
          <PackageOpen className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t("bundles.noData")}</p>
        </div>
      )}
    </div>
  )
}
