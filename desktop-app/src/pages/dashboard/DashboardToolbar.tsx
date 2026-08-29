import { Pencil, Check, Plus, RotateCcw, LayoutGrid } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useTranslation } from "react-i18next"
import type { SaveDetail } from "./types"

interface DashboardToolbarProps {
  isEditMode: boolean
  onToggleEditMode: () => void
  onAddWidget: () => void
  onResetLayout: () => void
  saveDetail: SaveDetail
}

export function DashboardToolbar({
  isEditMode,
  onToggleEditMode,
  onAddWidget,
  onResetLayout,
  saveDetail,
}: DashboardToolbarProps) {
  const { t } = useTranslation()

  const summary = saveDetail.summary
  const seasonName = t("seasons." + ["spring", "summer", "fall", "winter"][summary.season])
  const weekdayName = t("dashboard.weekdays." + ["mon", "tue", "wed", "thu", "fri", "sat", "sun"][(summary.dayOfMonth - 1) % 7])

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      {/* Left: Title & date */}
      <div className="flex items-center gap-3">
        <LayoutGrid className="h-6 w-6 text-primary" />
        <div>
          <h2 className="text-2xl font-bold tracking-tight">{t("dashboard.title")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("dashboard.dateValue", { season: seasonName, day: summary.dayOfMonth, weekday: weekdayName, year: summary.year })}
          </p>
        </div>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2">
        {isEditMode && (
          <>
            <Badge variant="secondary" className="gap-1.5 px-2.5 py-1 text-xs">
              <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
              {t("dashboard.editMode.active")}
            </Badge>

            <Button variant="outline" size="sm" onClick={onAddWidget} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              {t("dashboard.editMode.add")}
            </Button>

            <Button variant="outline" size="sm" onClick={onResetLayout} className="gap-1.5">
              <RotateCcw className="h-3.5 w-3.5" />
              {t("dashboard.editMode.reset")}
            </Button>
          </>
        )}

        <Button
          variant={isEditMode ? "default" : "outline"}
          size="sm"
          onClick={onToggleEditMode}
          className="gap-1.5"
        >
          {isEditMode ? (
            <>
              <Check className="h-3.5 w-3.5" />
              {t("dashboard.editMode.done")}
            </>
          ) : (
            <>
              <Pencil className="h-3.5 w-3.5" />
              {t("dashboard.editMode.edit")}
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
