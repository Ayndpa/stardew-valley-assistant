import { useState, useEffect } from "react"
import { Sidebar } from "@/components/Sidebar"
import { Dashboard } from "@/pages/Dashboard"
import { Crops } from "@/pages/Crops"
import { NPCs } from "@/pages/NPCs"
import { Calendar } from "@/pages/Calendar"
import { Settings } from "@/pages/Settings"
import { Mods } from "@/pages/Mods"
import { Onboarding } from "@/components/Onboarding"
import "./index.css"

export type Page = "dashboard" | "crops" | "npcs" | "calendar" | "settings" | "mods"

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

const MOCK_SAVE_SUMMARY: SaveSummary = {
  id: "MockCharacter_123456789",
  playerName: "农夫阿星",
  farmName: "桃源",
  money: 125840,
  totalMoneyEarned: 245000,
  dayOfMonth: 15,
  season: 0, // Spring
  year: 2,
  farmingLevel: 10,
  miningLevel: 8,
  combatLevel: 7,
  foragingLevel: 8,
  fishingLevel: 6,
  deepestMineLevel: 120,
  millisecondsPlayed: 45 * 3600 * 1000,
  lastSaveTime: Date.now() / 1000,
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
            setSaves([MOCK_SAVE_SUMMARY])
            setSelectedSaveId(MOCK_SAVE_SUMMARY.id)
            localStorage.setItem("selectedSaveId", MOCK_SAVE_SUMMARY.id)
          }
        } catch (err) {
          console.error("Error listing saves:", err)
          setSaves([MOCK_SAVE_SUMMARY])
          setSelectedSaveId(MOCK_SAVE_SUMMARY.id)
          localStorage.setItem("selectedSaveId", MOCK_SAVE_SUMMARY.id)
        }
      } else {
        setSaves([MOCK_SAVE_SUMMARY])
        setSelectedSaveId(MOCK_SAVE_SUMMARY.id)
        localStorage.setItem("selectedSaveId", MOCK_SAVE_SUMMARY.id)
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
        return <Settings selectedSaveId={selectedSaveId} />
      case "mods":
        return <Mods />
      default:
        return <Dashboard selectedSaveId={selectedSaveId} />
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar
        currentPage={currentPage}
        onNavigate={setCurrentPage}
        saves={saves}
        selectedSaveId={selectedSaveId}
        onSaveChange={handleSaveChange}
      />
      <main className="flex-1 overflow-auto">
        {renderPage()}
      </main>
      {showOnboarding && <Onboarding onComplete={handleOnboardingComplete} />}
    </div>
  )
}

export default App

