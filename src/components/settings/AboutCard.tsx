import { useState, useEffect } from "react"
import { Info, RefreshCw, CheckCircle } from "lucide-react"
import { getVersion } from "@tauri-apps/api/app"
import { Separator } from "@/components/ui/separator"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useTranslation } from "react-i18next"
import type { UpdateInfo } from "@/components/UpdateDialog"

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

export function AboutCard({ onUpdateFound }: { onUpdateFound?: (info: UpdateInfo) => void }) {
  const { t } = useTranslation()
  const [appVersion, setAppVersion] = useState<string>("")
  const [checking, setChecking] = useState(false)
  const [upToDate, setUpToDate] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => setAppVersion(""))
  }, [])

  const handleCheckUpdate = async () => {
    setChecking(true)
    setError(null)
    setUpToDate(false)

    try {
      const invoke = await getTauriInvoke()
      if (!invoke) {
        // Browser mock mode
        await new Promise(resolve => setTimeout(resolve, 1000))
        setUpToDate(true)
        return
      }

      const info: UpdateInfo = await invoke("check_for_updates", {
        currentVersion: appVersion,
      })

      if (info.has_update && onUpdateFound) {
        onUpdateFound(info)
      } else if (!info.has_update) {
        setUpToDate(true)
      }
    } catch (err) {
      console.error("Check update error:", err)
      setError(typeof err === "string" ? err : t("settings.about.updateCheckError"))
    } finally {
      setChecking(false)
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

          {/* Up to Date Status */}
          {upToDate && (
            <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20">
              <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                <CheckCircle className="h-4 w-4" />
                <span className="text-sm">{t("settings.about.upToDate")}</span>
              </div>
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
