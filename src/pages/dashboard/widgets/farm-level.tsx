import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useTranslation } from "react-i18next"
import { TreePine } from "lucide-react"
import { registerWidget } from "../widget-registry"
import type { WidgetRenderProps } from "../types"

function FarmLevelWidget({ saveDetail }: WidgetRenderProps) {
  const { t } = useTranslation()

  if (!saveDetail) return null

  const s = saveDetail.summary
  const avgLevel = Math.round(
    (s.farmingLevel + s.miningLevel + s.combatLevel + s.foragingLevel + s.fishingLevel) / 5,
  ) || 1

  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {t("dashboard.stats.levelTitle")}
        </CardTitle>
        <TreePine className="h-5 w-5 text-green-500" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">
          {t("dashboard.stats.levelValue", { level: avgLevel })}
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {t("dashboard.stats.levelDesc", { farming: s.farmingLevel, mining: s.miningLevel })}
        </p>
      </CardContent>
    </Card>
  )
}

registerWidget({
  id: "farm-level",
  nameKey: "dashboard.widgetPicker.farmLevel.name",
  descriptionKey: "dashboard.widgetPicker.farmLevel.description",
  icon: TreePine,
  defaultSize: "small",
  category: "stats",
  render: (props) => <FarmLevelWidget {...props} />,
})
