import { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"

import { openUrl } from "@tauri-apps/plugin-opener"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import {
  Puzzle,
  ExternalLink,
  Info,
  Sliders,
  FileCode,
  Terminal,
  AlertTriangle,
  Power,
  FolderOpen,
  Save,
  CheckCircle2,
  XCircle,
  X,
  Edit2
} from "lucide-react"
import { Mod } from "./ModList"

interface ModDetailProps {
  selectedMod: Mod | undefined
  mods: Mod[]
  activeDetailTab: string
  setActiveDetailTab: (tab: string) => void
  onToggleMod: (id: string) => void
  onOpenFolder: () => void
  onConfigChange: (modId: string, key: string, value: any) => void
  onSaveConfig: () => void
  onSelectMod: (id: string) => void
  onClose?: () => void
  isGameRunning?: boolean
  onRenameMod: (id: string, newName: string) => void
}

export function ModDetail({
  selectedMod,
  mods,
  activeDetailTab,
  setActiveDetailTab,
  onToggleMod,
  onOpenFolder,
  onConfigChange,
  onSaveConfig,
  onSelectMod,
  onClose,
  isGameRunning = false,
  onRenameMod,
}: ModDetailProps) {
  const { t } = useTranslation()
  const [isRenaming, setIsRenaming] = useState(false)
  const [tempName, setTempName] = useState("")

  useEffect(() => {
    if (selectedMod) {
      setTempName(selectedMod.name)
      setIsRenaming(false)
    }
  }, [selectedMod])

  if (!selectedMod) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center p-8">
        <Puzzle className="h-10 w-10 text-muted-foreground/30 mb-2" />
        <p className="text-muted-foreground text-sm">{t("mods.detail.selectModPrompt")}</p>
      </div>
    )
  }

  const hasUpdate = !!selectedMod.latestVersion && selectedMod.version !== selectedMod.latestVersion
  const canEdit = selectedMod.isEnabled && !isGameRunning

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Card Banner / Title */}
      <div className="flex-shrink-0 p-5 pb-3 bg-gradient-to-b from-accent/30 dark:from-accent/15 to-transparent border-b border-border/50">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            {isRenaming ? (
              <div className="flex items-center gap-2 mt-1">
                <Input
                  value={tempName}
                  onChange={(e) => setTempName(e.target.value)}
                  className="text-xs h-8 bg-card border-border px-2 rounded-md font-semibold"
                  placeholder="输入新名字"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      onRenameMod(selectedMod.id, tempName)
                      setIsRenaming(false)
                    } else if (e.key === "Escape") {
                      setTempName(selectedMod.name)
                      setIsRenaming(false)
                    }
                  }}
                />
                <Button
                  variant="default"
                  size="sm"
                  className="h-8 px-2.5 rounded-md text-xs font-medium"
                  onClick={() => {
                    onRenameMod(selectedMod.id, tempName)
                    setIsRenaming(false)
                  }}
                >
                  确定
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 rounded-md text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setTempName(selectedMod.name)
                    setIsRenaming(false)
                  }}
                >
                  取消
                </Button>
              </div>
            ) : (
              <h3
                className="text-lg font-bold flex items-center gap-2 group cursor-pointer"
                title="点击修改名字"
                onClick={() => {
                  if (!isGameRunning) {
                    setIsRenaming(true)
                    setTempName(selectedMod.name)
                  }
                }}
              >
                <Puzzle className="h-4.5 w-4.5 text-primary flex-shrink-0" />
                <span className="truncate">{selectedMod.name}</span>
                {!isGameRunning && (
                  <Edit2 className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity ml-1 shrink-0" />
                )}
              </h3>
            )}
            <p className="text-[10px] text-muted-foreground font-mono mt-0.5 truncate">
              {selectedMod.englishName}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Badge variant={selectedMod.isEnabled ? "default" : "secondary"} className={`text-[10px] ${selectedMod.isEnabled ? "bg-green-600 hover:bg-green-600" : ""}`}>
              {selectedMod.isEnabled ? t("mods.enabled") : t("mods.disabled")}
            </Badge>
            {onClose && (
              <button
                onClick={onClose}
                className="p-1 rounded-md hover:bg-foreground/10 text-muted-foreground hover:text-foreground transition-colors"
                title="Close"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Subinfo Row */}
        <div className="flex items-center gap-x-3 gap-y-1 flex-wrap mt-2 text-[10px] text-muted-foreground">
          <div>
            {t("mods.detail.author")}: <span className="font-semibold text-foreground">{selectedMod.author}</span>
          </div>
          <div className="w-px h-3 bg-border" />
          <div>
            {t("mods.detail.currentVersion")}: <span className="font-semibold text-foreground">v{selectedMod.version}</span>
          </div>
          {selectedMod.latestVersion && selectedMod.latestVersion !== selectedMod.version && (
            <>
              <div className="w-px h-3 bg-border" />
              <div>
                {t("mods.detail.latestVersion")}: <span className="font-semibold text-amber-600 dark:text-amber-400">v{selectedMod.latestVersion}</span>
              </div>
            </>
          )}
          {selectedMod.latestVersion && selectedMod.latestVersion === selectedMod.version && (
            <>
              <div className="w-px h-3 bg-border" />
              <div>
                {t("mods.detail.latestVersion")}: <span className="font-semibold text-green-600 dark:text-green-400">v{selectedMod.latestVersion} ✓</span>
              </div>
            </>
          )}
          {selectedMod.nexusId && (
            <>
              <div className="w-px h-3 bg-border" />
              <button
                onClick={() => openUrl(`https://www.nexusmods.com/stardewvalley/mods/${selectedMod.nexusId}`)}
                className="text-primary hover:underline flex items-center gap-0.5 cursor-pointer"
              >
                Nexus ID: {selectedMod.nexusId}
                <ExternalLink className="h-2.5 w-2.5" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeDetailTab} onValueChange={setActiveDetailTab} className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-shrink-0 px-5 border-b border-border/60">
          <TabsList className="bg-transparent h-9 p-0 gap-3 w-full justify-start border-none">
            <TabsTrigger
              value="info"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-1 py-1.5 text-[11px] font-semibold text-muted-foreground data-[state=active]:text-foreground"
            >
              <Info className="h-3 w-3 mr-1" />
              {t("mods.detail.tabInfo")}
            </TabsTrigger>
            <TabsTrigger
              value="config"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-1 py-1.5 text-[11px] font-semibold text-muted-foreground data-[state=active]:text-foreground"
            >
              <Sliders className="h-3 w-3 mr-1" />
              {t("mods.detail.tabConfig")}
            </TabsTrigger>
            <TabsTrigger
              value="files"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-1 py-1.5 text-[11px] font-semibold text-muted-foreground data-[state=active]:text-foreground"
            >
              <FileCode className="h-3 w-3 mr-1" />
              {t("mods.detail.tabFiles")}
            </TabsTrigger>
            <TabsTrigger
              value="logs"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-1 py-1.5 text-[11px] font-semibold text-muted-foreground data-[state=active]:text-foreground"
            >
              <Terminal className="h-3 w-3 mr-1" />
              {t("mods.detail.tabLogs")}
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Tab: Info */}
        <TabsContent value="info" className="flex-1 overflow-y-auto p-5 space-y-3 outline-none mt-0 data-[state=inactive]:hidden">
          <div>
            <h4 className="text-xs font-semibold text-foreground mb-1">{t("mods.detail.description")}</h4>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {selectedMod.description}
            </p>
          </div>

          <Separator />

          <div className="grid grid-cols-2 gap-3 text-[11px]">
            <div>
              <span className="text-muted-foreground block mb-0.5">{t("mods.detail.smapiDependencies")}</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {selectedMod.dependencies.length > 0 ? (
                  selectedMod.dependencies.map((dep) => {
                    const depLower = dep.toLowerCase()
                    const installedMod = mods.find(m => m.id.toLowerCase() === depLower)
                    const isInstalled = !!installedMod
                    return isInstalled ? (
                      <button
                        key={dep}
                        onClick={() => onSelectMod(installedMod.id)}
                        className="inline-flex items-center gap-0.5 text-[9px] py-0.5 px-1.5 rounded border border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/40 transition-colors cursor-pointer"
                        title={t("mods.detail.depInstalled", { name: installedMod.name, version: installedMod.version })}
                      >
                        <CheckCircle2 className="h-2.5 w-2.5 flex-shrink-0" />
                        {dep}
                      </button>
                    ) : (
                      <span
                        key={dep}
                        className="inline-flex items-center gap-0.5 text-[9px] py-0.5 px-1.5 rounded border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400"
                        title={t("mods.detail.depNotInstalled")}
                      >
                        <XCircle className="h-2.5 w-2.5 flex-shrink-0" />
                        {dep}
                      </span>
                    )
                  })
                ) : (
                  <span className="text-muted-foreground italic text-[10px]">{t("mods.detail.noDependencies")}</span>
                )}
              </div>
            </div>
            <div>
              <span className="text-muted-foreground block mb-0.5">{t("mods.detail.localPath")}</span>
              <span className="font-mono bg-accent/40 px-1.5 py-0.5 rounded text-[9px] break-all inline-block mt-1 text-foreground">
                {selectedMod.localPath}
              </span>
            </div>
          </div>

          {hasUpdate && (
            <div className="bg-amber-500/10 border border-amber-200/50 dark:border-amber-900/30 p-3 rounded-lg flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-[11px] font-semibold text-amber-800 dark:text-amber-200">
                  {t("mods.detail.newVersionTitle", { version: selectedMod.latestVersion })}
                </p>
                <p className="text-[10px] text-amber-700/90 dark:text-amber-300/80 mt-0.5">
                  {t("mods.detail.newVersionDesc", { version: selectedMod.version })}
                </p>
                <Button
                  variant="link"
                  className="text-amber-600 dark:text-amber-400 p-0 h-auto text-[10px] font-bold mt-1 hover:underline"
                  onClick={() => {
                    openUrl(`https://www.nexusmods.com/stardewvalley/mods/${selectedMod.nexusId}`)
                  }}
                >
                  {t("mods.detail.goNexusDownload")} &rarr;
                </Button>
              </div>
            </div>
          )}

          <div className="pt-1 flex gap-2">
            <Button
              variant={selectedMod.isEnabled ? "destructive" : "default"}
              size="sm"
              className="flex-1 gap-1.5 py-1.5 rounded-lg text-xs font-semibold"
              onClick={() => onToggleMod(selectedMod.id)}
              disabled={isGameRunning}
              title={isGameRunning ? t("mods.detail.cannotToggleRunning") : undefined}
            >
              <Power className="h-3.5 w-3.5" />
              {selectedMod.isEnabled ? t("mods.detail.disableMod") : t("mods.detail.enableMod")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 py-1.5 rounded-lg text-xs font-semibold text-muted-foreground hover:text-foreground border-border hover:bg-accent"
              onClick={onOpenFolder}
            >
              <FolderOpen className="h-3.5 w-3.5" />
              {t("mods.detail.locateFolder")}
            </Button>
          </div>
        </TabsContent>

        {/* Tab: Config Form Editor */}
        <TabsContent value="config" className="flex-1 overflow-y-auto p-5 space-y-3 outline-none mt-0 data-[state=inactive]:hidden">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-xs font-semibold text-foreground">{t("mods.detail.dynamicConfig")}</h4>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {t("mods.detail.configDesc")}
              </p>
            </div>
            {selectedMod.config.length > 0 && (
              <Button
                size="sm"
                className="bg-primary hover:bg-primary/95 text-primary-foreground gap-1.5 rounded-lg text-[11px] h-7"
                onClick={onSaveConfig}
                disabled={!canEdit}
                title={isGameRunning ? t("mods.detail.cannotSaveConfigRunning") : undefined}
              >
                <Save className="h-3 w-3" />
                {t("mods.detail.saveConfig")}
              </Button>
            )}
          </div>

          {!selectedMod.isEnabled && (
            <div className="bg-muted dark:bg-muted/10 border border-border p-3 rounded-lg text-center text-[11px] text-muted-foreground">
              {t("mods.detail.modDisabledHint")}
            </div>
          )}
          {isGameRunning && (
            <div className="bg-amber-500/10 border border-amber-500/20 p-3 rounded-lg text-center text-[11px] text-amber-600 dark:text-amber-400">
              {t("mods.detail.gameRunningConfigLocked")}
            </div>
          )}

          <div className="space-y-3">
            {selectedMod.config.length > 0 ? (
              selectedMod.config.map((field) => (
                <div
                  key={field.key}
                  className={`p-2.5 rounded-lg border transition-all ${
                    !canEdit
                      ? "opacity-50 border-border bg-accent/10"
                      : "border-border/60 bg-accent/10 hover:border-primary/30"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-0.5 min-w-0">
                      <label className="text-[11px] font-bold text-foreground block">
                        {field.label}
                        <span className="text-[9px] text-muted-foreground font-mono ml-1.5">
                          ({field.key})
                        </span>
                      </label>
                      <span className="text-[9px] text-muted-foreground leading-normal block">
                        {field.description}
                      </span>
                    </div>

                    <div className="flex-shrink-0 mt-0.5">
                      {field.type === "boolean" && (
                        <div
                          onClick={() => {
                            if(canEdit) {
                              onConfigChange(selectedMod.id, field.key, !field.value)
                            }
                          }}
                        >
                          <button
                            type="button"
                            disabled={!canEdit}
                            className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
                              field.value ? "bg-primary" : "bg-muted-foreground/30"
                            } ${!canEdit ? "cursor-not-allowed" : ""}`}
                          >
                            <span
                              className={`pointer-events-none block h-3 w-3 rounded-full bg-background shadow-sm ring-0 transition-transform ${
                                field.value ? "translate-x-3.5" : "translate-x-0.5"
                              }`}
                            />
                          </button>
                        </div>
                      )}

                      {field.type === "number" && (
                        <Input
                          type="number"
                          disabled={!canEdit}
                          className="w-14 h-7 text-[11px] text-center border-border bg-card rounded-md"
                          value={field.value}
                          onChange={(e) =>
                            onConfigChange(
                              selectedMod.id,
                              field.key,
                              parseInt(e.target.value) || 0
                            )
                          }
                        />
                      )}

                      {field.type === "string" && (
                        <Input
                          type="text"
                          disabled={!canEdit}
                          className="w-20 h-7 text-[11px] border border-border bg-card rounded-md"
                          value={field.value}
                          onChange={(e) =>
                            onConfigChange(selectedMod.id, field.key, e.target.value)
                          }
                        />
                      )}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-6 text-[11px] text-muted-foreground italic">
                {t("mods.detail.noConfigNeeded")}
              </div>
            )}
          </div>
        </TabsContent>

        {/* Tab: File View Simulation */}
        <TabsContent value="files" className="flex-1 overflow-y-auto p-5 space-y-3 outline-none mt-0 data-[state=inactive]:hidden">
          <div>
            <h4 className="text-xs font-semibold text-foreground">{t("mods.detail.configSimulator")}</h4>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {t("mods.detail.configSimulatorDesc")}
            </p>
          </div>

          <div className="bg-zinc-950 dark:bg-black/90 text-zinc-100 rounded-lg p-3 font-mono text-[10px] leading-relaxed overflow-x-auto border border-zinc-800">
            <div className="flex items-center justify-between text-[9px] text-zinc-500 border-b border-zinc-800 pb-1.5 mb-1.5">
              <span>{selectedMod.localPath}/config.json</span>
              <span className="text-green-500">JSON Format</span>
            </div>
            <pre className="text-emerald-400">
              {JSON.stringify(
                selectedMod.config.reduce((acc, field) => {
                  acc[field.key] = field.value
                  return acc
                }, {} as Record<string, any>),
                null,
                2
              )}
            </pre>
          </div>
        </TabsContent>

        {/* Tab: Logs Simulation */}
        <TabsContent value="logs" className="flex-1 overflow-y-auto p-5 space-y-3 outline-none mt-0 data-[state=inactive]:hidden">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-xs font-semibold text-foreground">{t("mods.detail.smapiLogStream")}</h4>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {t("mods.detail.smapiLogDesc")}
              </p>
            </div>
            <Badge variant="outline" className="text-[9px] border-green-700/30 text-green-600 bg-green-500/5">
              {t("mods.detail.normalLoad")}
            </Badge>
          </div>

          <div className="bg-zinc-950 dark:bg-black/90 text-zinc-300 rounded-lg p-3 font-mono text-[9px] leading-normal space-y-0.5 border border-zinc-800 flex-1 overflow-y-auto min-h-[200px]">
            <p className="text-zinc-500">[06:00:00 INFO  SMAPI] {t("mods.detail.logLoading")} {selectedMod.englishName}...</p>
            <p className="text-zinc-500">[06:00:00 INFO  SMAPI] {t("mods.detail.logReadingManifest")}</p>
            <p className="text-zinc-400">[06:00:01 TRACE SMAPI] {t("mods.detail.logVersionInfo", { version: selectedMod.version, author: selectedMod.author, nexusId: selectedMod.nexusId || t("mods.detail.logNoNexusId") })}</p>
            {selectedMod.dependencies.length > 0 && (
              <p className="text-zinc-400">[06:00:01 TRACE SMAPI] {t("mods.detail.logCheckDeps", { deps: selectedMod.dependencies.join(", ") })}</p>
            )}
            <p className="text-zinc-500">[06:00:01 INFO  SMAPI] {t("mods.detail.logConfigLoaded")}</p>
            {selectedMod.isEnabled ? (
              <>
                <p className="text-green-500">[06:00:01 INFO  SMAPI] {t("mods.detail.logInitHooks", { name: selectedMod.name })}</p>
                <p className="text-green-400">[06:00:02 INFO  {selectedMod.englishName}] {t("mods.detail.logEventListening")}</p>
                <p className="text-zinc-500">[06:00:02 INFO  SMAPI] {t("mods.detail.logLoadSuccess", { name: selectedMod.englishName })}</p>
              </>
            ) : (
              <>
                <p className="text-zinc-500">[06:00:01 INFO  SMAPI] {t("mods.detail.logDisabledDetect")}</p>
                <p className="text-amber-500">[06:00:01 WARN  SMAPI] {t("mods.detail.logSkippedLoad", { name: selectedMod.name })}</p>
              </>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
