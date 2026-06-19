import type { ReactNode } from "react"
import { GripVertical, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTranslation } from "react-i18next"

interface WidgetShellProps {
  children: ReactNode
  isEditMode: boolean
  canRemove: boolean
  onRemove: () => void
}

export function WidgetShell({ children, isEditMode, canRemove, onRemove }: WidgetShellProps) {
  const { t } = useTranslation()

  return (
    <div
      className={`relative h-full rounded-lg border bg-card text-card-foreground shadow-sm transition-all duration-200 overflow-hidden ${
        isEditMode
          ? "border-dashed border-primary/40 hover:ring-2 hover:ring-primary/20"
          : ""
      }`}
    >
      {/* Edit mode chrome */}
      {isEditMode && (
        <>
          {/* Drag handle */}
          <div className="drag-handle absolute top-0 left-0 right-0 h-8 z-10 flex items-center px-2 cursor-grab active:cursor-grabbing bg-gradient-to-b from-background/80 to-transparent">
            <GripVertical className="h-4 w-4 text-muted-foreground/60" />
            <span className="ml-1 text-[10px] text-muted-foreground/50 font-medium uppercase tracking-wider">
              {t("dashboard.editMode.dragHint", "拖拽移动")}
            </span>
          </div>

          {/* Remove button */}
          {canRemove && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-1 right-1 z-10 h-6 w-6 rounded-full hover:bg-destructive/10 hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation()
                onRemove()
              }}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </>
      )}

      {/* Widget content */}
      <div className={`h-full overflow-auto ${isEditMode ? "pt-8 pointer-events-none" : ""}`}>
        {children}
      </div>
    </div>
  )
}
