import { useState, useEffect, useMemo } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useTranslation } from "react-i18next"
import {
  Package,
  Fish,
  Pickaxe,
  UtensilsCrossed,
  Wrench,
  ScrollText,
  Trophy,
  Star,
  Cookie,
  CheckCircle2,
  Circle,
  FileQuestion,
} from "lucide-react"
import { ItemEntry } from "./items/types"

interface SaveSummary {
  id: string
  playerName: string
  farmName: string
  money: number
  totalMoneyEarned: number
  dayOfMonth: number
  season: number
  year: number
  farmingLevel: number
  miningLevel: number
  combatLevel: number
  foragingLevel: number
  fishingLevel: number
  deepestMineLevel: number
  millisecondsPlayed: number
  lastSaveTime: number
}

interface FriendshipInfo {
  npcName: string
  points: number
  giftsThisWeek: number
  giftsToday: number
  talkedToToday: boolean
  status: string
}

interface MonsterKillInfo {
  name: string
  count: number
}

interface SecretNoteEntry {
  id: number
  content: string
  isImage: boolean
  imageIndex?: number | null
  isJournal: boolean
  discoveryHints: string[]
}

interface SaveDetail {
  summary: SaveSummary
  weatherToday: string
  weatherTomorrow: string
  museumPiecesCount: number
  museumPieces: string[]
  friendships: FriendshipInfo[]
  shippedItems: string[]
  fishCaught: string[]
  cookingRecipes: string[]
  craftingRecipes: string[]
  recipesCooked: string[]
  secretNotesSeen: number[]
  songsHeard: string[]
  mailReceived: string[]
  maxStamina: number
  specificMonstersKilled: MonsterKillInfo[]
  goldenWalnutsFound: number
}

interface CollectionCategory {
  key: string
  collected: ItemEntry[]
  missing: ItemEntry[]
  total: number
  collectedCount: number
}

interface CollectionsProps {
  selectedSaveId: string
  onNavigateToItem?: (itemName: string) => void
}

const SHIPPING_EXCLUDE_TYPES = new Set(["arch", "fish", "minerals", "cooking", "ring", "seeds", "litter", "interactive", "quest", "asdf"])
const SHIPPING_EXCLUDE_CATS = new Set([
  "seed", "fertilizer", "bait", "tackle", "furniture", "big_craftable", "clothing", "hat",
])

