import { useState, useEffect } from "react"
import { Info } from "lucide-react"
import { getVersion } from "@tauri-apps/api/app"
import { Separator } from "@/components/ui/separator"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useTranslation } from "react-i18next"

export function AboutCard() {
  const { t } = useTranslation()
  const [appVersion, setAppVersion] = useState<string>("")

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => setAppVersion(""))
  }, [])

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
      </CardContent>
    </Card>
  )
}

