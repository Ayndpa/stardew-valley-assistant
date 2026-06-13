import { Badge } from "@/components/ui/badge"
import { useModManagement } from "@/hooks/useModManagement"
import { Button } from "@/components/ui/button"
import { Sliders, CheckCircle2, AlertTriangle, Info, X, PackagePlus } from "lucide-react"
import type { Page } from "@/App"

// Import subcomponents
import { SmapiInstaller } from "@/components/mods/SmapiInstaller"
import { SmapiManager } from "@/components/mods/SmapiManager"
import { ModList } from "@/components/mods/ModList"
import { ModDetail } from "@/components/mods/ModDetail"
import { ModProfiles } from "@/components/mods/ModProfiles"
import type { QueueSmapiDownloadRequest } from "@/hooks/useDownloadManager"

// Category Translations
const CATEGORY_MAP = {
  all: "全部",
  core: "核心API",
  content: "视觉美化",
  utility: "辅助工具",
  expansion: "大型拓展"
}

type ModsProps = {
  onNavigate?: (page: Page) => void
  refreshSignal?: number
  isGameRunning?: boolean
  onQueueSmapiDownload?: (request: QueueSmapiDownloadRequest) => { ok: boolean; message: string }
  onInstallNpcLocationsMod?: () => void | Promise<void>
}

