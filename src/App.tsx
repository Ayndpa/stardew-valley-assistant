import { useState, useEffect, useRef, useCallback } from "react"
import { Sidebar } from "@/components/Sidebar"
import { Dashboard } from "@/pages/Dashboard"
import { Crops } from "@/pages/Crops"
import { NPCs } from "@/pages/NPCs"
import { Calendar } from "@/pages/Calendar"
import { Settings } from "@/pages/Settings"
import { Mods } from "@/pages/Mods"
import { OnlineMods } from "@/components/mods/OnlineMods"
import { Onboarding } from "@/components/Onboarding"
import "./index.css"

export type Page = "dashboard" | "crops" | "npcs" | "calendar" | "settings" | "mods" | "onlineMods"

export interface SaveSummary {
  id: string
  playerName: string
  farmName: string
  money: number
  totalMoneyEarned: number
  dayOfMonth: number
  season: number // 0: Spring, 1: Summer, 2: Fall, 3: Winter
  year: number
  farmingLevel: number
  miningLevel: number
  combatLevel: number
  foragingLevel: number
  fishingLevel: number
  deepestMineLevel: number
  millisecondsPlayed: number
  lastSaveTime: number
}

function App() {
  const [currentPage, setCurrentPage] = useState<Page>("dashboard")
  const [showOnboarding, setShowOnboarding] = useState(() => {
    return !localStorage.getItem("stardewGameDirectory")
  })
  
  const [saves, setSaves] = useState<SaveSummary[]>([])
  const [selectedSaveId, setSelectedSaveId] = useState<string>(() => {
    return localStorage.getItem("selectedSaveId") || ""
  })

  // --- Sidebar collapsed state (synced across windows) ---
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    return localStorage.getItem("sidebarCollapsed") === "true"
  })
  const containerRef = useRef<HTMLDivElement>(null)
  const channelRef = useRef<BroadcastChannel | null>(null)

  const updateSidebarCollapsed = useCallback((value: boolean) => {
    setSidebarCollapsed(value)
    localStorage.setItem("sidebarCollapsed", String(value))
    channelRef.current?.postMessage({ type: "sidebarCollapsed", value })
  }, [])

  const toggleSidebarCollapsed = useCallback(() => {
    updateSidebarCollapsed(!sidebarCollapsed)
  }, [sidebarCollapsed, updateSidebarCollapsed])

  // BroadcastChannel: sync collapsed state across windows
  useEffect(() => {
    const channel = new BroadcastChannel("stardew-assistant")
    channelRef.current = channel
    channel.onmessage = (e) => {
      if (e.data?.type === "sidebarCollapsed") {
        setSidebarCollapsed(e.data.value)
      }
    }
    return () => channel.close()
  }, [])

  // Auto-collapse when main content area is too narrow
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (width === undefined) return
      if (width < 700 && !sidebarCollapsed) {
        updateSidebarCollapsed(true)
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [sidebarCollapsed, updateSidebarCollapsed])

  // Load list of saves
  useEffect(() => {
    async function fetchSavesList() {
      const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
      if (isTauri) {
        try {
          const mod = await import("@tauri-apps/api/core");
          const list: SaveSummary[] = await mod.invoke("list_save_files")
          setSaves(list)
          if (list.length > 0) {
            const storedId = localStorage.getItem("selectedSaveId")
            if (storedId && list.some(s => s.id === storedId)) {
              setSelectedSaveId(storedId)
            } else {
              setSelectedSaveId(list[0].id)
              localStorage.setItem("selectedSaveId", list[0].id)
            }
          } else {
            setSelectedSaveId("")
          }
        } catch (err) {
          console.error("Error listing saves:", err)
          setSelectedSaveId("")
        }
      } else {
        // Web preview: no saves available
        setSelectedSaveId("")
      }
    }
    fetchSavesList()
  }, [])

  const handleSaveChange = (id: string) => {
    setSelectedSaveId(id)
    localStorage.setItem("selectedSaveId", id)
  }

  const handleOnboardingComplete = (dir: string) => {
    localStorage.setItem("stardewGameDirectory", dir)
    setShowOnboarding(false)
  }

  const renderPage = () => {
    switch (currentPage) {
      case "dashboard":
        return <Dashboard selectedSaveId={selectedSaveId} />
      case "crops":
        return <Crops selectedSaveId={selectedSaveId} />
      case "npcs":
        return <NPCs selectedSaveId={selectedSaveId} />
      case "calendar":
        return <Calendar selectedSaveId={selectedSaveId} />
      case "settings":
        return (
          <Settings
            selectedSaveId={selectedSaveId}
            onRestartOnboarding={() => setShowOnboarding(true)}
          />
        )
      case "mods":
        return <Mods onNavigate={setCurrentPage} />
      case "onlineMods":
        return (
          <div className="p-8 space-y-6">
            <div>
              <h2 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-primary to-green-600 bg-clip-text text-transparent">获取模组</h2>
              <p className="text-muted-foreground mt-2 text-sm max-w-xl">
                浏览 SMAPI.io 兼容性数据库和 NexusMods。您可以搜索数千个星露谷物语模组，并了解它们与当前版本的兼容状态。
              </p>
            </div>
            <OnlineMods onNavigate={setCurrentPage} />
          </div>
        )
      default:
        return <Dashboard selectedSaveId={selectedSaveId} />
    }
  }

  return (
    <div ref={containerRef} className="flex h-screen overflow-hidden bg-background">
      <Sidebar
        currentPage={currentPage}
        onNavigate={setCurrentPage}
        saves={saves}
        selectedSaveId={selectedSaveId}
        onSaveChange={handleSaveChange}
        collapsed={sidebarCollapsed}
        onToggleCollapse={toggleSidebarCollapsed}
      />
      <main className="flex-1 overflow-auto">
        {renderPage()}
      </main>
      {showOnboarding && <Onboarding onComplete={handleOnboardingComplete} />}
    </div>
  )
}

export default App

