import { lazy, Suspense, useState, useEffect, useRef, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { Sidebar } from "@/components/Sidebar"
import { Dashboard } from "@/pages/Dashboard"
import { Collections } from "@/pages/Collections"
import { Crops } from "@/pages/Crops"
import { Items } from "@/pages/Items"
import { Bundles } from "@/pages/Bundles"
import { Calendar } from "@/pages/Calendar"
import { GameMap } from "@/pages/GameMap"
import { SaveEditor } from "@/pages/SaveEditor"
import { SaveBackups } from "@/pages/SaveBackups"
import { Children } from "@/pages/Children"
import { Animals } from "@/pages/Animals"
import { Settings } from "@/pages/Settings"
import { Mods } from "@/pages/Mods"
import { Downloads } from "@/pages/Downloads"
import { OnlineMods } from "@/components/mods/OnlineMods"
import { Onboarding } from "@/components/Onboarding"
import { TitleBar } from "@/components/TitleBar"
import { UpdateDialog, DISMISSED_UPDATE_VERSION_KEY } from "@/components/UpdateDialog"
import type { UpdateInfo } from "@/components/UpdateDialog"
import { useDownloadManager } from "@/hooks/useDownloadManager"
import { useSavesList } from "@/hooks/useSavesList"
import { useGameLauncher } from "@/hooks/useGameLauncher"
import { useNxmDeepLink } from "@/hooks/useNxmDeepLink"
import { useGlobalDragAndDrop } from "@/hooks/useGlobalDragAndDrop"
import "./index.css"

export type Page = "dashboard" | "collections" | "crops" | "items" | "npcs" | "calendar" | "fishingMap" | "saveEditor" | "saveBackups" | "settings" | "mods" | "onlineMods" | "downloads" | "bundles" | "children" | "animals"

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
  farmerAvatar?: string | null
  farmerAvatarError?: string | null
}


const NPCs = lazy(async () => {
  const mod = await import("@/pages/NPCs")
  return { default: mod.NPCs }
})


