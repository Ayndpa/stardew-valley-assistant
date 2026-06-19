import { useTranslation } from "react-i18next"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Sliders, X, Trash2, Loader2, CheckCircle2, AlertTriangle, ArrowUpCircle } from "lucide-react"

interface SmapiManagerProps {
  isManagementOpen: boolean
  setIsManagementOpen: (open: boolean) => void
  smapiStatus: {
    installed: boolean
    version: string | null
    path: string | null
  } | null
  gameVersion: string | null
  smapiLatestVersion: string | null
  smapiUpdateAvailable: boolean
  onUpdate: () => void
  onUninstall: () => void
  isGameRunning?: boolean
  smapiMirror: "ghproxy" | "official"
  setSmapiMirror: (mirror: "ghproxy" | "official") => void
  installStatus: "idle" | "fetching" | "downloading" | "extracting" | "copying" | "success" | "error"
  installProgress: number
  installError: string | null
}

export function SmapiManager({
  isManagementOpen,
  setIsManagementOpen,
  smapiStatus,
  gameVersion,
  smapiLatestVersion,
  smapiUpdateAvailable,
  onUpdate,
  onUninstall,
  isGameRunning = false,
  smapiMirror,
  setSmapiMirror,
  installStatus,
  installProgress,
  installError,
}: SmapiManagerProps) {
  const { t } = useTranslation()
  if (!isManagementOpen || !smapiStatus?.installed) return null

  const isBusy = installStatus !== "idle"

  return (
    <Card className="bg-card border-border shadow-md rounded-2xl p-6 relative overflow-hidden animate-in slide-in-from-top-3 duration-300">
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary to-green-600"></div>
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="font-extrabold text-lg text-foreground flex items-center gap-2">
            <Sliders className="h-5 w-5 text-primary" />
            {t("mods.smapi.managerTitle")}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5 font-medium">{t("mods.smapi.managerDesc")}</p>
        </div>
        <button
          onClick={() => setIsManagementOpen(false)}
          className="p-1 rounded-lg hover:bg-accent text-muted-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm mb-6">
        <div className="space-y-1">
          <span className="text-xs text-muted-foreground block font-medium">{t("mods.smapi.gameVersionLabel")}</span>
          <span className="font-semibold text-foreground font-mono bg-accent/30 px-2 py-0.5 rounded text-xs">{gameVersion || t("mods.smapi.gameVersionUndetected")}</span>
        </div>
        <div className="space-y-1">
          <span className="text-xs text-muted-foreground block font-medium">{t("mods.smapi.installedVersion")}</span>
          <span className="font-semibold text-primary font-mono bg-primary/10 px-2 py-0.5 rounded text-xs">{smapiStatus.version || t("mods.smapi.installedLabel")}</span>
        </div>
        <div className="space-y-1">
          <span className="text-xs text-muted-foreground block font-medium">{t("mods.smapi.latestVersion")}</span>
          <span className={`font-semibold font-mono px-2 py-0.5 rounded text-xs ${
            smapiUpdateAvailable
              ? "text-amber-600 dark:text-amber-400 bg-amber-500/10"
              : "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
          }`}>
            {smapiLatestVersion || t("mods.smapi.latestChecking")}
            {smapiUpdateAvailable && (
              <span className="ml-1.5 text-[10px] font-bold">({t("mods.smapi.updateAvailable")})</span>
            )}
          </span>
        </div>
      </div>

      {/* Download source selector (visible when update is available and idle) */}
      {smapiUpdateAvailable && installStatus === "idle" && (
        <div className="bg-accent/20 dark:bg-accent/5 rounded-xl p-4 border border-border/60 mb-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="space-y-0.5">
              <h4 className="text-xs font-bold text-foreground">{t("mods.smapi.downloadSource")}</h4>
              <p className="text-[10px] text-muted-foreground">{t("mods.smapi.downloadSourceDesc")}</p>
            </div>
            <div className="flex bg-accent/40 rounded-xl p-1 border border-border/30 w-full sm:w-auto">
              <button
                onClick={() => setSmapiMirror("ghproxy")}
                type="button"
                className={`flex-1 sm:flex-none text-[11px] font-semibold px-3 py-1.5 rounded-lg transition-all ${
                  smapiMirror === "ghproxy"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t("mods.smapi.mirrorRecommended")}
              </button>
              <button
                onClick={() => setSmapiMirror("official")}
                type="button"
                className={`flex-1 sm:flex-none text-[11px] font-semibold px-3 py-1.5 rounded-lg transition-all ${
                  smapiMirror === "official"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t("mods.smapi.mirrorOfficial")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Progress bar (visible during update) */}
      {isBusy && (
        <div className="space-y-3 mb-4">
          {installStatus === "error" ? (
            <div className="space-y-3">
              <div className="bg-red-500/15 border border-red-500/20 text-red-700 dark:text-red-400 text-xs rounded-xl p-3 font-mono break-all">
                <p className="font-bold flex items-center gap-1.5 mb-1 text-sm">
                  <AlertTriangle className="h-4 w-4" /> {t("mods.smapi.installError")}
                </p>
                {installError}
              </div>
            </div>
          ) : (
            <>
              <div className="flex justify-between text-xs font-bold text-foreground">
                <span className="flex items-center gap-1.5">
                  {installStatus === "success" ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                  ) : (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                  )}
                  {installStatus === "fetching" && t("mods.smapi.statusFetching")}
                  {installStatus === "downloading" && t("mods.smapi.statusDownloading")}
                  {installStatus === "extracting" && t("mods.smapi.statusExtracting")}
                  {installStatus === "copying" && t("mods.smapi.statusCopying")}
                  {installStatus === "success" && t("mods.smapi.statusSuccess")}
                </span>
                <span>{installProgress}%</span>
              </div>
              <div className="h-2 w-full bg-accent/40 rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300 rounded-full"
                  style={{ width: `${installProgress}%` }}
                ></div>
              </div>
            </>
          )}
        </div>
      )}

      <div className="border-t border-border pt-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="space-y-0.5 flex-1 min-w-0">
          <span className="text-xs text-muted-foreground block font-medium">{t("mods.smapi.launchFilePath")}</span>
          <code className="text-[11px] font-mono break-all text-foreground bg-accent/40 px-2 py-1 rounded block max-w-full truncate" title={smapiStatus.path || t("mods.smapi.noPath")}>
            {smapiStatus.path || t("mods.smapi.noPath")}
          </code>
        </div>
        <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
          {smapiUpdateAvailable && (
            <Button
              variant="default"
              size="sm"
              onClick={onUpdate}
              disabled={isGameRunning || isBusy}
              title={isGameRunning ? t("mods.smapi.cannotUpdateRunning") : undefined}
              className="rounded-xl font-semibold gap-1.5 bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-colors"
            >
              {isBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowUpCircle className="h-4 w-4" />
              )}
              {isBusy ? t("mods.smapi.statusUpdating") : t("mods.smapi.updateButton")}
            </Button>
          )}
          {!smapiUpdateAvailable && smapiLatestVersion && smapiStatus.version && (
            <span className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {t("mods.smapi.upToDate")}
            </span>
          )}
          <Button
            variant="destructive"
            size="sm"
            onClick={onUninstall}
            disabled={isGameRunning || isBusy}
            title={isGameRunning ? t("mods.smapi.cannotUninstallRunning") : undefined}
            className="rounded-xl font-semibold gap-1.5 bg-red-600 hover:bg-red-700 text-white shadow-sm transition-colors"
          >
            <Trash2 className="h-4 w-4" />
            {t("mods.smapi.uninstallButton")}
          </Button>
        </div>
      </div>
    </Card>
  )
}
