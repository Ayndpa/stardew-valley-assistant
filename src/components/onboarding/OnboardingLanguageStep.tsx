import { Globe, Check, ChevronRight } from "lucide-react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

interface OnboardingLanguageStepProps {
  onNext: () => void
}

export function OnboardingLanguageStep({ onNext }: OnboardingLanguageStepProps) {
  const { t, i18n } = useTranslation()
  const currentLanguage = i18n.language || "zh"

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng)
  }

  return (
    <div className="space-y-6 text-center animate-fade-in">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-inner">
        <Globe className="h-8 w-8 text-primary animate-pulse" />
      </div>
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight text-primary">
          {t("onboarding.language.title", "选择你的语言 / Select Your Language")}
        </h1>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          {t("onboarding.language.description", "请选择您在超级星露谷中使用的界面语言。这会立即更新界面显示。")}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 max-w-sm mx-auto mt-6">
        {[
          { value: "zh", label: "简体中文" },
          { value: "en", label: "English" },
        ].map((item) => {
          const isActive = currentLanguage.startsWith(item.value)
          return (
            <Button
              key={item.value}
              variant={isActive ? "default" : "outline"}
              onClick={() => changeLanguage(item.value)}
              className={cn(
                "flex items-center justify-center gap-2 py-6 h-auto transition-all duration-200 cursor-pointer relative rounded-xl border border-border/80",
                isActive ? "shadow-md scale-[1.02] font-semibold border-primary" : "hover:bg-accent/40"
              )}
            >
              <span className="text-sm">{item.label}</span>
              {isActive && (
                <Check className="h-4 w-4 shrink-0 absolute right-3" />
              )}
            </Button>
          )
        })}
      </div>

      <div className="pt-6 flex justify-end">
        <Button onClick={onNext} className="w-full sm:w-auto px-6 py-5 rounded-xl flex items-center justify-center gap-2 group font-semibold">
          {t("onboarding.language.next", "确认并继续")}
          <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
        </Button>
      </div>
    </div>
  )
}
