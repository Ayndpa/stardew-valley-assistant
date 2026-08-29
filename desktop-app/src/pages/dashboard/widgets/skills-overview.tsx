import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useTranslation } from "react-i18next"
import { TreePine, Pickaxe, Sword, Leaf, Fish } from "lucide-react"
import { registerWidget } from "../widget-registry"
import type { WidgetRenderProps } from "../types"

const SKILLS = [
  { key: "farming", icon: TreePine, color: "text-green-500", bgColor: "bg-green-500/10", barColor: "bg-green-500" },
  { key: "mining", icon: Pickaxe, color: "text-orange-400", bgColor: "bg-orange-400/10", barColor: "bg-orange-400" },
  { key: "combat", icon: Sword, color: "text-red-400", bgColor: "bg-red-400/10", barColor: "bg-red-400" },
  { key: "foraging", icon: Leaf, color: "text-emerald-500", bgColor: "bg-emerald-500/10", barColor: "bg-emerald-500" },
  { key: "fishing", icon: Fish, color: "text-blue-400", bgColor: "bg-blue-400/10", barColor: "bg-blue-400" },
] as const

function SkillsOverviewContent({ saveDetail }: WidgetRenderProps) {
  const { t } = useTranslation()

  if (!saveDetail) return null

  const summary = saveDetail.summary
  const levels = {
    farming: summary.farmingLevel,
    mining: summary.miningLevel,
    combat: summary.combatLevel,
    foraging: summary.foragingLevel,
    fishing: summary.fishingLevel,
  }

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">
          {t("dashboard.stats.levelTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {SKILLS.map(({ key, icon: Icon, color, bgColor, barColor }) => {
          const level = levels[key]
          const pct = Math.min(100, (level / 10) * 100)
          return (
            <div key={key} className="flex items-center gap-2.5">
              <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${bgColor}`}>
                <Icon className={`h-4 w-4 ${color}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-xs font-medium capitalize">{key}</span>
                  <span className="text-xs text-muted-foreground">Lv.{level}</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${barColor}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

registerWidget({
  id: "skills-overview",
  nameKey: "dashboard.widgetPicker.skillsOverview.name",
  descriptionKey: "dashboard.widgetPicker.skillsOverview.description",
  icon: TreePine,
  defaultSize: "small",
  category: "stats",
  render: (props) => <SkillsOverviewContent {...props} />,
})
