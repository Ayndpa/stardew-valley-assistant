import { useState } from "react"
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

function App() {
  const [currentPage, setCurrentPage] = useState<Page>("dashboard")
  const [showOnboarding, setShowOnboarding] = useState(() => {
    return !localStorage.getItem("stardewGameDirectory")
  })

  const handleOnboardingComplete = (dir: string) => {
    localStorage.setItem("stardewGameDirectory", dir)
    setShowOnboarding(false)
  }

  const renderPage = () => {
    switch (currentPage) {
      case "dashboard":
        return <Dashboard />
      case "crops":
        return <Crops />
      case "npcs":
        return <NPCs />
      case "calendar":
        return <Calendar />
      case "settings":
        return <Settings />
      case "mods":
        return <Mods />
      default:
        return <Dashboard />
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar currentPage={currentPage} onNavigate={setCurrentPage} />
      <main className="flex-1 overflow-auto">
        {renderPage()}
      </main>
      {showOnboarding && <Onboarding onComplete={handleOnboardingComplete} />}
    </div>
  )
}

export default App
