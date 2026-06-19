import { useTranslation } from "react-i18next"
import { Badge } from "@/components/ui/badge"
import { useModManagement } from "@/hooks/useModManagement"
import { useConfirm } from "@/hooks/useConfirm"
import { Button } from "@/components/ui/button"
import { CheckCircle2, AlertTriangle, Info, X, PackagePlus, ArrowUpCircle, Trash2, Loader2 } from "lucide-react"
import type { Page } from "@/App"

// Import subcomponents
import { SmapiInstaller } from "@/components/mods/SmapiInstaller"
import { ModList } from "@/components/mods/ModList"
import { ModDetail } from "@/components/mods/ModDetail"
import type { QueueSmapiDownloadRequest } from "@/hooks/useDownloadManager"

// Category Translations
const CATEGORY_MAP_ZH = {
  all: "全部",
  core: "核心API",
  content: "视觉美化",
  utility: "辅助工具",
  expansion: "大型拓展"
}
const CATEGORY_MAP_EN = {
  all: "All",
  core: "Core API",
  content: "Visual",
  utility: "Utility",
  expansion: "Expansion"
}

type ModsProps = {
  onNavigate?: (page: Page) => void
  refreshSignal?: number
  isGameRunning?: boolean
  onQueueSmapiDownload?: (request: QueueSmapiDownloadRequest) => { ok: boolean; message: string }
  onInstallNpcLocationsMod?: () => void | Promise<void>
}

