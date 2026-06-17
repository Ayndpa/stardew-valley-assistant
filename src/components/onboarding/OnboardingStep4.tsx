import { Button } from "@/components/ui/button"
import { useTranslation } from "react-i18next"
import { ThemeMode, ThemeSeason } from "@/lib/theme-provider"
import { CheckCircle2, Heart } from "lucide-react"

interface OnboardingStep4Props {
  directory: string
  themeMode: ThemeMode
  themeSeason: ThemeSeason
  selectedFeatures: string[]
  onPrev: () => void
  onComplete: () => void
}

export function OnboardingStep4({
  directory,
  themeMode,
  themeSeason,
  selectedFeatures,
  onPrev,
  onComplete,
}: OnboardingStep4Props) {
  const { t } = useTranslation()
  const enabledCount = selectedFeatures.length

  return (
    <div className="space-y-6 text-center animate-fade-in">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-500 shadow-inner">
        <CheckCircle2 className="h-8 w-8 text-emerald-500 animate-bounce" />
      </div>
      <div className="space-y-2">
        <h2 className="text-2xl font-bold tracking-tight text-primary">{t("onboarding.journey.title")}</h2>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          {t("onboarding.journey.description")}
        </p>
      </div>

      {/* Summary card */}
      <div className="bg-primary/5 p-4 rounded-xl border border-primary/10 text-left max-w-md mx-auto space-y-2">
        <div className="flex justify-between items-center text-xs border-b border-primary/10 pb-2">
          <span className="text-muted-foreground font-medium">{t("onboarding.journey.summary.directory")}</span>
          <span className="font-mono text-foreground font-bold truncate max-w-[200px]" title={directory}>{directory}</span>
        </div>
        <div className="flex justify-between items-center text-xs border-b border-primary/10 pb-2 pt-1">
          <span className="text-muted-foreground font-medium">{t("onboarding.journey.summary.theme")}</span>
          <span className="font-semibold text-foreground">
            {t(`onboarding.appearance.themes.${themeMode}`)}
          </span>
        </div>
        <div className="flex justify-between items-center text-xs border-b border-primary/10 pb-2 pt-1">
          <span className="text-muted-foreground font-medium">{t("onboarding.journey.summary.season")}</span>
          <span className="font-semibold text-foreground">
            {themeSeason === "default" && t("onboarding.appearance.themes.classic")}
            {themeSeason === "spring" && t("onboarding.appearance.themes.spring")}
            {themeSeason === "summer" && t("onboarding.appearance.themes.summer")}
            {themeSeason === "fall" && t("onboarding.appearance.themes.fall")}
            {themeSeason === "winter" && t("onboarding.appearance.themes.winter")}
          </span>
        </div>
        <div className="flex justify-between items-center text-xs pt-1">
          <span className="text-muted-foreground font-medium">{t("onboarding.journey.summary.features")}</span>
          <span className="text-emerald-500 font-semibold flex items-center gap-1 text-[11px] sm:text-xs">
            <CheckCircle2 className="h-3 w-3 shrink-0" />
            {enabledCount === 7
              ? t("onboarding.journey.summary.featuresList")
              : t("onboarding.journey.summary.featuresListCustom", { count: enabledCount })}
          </span>
        </div>
      </div>

      <div className="pt-4 flex justify-between gap-4">
        <Button variant="ghost" onClick={onPrev} className="px-5 rounded-xl font-medium">
          {t("onboarding.journey.prev")}
        </Button>
        <Button onClick={onComplete} className="flex-1 py-6 rounded-xl text-md font-bold flex gap-2 shadow-lg hover:shadow-xl transition-all justify-center items-center">
          {t("onboarding.journey.enter")}
          <Heart className="h-5 w-5 fill-primary-foreground animate-pulse" />
        </Button>
      </div>
    </div>
  )
}
