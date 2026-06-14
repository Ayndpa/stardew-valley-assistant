import { useTranslation } from "react-i18next"
import { Card } from "@/components/ui/card"
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
  XCircle
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
  isGameRunning?: boolean
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
  isGameRunning = false,
}: ModDetailProps) {
  const { t } = useTranslation()
  if (!selectedMod) {
    return (
      <Card className="border border-border p-8 text-center flex flex-col items-center justify-center h-[400px]">
        <Puzzle className="h-10 w-10 text-muted-foreground/30 mb-2" />
        <p className="text-muted-foreground">{t("mods.detail.selectModPrompt")}</p>
      </Card>
    )
  }

  const hasUpdate = !!selectedMod.latestVersion && selectedMod.version !== selectedMod.latestVersion
  const canEdit = selectedMod.isEnabled && !isGameRunning

  return (
    <Card className="border border-border shadow-md rounded-xl overflow-hidden bg-card">
      {/* Card Banner / Title */}
      <div className="p-6 pb-4 bg-gradient-to-b from-accent/30 dark:from-accent/15 to-transparent border-b border-border/50">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-xl font-bold flex items-center gap-2">
              <Puzzle className="h-5 w-5 text-primary" />
              {selectedMod.name}
            </h3>
            <p className="text-xs text-muted-foreground font-mono mt-1">
              {selectedMod.englishName}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={selectedMod.isEnabled ? "default" : "secondary"} className={selectedMod.isEnabled ? "bg-green-600 hover:bg-green-600" : ""}>
              {selectedMod.isEnabled ? t("mods.enabled") : t("mods.disabled")}
            </Badge>
          </div>
        </div>

        {/* Subinfo Row */}
        <div className="flex items-center gap-x-4 gap-y-2 flex-wrap mt-4 text-xs text-muted-foreground">
          <div>
            {t("mods.detail.author")}: <span className="font-semibold text-foreground">{selectedMod.author}</span>
          </div>
          <div>
            {t("mods.detail.currentVersion")}: <span className="font-semibold text-foreground">v{selectedMod.version}</span>
          </div>
          {selectedMod.latestVersion && selectedMod.latestVersion !== selectedMod.version && (
            <div>
              {t("mods.detail.latestVersion")}: <span className="font-semibold text-amber-600 dark:text-amber-400">v{selectedMod.latestVersion}</span>
            </div>
          )}
          {selectedMod.latestVersion && selectedMod.latestVersion === selectedMod.version && (
            <div>
              {t("mods.detail.latestVersion")}: <span className="font-semibold text-green-600 dark:text-green-400">v{selectedMod.latestVersion} ✓</span>
            </div>
          )}
          {selectedMod.nexusId && (
            <button
              onClick={() => openUrl(`https://www.nexusmods.com/stardewvalley/mods/${selectedMod.nexusId}`)}
              className="text-primary hover:underline flex items-center gap-0.5 cursor-pointer"
            >
              Nexus ID: {selectedMod.nexusId}
              <ExternalLink className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Tabs list inside details panel */}
      <Tabs value={activeDetailTab} onValueChange={setActiveDetailTab} className="w-full">
        <div className="px-6 border-b border-border/60">
          <TabsList className="bg-transparent h-10 p-0 gap-4 w-full justify-start border-none">
            <TabsTrigger
              value="info"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-1 py-2 text-xs font-semibold text-muted-foreground data-[state=active]:text-foreground"
            >
              <Info className="h-3.5 w-3.5 mr-1" />
              {t("mods.detail.tabInfo")}
            </TabsTrigger>
            <TabsTrigger
              value="config"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-1 py-2 text-xs font-semibold text-muted-foreground data-[state=active]:text-foreground"
            >
              <Sliders className="h-3.5 w-3.5 mr-1" />
              {t("mods.detail.tabConfig")}
            </TabsTrigger>
            <TabsTrigger
              value="files"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-1 py-2 text-xs font-semibold text-muted-foreground data-[state=active]:text-foreground"
            >
              <FileCode className="h-3.5 w-3.5 mr-1" />
              {t("mods.detail.tabFiles")}
            </TabsTrigger>
            <TabsTrigger
              value="logs"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-1 py-2 text-xs font-semibold text-muted-foreground data-[state=active]:text-foreground"
            >
              <Terminal className="h-3.5 w-3.5 mr-1" />
              {t("mods.detail.tabLogs")}
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Tab: Info */}
        <TabsContent value="info" className="p-6 space-y-4 outline-none">
          <div>
            <h4 className="text-sm font-semibold text-foreground mb-1.5">{t("mods.detail.description")}</h4>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {selectedMod.description}
            </p>
          </div>

          <Separator />

          <div className="grid grid-cols-2 gap-4 text-xs">
            <div>
              <span className="text-muted-foreground block mb-0.5">{t("mods.detail.smapiDependencies")}</span>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {selectedMod.dependencies.length > 0 ? (
                  selectedMod.dependencies.map((dep) => {
                    const depLower = dep.toLowerCase()
                    const installedMod = mods.find(m => m.id.toLowerCase() === depLower)
                    const isInstalled = !!installedMod
                    return isInstalled ? (
                      <button
                        key={dep}
                        onClick={() => onSelectMod(installedMod.id)}
                        className="inline-flex items-center gap-1 text-[10px] py-0.5 px-1.5 rounded-md border border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/40 transition-colors cursor-pointer"
                        title={t("mods.detail.depInstalled", { name: installedMod.name, version: installedMod.version })}
                      >
                        <CheckCircle2 className="h-3 w-3 flex-shrink-0" />
                        {dep}
                      </button>
                    ) : (
                      <span
                        key={dep}
                        className="inline-flex items-center gap-1 text-[10px] py-0.5 px-1.5 rounded-md border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400"
                        title={t("mods.detail.depNotInstalled")}
                      >
                        <XCircle className="h-3 w-3 flex-shrink-0" />
                        {dep}
                      </span>
                    )
                  })
                ) : (
                  <span className="text-muted-foreground italic">{t("mods.detail.noDependencies")}</span>
                )}
              </div>
            </div>
            <div>
              <span className="text-muted-foreground block mb-0.5">{t("mods.detail.localPath")}</span>
              <span className="font-mono bg-accent/40 px-1.5 py-0.5 rounded text-[10px] break-all inline-block mt-1 text-foreground">
                {selectedMod.localPath}
              </span>
            </div>
          </div>

          {hasUpdate && (
            <div className="bg-amber-500/10 border border-amber-200/50 dark:border-amber-900/30 p-3.5 rounded-xl flex items-start gap-2.5">
              <AlertTriangle className="h-4.5 w-4.5 text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">
                  {t("mods.detail.newVersionTitle", { version: selectedMod.latestVersion })}
                </p>
                <p className="text-[11px] text-amber-700/90 dark:text-amber-300/80 mt-0.5">
                  {t("mods.detail.newVersionDesc", { version: selectedMod.version })}
                </p>
                <Button 
                  variant="link" 
                  className="text-amber-600 dark:text-amber-400 p-0 h-auto text-[11px] font-bold mt-1.5 hover:underline"
                  onClick={() => {
                    openUrl(`https://www.nexusmods.com/stardewvalley/mods/${selectedMod.nexusId}`)
                  }}
                >
                  {t("mods.detail.goNexusDownload")} &rarr;
                </Button>
              </div>
            </div>
          )}

          <div className="pt-2 flex gap-2">
            <Button
              variant={selectedMod.isEnabled ? "destructive" : "default"}
              size="sm"
              className="flex-1 gap-1.5 py-2 rounded-xl text-xs font-semibold"
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
              className="gap-1.5 py-2 rounded-xl text-xs font-semibold text-muted-foreground hover:text-foreground border-border hover:bg-accent"
              onClick={onOpenFolder}
            >
              <FolderOpen className="h-3.5 w-3.5" />
              {t("mods.detail.locateFolder")}
            </Button>
          </div>
        </TabsContent>

        {/* Tab: Config Form Editor */}
        <TabsContent value="config" className="p-6 space-y-4 outline-none">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-semibold text-foreground">{t("mods.detail.dynamicConfig")}</h4>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("mods.detail.configDesc")}
              </p>
            </div>
            {selectedMod.config.length > 0 && (
              <Button
                size="sm"
                className="bg-primary hover:bg-primary/95 text-primary-foreground gap-1.5 rounded-lg text-xs"
                onClick={onSaveConfig}
                disabled={!canEdit}
                title={isGameRunning ? t("mods.detail.cannotSaveConfigRunning") : undefined}
              >
                <Save className="h-3.5 w-3.5" />
                {t("mods.detail.saveConfig")}
              </Button>
            )}
          </div>

          {!selectedMod.isEnabled && (
            <div className="bg-muted dark:bg-muted/10 border border-border p-3.5 rounded-xl text-center text-xs text-muted-foreground">
              {t("mods.detail.modDisabledHint")}
            </div>
          )}
          {isGameRunning && (
            <div className="bg-amber-500/10 border border-amber-500/20 p-3.5 rounded-xl text-center text-xs text-amber-600 dark:text-amber-400">
              {t("mods.detail.gameRunningConfigLocked")}
            </div>
          )}

          <div className="space-y-4 mt-2 max-h-[300px] overflow-y-auto pr-1">
            {selectedMod.config.length > 0 ? (
              selectedMod.config.map((field) => (
                <div
                  key={field.key}
                  className={`p-3 rounded-lg border transition-all ${
                    !canEdit 
                      ? "opacity-50 border-border bg-accent/10" 
                      : "border-border/60 bg-accent/10 hover:border-primary/30"
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-foreground block">
                        {field.label}
                        <span className="text-[10px] text-muted-foreground font-mono ml-2">
                          ({field.key})
                        </span>
                      </label>
                      <span className="text-[10px] text-muted-foreground leading-normal block">
                        {field.description}
                      </span>
                    </div>

                    {/* Render controls based on type */}
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
                            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                              field.value ? "bg-primary" : "bg-muted-foreground/30"
                            } ${!canEdit ? "cursor-not-allowed" : ""}`}
                          >
                            <span
                              className={`pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform ${
                                field.value ? "translate-x-4.5" : "translate-x-0.5"
                              }`}
                            />
                          </button>
                        </div>
                      )}

                      {field.type === "number" && (
                        <Input
                          type="number"
                          disabled={!canEdit}
                          className="w-16 h-8 text-xs text-center border-border bg-card rounded-md"
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
                          className="w-24 h-8 text-xs border border-border bg-card rounded-md"
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
              <div className="text-center py-6 text-xs text-muted-foreground italic">
                {t("mods.detail.noConfigNeeded")}
              </div>
            )}
          </div>
        </TabsContent>

        {/* Tab: File View Simulation */}
        <TabsContent value="files" className="p-6 space-y-4 outline-none">
          <div>
            <h4 className="text-sm font-semibold text-foreground">{t("mods.detail.configSimulator")}</h4>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t("mods.detail.configSimulatorDesc")}
            </p>
          </div>

          <div className="bg-zinc-950 dark:bg-black/90 text-zinc-100 rounded-xl p-4 font-mono text-[11px] leading-relaxed overflow-x-auto border border-zinc-800">
            <div className="flex items-center justify-between text-[10px] text-zinc-500 border-b border-zinc-800 pb-2 mb-2">
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
        <TabsContent value="logs" className="p-6 space-y-4 outline-none">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-semibold text-foreground">{t("mods.detail.smapiLogStream")}</h4>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("mods.detail.smapiLogDesc")}
              </p>
            </div>
            <Badge variant="outline" className="text-[10px] border-green-700/30 text-green-600 bg-green-500/5">
              {t("mods.detail.normalLoad")}
            </Badge>
          </div>

          <div className="bg-zinc-950 dark:bg-black/90 text-zinc-300 rounded-xl p-4 font-mono text-[10px] leading-normal space-y-1 border border-zinc-800 h-[240px] overflow-y-auto">
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
    </Card>
  )
}
