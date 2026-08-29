import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useTranslation } from "react-i18next"
import { Coins } from "lucide-react"
import { registerWidget } from "../widget-registry"
import type { WidgetRenderProps } from "../types"

function CoinsWidget({ saveDetail }: WidgetRenderProps) {
  const { t } = useTranslation()

  if (!saveDetail) return null

  const { money, totalMoneyEarned } = saveDetail.summary

  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {t("dashboard.stats.moneyTitle")}
        </CardTitle>
        <Coins className="h-5 w-5 text-yellow-500" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{money.toLocaleString()}g</div>
        <p className="text-xs text-muted-foreground mt-1">
          {t("dashboard.stats.moneyDesc", { amount: totalMoneyEarned.toLocaleString() })}
        </p>
      </CardContent>
    </Card>
  )
}

registerWidget({
  id: "coins",
  nameKey: "dashboard.widgetPicker.coins.name",
  descriptionKey: "dashboard.widgetPicker.coins.description",
  icon: Coins,
  defaultSize: "small",
  category: "stats",
  render: (props) => <CoinsWidget {...props} />,
})
