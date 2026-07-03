import { useState, useCallback, useEffect } from "react"
import type { DashboardLayout } from "./types"
import { WIDGET_SIZE_PRESETS } from "./types"
import { getWidget } from "./widget-registry"

const STORAGE_KEY = "dashboard-layout"
const CURRENT_VERSION = 1

function generateId(): string {
  return `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function getDefaultLayout(): DashboardLayout {
  return {
    version: CURRENT_VERSION,
    widgets: [
      { instanceId: generateId(), widgetId: "weather-forecast", layout: { x: 0, y: 0, w: 12, h: 3 } },
      { instanceId: generateId(), widgetId: "coins", layout: { x: 0, y: 3, w: 3, h: 2 } },
      { instanceId: generateId(), widgetId: "farm-level", layout: { x: 3, y: 3, w: 3, h: 2 } },
      { instanceId: generateId(), widgetId: "friendship-progress", layout: { x: 6, y: 3, w: 3, h: 2 } },
      { instanceId: generateId(), widgetId: "perfection", layout: { x: 9, y: 3, w: 3, h: 2 } },
      { instanceId: generateId(), widgetId: "collection-progress", layout: { x: 0, y: 5, w: 12, h: 4 } },
    ],
  }
}

function loadLayout(): DashboardLayout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return getDefaultLayout()
    const parsed = JSON.parse(raw) as DashboardLayout
    if (!parsed.version || parsed.version !== CURRENT_VERSION) {
      return getDefaultLayout()
    }
    // Validate that all widget IDs still exist in the registry
    return parsed
  } catch {
    return getDefaultLayout()
  }
}

function saveLayout(layout: DashboardLayout): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout))
  } catch {
    // localStorage full or unavailable
  }
}

export function useDashboardLayout() {
  const [layout, setLayout] = useState<DashboardLayout>(loadLayout)
  const [isEditMode, setIsEditMode] = useState(false)

  useEffect(() => {
    saveLayout(layout)
  }, [layout])

  const updateWidgetLayouts = useCallback(
    (newLayouts: Array<{ i: string; x: number; y: number; w: number; h: number }>) => {
      setLayout((prev) => ({
        ...prev,
        widgets: prev.widgets.map((widget) => {
          const updated = newLayouts.find((l) => l.i === widget.instanceId)
          if (updated) {
            return {
              ...widget,
              layout: { ...widget.layout, x: updated.x, y: updated.y, w: updated.w, h: updated.h },
            }
          }
          return widget
        }),
      }))
    },
    [],
  )

  const addWidget = useCallback((widgetId: string) => {
    const def = getWidget(widgetId)
    if (!def) return
    const preset = WIDGET_SIZE_PRESETS[def.defaultSize]
    setLayout((prev) => {
      const maxY = prev.widgets.reduce((max, w) => Math.max(max, w.layout.y + w.layout.h), 0)
      return {
        ...prev,
        widgets: [
          ...prev.widgets,
          {
            instanceId: generateId(),
            widgetId,
            layout: {
              x: 0,
              y: maxY,
              w: preset.w,
              h: preset.h,
              minW: preset.minW,
              minH: preset.minH,
            },
          },
        ],
      }
    })
  }, [])

  const removeWidget = useCallback((instanceId: string) => {
    setLayout((prev) => ({
      ...prev,
      widgets: prev.widgets.filter((w) => w.instanceId !== instanceId),
    }))
  }, [])

  const resetLayout = useCallback(() => {
    setLayout(getDefaultLayout())
  }, [])

  const updateWidgetConfig = useCallback(
    (instanceId: string, patch: Record<string, unknown>) => {
      setLayout((prev) => ({
        ...prev,
        widgets: prev.widgets.map((w) =>
          w.instanceId === instanceId
            ? { ...w, config: { ...(w.config ?? {}), ...patch } }
            : w
        ),
      }))
    },
    [],
  )

  const toggleEditMode = useCallback(() => {
    setIsEditMode((prev) => !prev)
  }, [])

  return {
    layout,
    isEditMode,
    updateWidgetLayouts,
    addWidget,
    removeWidget,
    resetLayout,
    toggleEditMode,
    updateWidgetConfig,
  }
}
