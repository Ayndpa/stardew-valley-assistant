import { useState, useEffect } from "react"
import { Info, RefreshCw, ExternalLink, CheckCircle, AlertCircle } from "lucide-react"
import { getVersion } from "@tauri-apps/api/app"
import { Separator } from "@/components/ui/separator"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useTranslation } from "react-i18next"

async function getTauriInvoke() {
  if (typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__) {
    try {
      const mod = await import("@tauri-apps/api/core");
      return mod.invoke;
    } catch (err) {
      console.error("Failed to load Tauri core invoke plugin", err);
    }
  }
  return null;
}

interface UpdateInfo {
  has_update: boolean;
  current_version: string;
  latest_version: string;
  release_url: string;
  release_notes: string;
  published_at: string;
}

export function AboutCard() {
  const { t } = useTranslation()
  const [appVersion, setAppVersion] = useState<string>("")
  const [checking, setChecking] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => setAppVersion(""))
  }, [])

  const handleCheckUpdate = async () => {
    setChecking(true)
    setError(null)
    setUpdateInfo(null)

    try {
      const invoke = await getTauriInvoke()
      if (!invoke) {
        // Browser mock mode
        await new Promise(resolve => setTimeout(resolve, 1000))
        setUpdateInfo({
          has_update: false,
          current_version: appVersion,
          latest_version: appVersion,
          release_url: "https://github.com/Ayndpa/stardew-valley-assistant/releases",
          release_notes: "",
          published_at: new Date().toISOString(),
        })
        return
      }

      const info: UpdateInfo = await invoke("check_for_updates", {
        currentVersion: appVersion,
      })
      setUpdateInfo(info)
    } catch (err) {
      console.error("Check update error:", err)
      setError(typeof err === "string" ? err : t("settings.about.updateCheckError"))
    } finally {
      setChecking(false)
    }
  }

  const handleOpenRelease = async () => {
    if (updateInfo?.release_url) {
      const invoke = await getTauriInvoke()
      if (invoke) {
        try {
          const { openUrl } = await import("@tauri-apps/plugin-opener")
          await openUrl(updateInfo.release_url)
        } catch {
          window.open(updateInfo.release_url, "_blank")
        }
      } else {
        window.open(updateInfo.release_url, "_blank")
      }
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Info className="h-5 w-5" />
          {t("settings.about.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{t("settings.about.version")}</span>
          <span>{appVersion || "—"}</span>
        </div>
        <Separator />
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{t("settings.about.framework")}</span>
          <span>Tauri + React</span>
        </div>
        <Separator />
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{t("settings.about.ui")}</span>
          <span>shadcn/ui</span>
        </div>
        <Separator />

        {/* Update Check Section */}
        <div className="pt-2 space-y-3">
          <Button
            onClick={handleCheckUpdate}
            disabled={checking || !appVersion}
            variant="outline"
            className="w-full"
          >
            {checking ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                {t("settings.about.checking")}
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                {t("settings.about.checkUpdate")}
              </>
            )}
          </Button>

          {/* Update Status */}
          {updateInfo && (
            <div className={`p-3 rounded-lg ${updateInfo.has_update ? "bg-yellow-500/10 border border-yellow-500/20" : "bg-green-500/10 border border-green-500/20"}`}>
              {updateInfo.has_update ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-yellow-600 dark:text-yellow-400">
                    <AlertCircle className="h-4 w-4" />
                    <span className="text-sm font-medium">{t("settings.about.updateAvailable")}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("settings.about.newVersion", { version: updateInfo.latest_version })}
                  </p>
                  <Button
                    size="sm"
                    className="w-full"
                    onClick={handleOpenRelease}
                  >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    {t("settings.about.downloadUpdate")}
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                  <CheckCircle className="h-4 w-4" />
                  <span className="text-sm">{t("settings.about.upToDate")}</span>
                </div>
              )}
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
              <p className="text-xs text-destructive">{error}</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
