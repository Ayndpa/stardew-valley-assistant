import { useTranslation } from "react-i18next"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Separator } from "@/components/ui/separator"
import type { Page } from "@/App"
import {
  Sprout,
  Package,
  Users,
  CalendarDays,
  Fish,
  PencilRuler,
  ArchiveRestore,
  Puzzle,
  Download,
  ListChecks,
  Sliders,
  Trophy,
} from "lucide-react"

interface FeaturesCardProps {
  enabledFeatures: Page[]
  onEnabledFeaturesChange: (features: Page[]) => void
}

export function FeaturesCard({
  enabledFeatures,
  onEnabledFeaturesChange,
}: FeaturesCardProps) {
  const { t } = useTranslation()

  const optionalFeatures: { id: Page; icon: any }[] = [
    { id: "collections", icon: Trophy },
    { id: "crops", icon: Sprout },
    { id: "items", icon: Package },
    { id: "npcs", icon: Users },
    { id: "calendar", icon: CalendarDays },
    { id: "fishingMap", icon: Fish },
    { id: "saveEditor", icon: PencilRuler },
    { id: "saveBackups", icon: ArchiveRestore },
    { id: "mods", icon: Puzzle },
    { id: "onlineMods", icon: Download },
    { id: "downloads", icon: ListChecks },
  ]

  const handleToggle = (id: Page, checked: boolean) => {
    if (checked) {
      onEnabledFeaturesChange([...enabledFeatures, id])
    } else {
      onEnabledFeaturesChange(enabledFeatures.filter((f) => f !== id))
    }
  }

  const handleEnableAll = () => {
    onEnabledFeaturesChange(optionalFeatures.map((f) => f.id))
  }

  const handleDisableAll = () => {
    onEnabledFeaturesChange([])
  }

  return (
    <Card className="border border-border/80 overflow-hidden">
      <CardHeader className="bg-gradient-to-r from-primary/10 via-transparent to-transparent pb-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20 shrink-0">
              <Sliders className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg font-bold">{t("settings.features.title")}</CardTitle>
              <CardDescription className="text-xs">{t("settings.features.description")}</CardDescription>
            </div>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4 pt-6">
        {/* Batch actions */}
        <div className="flex justify-end gap-2 pb-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleEnableAll}
            className="text-xs h-8 rounded-lg cursor-pointer hover:bg-accent/40"
          >
            {t("settings.features.enableAll")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDisableAll}
            className="text-xs h-8 rounded-lg cursor-pointer hover:bg-accent/40"
          >
            {t("settings.features.disableAll")}
          </Button>
        </div>

        <Separator className="bg-border/60" />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {optionalFeatures.map((item) => {
            const Icon = item.icon
            const isChecked = enabledFeatures.includes(item.id)
            const inputId = `feature-${item.id}`

            return (
              <div
                key={item.id}
                onClick={() => handleToggle(item.id, !isChecked)}
                className="flex items-center justify-between p-3 rounded-lg bg-accent/30 hover:bg-accent/50 border border-border/40 transition-all cursor-pointer select-none"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="rounded-lg p-2 bg-primary/10 text-primary shrink-0">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <label
                      htmlFor={inputId}
                      className="text-sm font-semibold text-foreground cursor-pointer truncate"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {t(`sidebar.${item.id}`)}
                    </label>
                  </div>
                </div>
                <div onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    id={inputId}
                    checked={isChecked}
                    onCheckedChange={(checked) => handleToggle(item.id, !!checked)}
                    className="h-4 w-4 rounded cursor-pointer"
                  />
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
