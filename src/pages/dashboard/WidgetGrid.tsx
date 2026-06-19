import { useRef, useState, useEffect } from "react"
import { ResponsiveGridLayout, verticalCompactor } from "react-grid-layout"
import type { DashboardLayout, SaveDetail, WidgetRenderProps } from "./types"
import { getWidget } from "./widget-registry"
import { WidgetShell } from "./WidgetShell"
import type { ItemEntry } from "../items/types"
import type { Layout } from "react-grid-layout"

const BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480 }
const COLS = { lg: 12, md: 8, sm: 6, xs: 4 }

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
}: WidgetGridProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const width = useContainerWidth(containerRef)

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

  const layouts = { lg: rglLayout, md: rglLayout, sm: rglLayout, xs: rglLayout }

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
          onLayoutChange={(_currentLayout: Layout, allLayouts: Partial<Record<string, Layout>>) => {
            if (isEditMode) {
              const lgLayout = allLayouts.lg ?? _currentLayout
              onLayoutChange(lgLayout.map((item) => ({
                i: item.i,
                x: item.x,
                y: item.y,
                w: item.w,
                h: item.h,
              })))
            }
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
            }

            return (
              <div key={widget.instanceId}>
                <WidgetShell
                  isEditMode={isEditMode}
                  canRemove={definition.removable !== false}
                  onRemove={() => onRemoveWidget(widget.instanceId)}
                >
                  {definition.render(renderProps)}
                </WidgetShell>
              </div>
            )
          })}
        </ResponsiveGridLayout>
      )}
    </div>
  )
}