export function Mods({ onNavigate, refreshSignal, isGameRunning = false, onQueueSmapiDownload, onInstallNpcLocationsMod }: ModsProps) {
  const { t, i18n } = useTranslation()
  const isZh = (i18n.resolvedLanguage || i18n.language || "zh").startsWith("zh")
  const CATEGORY_MAP = isZh ? CATEGORY_MAP_ZH : CATEGORY_MAP_EN
  const { confirm, ConfirmDialogElement } = useConfirm()
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
    installStatus,
    installProgress,
    installError,
    smapiUpdateAvailable,
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
    handleUpdateSmapi,
    handleDeleteMod,
    handleOpenOfficialSite,
    handleApplyProfile,
    handleInstallModFromZip,
    showToast
  } = useModManagement({ refreshSignal, isGameRunning, onQueueSmapiDownload, confirm })

  const handlePickZipFile = async () => {
    if (isGameRunning) {
      showToast(t("mods.toast.gameRunningNoImport"), "warning")
      return
    }

    if (typeof window === "undefined" || !(window as any).__TAURI_INTERNALS__) {
      showToast(t("mods.toast.webModeNoFilePicker"), "warning")
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
        showToast(t("mods.toast.onlyZipSupported"), "warning")
        return
      }

      handleInstallModFromZip(zipPath)
    } catch (err) {
      console.error("open dialog failed:", err)
      showToast(t("mods.toast.fileSelectFailed"), "warning")
    }
  }

  const isBusy = installStatus !== "idle"

  return (
    <div className="h-full flex flex-col overflow-hidden relative">
      {ConfirmDialogElement}
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
        <div className="flex-1 overflow-y-auto">
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
        </div>
      ) : (
        <>
          {/* Header Bar — all SMAPI info inline, always visible */}
          <div className="flex-shrink-0 px-4 py-2 border-b border-border bg-card/80 backdrop-blur-sm">
            <div className="flex items-center gap-2.5 flex-wrap">
              {/* Title */}
              <h2 className="text-lg font-extrabold tracking-tight bg-gradient-to-r from-primary to-green-600 bg-clip-text text-transparent flex-shrink-0">
                {t("mods.title")}
              </h2>

              <div className="w-px h-4 bg-border" />

              {/* SMAPI Version Info (always shown when installed) */}
              {smapiStatus?.installed && (
                <div className="flex items-center gap-2 text-[11px] flex-wrap">
                  <span className="font-mono font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                    SMAPI {smapiStatus.version || "—"}
                  </span>
                  {smapiLatestVersion && (
                    <>
                      <span className="text-muted-foreground">→</span>
                      <span className={`font-mono font-semibold px-1.5 py-0.5 rounded ${
                        smapiUpdateAvailable
                          ? "text-amber-600 dark:text-amber-400 bg-amber-500/10"
                          : "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
                      }`}>
                        {smapiLatestVersion}
                      </span>
                    </>
                  )}
                  {gameVersion && (
                    <span className="text-muted-foreground">
                      {t("mods.smapi.gameVersionLabel")} <span className="font-mono font-semibold text-foreground">{gameVersion}</span>
                    </span>
                  )}
                </div>
              )}

              {/* SMAPI not installed badge */}
              {smapiStatus && !smapiStatus.installed && (
                <Badge className="bg-red-500/10 text-red-500 border-red-500/20 text-[10px] px-2 py-0.5 rounded-full">
                  {t("mods.smapiNotInstalled")}
                </Badge>
              )}

              {/* SMAPI detecting */}
              {smapiStatus === null && (
                <span className="text-[10px] text-muted-foreground animate-pulse">{t("mods.smapiDetecting")}</span>
              )}

              {/* SMAPI Actions (inline, always visible when installed) */}
              {smapiStatus?.installed && (
                <div className="flex items-center gap-1.5">
                  {/* Mirror selector */}
                  {smapiUpdateAvailable && installStatus === "idle" && (
                    <div className="flex bg-accent/40 rounded-md p-0.5 border border-border/30">
                      <button
                        onClick={() => setSmapiMirror("ghproxy")}
                        className={`text-[9px] font-semibold px-1.5 py-0.5 rounded transition-all ${
                          smapiMirror === "ghproxy"
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {t("mods.smapi.mirrorRecommended")}
                      </button>
                      <button
                        onClick={() => setSmapiMirror("official")}
                        className={`text-[9px] font-semibold px-1.5 py-0.5 rounded transition-all ${
                          smapiMirror === "official"
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {t("mods.smapi.mirrorOfficial")}
                      </button>
                    </div>
                  )}

                  {/* Progress (inline) */}
                  {isBusy && installStatus !== "error" && (
                    <div className="flex items-center gap-1">
                      {installStatus === "success" ? (
                        <CheckCircle2 className="h-3 w-3 text-green-500" />
                      ) : (
                        <Loader2 className="h-3 w-3 animate-spin text-primary" />
                      )}
                      <div className="w-14 h-1.5 bg-accent/40 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary transition-all duration-300 rounded-full"
                          style={{ width: `${installProgress}%` }}
                        />
                      </div>
                      <span className="text-[9px] font-mono text-muted-foreground">{installProgress}%</span>
                    </div>
                  )}

                  {/* Error */}
                  {installStatus === "error" && (
                    <span className="text-[9px] text-red-500 flex items-center gap-0.5">
                      <AlertTriangle className="h-3 w-3" />
                      {t("mods.smapi.installError")}
                    </span>
                  )}

                  {/* Up to date */}
                  {!smapiUpdateAvailable && !isBusy && smapiLatestVersion && smapiStatus.version && (
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-0.5">
                      <CheckCircle2 className="h-3 w-3" />
                      {t("mods.smapi.upToDate")}
                    </span>
                  )}

                  {/* Update button */}
                  {smapiUpdateAvailable && (
                    <Button
                      variant="default"
                      size="sm"
                      onClick={handleUpdateSmapi}
                      disabled={isGameRunning || isBusy}
                      className="h-6 px-2 rounded text-[9px] font-semibold gap-0.5 bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowUpCircle className="h-3 w-3" />}
                      {isBusy ? t("mods.smapi.statusUpdating") : t("mods.smapi.updateButton")}
                    </Button>
                  )}

                  {/* Uninstall button */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleUninstallSmapi}
                    disabled={isGameRunning || isBusy}
                    className="h-6 px-1.5 rounded text-[9px] text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    title={t("mods.smapi.uninstallButton")}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              )}

              {/* Spacer */}
              <div className="flex-1" />

              {/* Game Running Badge */}
              {isGameRunning && (
                <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20 text-[9px] px-1.5 py-0.5 rounded-full font-semibold">
                  {t("mods.gameRunningLocked")}
                </Badge>
              )}

              {/* NPC Locations Mod Button */}
              {onInstallNpcLocationsMod && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[10px] gap-0.5 hover:bg-accent"
                  onClick={() => void onInstallNpcLocationsMod()}
                  disabled={isGameRunning}
                  title={isGameRunning ? t("mods.gameRunningModDisabled") : t("mods.installRealtimeModTooltip")}
                >
                  <PackagePlus className="h-3 w-3 text-emerald-600" />
                  {t("mods.installRealtimeMod")}
                </Button>
              )}

              {/* Inline Stats */}
              <div className="flex items-center gap-2.5 text-[11px] flex-shrink-0">
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground">{t("mods.installed")}</span>
                  <span className="font-bold text-foreground">{totalInstalled}</span>
                </div>
                <div className="w-px h-3 bg-border" />
                <div className="flex items-center gap-1">
                  <span className="text-green-600 dark:text-green-400">{t("mods.enabled")}</span>
                  <span className="font-bold text-green-600 dark:text-green-500">{activeCount}</span>
                </div>
                {updateAvailableCount > 0 && (
                  <>
                    <div className="w-px h-3 bg-border" />
                    <div className="flex items-center gap-1">
                      <span className="text-amber-600 dark:text-amber-400">{t("mods.updatable")}</span>
                      <span className="font-bold text-amber-500">{updateAvailableCount}</span>
                    </div>
                  </>
                )}
                {isZh && (
                  <>
                    <div className="w-px h-3 bg-border" />
                    <div className="flex items-center gap-1">
                      <span className={isSyncingModTranslations ? "text-sky-600 dark:text-sky-400" : "text-muted-foreground"}>{t("mods.translationLibrary")}</span>
                      <span className={`font-bold ${isSyncingModTranslations ? "text-sky-500 animate-pulse" : "text-foreground"}`}>
                        {translationSyncingModIds.size}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Content area — ModList + optional inline Detail Panel */}
          <div className="flex-1 flex overflow-hidden">
            {/* Mod List */}
            <div className="flex-1 overflow-hidden">
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
                confirm={confirm}
                currentMods={mods.map((m) => ({ folderName: m.folderName.replace(/(^|\/)\./g, "$1"), isEnabled: m.isEnabled, name: m.name }))}
                onApplyProfile={handleApplyProfile}
                showToast={showToast}
              />
            </div>

            {/* Detail Panel — inline right side when a mod is selected */}
            {selectedMod && (
              <div className="w-[440px] max-w-[40%] border-l border-border bg-card overflow-hidden flex flex-col animate-in slide-in-from-right duration-200">
                <div className="flex-1 overflow-y-auto">
                  <ModDetail
                    selectedMod={selectedMod}
                    mods={mods}
                    activeDetailTab={activeDetailTab}
                    setActiveDetailTab={setActiveDetailTab}
                    onToggleMod={handleToggleMod}
                    onOpenFolder={handleOpenFolder}
                    onConfigChange={handleConfigChange}
                    onSaveConfig={handleSaveConfig}
                    onSelectMod={setSelectedModId}
                    onClose={() => setSelectedModId("")}
                    isGameRunning={isGameRunning}
                  />
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
