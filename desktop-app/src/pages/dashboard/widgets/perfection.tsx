import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useTranslation } from "react-i18next"
import { Trophy } from "lucide-react"
import { registerWidget } from "../widget-registry"
import type { WidgetRenderProps, SaveDetail } from "../types"

function computeCollectionPct(detail: SaveDetail, itemEntries: import("../../items/types").ItemEntry[]): number {
  const SHIPPING_EXCLUDE_TYPES = new Set(["arch", "fish", "minerals", "cooking", "ring", "seeds", "litter", "interactive", "quest", "asdf"])
  const SHIPPING_EXCLUDE_CATS = new Set(["seed", "fertilizer", "bait", "tackle", "furniture", "big_craftable", "clothing", "hat"])
  const shippedSet = new Set(detail.shippedItems)
  const shippableItems = itemEntries.filter(
    (item) => !SHIPPING_EXCLUDE_TYPES.has(item.itemTypeKey) && !SHIPPING_EXCLUDE_CATS.has(item.categoryKey),
  )
  const shippedCount = shippableItems.filter((item) => shippedSet.has(item.id)).length

  const fishSet = new Set(detail.fishCaught.map((id) => id.replace(/\(O\)/g, "")))
  const allFish = itemEntries.filter((item) => item.itemTypeKey === "fish")
  const caughtCount = allFish.filter((item) => fishSet.has(item.id)).length

  const museumSet = new Set(detail.museumPieces.map((id) => id.trim()))
  const allMuseum = itemEntries.filter((item) => item.itemTypeKey === "arch" || item.itemTypeKey === "minerals")
  const museumCount = allMuseum.filter((item) => museumSet.has(item.id)).length

  const cookedSet = new Set(detail.recipesCooked)
  const allCooking = itemEntries.filter((item) => item.itemTypeKey === "cooking")
  const cookedCount = allCooking.filter((item) => cookedSet.has(item.id)).length

  const craftedSet = new Set(detail.craftingRecipes)
  const allCrafting = itemEntries.filter((item) => item.itemTypeKey === "crafting")
  const craftedCount = allCrafting.filter((item) => craftedSet.has(item.name) || craftedSet.has(item.internalName)).length

  const stardropFlags = ["CF_Fair", "CF_Fish", "CF_Mines", "CF_Sewer", "museumComplete", "CF_Spouse", "CF_Statue"]
  const mailSet = new Set(detail.mailReceived)
  const stardropsFound = stardropFlags.filter((f) => mailSet.has(f)).length
  const stardropsFromStamina = Math.min(7, Math.max(0, Math.floor((detail.maxStamina - 270) / 34)))
  const stardrops = Math.max(stardropsFound, stardropsFromStamina)

  const monsterGoalsCompleted = detail.specificMonstersKilled.filter((m) => m.count > 0).length

  const shipPct = shippableItems.length > 0 ? shippedCount / shippableItems.length : 0
  const fishPct = allFish.length > 0 ? caughtCount / allFish.length : 0
  const museumPct = allMuseum.length > 0 ? museumCount / allMuseum.length : 0
  const cookPct = allCooking.length > 0 ? cookedCount / allCooking.length : 0
  const craftPct = allCrafting.length > 0 ? craftedCount / allCrafting.length : 0
  const stardropPct = stardrops / 7
  const walnutPct = detail.goldenWalnutsFound / 130
  const monsterPct = monsterGoalsCompleted > 0 ? Math.min(1, monsterGoalsCompleted / 12) : 0

  return Math.round(
    shipPct * 15 + fishPct * 10 + museumPct * 10 + cookPct * 10 + craftPct * 10 +
    stardropPct * 10 + walnutPct * 5 + monsterPct * 10,
  )
}

function PerfectionWidget({ saveDetail, itemEntries }: WidgetRenderProps) {
  const { t } = useTranslation()

  if (!saveDetail) return null

  const perfectionPct = itemEntries ? computeCollectionPct(saveDetail, itemEntries) : 0

  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {t("dashboard.stats.collectionTitle")}
        </CardTitle>
        <Trophy className="h-5 w-5 text-amber-500" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{perfectionPct}%</div>
        <p className="text-xs text-muted-foreground mt-1">
          {t("dashboard.stats.collectionDesc", { percent: perfectionPct })}
        </p>
      </CardContent>
    </Card>
  )
}

registerWidget({
  id: "perfection",
  nameKey: "dashboard.widgetPicker.perfection.name",
  descriptionKey: "dashboard.widgetPicker.perfection.description",
  icon: Trophy,
  defaultSize: "small",
  category: "stats",
  render: (props) => <PerfectionWidget {...props} />,
})
