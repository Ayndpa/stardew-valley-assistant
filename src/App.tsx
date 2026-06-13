import { useState, useEffect, useRef, useCallback, type DragEvent } from "react"
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
  const [modListRefreshSignal, setModListRefreshSignal] = useState(0)
  const [globalToast, setGlobalToast] = useState<{ message: string; type: "success" | "info" | "warning" } | null>(null)
  const [isGlobalDragOver, setIsGlobalDragOver] = useState(false)
  const globalDragCounterRef = useRef(0)
  const isHandlingGlobalDropRef = useRef(false)
  const lastHandledDropRef = useRef<{ sig: string; at: number } | null>(null)
  
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

  const showGlobalToast = useCallback((message: string, type: "success" | "info" | "warning") => {
    setGlobalToast({ message, type })
  }, [])

  const handleLaunchGame = useCallback(async () => {
    const gameDir = localStorage.getItem("stardewGameDirectory") || ""
    if (!gameDir) {
      showGlobalToast("请先配置游戏安装目录。", "warning")
      return
    }

    if (typeof window === "undefined" || !(window as any).__TAURI_INTERNALS__) {
      showGlobalToast("当前为 Web 模式，暂不支持直接启动游戏。", "warning")
      return
    }

    try {
      const invokeModule = await import("@tauri-apps/api/core")
      await invokeModule.invoke("launch_game", { gameDir })
      showGlobalToast("游戏启动中…", "success")
    } catch (err) {
      console.error("launch_game failed:", err)
      showGlobalToast("启动游戏失败: " + err, "warning")
    }
  }, [showGlobalToast])

  useEffect(() => {
    if (globalToast) {
      const timer = setTimeout(() => {
        setGlobalToast(null)
      }, 4000)
      return () => clearTimeout(timer)
    }
  }, [globalToast])

  const getZipPathFromPayload = useCallback((paths: string[]) => {
    return paths.find((path) => path.toLowerCase().endsWith(".zip")) || null
  }, [])

  const handleGlobalZipDrop = useCallback(async (paths: string[], source: string) => {
    const zipPath = getZipPathFromPayload(paths)

    if (!zipPath) {
      if (paths.length > 0) {
        showGlobalToast(`【${source}】未检测到 .zip 文件`, "warning")
      } else {
        showGlobalToast(`【${source}】未检测到拖入文件`, "warning")
      }
      return
    }

    const normalizedZipPath = zipPath.toLowerCase()
    const now = Date.now()
    const lastDrop = lastHandledDropRef.current
    if (isHandlingGlobalDropRef.current) {
      if (!lastDrop || (lastDrop.sig !== normalizedZipPath || now - lastDrop.at > 1200)) {
        // allow a new install if it's clearly a different file
      } else {
        return
      }
    } else if (lastDrop && lastDrop.sig === normalizedZipPath && now - lastDrop.at < 1200) {
      return
    }

    isHandlingGlobalDropRef.current = true
    lastHandledDropRef.current = { sig: normalizedZipPath, at: now }

    const gameDir = localStorage.getItem("stardewGameDirectory") || ""
    if (!gameDir) {
      showGlobalToast("未配置游戏安装目录，请先在设置中配置", "warning")
      isHandlingGlobalDropRef.current = false
      return
    }

    if (!window || !(window as any).__TAURI_INTERNALS__) {
      showGlobalToast("当前运行环境不支持拖拽安装，请在桌面应用中运行", "warning")
      isHandlingGlobalDropRef.current = false
      return
    }

    try {
      const invokeModule = await import("@tauri-apps/api/core")
      await invokeModule.invoke("install_mod_from_zip", { gameDir, zipPath })
      const fileName = zipPath.split("\\").pop()?.split("/").pop() || "模组"
      setCurrentPage("mods")
      setModListRefreshSignal((value) => value + 1)
      showGlobalToast(`已安装模组包：${fileName}`, "success")
    } catch (err) {
      console.error(`install_mod_from_zip failed from ${source}:`, err)
      showGlobalToast("安装模组失败: " + err, "warning")
    } finally {
      isHandlingGlobalDropRef.current = false
    }
  }, [getZipPathFromPayload, showGlobalToast])

  const extractZipPathFromDataTransfer = useCallback((dataTransfer: DataTransfer | null): string | null => {
    if (!dataTransfer) return null
    const files = Array.from(dataTransfer.files || [])
    const zipFile = files.find((file) => file.name.toLowerCase().endsWith(".zip"))
    if (!zipFile) return null
    return (zipFile as File & { path?: string }).path || null
  }, [])

  useEffect(() => {
    const unlistenFns: Array<() => void> = []

    const setupGlobalDrop = async () => {
      if (typeof window === "undefined" || !(window as any).__TAURI_INTERNALS__) {
        return
      }

      try {
        const webviewModule = await import("@tauri-apps/api/webview")
        const webview = webviewModule.getCurrentWebview()

        unlistenFns.push(
          await webview.onDragDropEvent((event) => {
            const payload = event.payload
            if (payload.type === "enter" || payload.type === "over") {
              setIsGlobalDragOver(true)
              return
            }

            if (payload.type === "leave") {
              setIsGlobalDragOver(false)
              globalDragCounterRef.current = 0
              return
            }

            if (payload.type === "drop") {
              setIsGlobalDragOver(false)
              globalDragCounterRef.current = 0
              handleGlobalZipDrop(payload.paths, "window.webview")
            }
          })
        )
      } catch (err) {
        console.debug("Unable to setup global file drop listener:", err)
      }
    }

    setupGlobalDrop()

    return () => {
      unlistenFns.forEach((unlisten) => unlisten())
    }
  }, [handleGlobalZipDrop])

  const handleGlobalDragEnter = (e: DragEvent<HTMLDivElement>) => {
    if (typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__) {
      return
    }
    e.preventDefault()
    globalDragCounterRef.current += 1
    setIsGlobalDragOver(true)
  }

  const handleGlobalDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__) {
      return
    }
    e.preventDefault()
    e.dataTransfer.dropEffect = "copy"
  }

  const handleGlobalDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__) {
      return
    }
    e.preventDefault()
    globalDragCounterRef.current = Math.max(0, globalDragCounterRef.current - 1)
    if (globalDragCounterRef.current === 0) {
      setIsGlobalDragOver(false)
    }
  }

  const handleGlobalDrop = (e: DragEvent<HTMLDivElement>) => {
    if (typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__) {
      return
    }
    e.preventDefault()
    e.stopPropagation()
    globalDragCounterRef.current = 0
    setIsGlobalDragOver(false)

    const zipPath = extractZipPathFromDataTransfer(e.dataTransfer)
    if (!zipPath) {
      const files = Array.from(e.dataTransfer.files || [])
      const zipFile = files.find((file) => file.name.toLowerCase().endsWith(".zip"))
      if (!files.length) {
        showGlobalToast("未检测到拖入文件", "warning")
        return
      }
      if (!zipFile) {
        showGlobalToast("只支持拖入 .zip 模组压缩包", "warning")
        return
      }
      showGlobalToast("当前环境未返回文件绝对路径，请使用“导入新模组”或手动放置可访问路径", "warning")
      return
    }

    handleGlobalZipDrop([zipPath], "页面拖放")
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
        return <Mods onNavigate={setCurrentPage} refreshSignal={modListRefreshSignal} />
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
        onLaunchGame={handleLaunchGame}
      />
      <main
        className="flex-1 overflow-auto relative"
        onDragEnter={handleGlobalDragEnter}
        onDragOver={handleGlobalDragOver}
        onDragLeave={handleGlobalDragLeave}
        onDrop={handleGlobalDrop}
      >
        {isGlobalDragOver && (
          <div className="fixed inset-0 z-40 bg-primary/10 backdrop-blur-sm border-4 border-dashed border-primary pointer-events-none">
            <div className="h-full w-full flex items-center justify-center">
              <div className="bg-card/95 border border-primary rounded-2xl px-6 py-4 shadow-2xl">
                <p className="text-sm font-semibold text-primary">松开鼠标，安装该 .zip 模组</p>
                <p className="text-xs text-muted-foreground mt-1">全局支持 .zip 拖拽安装，安装后将刷新模组列表</p>
              </div>
            </div>
          </div>
        )}

        {globalToast && (
          <div
            className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-4 rounded-xl border shadow-xl ${
              globalToast.type === "success"
                ? "bg-green-50/90 dark:bg-green-950/80 border-green-200 dark:border-green-800 text-green-800 dark:text-green-200"
                : globalToast.type === "warning"
                  ? "bg-amber-50/90 dark:bg-amber-950/80 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200"
                  : "bg-blue-50/90 dark:bg-blue-950/80 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200"
            }`}
          >
            <div className="text-sm font-medium pr-4">{globalToast.message}</div>
            <button onClick={() => setGlobalToast(null)} className="p-1 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 transition-colors ml-auto">
              ×
            </button>
          </div>
        )}

        {renderPage()}
      </main>
      {showOnboarding && <Onboarding onComplete={handleOnboardingComplete} />}
    </div>
  )
}

export default App

