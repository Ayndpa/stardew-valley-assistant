import { useRef, useState, useEffect, useCallback } from "react"
import { createPortal } from "react-dom"
import { ResponsiveGridLayout, verticalCompactor } from "react-grid-layout"
import { X } from "lucide-react"
import type { DashboardLayout, SaveDetail, WidgetRenderProps } from "./types"
import { getWidget } from "./widget-registry"
import { WidgetShell } from "./WidgetShell"
import { Button } from "@/components/ui/button"
import type { ItemEntry } from "../items/types"
import type { Layout } from "react-grid-layout"

const BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480 }
const COLS = { lg: 12, md: 8, sm: 6, xs: 4 }
type DashboardBreakpoint = keyof typeof BREAKPOINTS

function useContainerWidth(ref: React.RefObject<HTMLDivElement | null>): number {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    if (!ref.current) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWidth(entry.contentRect.width)
      }
    })
    observer.observe(ref.current)
    setWidth(ref.current.offsetWidth)
    return () => observer.disconnect()
  }, [ref])
  return width
}

interface WidgetGridProps {
  layout: DashboardLayout
  isEditMode: boolean
  selectedSaveId: string
  saveDetail: SaveDetail | null
  isLoading: boolean
  itemEntries: ItemEntry[] | null
  onLayoutChange: (layouts: Array<{ i: string; x: number; y: number; w: number; h: number }>) => void
  onRemoveWidget: (instanceId: string) => void
  onConfigChange: (instanceId: string, patch: Record<string, unknown>) => void
}

export function WidgetGrid({
  layout,
  isEditMode,
  selectedSaveId,
  saveDetail,
  isLoading,
  itemEntries,
  onLayoutChange,
  onRemoveWidget,
  onConfigChange,
}: WidgetGridProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const width = useContainerWidth(containerRef)
  const [configuringInstanceId, setConfiguringInstanceId] = useState<string | null>(null)

  // Close config panel when exiting edit mode
  useEffect(() => {
    if (!isEditMode) setConfiguringInstanceId(null)
  }, [isEditMode])

  const handleCloseConfig = useCallback(() => setConfiguringInstanceId(null), [])

  const rglLayout: Layout = layout.widgets.map((w) => ({
    i: w.instanceId,
    x: w.layout.x,
    y: w.layout.y,
    w: w.layout.w,
    h: w.layout.h,
    minW: w.layout.minW,
    minH: w.layout.minH,
    maxW: w.layout.maxW,
    maxH: w.layout.maxH,
    static: !isEditMode,
  }))

  const layouts: Record<DashboardBreakpoint, Layout> = {
    lg: rglLayout,
    md: rglLayout,
    sm: rglLayout,
    xs: rglLayout,
  }

  // Find the widget instance currently being configured
  const configuringWidget = configuringInstanceId
    ? layout.widgets.find((w) => w.instanceId === configuringInstanceId)
    : null
  const configuringDefinition = configuringWidget ? getWidget(configuringWidget.widgetId) : null

  return (
    <div ref={containerRef} className={isEditMode ? "dashboard-edit-mode" : ""}>
      {width > 0 && (
        <ResponsiveGridLayout
          width={width}
          breakpoints={BREAKPOINTS}
          cols={COLS}
          rowHeight={80}
          layouts={layouts}
          dragConfig={{ enabled: isEditMode, handle: ".drag-handle", threshold: 3, bounded: false }}
          resizeConfig={{ enabled: isEditMode }}
          onLayoutChange={(currentLayout: Layout) => {
            if (!isEditMode) return
            onLayoutChange(currentLayout.map((item) => ({
              i: item.i,
              x: item.x,
              y: item.y,
              w: item.w,
              h: item.h,
            })))
          }}
          compactor={verticalCompactor}
          margin={[16, 16]}
        >
          {layout.widgets.map((widget) => {
            const definition = getWidget(widget.widgetId)
            if (!definition) return null

            const renderProps: WidgetRenderProps = {
              selectedSaveId,
              saveDetail,
              isLoading,
              itemEntries,
              config: widget.config ?? {},
              isEditMode,
              onConfigChange: (patch) => onConfigChange(widget.instanceId, patch),
            }

            return (
              <div key={widget.instanceId}>
                <WidgetShell
                  isEditMode={isEditMode}
                  canRemove={definition.removable !== false}
                  onRemove={() => onRemoveWidget(widget.instanceId)}
                  onSettings={
                    definition.renderConfig
                      ? () => setConfiguringInstanceId(widget.instanceId)
                      : undefined
                  }
                >
                  {definition.render(renderProps)}
                </WidgetShell>
              </div>
            )
          })}
        </ResponsiveGridLayout>
      )}

      {/* Config panel modal */}
      {configuringWidget && configuringDefinition?.renderConfig &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
            onClick={(e) => { if (e.target === e.currentTarget) handleCloseConfig() }}
          >
            <div className="w-full max-w-md bg-card border border-border rounded-xl shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden">
              {configuringDefinition.renderConfig({
                selectedSaveId,
                saveDetail,
                isLoading,
                itemEntries,
                config: configuringWidget.config ?? {},
                isEditMode,
                onConfigChange: (patch) => onConfigChange(configuringWidget.instanceId, patch),
              })}
              <div className="flex justify-end px-4 pb-4">
                <Button variant="outline" size="sm" onClick={handleCloseConfig} className="gap-1.5">
                  <X className="h-3.5 w-3.5" />
                  关闭
                </Button>
              </div>
            </div>
          </div>,
          document.body,
        )
      }
    </div>
  )
}
