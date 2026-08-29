import { Palette, Sun, Moon, Monitor, Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ThemeMode, ThemeSeason } from "@/lib/theme-provider"
import { useTranslation } from "react-i18next"

interface AppearanceCardProps {
  themeMode: ThemeMode
  themeSeason: ThemeSeason
  setThemeMode: (mode: ThemeMode) => void
  setThemeSeason: (season: ThemeSeason) => void
}

export function AppearanceCard({
  themeMode,
  themeSeason,
  setThemeMode,
  setThemeSeason,
}: AppearanceCardProps) {
  const { t } = useTranslation()

  return (
    <Card className="border border-border/80 overflow-hidden">
      <CardHeader className="bg-gradient-to-r from-primary/10 via-transparent to-transparent pb-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20 shrink-0">
            <Palette className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle className="text-lg font-bold">{t("settings.appearance.title")}</CardTitle>
            <CardDescription>{t("settings.appearance.description")}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6 pt-6">
        {/* Theme Mode */}
        <div className="space-y-2">
          <h4 className="text-sm font-semibold tracking-wide text-foreground">{t("settings.appearance.themeMode")}</h4>
          <div className="grid grid-cols-3 gap-3">
            {[
              { value: "light" as ThemeMode, label: t("settings.appearance.light"), icon: Sun },
              { value: "dark" as ThemeMode, label: t("settings.appearance.dark"), icon: Moon },
              { value: "system" as ThemeMode, label: t("settings.appearance.system"), icon: Monitor },
            ].map((item) => {
              const Icon = item.icon
              const isActive = themeMode === item.value
              return (
                <Button
                  key={item.value}
                  variant={isActive ? "default" : "outline"}
                  onClick={() => setThemeMode(item.value)}
                  className={cn(
                    "flex items-center justify-center gap-2 py-4 h-auto transition-all duration-200 cursor-pointer",
                    isActive ? "shadow-md scale-[1.02] font-semibold" : "hover:bg-accent/40"
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                </Button>
              )
            })}
          </div>
        </div>

        <Separator className="bg-border/60" />

        {/* Season Themes */}
        <div className="space-y-3">
          <div className="flex flex-col gap-1">
            <h4 className="text-sm font-semibold tracking-wide text-foreground">{t("settings.appearance.seasonColor")}</h4>
            <p className="text-xs text-muted-foreground">{t("settings.appearance.seasonDesc")}</p>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {[
              {
                value: "default" as ThemeSeason,
                label: t("settings.appearance.classic"),
                desc: t("settings.appearance.classicDesc"),
                gradient: "from-emerald-500/90 to-green-600/90",
                color: "bg-emerald-500",
              },
              {
                value: "spring" as ThemeSeason,
                label: t("settings.appearance.spring"),
                desc: t("settings.appearance.springDesc"),
                gradient: "from-pink-400/90 to-rose-500/90",
                color: "bg-pink-400",
              },
              {
                value: "summer" as ThemeSeason,
                label: t("settings.appearance.summer"),
                desc: t("settings.appearance.summerDesc"),
                gradient: "from-amber-400/90 to-yellow-500/90",
                color: "bg-amber-400",
              },
              {
                value: "fall" as ThemeSeason,
                label: t("settings.appearance.fall"),
                desc: t("settings.appearance.fallDesc"),
                gradient: "from-orange-500/90 to-amber-600/90",
                color: "bg-orange-500",
              },
              {
                value: "winter" as ThemeSeason,
                label: t("settings.appearance.winter"),
                desc: t("settings.appearance.winterDesc"),
                gradient: "from-sky-400/90 to-blue-500/90",
                color: "bg-sky-400",
              },
            ].map((item) => {
              const isSelected = themeSeason === item.value
              return (
                <button
                  key={item.value}
                  onClick={() => setThemeSeason(item.value)}
                  className={cn(
                    "group relative flex flex-col justify-between text-left p-4 rounded-xl border transition-all duration-300 cursor-pointer overflow-hidden bg-card text-card-foreground",
                    isSelected 
                      ? "border-primary shadow-lg ring-2 ring-primary/20 scale-[1.01]" 
                      : "border-border/60 hover:border-border-foreground/45 hover:shadow-md hover:scale-[1.005]"
                  )}
                >
                  {/* Left color bar decorator */}
                  <div className={cn("absolute left-0 top-0 bottom-0 w-1.5 bg-gradient-to-b", item.gradient)} />
                  
                  <div className="pl-2.5 space-y-1.5 flex-1 pr-6">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm leading-tight text-foreground group-hover:text-primary transition-colors">
                        {item.label}
                      </span>
                      <span className={cn("h-2 w-2 rounded-full", item.color)} />
                    </div>
                    <p className="text-xs text-muted-foreground leading-normal pr-4">
                      {item.desc}
                    </p>
                  </div>

                  {/* Check icon indicator */}
                  {isSelected && (
                    <div className="absolute right-3.5 top-3.5 h-5 w-5 rounded-full bg-primary flex items-center justify-center text-primary-foreground animate-in zoom-in-75 duration-200">
                      <Check className="h-3.5 w-3.5 stroke-[3]" />
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
