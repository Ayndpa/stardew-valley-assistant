import { useTranslation } from "react-i18next"
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
    <div className="flex-shrink-0 border-b border-border bg-accent/20 dark:bg-accent/5 animate-in slide-in-from-top-2 duration-200">
      <div className="px-4 py-2.5 flex items-center gap-4 flex-wrap">
        {/* Left: Version info (inline) */}
        <div className="flex items-center gap-3 text-[11px] flex-wrap min-w-0">
          <div className="flex items-center gap-1.5">
            <Sliders className="h-3 w-3 text-primary" />
            <span className="font-bold text-xs">{t("mods.smapi.managerTitle")}</span>
          </div>
          <div className="w-px h-3 bg-border" />
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">{t("mods.smapi.gameVersionLabel")}</span>
            <span className="font-mono font-semibold text-foreground bg-accent/40 px-1 rounded text-[10px]">{gameVersion || "—"}</span>
          </div>
          <div className="w-px h-3 bg-border" />
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">{t("mods.smapi.installedVersion")}</span>
            <span className="font-mono font-semibold text-primary bg-primary/10 px-1 rounded text-[10px]">{smapiStatus.version || t("mods.smapi.installedLabel")}</span>
          </div>
          <div className="w-px h-3 bg-border" />
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">{t("mods.smapi.latestVersion")}</span>
            <span className={`font-mono font-semibold px-1 rounded text-[10px] ${
              smapiUpdateAvailable
                ? "text-amber-600 dark:text-amber-400 bg-amber-500/10"
                : "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
            }`}>
              {smapiLatestVersion || "—"}
              {smapiUpdateAvailable && (
                <span className="ml-1 font-bold">!</span>
              )}
            </span>
          </div>
          {smapiStatus.path && (
            <>
              <div className="w-px h-3 bg-border" />
              <span className="text-muted-foreground truncate max-w-[200px]" title={smapiStatus.path}>
                <code className="text-[9px] font-mono">{smapiStatus.path}</code>
              </span>
            </>
          )}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Right: Actions */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Download source selector */}
          {smapiUpdateAvailable && installStatus === "idle" && (
            <div className="flex bg-accent/40 rounded-lg p-0.5 border border-border/30 mr-1">
              <button
                onClick={() => setSmapiMirror("ghproxy")}
                type="button"
                className={`text-[10px] font-semibold px-2 py-1 rounded transition-all ${
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
                className={`text-[10px] font-semibold px-2 py-1 rounded transition-all ${
                  smapiMirror === "official"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t("mods.smapi.mirrorOfficial")}
              </button>
            </div>
          )}

          {/* Progress indicator (inline) */}
          {isBusy && installStatus !== "error" && (
            <div className="flex items-center gap-1.5 mr-1">
              {installStatus === "success" ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
              ) : (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              )}
              <span className="text-[10px] font-semibold">
                {installStatus === "fetching" && t("mods.smapi.statusFetching")}
                {installStatus === "downloading" && t("mods.smapi.statusDownloading")}
                {installStatus === "extracting" && t("mods.smapi.statusExtracting")}
                {installStatus === "copying" && t("mods.smapi.statusCopying")}
                {installStatus === "success" && t("mods.smapi.statusSuccess")}
              </span>
              <div className="w-16 h-1.5 bg-accent/40 rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300 rounded-full"
                  style={{ width: `${installProgress}%` }}
                />
              </div>
              <span className="text-[10px] font-mono text-muted-foreground">{installProgress}%</span>
            </div>
          )}

          {/* Error indicator */}
          {installStatus === "error" && (
            <span className="text-[10px] text-red-500 flex items-center gap-1 mr-1">
              <AlertTriangle className="h-3 w-3" />
              {t("mods.smapi.installError")}
            </span>
          )}

          {/* Up to date indicator */}
          {!smapiUpdateAvailable && !isBusy && smapiLatestVersion && smapiStatus.version && (
            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1 mr-1">
              <CheckCircle2 className="h-3 w-3" />
              {t("mods.smapi.upToDate")}
            </span>
          )}

          {smapiUpdateAvailable && (
            <Button
              variant="default"
              size="sm"
              onClick={onUpdate}
              disabled={isGameRunning || isBusy}
              title={isGameRunning ? t("mods.smapi.cannotUpdateRunning") : undefined}
              className="h-7 px-2.5 rounded-lg text-[10px] font-semibold gap-1 bg-blue-600 hover:bg-blue-700 text-white"
            >
              {isBusy ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <ArrowUpCircle className="h-3 w-3" />
              )}
              {isBusy ? t("mods.smapi.statusUpdating") : t("mods.smapi.updateButton")}
            </Button>
          )}
          <Button
            variant="destructive"
            size="sm"
            onClick={onUninstall}
            disabled={isGameRunning || isBusy}
            title={isGameRunning ? t("mods.smapi.cannotUninstallRunning") : undefined}
            className="h-7 px-2.5 rounded-lg text-[10px] font-semibold gap-1"
          >
            <Trash2 className="h-3 w-3" />
            {t("mods.smapi.uninstallButton")}
          </Button>
          <button
            onClick={() => setIsManagementOpen(false)}
            className="p-1 rounded hover:bg-accent text-muted-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
