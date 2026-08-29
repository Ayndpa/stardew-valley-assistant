import { Button } from "@/components/ui/button"
import { useTranslation } from "react-i18next"
import {
  Leaf,
  Sprout,
  Users,
  CalendarDays,
  Puzzle,
  ChevronRight,
} from "lucide-react"

interface OnboardingStep1Props {
  onPrev: () => void
  onNext: () => void
}

export function OnboardingStep1({ onPrev, onNext }: OnboardingStep1Props) {
  const { t } = useTranslation()

  return (
    <div className="space-y-6 text-center animate-fade-in">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-inner">
        <Leaf className="h-8 w-8 text-primary animate-pulse" />
      </div>
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight text-primary">
          {t("onboarding.welcome.title")}
        </h1>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          {t("onboarding.welcome.description")}
        </p>
      </div>

      {/* Feature Highlights Grid */}
      <div className="grid grid-cols-2 gap-4 text-left mt-6">
        <div className="p-4 rounded-xl border border-border bg-accent/20 hover:bg-accent/40 transition-colors flex gap-3 items-center">
          <div className="rounded-lg p-2 bg-primary/10 text-primary shrink-0">
            <Puzzle className="h-4 w-4" />
          </div>
          <div>
            <h4 className="text-sm font-semibold">{t("onboarding.welcome.features.modsTitle")}</h4>
            <p className="text-xs text-muted-foreground mt-0.5">{t("onboarding.welcome.features.modsDesc")}</p>
          </div>
        </div>

        <div className="p-4 rounded-xl border border-border bg-accent/20 hover:bg-accent/40 transition-colors flex gap-3 items-center">
          <div className="rounded-lg p-2 bg-primary/10 text-primary shrink-0">
            <Sprout className="h-4 w-4" />
          </div>
          <div>
            <h4 className="text-sm font-semibold">{t("onboarding.welcome.features.cropsTitle")}</h4>
            <p className="text-xs text-muted-foreground mt-0.5">{t("onboarding.welcome.features.cropsDesc")}</p>
          </div>
        </div>

        <div className="p-4 rounded-xl border border-border bg-accent/20 hover:bg-accent/40 transition-colors flex gap-3 items-center">
          <div className="rounded-lg p-2 bg-primary/10 text-primary shrink-0">
            <Users className="h-4 w-4" />
          </div>
          <div>
            <h4 className="text-sm font-semibold">{t("onboarding.welcome.features.npcsTitle")}</h4>
            <p className="text-xs text-muted-foreground mt-0.5">{t("onboarding.welcome.features.npcsDesc")}</p>
          </div>
        </div>

        <div className="p-4 rounded-xl border border-border bg-accent/20 hover:bg-accent/40 transition-colors flex gap-3 items-center">
          <div className="rounded-lg p-2 bg-primary/10 text-primary shrink-0">
            <CalendarDays className="h-4 w-4" />
          </div>
          <div>
            <h4 className="text-sm font-semibold">{t("onboarding.welcome.features.calendarTitle")}</h4>
            <p className="text-xs text-muted-foreground mt-0.5">{t("onboarding.welcome.features.calendarDesc")}</p>
          </div>
        </div>
      </div>

      <div className="pt-4 flex justify-between gap-4">
        <Button variant="ghost" onClick={onPrev} className="px-5 rounded-xl font-medium">
          {t("onboarding.welcome.prev")}
        </Button>
        <Button onClick={onNext} className="w-full sm:w-auto px-6 py-5 rounded-xl flex items-center justify-center gap-2 group font-semibold">
          {t("onboarding.welcome.startBtn")}
          <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
        </Button>
      </div>
    </div>
  )
}
