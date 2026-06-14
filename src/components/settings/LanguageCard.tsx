import { Globe, Check } from "lucide-react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export function LanguageCard() {
  const { t, i18n } = useTranslation()
  const currentLanguage = i18n.language || "zh"

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng)
  }

  return (
    <Card className="border border-border/80 overflow-hidden">
      <CardHeader className="bg-gradient-to-r from-primary/10 via-transparent to-transparent pb-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20 shrink-0">
            <Globe className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle className="text-lg font-bold">{t("settings.language.title")}</CardTitle>
            <CardDescription>{t("settings.language.description")}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-6">
        <div className="grid grid-cols-2 gap-3">
          {[
            { value: "zh", label: t("settings.language.zh") },
            { value: "en", label: t("settings.language.en") },
          ].map((item) => {
            const isActive = currentLanguage.startsWith(item.value)
            return (
              <Button
                key={item.value}
                variant={isActive ? "default" : "outline"}
                onClick={() => changeLanguage(item.value)}
                className={cn(
                  "flex items-center justify-center gap-2 py-4 h-auto transition-all duration-200 cursor-pointer relative",
                  isActive ? "shadow-md scale-[1.02] font-semibold" : "hover:bg-accent/40"
                )}
              >
                <span>{item.label}</span>
                {isActive && (
                  <Check className="h-4 w-4 shrink-0 absolute right-3" />
                )}
              </Button>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
