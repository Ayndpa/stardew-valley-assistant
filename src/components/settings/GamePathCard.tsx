import { FolderOpen, Search, CheckCircle2, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useTranslation } from "react-i18next"

interface GamePathCardProps {
  gameDir: string
  isValidPath: boolean | null
  onAutoDetect: () => void
  onBrowse: () => void
  onChangeDir: (val: string) => void
}

export function GamePathCard({
  gameDir,
  isValidPath,
  onAutoDetect,
  onBrowse,
  onChangeDir,
}: GamePathCardProps) {
  const { t } = useTranslation()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <FolderOpen className="h-5 w-5" />
          {t("settings.gamePath.title")}
        </CardTitle>
        <CardDescription>{t("settings.gamePath.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">{t("settings.gamePath.label")}</label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                placeholder={t("settings.gamePath.placeholder")}
                value={gameDir}
                onChange={(e) => onChangeDir(e.target.value)}
                className="pr-10 font-mono text-sm"
              />
              {isValidPath !== null && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  {isValidPath ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                  )}
                </div>
              )}
            </div>
            <Button
              variant="default"
              onClick={onAutoDetect}
              className="flex gap-2 font-medium bg-primary text-primary-foreground hover:bg-primary/95 shrink-0"
            >
              <Search className="h-4 w-4" />
              {t("settings.gamePath.autoDetect")}
            </Button>
            <Button
              variant="outline"
              onClick={onBrowse}
              className="flex gap-2 font-medium shrink-0"
            >
              <FolderOpen className="h-4 w-4" />
              {t("settings.gamePath.browse")}
            </Button>
          </div>
          {isValidPath === false && (
            <p className="text-xs text-amber-500 flex items-center gap-1 mt-1 font-medium">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>{t("settings.gamePath.invalidPath")}</span>
            </p>
          )}
          {isValidPath === true && (
            <p className="text-xs text-emerald-500 flex items-center gap-1 mt-1 font-medium">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>{t("settings.gamePath.validPath")}</span>
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

