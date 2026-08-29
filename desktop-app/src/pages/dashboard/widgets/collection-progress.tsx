import { useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useTranslation } from "react-i18next"
import {
  Package, Fish, Pickaxe, UtensilsCrossed, Wrench, ScrollText,
  Star, Cookie, Trophy,
} from "lucide-react"
import { registerWidget } from "../widget-registry"
import type { WidgetRenderProps } from "../types"

function CollectionProgressContent({ saveDetail, itemEntries }: WidgetRenderProps) {
  const { t } = useTranslation()

  const collectionStats = useMemo(() => {
    if (!saveDetail || !itemEntries) return null

    const SHIPPING_EXCLUDE_TYPES = new Set(["arch", "fish", "minerals", "cooking", "ring", "seeds", "litter", "interactive", "quest", "asdf"])
    const SHIPPING_EXCLUDE_CATS = new Set(["seed", "fertilizer", "bait", "tackle", "furniture", "big_craftable", "clothing", "hat"])
    const shippedSet = new Set(saveDetail.shippedItems)
    const shippableItems = itemEntries.filter(
      (item) => !SHIPPING_EXCLUDE_TYPES.has(item.itemTypeKey) && !SHIPPING_EXCLUDE_CATS.has(item.categoryKey),
    )
    const shippedCount = shippableItems.filter((item) => shippedSet.has(item.id)).length

    const fishSet = new Set(saveDetail.fishCaught.map((id) => id.replace(/\(O\)/g, "")))
    const allFish = itemEntries.filter((item) => item.itemTypeKey === "fish")
    const caughtCount = allFish.filter((item) => fishSet.has(item.id)).length

    const museumSet = new Set(saveDetail.museumPieces.map((id) => id.trim()))
    const allMuseum = itemEntries.filter((item) => item.itemTypeKey === "arch" || item.itemTypeKey === "minerals")
    const museumCount = allMuseum.filter((item) => museumSet.has(item.id)).length

    const cookedSet = new Set(saveDetail.recipesCooked)
    const allCooking = itemEntries.filter((item) => item.itemTypeKey === "cooking")
    const cookedCount = allCooking.filter((item) => cookedSet.has(item.id)).length

    const craftedSet = new Set(saveDetail.craftingRecipes)
    const allCrafting = itemEntries.filter((item) => item.itemTypeKey === "crafting")
    const craftedCount = allCrafting.filter((item) => craftedSet.has(item.name) || craftedSet.has(item.internalName)).length

    const secretNotesCount = saveDetail.secretNotesSeen.filter((id) => id >= 1 && id <= 25).length

    const stardropFlags = ["CF_Fair", "CF_Fish", "CF_Mines", "CF_Sewer", "museumComplete", "CF_Spouse", "CF_Statue"]
    const mailSet = new Set(saveDetail.mailReceived)
    const stardropsFound = stardropFlags.filter((f) => mailSet.has(f)).length
    const stardropsFromStamina = Math.min(7, Math.max(0, Math.floor((saveDetail.maxStamina - 270) / 34)))
    const stardrops = Math.max(stardropsFound, stardropsFromStamina)

    const monsterGoalsCompleted = saveDetail.specificMonstersKilled.filter((m) => m.count > 0).length

    const shipPct = shippableItems.length > 0 ? shippedCount / shippableItems.length : 0
    const fishPct = allFish.length > 0 ? caughtCount / allFish.length : 0
    const museumPct = allMuseum.length > 0 ? museumCount / allMuseum.length : 0
    const cookPct = allCooking.length > 0 ? cookedCount / allCooking.length : 0
    const craftPct = allCrafting.length > 0 ? craftedCount / allCrafting.length : 0
    const stardropPct = stardrops / 7
    const walnutPct = saveDetail.goldenWalnutsFound / 130
    const monsterPct = monsterGoalsCompleted > 0 ? Math.min(1, monsterGoalsCompleted / 12) : 0

    const perfectionPct = Math.round(
      shipPct * 15 + fishPct * 10 + museumPct * 10 + cookPct * 10 + craftPct * 10 +
      stardropPct * 10 + walnutPct * 5 + monsterPct * 10,
    )

    return {
      shipping: { collected: shippedCount, total: shippableItems.length },
      fish: { collected: caughtCount, total: allFish.length },
      museum: { collected: museumCount, total: allMuseum.length },
      cooking: { collected: cookedCount, total: allCooking.length },
      crafting: { collected: craftedCount, total: allCrafting.length },
      notes: { collected: secretNotesCount, total: 25 },
      stardrops,
      walnuts: saveDetail.goldenWalnutsFound,
      monsterGoals: monsterGoalsCompleted,
      perfectionPct,
    }
  }, [saveDetail, itemEntries])

  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-lg">{t("dashboard.collection.title")}</CardTitle>
            <CardDescription>
              {t("dashboard.collection.overall", { percent: collectionStats?.perfectionPct ?? 0 })}
            </CardDescription>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/10 shrink-0">
            <Trophy className="h-5 w-5 text-amber-500" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 overflow-auto">
        {itemEntries === null || !collectionStats ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
            {t("dashboard.collection.loading")}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-3">
              <Badge variant="secondary" className="gap-1.5 px-3 py-1.5">
                <Star className="h-3.5 w-3.5 text-amber-400" />
                {t("dashboard.collection.stardrops", { count: collectionStats.stardrops })}
              </Badge>
              <Badge variant="secondary" className="gap-1.5 px-3 py-1.5">
                <Cookie className="h-3.5 w-3.5 text-amber-600" />
                {t("dashboard.collection.walnuts", { count: collectionStats.walnuts })}
              </Badge>
              <Badge variant="secondary" className="gap-1.5 px-3 py-1.5">
                <Trophy className="h-3.5 w-3.5 text-red-400" />
                {t("dashboard.collection.monsterSlayer", { count: collectionStats.monsterGoals })}
              </Badge>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {[
                { key: "shipping", icon: Package, color: "text-green-500", bgColor: "bg-green-500/10", stats: collectionStats.shipping },
                { key: "fish", icon: Fish, color: "text-blue-400", bgColor: "bg-blue-400/10", stats: collectionStats.fish },
                { key: "museum", icon: Pickaxe, color: "text-violet-500", bgColor: "bg-violet-500/10", stats: collectionStats.museum },
                { key: "cooking", icon: UtensilsCrossed, color: "text-orange-400", bgColor: "bg-orange-400/10", stats: collectionStats.cooking },
                { key: "crafting", icon: Wrench, color: "text-teal-500", bgColor: "bg-teal-500/10", stats: collectionStats.crafting },
                { key: "notes", icon: ScrollText, color: "text-pink-400", bgColor: "bg-pink-400/10", stats: collectionStats.notes },
              ].map(({ key, icon: Icon, color, bgColor, stats }) => {
                const pct = stats.total > 0 ? Math.round((stats.collected / stats.total) * 100) : 0
                return (
                  <div
                    key={key}
                    className="flex items-center gap-3 p-3 rounded-lg border bg-card/50 hover:bg-accent/30 transition-colors"
                  >
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${bgColor}`}>
                      <Icon className={`h-5 w-5 ${color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium truncate">
                          {t(`dashboard.collection.${key}.title`)}
                        </span>
                        <span className="text-xs text-muted-foreground shrink-0 ml-2">
                          {stats.collected}/{stats.total}
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${color.replace("text-", "bg-")}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

registerWidget({
  id: "collection-progress",
  nameKey: "dashboard.widgetPicker.collectionProgress.name",
  descriptionKey: "dashboard.widgetPicker.collectionProgress.description",
  icon: Trophy,
  defaultSize: "full",
  category: "progress",
  render: (props) => <CollectionProgressContent {...props} />,
})
