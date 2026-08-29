import { useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useTranslation } from "react-i18next"
import { Heart, MessageCircle, Gift } from "lucide-react"
import { registerWidget } from "../widget-registry"
import type { WidgetRenderProps } from "../types"

const VILLAGERS = new Set([
  "Abigail", "Alex", "Caroline", "Clint", "Demetrius", "Elliott", "Emily", "Evelyn",
  "George", "Gus", "Haley", "Harvey", "Jas", "Jodi", "Kent", "Krobus", "Leah", "Leo",
  "Lewis", "Linus", "Marnie", "Maru", "Pam", "Penny", "Pierre", "Robin", "Sam", "Sandy",
  "Sebastian", "Shane", "Vincent", "Willy", "Wizard", "Dwarf",
])

function FriendshipSummaryContent({ saveDetail }: WidgetRenderProps) {
  const { t } = useTranslation()

  const sorted = useMemo(() => {
    if (!saveDetail) return []
    return saveDetail.friendships
      .filter((f) => VILLAGERS.has(f.npcName))
      .map((f) => ({
        ...f,
        hearts: Math.floor(f.points / 250),
      }))
      .sort((a, b) => b.hearts - a.hearts)
      .slice(0, 12)
  }, [saveDetail])

  if (!saveDetail || sorted.length === 0) return null

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Heart className="h-4 w-4 text-red-400" />
          {t("dashboard.widgetPicker.friendshipSummary.name")}
        </CardTitle>
      </CardHeader>
      <CardContent className="overflow-auto">
        <div className="space-y-1.5">
          {sorted.map((npc) => {
            const pct = Math.min(100, (npc.hearts / 10) * 100)
            const npcName = t(`npcs.${npc.npcName}`, npc.npcName)
            return (
              <div key={npc.npcName} className="flex items-center gap-2 py-1">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs font-medium truncate">{npcName}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {npc.talkedToToday && (
                        <MessageCircle className="h-3 w-3 text-green-500" />
                      )}
                      {npc.giftsToday > 0 && (
                        <Gift className="h-3 w-3 text-pink-400" />
                      )}
                      <span className="text-[10px] text-muted-foreground">
                        {npc.hearts}❤
                      </span>
                    </div>
                  </div>
                  <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-red-400 transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

registerWidget({
  id: "friendship-summary",
  nameKey: "dashboard.widgetPicker.friendshipSummary.name",
  descriptionKey: "dashboard.widgetPicker.friendshipSummary.description",
  icon: Heart,
  defaultSize: "medium",
  category: "social",
  render: (props) => <FriendshipSummaryContent {...props} />,
})