export function Collections({ selectedSaveId, onNavigateToItem }: CollectionsProps) {
  const { t, i18n } = useTranslation()
  const [detail, setDetail] = useState<SaveDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [itemEntries, setItemEntries] = useState<ItemEntry[] | null>(null)
  const [secretNotesData, setSecretNotesData] = useState<SecretNoteEntry[] | null>(null)

  const activeLang = i18n.resolvedLanguage || i18n.language || "zh"

  // Fetch save detail
  useEffect(() => {
    async function fetchDetail() {
      if (!selectedSaveId) {
        setLoading(false)
        return
      }
      setLoading(true)
      const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__
      if (isTauri) {
        try {
          const { invoke } = await import("@tauri-apps/api/core")
          const gameDir = localStorage.getItem("stardewGameDirectory") || undefined
          const d: SaveDetail = await invoke("get_save_detail", {
            id: selectedSaveId,
            gameDir,
            includeAvatar: false,
          })
          setDetail(d)
        } catch (err) {
          console.error("Error loading save detail:", err)
          setDetail(null)
        } finally {
          setLoading(false)
        }
      } else {
        setLoading(false)
      }
    }
    fetchDetail()
  }, [selectedSaveId])

  // Fetch item game data
  useEffect(() => {
    let canceled = false
    async function loadItems() {
      const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__
      if (!isTauri) { setItemEntries([]); return }
      const gameDir = localStorage.getItem("stardewGameDirectory") || ""
      try {
        const { invoke } = await import("@tauri-apps/api/core")
        const data = await invoke<{ encyclopedia: ItemEntry[] }>("get_item_game_data", {
          gameDir: gameDir.trim() || undefined,
          lang: activeLang,
        })
        if (!canceled) setItemEntries(data.encyclopedia)
      } catch (err) {
        console.error("Error loading item game data:", err)
        if (!canceled) setItemEntries([])
      }
    }
    loadItems()
    return () => { canceled = true }
  }, [activeLang])

  // Fetch secret notes game data
  useEffect(() => {
    let canceled = false
    async function loadSecretNotes() {
      const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__
      if (!isTauri) { setSecretNotesData([]); return }
      const gameDir = localStorage.getItem("stardewGameDirectory") || ""
      try {
        const { invoke } = await import("@tauri-apps/api/core")
        const data = await invoke<SecretNoteEntry[]>("get_secret_notes_game_data", {
          gameDir: gameDir.trim() || undefined,
          lang: activeLang,
        })
        if (!canceled) setSecretNotesData(data)
      } catch (err) {
        console.error("Error loading secret notes data:", err)
        if (!canceled) setSecretNotesData([])
      }
    }
    loadSecretNotes()
    return () => { canceled = true }
  }, [activeLang])

  // Compute collection categories
  const categories = useMemo((): CollectionCategory[] => {
    if (!detail || !itemEntries) return []

    // Shipping
    const shippedSet = new Set(detail.shippedItems)
    const shippableItems = itemEntries.filter(
      (item) => !SHIPPING_EXCLUDE_TYPES.has(item.itemTypeKey) && !SHIPPING_EXCLUDE_CATS.has(item.categoryKey),
    )
    const shippingCollected = shippableItems.filter((item) => shippedSet.has(item.id))
    const shippingMissing = shippableItems.filter((item) => !shippedSet.has(item.id))

    // Fish
    const fishSet = new Set(detail.fishCaught.map((id) => id.replace(/\(O\)/g, "")))
    const allFish = itemEntries.filter((item) => item.itemTypeKey === "fish")
    const fishCollected = allFish.filter((item) => fishSet.has(item.id))
    const fishMissing = allFish.filter((item) => !fishSet.has(item.id))

    // Museum
    const museumSet = new Set(detail.museumPieces.map((id) => id.trim()))
    const allMuseum = itemEntries.filter(
      (item) => item.itemTypeKey === "arch" || item.itemTypeKey === "minerals",
    )
    const museumCollected = allMuseum.filter((item) => museumSet.has(item.id))
    const museumMissing = allMuseum.filter((item) => !museumSet.has(item.id))

    // Cooking
    const cookedSet = new Set(detail.recipesCooked)
    const allCooking = itemEntries.filter((item) => item.itemTypeKey === "cooking")
    const cookingCollected = allCooking.filter((item) => cookedSet.has(item.id))
    const cookingMissing = allCooking.filter((item) => !cookedSet.has(item.id))

    // Crafting
    const craftedSet = new Set(
      detail.craftingRecipes,
    )
    const allCrafting = itemEntries.filter((item) => item.itemTypeKey === "crafting")
    const craftingCollected = allCrafting.filter(
      (item) => craftedSet.has(item.name) || craftedSet.has(item.internalName),
    )
    const craftingMissing = allCrafting.filter(
      (item) => !craftedSet.has(item.name) && !craftedSet.has(item.internalName),
    )

    // Secret Notes (use dynamic data from game, fallback to placeholders while loading)
    const seenNotes = new Set(detail.secretNotesSeen)
    const dynamicNotes = secretNotesData && secretNotesData.length > 0
      ? secretNotesData.filter((n) => !n.isJournal)
      : null
    const secretNotesOnly = dynamicNotes ?? Array.from({ length: 25 }, (_, i) => ({
      id: i + 1,
      content: "",
      isImage: false,
      imageIndex: null,
      isJournal: false,
      discoveryHints: [],
    }))
    const noteItems: ItemEntry[] = secretNotesOnly.map((n) => ({
      id: String(n.id),
      name: n.isImage
        ? `${t("collections.notes.notePrefix")} #${n.id} (${t("collections.notes.imageNote")})`
        : `${t("collections.notes.notePrefix")} #${n.id}`,
      internalName: `SecretNote_${n.id}`,
      description: n.content,
      itemType: "Secret Note",
      itemTypeKey: "note",
      category: "Secret Note",
      categoryKey: "note",
      icon: null,
      sellPrice: 0,
      canBeGivenAsGift: false,
      canBeTrashed: false,
      recipeSources: n.discoveryHints,
    }))
    const notesCollected = noteItems.filter((n) => seenNotes.has(Number(n.id)))
    const notesMissing = noteItems.filter((n) => !seenNotes.has(Number(n.id)))

    return [
      { key: "shipping", collected: shippingCollected, missing: shippingMissing, total: shippableItems.length, collectedCount: shippingCollected.length },
      { key: "fish", collected: fishCollected, missing: fishMissing, total: allFish.length, collectedCount: fishCollected.length },
      { key: "museum", collected: museumCollected, missing: museumMissing, total: allMuseum.length, collectedCount: museumCollected.length },
      { key: "cooking", collected: cookingCollected, missing: cookingMissing, total: allCooking.length, collectedCount: cookingCollected.length },
      { key: "crafting", collected: craftingCollected, missing: craftingMissing, total: allCrafting.length, collectedCount: craftingCollected.length },
      { key: "notes", collected: notesCollected, missing: notesMissing, total: 25, collectedCount: notesCollected.length },
    ]
  }, [detail, itemEntries, secretNotesData, t])

  // Extra stats
  const extraStats = useMemo(() => {
    if (!detail) return { stardrops: 0, walnuts: 0, monsterGoals: 0 }
    const stardropFlags = ["CF_Fair", "CF_Fish", "CF_Mines", "CF_Sewer", "museumComplete", "CF_Spouse", "CF_Statue"]
    const mailSet = new Set(detail.mailReceived)
    const stardropsFound = stardropFlags.filter((f) => mailSet.has(f)).length
    const stardropsFromStamina = Math.min(7, Math.max(0, Math.floor((detail.maxStamina - 270) / 34)))
    const stardrops = Math.max(stardropsFound, stardropsFromStamina)
    const monsterGoals = detail.specificMonstersKilled.filter((m) => m.count > 0).length
    return { stardrops, walnuts: detail.goldenWalnutsFound, monsterGoals }
  }, [detail])

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-[50vh]">
        <div className="text-center space-y-2">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto"></div>
          <p className="text-muted-foreground text-sm font-medium">{t("dashboard.loading")}</p>
        </div>
      </div>
    )
  }

  if (!selectedSaveId || !detail) {
    return (
      <div className="p-8 flex items-center justify-center h-[70vh]">
        <div className="text-center space-y-4 max-w-md">
          <FileQuestion className="h-16 w-16 text-muted-foreground/30 mx-auto" />
          <h3 className="text-xl font-bold text-muted-foreground">{t("dashboard.noSaveTitle")}</h3>
          <p className="text-sm text-muted-foreground/70">{t("dashboard.noSaveDescription")}</p>
        </div>
      </div>
    )
  }

  const tabIcons: Record<string, React.ReactNode> = {
    shipping: <Package className="h-4 w-4" />,
    fish: <Fish className="h-4 w-4" />,
    museum: <Pickaxe className="h-4 w-4" />,
    cooking: <UtensilsCrossed className="h-4 w-4" />,
    crafting: <Wrench className="h-4 w-4" />,
    notes: <ScrollText className="h-4 w-4" />,
  }

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">{t("collections.title")}</h2>
          <p className="text-muted-foreground mt-1">{t("collections.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="gap-1.5 px-3 py-1.5">
            <Star className="h-3.5 w-3.5 text-amber-400" />
            {t("dashboard.collection.stardrops", { count: extraStats.stardrops })}
          </Badge>
          <Badge variant="secondary" className="gap-1.5 px-3 py-1.5">
            <Cookie className="h-3.5 w-3.5 text-amber-600" />
            {t("dashboard.collection.walnuts", { count: extraStats.walnuts })}
          </Badge>
          <Badge variant="secondary" className="gap-1.5 px-3 py-1.5">
            <Trophy className="h-3.5 w-3.5 text-red-400" />
            {t("dashboard.collection.monsterSlayer", { count: extraStats.monsterGoals })}
          </Badge>
        </div>
      </div>

      {/* Tabs */}
      {itemEntries === null ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
          {t("dashboard.collection.loading")}
        </div>
      ) : (
        <Tabs defaultValue="shipping" className="space-y-4">
          <TabsList className="flex flex-wrap h-auto gap-1 p-1">
            {categories.map((cat) => (
              <TabsTrigger
                key={cat.key}
                value={cat.key}
                className="gap-1.5 text-xs data-[state=active]:bg-primary/10 data-[state=active]:text-primary"
              >
                {tabIcons[cat.key]}
                <span className="hidden sm:inline">{t(`dashboard.collection.${cat.key}.title`)}</span>
                <span className="text-muted-foreground">
                  {cat.collectedCount}/{cat.total}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>

          {categories.map((cat) => {
            const pct = cat.total > 0 ? Math.round((cat.collectedCount / cat.total) * 100) : 0
            return (
              <TabsContent key={cat.key} value={cat.key} className="space-y-4">
                {/* Progress header */}
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {tabIcons[cat.key]}
                        <span className="font-semibold">{t(`dashboard.collection.${cat.key}.title`)}</span>
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {cat.collectedCount} / {cat.total} ({pct}%)
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      {t(`dashboard.collection.${cat.key}.desc`)}
                    </p>
                  </CardContent>
                </Card>

                {/* Collected items */}
                <div>
                  <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    {t("collections.collectedTitle", { count: cat.collectedCount })}
                  </h3>
                  {cat.collected.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4">
                      {t(`dashboard.collection.${cat.key}.empty`)}
                    </p>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
                      {cat.collected.map((item) => (
                        <div
                          key={item.id}
                          className={`flex items-start gap-2 p-2 rounded-lg bg-green-500/5 border border-green-500/20 text-sm hover:bg-green-500/10 transition-colors ${onNavigateToItem && cat.key !== "notes" ? "cursor-pointer" : ""}`}
                          onClick={() => cat.key !== "notes" && onNavigateToItem?.(item.name)}
                          title={item.description || item.name}
                        >
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-background/80 mt-0.5">
                            {item.icon ? (
                              <img
                                src={item.icon}
                                alt=""
                                className="h-5 w-5 object-contain"
                                style={{ imageRendering: "pixelated" }}
                              />
                            ) : (
                              <Package className="h-3.5 w-3.5 text-muted-foreground" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-medium">{item.name}</span>
                            {cat.key === "notes" && item.description && (
                              <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2 whitespace-pre-line">{item.description}</p>
                            )}
                            {cat.key === "notes" && item.recipeSources.length > 0 && (
                              <div className="mt-1 space-y-0.5">
                                {item.recipeSources.map((hint, i) => (
                                  <p key={i} className="text-[10px] text-green-600/80">💡 {hint}</p>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Missing items */}
                <div>
                  <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
                    <Circle className="h-4 w-4 text-amber-500" />
                    {t("collections.missingTitle", { count: cat.missing.length })}
                  </h3>
                  {cat.missing.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4">
                      {t("collections.allComplete")}
                    </p>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
                      {cat.missing.map((item) => (
                        <div
                          key={item.id}
                          className={`flex items-start gap-2 p-2 rounded-lg bg-accent/20 text-sm text-muted-foreground hover:bg-accent/30 transition-colors ${onNavigateToItem && cat.key !== "notes" ? "cursor-pointer" : ""}`}
                          onClick={() => cat.key !== "notes" && onNavigateToItem?.(item.name)}
                          title={item.description || item.name}
                        >
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-background/80 mt-0.5">
                            {item.icon ? (
                              <img
                                src={item.icon}
                                alt=""
                                className="h-5 w-5 object-contain opacity-50"
                                style={{ imageRendering: "pixelated" }}
                              />
                            ) : (
                              <Package className="h-3.5 w-3.5 text-muted-foreground/50" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <span className="block truncate text-xs">{item.name}</span>
                            {cat.key === "notes" && item.description && (
                              <p className="text-[10px] text-muted-foreground/70 mt-0.5 line-clamp-2 whitespace-pre-line">{item.description}</p>
                            )}
                            {cat.key === "notes" && item.recipeSources.length > 0 && (
                              <div className="mt-1 space-y-0.5">
                                {item.recipeSources.map((hint, i) => (
                                  <p key={i} className="text-[10px] text-amber-500/80">💡 {hint}</p>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </TabsContent>
            )
          })}
        </Tabs>
      )}
    </div>
  )
}
