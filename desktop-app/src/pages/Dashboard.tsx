import { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { FileQuestion } from "lucide-react"
import { useDashboardLayout } from "./dashboard/use-dashboard-layout"
import { WidgetGrid } from "./dashboard/WidgetGrid"
import { DashboardToolbar } from "./dashboard/DashboardToolbar"
import { WidgetPicker } from "./dashboard/WidgetPicker"
import type { SaveDetail } from "./dashboard/types"
import type { ItemEntry } from "./items/types"

// Import widgets to trigger registration side effects
import "./dashboard/widgets"

interface DashboardProps {
  selectedSaveId: string
}

export function Dashboard({ selectedSaveId }: DashboardProps) {
  const { t, i18n } = useTranslation()
  const [saveDetail, setSaveDetail] = useState<SaveDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [itemEntries, setItemEntries] = useState<ItemEntry[] | null>(null)
  const [showPicker, setShowPicker] = useState(false)

  const activeLang = i18n.resolvedLanguage || i18n.language || "zh"

  const {
    layout,
    isEditMode,
    updateWidgetLayouts,
    addWidget,
    removeWidget,
    resetLayout,
    toggleEditMode,
    updateWidgetConfig,
  } = useDashboardLayout()

  // Fetch save detail
  useEffect(() => {
    async function fetchDetail() {
      if (!selectedSaveId) {
        setLoading(false)
        return
      }
      setLoading(true)
      const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__
      if (isTauri) {
        try {
          const { invoke } = await import("@tauri-apps/api/core")
          const gameDir = localStorage.getItem("stardewGameDirectory") || undefined
          const d: SaveDetail = await invoke("get_save_detail", {
            id: selectedSaveId,
            gameDir,
            includeAvatar: false,
          })
          setSaveDetail(d)
        } catch (err) {
          console.error("Error loading save detail:", err)
          setSaveDetail(null)
        } finally {
          setLoading(false)
        }
      } else {
        setLoading(false)
      }
    }
    fetchDetail()
  }, [selectedSaveId])

  // Fetch item game data
  useEffect(() => {
    let canceled = false
    async function loadItems() {
      const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__
      if (!isTauri) {
        setItemEntries([])
        return
      }
      const gameDir = localStorage.getItem("stardewGameDirectory") || ""
      try {
        const { invoke } = await import("@tauri-apps/api/core")
        // 仪表盘上的挂件只做计数与筛选，从不显示物品图标；
        // 带上图标会让这次 IPC 的响应体从几十 KB 涨到 500 KB 以上。
        const data = await invoke<{ encyclopedia: ItemEntry[] }>("get_item_game_data", {
          gameDir: gameDir.trim() || undefined,
          lang: activeLang,
          includeIcons: false,
        })
        if (!canceled) setItemEntries(data.encyclopedia)
      } catch (err) {
        console.error("Error loading item game data:", err)
        if (!canceled) setItemEntries([])
      }
    }
    loadItems()
    return () => { canceled = true }
  }, [activeLang])

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-[50vh]">
        <div className="text-center space-y-2">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto" />
          <p className="text-muted-foreground text-sm font-medium">{t("dashboard.loading")}</p>
        </div>
      </div>
    )
  }

  if (!selectedSaveId || !saveDetail) {
    return (
      <div className="p-8 flex items-center justify-center h-[70vh]">
        <div className="text-center space-y-4 max-w-md">
          <FileQuestion className="h-16 w-16 text-muted-foreground/30 mx-auto" />
          <h3 className="text-xl font-bold text-muted-foreground">{t("dashboard.noSaveTitle")}</h3>
          <p className="text-sm text-muted-foreground/70">{t("dashboard.noSaveDescription")}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8 space-y-6">
      <DashboardToolbar
        isEditMode={isEditMode}
        onToggleEditMode={toggleEditMode}
        onAddWidget={() => setShowPicker(true)}
        onResetLayout={resetLayout}
        saveDetail={saveDetail}
      />

      <WidgetGrid
        layout={layout}
        isEditMode={isEditMode}
        selectedSaveId={selectedSaveId}
        saveDetail={saveDetail}
        isLoading={loading}
        itemEntries={itemEntries}
        onLayoutChange={updateWidgetLayouts}
        onRemoveWidget={removeWidget}
        onConfigChange={updateWidgetConfig}
      />

      {showPicker && (
        <WidgetPicker
          currentWidgets={layout.widgets}
          onAdd={(id) => {
            addWidget(id)
          }}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  )
}
