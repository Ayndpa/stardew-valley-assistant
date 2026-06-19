import { useMemo } from "react"
import { createPortal } from "react-dom"
import { X, Plus } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useTranslation } from "react-i18next"
import { getAllWidgets } from "./widget-registry"
import type { WidgetInstance, WidgetDefinition } from "./types"

const CATEGORY_ORDER: WidgetDefinition["category"][] = ["stats", "weather", "progress", "info", "social"]

interface WidgetPickerProps {
  currentWidgets: WidgetInstance[]
  onAdd: (widgetId: string) => void
  onClose: () => void
}

export function WidgetPicker({ currentWidgets, onAdd, onClose }: WidgetPickerProps) {
  const { t } = useTranslation()

  const allWidgets = useMemo(() => getAllWidgets(), [])
  const currentIds = useMemo(
    () => new Set(currentWidgets.map((w) => w.widgetId)),
    [currentWidgets],
  )

  const grouped = useMemo(() => {
    const map = new Map<string, WidgetDefinition[]>()
    for (const cat of CATEGORY_ORDER) {
      map.set(cat, [])
    }
    for (const widget of allWidgets) {
      const list = map.get(widget.category) ?? []
      list.push(widget)
      map.set(widget.category, list)
    }
    return map
  }, [allWidgets])

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <Card className="w-full max-w-2xl max-h-[80vh] border border-border shadow-2xl bg-card rounded-xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4 shrink-0">
          <div>
            <CardTitle className="text-lg">{t("dashboard.widgetPicker.title")}</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              {t("dashboard.widgetPicker.description")}
            </p>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>

        <CardContent className="overflow-y-auto flex-1 space-y-6 pr-6">
          {CATEGORY_ORDER.map((category) => {
            const widgets = grouped.get(category) ?? []
            if (widgets.length === 0) return null

            return (
              <div key={category}>
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
                  {t(`dashboard.widgetPicker.categories.${category}`)}
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {widgets.map((widget) => {
                    const isAdded = currentIds.has(widget.id)
                    const Icon = widget.icon

                    return (
                      <div
                        key={widget.id}
                        className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                          isAdded
                            ? "bg-muted/50 border-muted"
                            : "bg-card hover:bg-accent/30 border-border"
                        }`}
                      >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                          <Icon className="h-5 w-5 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">
                            {t(widget.nameKey)}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                            {t(widget.descriptionKey)}
                          </p>
                        </div>
                        <Button
                          variant={isAdded ? "secondary" : "outline"}
                          size="sm"
                          className="shrink-0 h-8 gap-1"
                          disabled={isAdded}
                          onClick={() => {
                            onAdd(widget.id)
                          }}
                        >
                          {isAdded ? (
                            t("dashboard.widgetPicker.added")
                          ) : (
                            <>
                              <Plus className="h-3 w-3" />
                              {t("dashboard.widgetPicker.add")}
                            </>
                          )}
                        </Button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>
    </div>,
    document.body,
  )
}
