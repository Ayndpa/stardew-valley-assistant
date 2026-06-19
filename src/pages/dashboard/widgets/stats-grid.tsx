import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useTranslation } from "react-i18next"
import { Coins, Heart, TreePine, Trophy } from "lucide-react"
import { registerWidget } from "../widget-registry"
import type { WidgetRenderProps, SaveDetail } from "../types"

const VILLAGERS = new Set([
  "Abigail", "Alex", "Caroline", "Clint", "Demetrius", "Elliott", "Emily", "Evelyn",
  "George", "Gus", "Haley", "Harvey", "Jas", "Jodi", "Kent", "Krobus", "Leah", "Leo",
  "Lewis", "Linus", "Marnie", "Maru", "Pam", "Penny", "Pierre", "Robin", "Sam", "Sandy",
  "Sebastian", "Shane", "Vincent", "Willy", "Wizard", "Dwarf",
])

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

function StatsGridContent({ saveDetail, itemEntries }: WidgetRenderProps) {
  const { t } = useTranslation()

  if (!saveDetail) return null

  const summary = saveDetail.summary
  const perfectionPct = itemEntries ? computeCollectionPct(saveDetail, itemEntries) : 0

  let maxHeartsCount = 0
  let totalTracked = 0
  saveDetail.friendships.forEach((f) => {
    if (VILLAGERS.has(f.npcName)) {
      totalTracked++
      const hearts = Math.floor(f.points / 250)
      if (hearts >= 8) maxHeartsCount++
    }
  })
  if (totalTracked === 0) totalTracked = 34

  const statsCards = [
    {
      title: t("dashboard.stats.moneyTitle"),
      value: `${summary.money.toLocaleString()}g`,
      icon: <Coins className="h-5 w-5" />,
      description: t("dashboard.stats.moneyDesc", { amount: summary.totalMoneyEarned.toLocaleString() }),
      color: "text-yellow-500",
    },
    {
      title: t("dashboard.stats.levelTitle"),
      value: t("dashboard.stats.levelValue", {
        level: Math.round(
          (summary.farmingLevel + summary.miningLevel + summary.combatLevel + summary.foragingLevel + summary.fishingLevel) / 5,
        ) || 1,
      }),
      icon: <TreePine className="h-5 w-5" />,
      description: t("dashboard.stats.levelDesc", { farming: summary.farmingLevel, mining: summary.miningLevel }),
      color: "text-green-500",
    },
    {
      title: t("dashboard.stats.friendshipTitle"),
      value: `${maxHeartsCount} / ${totalTracked}`,
      icon: <Heart className="h-5 w-5" />,
      description: t("dashboard.stats.friendshipDesc"),
      color: "text-red-400",
    },
    {
      title: t("dashboard.stats.collectionTitle"),
      value: `${perfectionPct}%`,
      icon: <Trophy className="h-5 w-5" />,
      description: t("dashboard.stats.collectionDesc", { percent: perfectionPct }),
      color: "text-amber-500",
    },
  ]

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 h-full">
      {statsCards.map((stat) => (
        <Card key={stat.title}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{stat.title}</CardTitle>
            <div className={stat.color}>{stat.icon}</div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stat.value}</div>
            <p className="text-xs text-muted-foreground mt-1">{stat.description}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

registerWidget({
  id: "stats-grid",
  nameKey: "dashboard.widgetPicker.statsGrid.name",
  descriptionKey: "dashboard.widgetPicker.statsGrid.description",
  icon: Coins,
  defaultSize: "full",
  category: "stats",
  render: (props) => <StatsGridContent {...props} />,
})