export function Mods({ onNavigate, refreshSignal, isGameRunning = false, onQueueSmapiDownload, onInstallNpcLocationsMod }: ModsProps) {
  const {
    mods,
    isLoadingMods,
    searchTerm,
    setSearchTerm,
    selectedCategory,
    setSelectedCategory,
    selectedModId,
    setSelectedModId,
    activeDetailTab,
    setActiveDetailTab,
    smapiStatus,
    gameVersion,
    smapiLatestVersion,
    smapiMirror,
    setSmapiMirror,
    isManagementOpen,
    setIsManagementOpen,
    installStatus,
    installProgress,
    installError,
    isScanning,
    isCheckingUpdates,
    isSyncingModTranslations,
    translationSyncingModIds,
    toast,
    setToast,

    // Computed values
    selectedMod,
    filteredMods,
    totalInstalled,
    activeCount,
    updateAvailableCount,

    // Operations
    handleToggleMod,
    handleScanDirectory,
    handleCheckUpdates,
    handleOpenFolder,
    handleConfigChange,
    handleSaveConfig,
    handleInstallSmapi,
    handleUninstallSmapi,
    handleDeleteMod,
    handleOpenOfficialSite,
    handleApplyProfile,
    handleInstallModFromZip,
    showToast
  } = useModManagement({ refreshSignal, isGameRunning, onQueueSmapiDownload })

  const handlePickZipFile = async () => {
    if (isGameRunning) {
      showToast("游戏运行中不能导入或安装模组，请退出游戏后再试。", "warning")
      return
    }

    if (typeof window === "undefined" || !(window as any).__TAURI_INTERNALS__) {
      showToast("当前运行环境不支持本地文件选择，请在桌面应用中运行", "warning")
      return
    }

    try {
      const dialogModule = await import("@tauri-apps/plugin-dialog")
      const selectedPath = await dialogModule.open({
        multiple: false,
        filters: [{ name: "Stardew 模组包", extensions: ["zip"] }]
      })

      const zipPath = Array.isArray(selectedPath)
        ? selectedPath.find((path) => typeof path === "string" && path.toLowerCase().endsWith(".zip"))
        : selectedPath

      if (typeof zipPath !== "string") {
        return
      }

      if (!zipPath.toLowerCase().endsWith(".zip")) {
        showToast("仅支持 .zip 模组压缩包", "warning")
        return
      }

      handleInstallModFromZip(zipPath)
    } catch (err) {
      console.error("open dialog failed:", err)
      showToast("选择模组文件失败", "warning")
    }
  }

  return (
    <div
      className="min-h-screen p-8 space-y-6 relative"
    >
      {/* Toast Notification */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-4 rounded-xl border shadow-xl animate-in slide-in-from-bottom-5 fade-in duration-300 ${
          toast.type === "success" 
            ? "bg-green-50/90 dark:bg-green-950/80 border-green-200 dark:border-green-800 text-green-800 dark:text-green-200" 
            : toast.type === "warning" 
            ? "bg-amber-50/90 dark:bg-amber-950/80 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200" 
            : "bg-blue-50/90 dark:bg-blue-950/80 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200"
        }`}>
          {toast.type === "success" && <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />}
          {toast.type === "warning" && <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0" />}
          {toast.type === "info" && <Info className="h-5 w-5 text-blue-500 flex-shrink-0" />}
          <div className="text-sm font-medium pr-4">{toast.message}</div>
          <button 
            onClick={() => setToast(null)} 
            className="p-1 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 transition-colors ml-auto"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {smapiStatus !== null && !smapiStatus.installed ? (
        <SmapiInstaller
          smapiLatestVersion={smapiLatestVersion}
          smapiMirror={smapiMirror}
          setSmapiMirror={setSmapiMirror}
          onInstall={handleInstallSmapi}
          onOpenOfficialSite={handleOpenOfficialSite}
          installStatus={installStatus}
          installProgress={installProgress}
          installError={installError}
          gameVersion={gameVersion}
          isGameRunning={isGameRunning}
        />
      ) : (
        <>
          {/* Header Panel */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-card border border-border p-6 rounded-2xl shadow-sm bg-gradient-to-r from-card to-accent/20 animate-in fade-in duration-300">
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-primary to-green-600 bg-clip-text text-transparent">模组管理</h2>
                {smapiStatus?.installed && !smapiStatus?.version ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full border transition-all" style={{ backgroundColor: 'rgba(120,120,120,0.15)', color: '#888', borderColor: 'rgba(120,120,120,0.25)' }}>
                    SMAPI: 已安装 (加载中)
                  </span>
                ) : (
                  <Badge 
                    className={`gap-1.5 px-3 py-1 font-semibold rounded-full border transition-all ${
                      smapiStatus?.installed 
                        ? "bg-primary/10 text-primary border-primary/20" 
                        : "bg-red-500/10 text-red-500 border-red-500/20"
                    }`}
                  >
                    {smapiStatus === null ? (
                      "正在检测 SMAPI..."
                    ) : smapiStatus.installed ? (
                      `SMAPI: v${smapiStatus.version}`
                    ) : (
                      "SMAPI: 未安装"
                    )}
                  </Badge>
                )}
                {smapiStatus?.installed && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-lg text-xs gap-1.5 hover:bg-accent border-border font-semibold shadow-sm"
                    onClick={() => setIsManagementOpen(!isManagementOpen)}
                  >
                    <Sliders className="h-3.5 w-3.5 text-primary" />
                    管理 SMAPI
                  </Button>
                )}
                {isGameRunning && (
                  <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20 gap-1.5 px-3 py-1 font-semibold rounded-full">
                    游戏运行中：已锁定修改
                  </Badge>
                )}
                {onInstallNpcLocationsMod && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-lg text-xs gap-1.5 hover:bg-accent border-border font-semibold shadow-sm"
                    onClick={() => void onInstallNpcLocationsMod()}
                    disabled={isGameRunning}
                    title={isGameRunning ? "游戏运行中，不能安装模组" : "安装村民关系实时位置读取 Mod"}
                  >
                    <PackagePlus className="h-3.5 w-3.5 text-emerald-600" />
                    安装实时位置 Mod
                  </Button>
                )}
              </div>
              <p className="text-muted-foreground mt-2 text-sm max-w-xl">
                对游戏扩展模组的加载进行集中控制。您可以在此处扫描本地模组、进行一键版本查重升级，或者直接对每个模组的本地 <code className="bg-accent/40 px-1 py-0.5 rounded text-xs">config.json</code> 参数进行模拟可视化编辑。
              </p>
            </div>

            {/* Global Statistics Panel */}
            <div className="flex gap-4 self-stretch lg:self-auto">
              <div className="bg-accent/30 dark:bg-accent/10 border border-border/60 rounded-xl px-4 py-3 text-center flex-1 lg:flex-initial min-w-[90px]">
                <p className="text-xs text-muted-foreground font-medium">已安装</p>
                <p className="text-2xl font-bold text-foreground mt-0.5">{totalInstalled}</p>
              </div>
              <div className="bg-green-50/50 dark:bg-green-950/10 border border-green-100 dark:border-green-950 rounded-xl px-4 py-3 text-center flex-1 lg:flex-initial min-w-[90px]">
                <p className="text-xs text-green-700 dark:text-green-400 font-medium">已启用</p>
                <p className="text-2xl font-bold text-green-600 dark:text-green-500 mt-0.5">{activeCount}</p>
              </div>
              <div className={`border rounded-xl px-4 py-3 text-center flex-1 lg:flex-initial min-w-[90px] transition-colors ${
                updateAvailableCount > 0 
                  ? "bg-amber-50/50 dark:bg-amber-950/10 border-amber-200 dark:border-amber-900" 
                  : "bg-accent/30 dark:bg-accent/10 border-border/60"
              }`}>
                <p className={`text-xs font-medium ${updateAvailableCount > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>可更新</p>
                <p className={`text-2xl font-bold mt-0.5 ${updateAvailableCount > 0 ? "text-amber-500" : "text-foreground"}`}>{updateAvailableCount}</p>
              </div>
              <div className={`border rounded-xl px-4 py-3 text-center flex-1 lg:flex-initial min-w-[90px] transition-colors ${
                isSyncingModTranslations
                  ? "bg-sky-50/60 dark:bg-sky-950/10 border-sky-200 dark:border-sky-900"
                  : "bg-accent/30 dark:bg-accent/10 border-border/60"
              }`}>
                <p className={`text-xs font-medium ${isSyncingModTranslations ? "text-sky-600 dark:text-sky-400" : "text-muted-foreground"}`}>翻译库</p>
                <p className={`text-2xl font-bold mt-0.5 ${isSyncingModTranslations ? "text-sky-500 animate-pulse" : "text-foreground"}`}>
                  {translationSyncingModIds.size}
                </p>
              </div>
            </div>
          </div>

          {/* SMAPI Management Panel */}
          <SmapiManager
            isManagementOpen={isManagementOpen}
            setIsManagementOpen={setIsManagementOpen}
            smapiStatus={smapiStatus}
            gameVersion={gameVersion}
            smapiLatestVersion={smapiLatestVersion}
            onUninstall={handleUninstallSmapi}
            isGameRunning={isGameRunning}
          />
          {/* Mod Profiles Section */}
          <ModProfiles
            currentMods={mods.map((m) => ({ folderName: m.folderName.replace(/^\./, ""), isEnabled: m.isEnabled, name: m.name }))}
            onApplyProfile={handleApplyProfile}
            showToast={showToast}
            isGameRunning={isGameRunning}
          />

          {/* Main Split Layout */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
            {/* Left Area: Filter Tabs & Mod Cards */}
            <div className="xl:col-span-7">
              <ModList
                mods={mods}
                filteredMods={filteredMods}
                selectedModId={selectedModId}
                setSelectedModId={setSelectedModId}
                onToggleMod={handleToggleMod}
                onDeleteMod={handleDeleteMod}
                selectedCategory={selectedCategory}
                setSelectedCategory={setSelectedCategory}
                categoryMap={CATEGORY_MAP}
                searchTerm={searchTerm}
                setSearchTerm={setSearchTerm}
                onScan={handleScanDirectory}
                isScanning={isScanning}
                onCheckUpdates={handleCheckUpdates}
                isCheckingUpdates={isCheckingUpdates}
                onOpenFolder={handleOpenFolder}
                isLoading={isLoadingMods}
                onGoOnline={() => onNavigate?.("onlineMods")}
                onImportMod={() => {
                  void handlePickZipFile()
                }}
                isGameRunning={isGameRunning}
                translationSyncingModIds={translationSyncingModIds}
              />
            </div>

            {/* Right Area: Mod Details & Interactive Configuration */}
            <div className="xl:col-span-5">
              <ModDetail
                selectedMod={selectedMod}
                activeDetailTab={activeDetailTab}
                setActiveDetailTab={setActiveDetailTab}
                onToggleMod={handleToggleMod}
                onOpenFolder={handleOpenFolder}
                onConfigChange={handleConfigChange}
                onSaveConfig={handleSaveConfig}
                isGameRunning={isGameRunning}
              />
            </div>
          </div>

        </>
      )}
    </div>
  )
}