function App() {
  const { t } = useTranslation()
  const [currentPage, setCurrentPage] = useState<Page>("dashboard")
  const [itemNavigationTarget, setItemNavigationTarget] = useState<string | null>(null)
  const [showOnboarding, setShowOnboarding] = useState(() => {
    return !localStorage.getItem("stardewGameDirectory")
  })
  const [onboardingReason, setOnboardingReason] = useState<string | null>(null)
  const [modListRefreshSignal, setModListRefreshSignal] = useState(0)
  const [globalToast, setGlobalToast] = useState<{ message: string; type: "success" | "info" | "warning" } | null>(null)
  const [saveEditorAcknowledged, setSaveEditorAcknowledged] = useState(false)
  const [updateDialogInfo, setUpdateDialogInfo] = useState<UpdateInfo | null>(null)

  // Custom Hooks
  const { saves, selectedSaveId, fetchSavesList, handleSaveChange } = useSavesList()

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

  // --- Enabled sidebar features state (synced across windows) ---
  const [enabledFeatures, setEnabledFeatures] = useState<Page[]>(() => {
    const saved = localStorage.getItem("enabledFeatures")
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Page[]
        // 迁移：旧版本中 collections 始终显示，未存储在 enabledFeatures 中，需要补上
        if (!parsed.includes("collections")) {
          parsed.push("collections")
        }
        // 迁移：新增的 bundles 功能需要补上
        if (!parsed.includes("bundles")) {
          parsed.push("bundles")
        }
        // 迁移：新增的 children 功能需要补上
        if (!parsed.includes("children")) {
          parsed.push("children")
        }
        // 迁移：新增的 animals 功能需要补上
        if (!parsed.includes("animals")) {
          parsed.push("animals")
        }
        return parsed
      } catch (e) {
        // ignore
      }
    }
    return ["collections", "crops", "items", "npcs", "calendar", "bundles", "animals", "fishingMap", "children", "saveEditor", "saveBackups", "mods", "onlineMods", "downloads"]
  })

  const updateEnabledFeatures = useCallback((value: Page[]) => {
    setEnabledFeatures(value)
    localStorage.setItem("enabledFeatures", JSON.stringify(value))
    channelRef.current?.postMessage({ type: "enabledFeatures", value })
  }, [])

  // BroadcastChannel: sync collapsed and features state across windows
  useEffect(() => {
    const channel = new BroadcastChannel("stardew-assistant")
    channelRef.current = channel
    channel.onmessage = (e) => {
      if (e.data?.type === "sidebarCollapsed") {
        setSidebarCollapsed(e.data.value)
      } else if (e.data?.type === "enabledFeatures") {
        setEnabledFeatures(e.data.value)
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

  useEffect(() => {
    if (currentPage !== "saveEditor") {
      setSaveEditorAcknowledged(false)
    }
  }, [currentPage])

  const handleOnboardingComplete = (dir: string, features?: Page[]) => {
    localStorage.setItem("stardewGameDirectory", dir)
    if (features) {
      updateEnabledFeatures(features)
    }
    setOnboardingReason(null)
    setShowOnboarding(false)
  }

  const showGlobalToast = useCallback((message: string, type: "success" | "info" | "warning") => {
    setGlobalToast({ message, type })
  }, [])

  const promptGameDirectoryOnboarding = useCallback((reason: string) => {
    localStorage.removeItem("stardewGameDirectory")
    setOnboardingReason(reason)
    setShowOnboarding(true)
    showGlobalToast(reason, "warning")
  }, [showGlobalToast])

  const ensureGameDirectoryReady = useCallback(async () => {
    const gameDir = localStorage.getItem("stardewGameDirectory") || ""
    if (!gameDir) {
      const reason = "请先配置游戏安装目录。"
      setOnboardingReason(reason)
      setShowOnboarding(true)
      return null
    }

    if (typeof window === "undefined" || !(window as any).__TAURI_INTERNALS__) {
      return gameDir
    }

    try {
      const invokeModule = await import("@tauri-apps/api/core")
      const exists = await invokeModule.invoke<boolean>("path_exists", { path: gameDir })
      if (exists) {
        return gameDir
      }

      promptGameDirectoryOnboarding('之前配置的游戏目录不存在：' + gameDir + '。请重新选择游戏目录。')
      return null
    } catch (err) {
      console.error("Failed to verify game directory:", err)
      showGlobalToast("检查游戏目录是否存在时发生错误。", "warning")
      return null
    }
  }, [promptGameDirectoryOnboarding, showGlobalToast])

  useEffect(() => {
    ensureGameDirectoryReady()
  }, [ensureGameDirectoryReady])

  // Auto-check for updates on startup
  useEffect(() => {
    const checkUpdateOnStart = async () => {
      if (typeof window === "undefined" || !(window as any).__TAURI_INTERNALS__) return
      try {
        const { invoke } = await import("@tauri-apps/api/core")
        const { getVersion } = await import("@tauri-apps/api/app")
        const currentVersion = await getVersion()
        const info: UpdateInfo = await invoke("check_for_updates", { currentVersion })
        if (info.has_update) {
          const dismissedVersion = localStorage.getItem(DISMISSED_UPDATE_VERSION_KEY)
          if (dismissedVersion === info.latest_version) return
          setUpdateDialogInfo(info)
        }
      } catch {
        // Silently ignore auto-check failures
      }
    }
    checkUpdateOnStart()
  }, [])

  const handleDownloadUpdate = async (url: string) => {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener")
      await openUrl(url)
    } catch {
      window.open(url, "_blank")
    }
    setUpdateDialogInfo(null)
  }

  // Custom hooks for launcher, deep link and drag and drop
  const { isGameRunning, handleLaunchGame } = useGameLauncher({ ensureGameDirectoryReady, showGlobalToast })

  const handleInstallNpcLocationsMod = useCallback(async () => {
    if (isGameRunning) {
      showGlobalToast("游戏运行中不能安装模组，请退出游戏后再试。", "warning")
      return
    }

    const gameDir = await ensureGameDirectoryReady()
    if (!gameDir) return

    if (typeof window === "undefined" || !(window as any).__TAURI_INTERNALS__) {
      showGlobalToast("当前运行环境不支持安装内置模组，请在桌面应用中运行。", "warning")
      return
    }

    try {
      const { invoke } = await import("@tauri-apps/api/core")
      await invoke("install_bundled_npc_locations_mod", { gameDir })
      setModListRefreshSignal((value) => value + 1)
      setCurrentPage("mods")
      showGlobalToast("已安装 NPC 实时位置模组。请通过 SMAPI 启动游戏后再回到村民关系查看实时位置。", "success")
    } catch (err) {
      console.error("Failed to install bundled NPC locations mod:", err)
      showGlobalToast("安装 NPC 实时位置模组失败: " + String(err), "warning")
    }
  }, [ensureGameDirectoryReady, isGameRunning, showGlobalToast])

  const {
    tasks: downloadTasks,
    stats: downloadStats,
    queueNexusDownload,
    queueSmapiDownload,
    retryTask,
    pauseTask,
    resumeTask,
    removeTask,
    clearCompletedTasks,
  } = useDownloadManager({
    isGameRunning,
    onModInstalled: () => setModListRefreshSignal((value) => value + 1),
    onShowToast: showGlobalToast,
  })

  useNxmDeepLink({
    isGameRunning,
    ensureGameDirectoryReady,
    showGlobalToast,
    queueNexusDownload,
  })

  const {
    isGlobalDragOver,
    handleGlobalDragEnter,
    handleGlobalDragOver,
    handleGlobalDragLeave,
    handleGlobalDrop,
  } = useGlobalDragAndDrop({
    isGameRunning,
    ensureGameDirectoryReady,
    showGlobalToast,
    setModListRefreshSignal,
    setCurrentPage,
  })

  useEffect(() => {
    if (globalToast) {
      const timer = setTimeout(() => {
        setGlobalToast(null)
      }, 4000)
      return () => clearTimeout(timer)
    }
  }, [globalToast])

  // Redirect to dashboard if the current page gets disabled
  useEffect(() => {
    if (currentPage !== "dashboard" && currentPage !== "collections" && currentPage !== "settings" && !enabledFeatures.includes(currentPage)) {
      setCurrentPage("dashboard")
    }
  }, [currentPage, enabledFeatures])

  const renderPage = () => {
    switch (currentPage) {
      case "dashboard":
        return <Dashboard selectedSaveId={selectedSaveId} />
      case "collections":
        return (
          <Collections
            selectedSaveId={selectedSaveId}
            onNavigateToItem={(itemName) => {
              setItemNavigationTarget(itemName)
              setCurrentPage("items")
            }}
          />
        )
      case "crops":
        return <Crops selectedSaveId={selectedSaveId} />
      case "items":
        return (
          <Items
            navigationTarget={itemNavigationTarget}
            onNavigationHandled={() => setItemNavigationTarget(null)}
          />
        )
      case "npcs":
        return (
          <Suspense
            fallback={
              <div className="p-8">
                <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 rounded-lg border bg-accent/10">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
                  <p className="text-sm text-muted-foreground">正在异步加载村民关系页面...</p>
                </div>
              </div>
            }
          >
            <NPCs
              selectedSaveId={selectedSaveId}
              onNavigateToItem={(itemName) => {
                setItemNavigationTarget(itemName)
                setCurrentPage("items")
              }}
              onInstallNpcLocationsMod={handleInstallNpcLocationsMod}
            />
          </Suspense>
        )
      case "calendar":
        return <Calendar selectedSaveId={selectedSaveId} />
      case "bundles":
        return (
          <Bundles
            onNavigateToItem={(itemName) => {
              setItemNavigationTarget(itemName)
              setCurrentPage("items")
            }}
          />
        )
      case "fishingMap":
        return <GameMap selectedSaveId={selectedSaveId} />
      case "settings":
        return (
        <Settings
          selectedSaveId={selectedSaveId}
          onRestartOnboarding={() => setShowOnboarding(true)}
          enabledFeatures={enabledFeatures}
          onEnabledFeaturesChange={updateEnabledFeatures}
          onUpdateFound={setUpdateDialogInfo}
          />
        )
      case "saveBackups":
        return (
          <SaveBackups
            selectedSaveId={selectedSaveId}
            onShowToast={showGlobalToast}
            onSavesChanged={fetchSavesList}
          />
        )
      case "children":
        return (
          <Children
            selectedSaveId={selectedSaveId}
            onShowToast={showGlobalToast}
          />
        )
      case "animals":
        return <Animals selectedSaveId={selectedSaveId} />
      case "saveEditor":
        return (
          <SaveEditor
            selectedSaveId={selectedSaveId}
            onShowToast={showGlobalToast}
            onSaved={fetchSavesList}
            warningAcknowledged={saveEditorAcknowledged}
            onAcknowledgeWarning={() => setSaveEditorAcknowledged(true)}
            onCancel={() => setCurrentPage("dashboard")}
          />
        )
      case "mods":
        return (
          <Mods
            onNavigate={setCurrentPage}
            refreshSignal={modListRefreshSignal}
            isGameRunning={isGameRunning}
            onQueueSmapiDownload={queueSmapiDownload}
            onInstallNpcLocationsMod={handleInstallNpcLocationsMod}
          />
        )
      case "downloads":
        return (
          <Downloads
            tasks={downloadTasks}
            stats={downloadStats}
            isGameRunning={isGameRunning}
            onRetry={retryTask}
            onPause={pauseTask}
            onResume={resumeTask}
            onRemove={removeTask}
            onClearCompleted={clearCompletedTasks}
          />
        )
      case "onlineMods":
        return (
          <div className="p-8 space-y-6">
            <div>
              <h2 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-primary to-green-600 bg-clip-text text-transparent">{t("onlineModsPage.title")}</h2>
              <p className="text-muted-foreground mt-2 text-sm max-w-xl">
                {t("onlineModsPage.description")}
              </p>
            </div>
            <OnlineMods
              onNavigate={setCurrentPage}
              isGameRunning={isGameRunning}
              onQueueDownload={queueNexusDownload}
            />
          </div>
        )
      default:
        return <Dashboard selectedSaveId={selectedSaveId} />
    }
  }

  return (
    <div ref={containerRef} className="app-shell relative flex h-screen overflow-hidden">
      <TitleBar />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar
          currentPage={currentPage}
          onNavigate={setCurrentPage}
          saves={saves}
          selectedSaveId={selectedSaveId}
          onSaveChange={handleSaveChange}
          collapsed={sidebarCollapsed}
          onToggleCollapse={toggleSidebarCollapsed}
          onLaunchGame={handleLaunchGame}
          isGameRunning={isGameRunning}
          downloadStats={downloadStats}
          enabledFeatures={enabledFeatures}
        />
        <main
          className="app-panel relative flex-1 overflow-auto pt-13"
          onDragEnter={handleGlobalDragEnter}
          onDragOver={handleGlobalDragOver}
          onDragLeave={handleGlobalDragLeave}
          onDrop={handleGlobalDrop}
        >
          {isGlobalDragOver && (
            <div className="fixed inset-0 z-40 border-4 border-dashed border-primary bg-primary/10 backdrop-blur-sm pointer-events-none">
              <div className="flex h-full w-full items-center justify-center">
                <div className="rounded-2xl border border-primary bg-card/95 px-6 py-4 shadow-2xl">
                  <p className="text-sm font-semibold text-primary">松开鼠标，安装该 .zip 模组</p>
                  <p className="mt-1 text-xs text-muted-foreground">全局支持 .zip 拖拽安装，安装后将刷新模组列表</p>
                </div>
              </div>
            </div>
          )}

          {globalToast && (
            <div
              className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl border px-5 py-4 shadow-xl ${
                globalToast.type === "success"
                  ? "border-green-200 bg-green-50/90 text-green-800 dark:border-green-800 dark:bg-green-950/80 dark:text-green-200"
                  : globalToast.type === "warning"
                    ? "border-amber-200 bg-amber-50/90 text-amber-800 dark:border-amber-800 dark:bg-amber-950/80 dark:text-amber-200"
                    : "border-blue-200 bg-blue-50/90 text-blue-800 dark:border-blue-800 dark:bg-blue-950/80 dark:text-blue-200"
              }`}
            >
              <div className="pr-4 text-sm font-medium">{globalToast.message}</div>
              <button onClick={() => setGlobalToast(null)} className="ml-auto rounded-lg p-1 transition-colors hover:bg-black/10 dark:hover:bg-white/10">
                ×
              </button>
            </div>
          )}

          {renderPage()}
        </main>
      </div>
      {showOnboarding && (
        <Onboarding
          onComplete={handleOnboardingComplete}
          initialReason={onboardingReason}
          enabledFeatures={enabledFeatures}
        />
      )}
      <UpdateDialog
        isOpen={!!updateDialogInfo}
        updateInfo={updateDialogInfo}
        onClose={(dismissVersion) => {
          if (dismissVersion && updateDialogInfo) {
            localStorage.setItem(DISMISSED_UPDATE_VERSION_KEY, updateDialogInfo.latest_version)
          }
          setUpdateDialogInfo(null)
        }}
        onDownload={handleDownloadUpdate}
      />
    </div>
  )
}

export default App
