import { useTranslation } from "react-i18next"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { AlertTriangle, Download, RefreshCw, Loader2, X, Info } from "lucide-react"

interface SmapiInstallerProps {
  smapiLatestVersion: string | null
  smapiMirror: "ghproxy" | "official"
  setSmapiMirror: (mirror: "ghproxy" | "official") => void
  onInstall: () => void
  onOpenOfficialSite: () => void
  installStatus: "idle" | "fetching" | "downloading" | "extracting" | "copying" | "success" | "error"
  installProgress: number
  installError: string | null
  gameVersion: string | null
  isGameRunning?: boolean
}

export function SmapiInstaller({
  smapiLatestVersion,
  smapiMirror,
  setSmapiMirror,
  onInstall,
  onOpenOfficialSite,
  installStatus,
  installProgress,
  installError,
  gameVersion,
  isGameRunning = false,
}: SmapiInstallerProps) {
  const { t } = useTranslation()

  return (
    <div className="max-w-2xl mx-auto space-y-8 py-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Main Hero Card */}
      <Card className="border border-border shadow-xl bg-card rounded-3xl overflow-hidden relative">
        <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-red-400 via-orange-400 to-amber-400"></div>
        
        <CardContent className="p-8 space-y-8">
          {/* Icon and Title */}
          <div className="text-center space-y-3">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-red-500/10 text-red-500 shadow-inner">
              <AlertTriangle className="h-10 w-10 text-red-500 animate-pulse" />
            </div>
            <div className="space-y-1">
              <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
                {t("mods.smapi.installTitle")}
              </h1>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                {t("mods.smapi.installDesc")}
              </p>
            </div>
          </div>

          {/* Status Details */}
          <div className="bg-accent/20 dark:bg-accent/5 rounded-2xl p-6 border border-border/60 space-y-4">
            <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{t("mods.smapi.systemDetection")}</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="space-y-1">
                <span className="text-muted-foreground block font-medium">{t("mods.smapi.gameDirectory")}</span>
                <span className="font-semibold text-foreground font-mono truncate block max-w-xs" title={localStorage.getItem("stardewGameDirectory") || ""}>
                  {localStorage.getItem("stardewGameDirectory") || t("mods.smapi.notConfigured")}
                </span>
              </div>
              <div className="space-y-1">
                <span className="text-muted-foreground block font-medium">{t("mods.smapi.gameVersion")}</span>
                <span className="font-semibold text-foreground font-mono bg-accent/40 px-2 py-0.5 rounded text-[11px]">
                  {gameVersion === null ? t("mods.smapi.detecting") : gameVersion}
                </span>
              </div>
              <div className="space-y-1">
                <span className="text-muted-foreground block font-medium">{t("mods.smapi.smapiStatus")}</span>
                <span className="font-semibold text-red-500 flex items-center gap-1 font-medium">
                  <X className="h-3.5 w-3.5" /> {t("mods.smapi.notInstalled")}
                </span>
              </div>
              <div className="space-y-1">
                <span className="text-muted-foreground block font-medium">{t("mods.smapi.latestSmapi")}</span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400 font-mono bg-emerald-500/10 px-2 py-0.5 rounded text-[11px]">
                  {smapiLatestVersion === null ? t("mods.smapi.checking") : `v${smapiLatestVersion}`}
                </span>
              </div>
            </div>
          </div>

          {/* 下载设置 */}
          {installStatus === "idle" && (
            <div className="bg-accent/20 dark:bg-accent/5 rounded-2xl p-5 border border-border/60 space-y-3">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
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

          {/* Action and Progress Bar */}
          <div className="space-y-4 pt-4 border-t border-border/60">
            {installStatus === "idle" ? (
              <div className="flex flex-col sm:flex-row justify-center gap-3">
                <Button
                  onClick={onInstall}
                  disabled={smapiLatestVersion === null || isGameRunning}
                  title={isGameRunning ? t("mods.smapi.cannotInstallRunning") : undefined}
                  className="bg-primary hover:bg-primary/95 text-primary-foreground font-bold text-sm px-8 py-6 rounded-2xl shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-2"
                >
                  <Download className="h-5 w-5" />
                  {t("mods.smapi.oneClickInstall")} {smapiLatestVersion && `v${smapiLatestVersion}`}
                </Button>
                <Button
                  variant="outline"
                  onClick={onOpenOfficialSite}
                  className="border-border text-foreground hover:bg-accent font-semibold text-sm px-6 py-6 rounded-2xl"
                >
                  {t("mods.smapi.manualDownload")}
                </Button>
              </div>
            ) : installStatus === "error" ? (
              <div className="space-y-4">
                <div className="bg-red-500/15 border border-red-500/20 text-red-700 dark:text-red-400 text-xs rounded-xl p-4 font-mono break-all">
                  <p className="font-bold flex items-center gap-1.5 mb-1 text-sm">
                    <AlertTriangle className="h-4 w-4" /> {t("mods.smapi.installError")}
                  </p>
                  {installError}
                </div>
                <div className="flex justify-center gap-3">
                  <Button
                    onClick={onInstall}
                    disabled={isGameRunning}
                    title={isGameRunning ? t("mods.smapi.cannotInstallRunning") : undefined}
                    className="bg-primary hover:bg-primary/95 text-primary-foreground font-bold text-xs px-6 py-4 rounded-xl"
                  >
                    <RefreshCw className="h-4 w-4 mr-1.5 animate-spin" style={{ animationDuration: '3s' }} /> {t("mods.smapi.retryInstall")}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex justify-between text-xs font-bold text-foreground">
                  <span className="flex items-center gap-1.5">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
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
                <p className="text-[10px] text-muted-foreground text-center">
                  {isGameRunning ? t("mods.smapi.gameRunningLocked") : t("mods.smapi.autoInstalling")}
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Installation Details Info Card */}
      <Card className="border border-border bg-card rounded-2xl p-6">
        <CardHeader className="p-0 pb-3 flex flex-row items-center gap-2">
          <Info className="h-5 w-5 text-primary" />
          <CardTitle className="text-sm font-bold text-foreground">{t("mods.smapi.aboutTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="p-0 text-xs text-muted-foreground/90 space-y-2 leading-relaxed font-medium">
          <p>{t("mods.smapi.aboutStep1")}</p>
          <p>{t("mods.smapi.aboutStep2")}</p>
          <p>{t("mods.smapi.aboutStep3")}</p>
        </CardContent>
      </Card>
    </div>
  )
}
