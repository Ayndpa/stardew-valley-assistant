import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useTranslation } from "react-i18next"
import { Heart } from "lucide-react"
import { registerWidget } from "../widget-registry"
import type { WidgetRenderProps } from "../types"

const VILLAGERS = new Set([
  "Abigail", "Alex", "Caroline", "Clint", "Demetrius", "Elliott", "Emily", "Evelyn",
  "George", "Gus", "Haley", "Harvey", "Jas", "Jodi", "Kent", "Krobus", "Leah", "Leo",
  "Lewis", "Linus", "Marnie", "Maru", "Pam", "Penny", "Pierre", "Robin", "Sam", "Sandy",
  "Sebastian", "Shane", "Vincent", "Willy", "Wizard", "Dwarf",
])

function FriendshipProgressWidget({ saveDetail }: WidgetRenderProps) {
  const { t } = useTranslation()

  if (!saveDetail) return null

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

  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {t("dashboard.stats.friendshipTitle")}
        </CardTitle>
        <Heart className="h-5 w-5 text-red-400" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{maxHeartsCount} / {totalTracked}</div>
        <p className="text-xs text-muted-foreground mt-1">
          {t("dashboard.stats.friendshipDesc")}
        </p>
      </CardContent>
    </Card>
  )
}

registerWidget({
  id: "friendship-progress",
  nameKey: "dashboard.widgetPicker.friendshipProgress.name",
  descriptionKey: "dashboard.widgetPicker.friendshipProgress.description",
  icon: Heart,
  defaultSize: "small",
  category: "stats",
  render: (props) => <FriendshipProgressWidget {...props} />,
})
