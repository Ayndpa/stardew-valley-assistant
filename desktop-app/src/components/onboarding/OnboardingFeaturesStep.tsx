import { Button } from "@/components/ui/button"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import {
  Puzzle,
  Sprout,
  Package,
  PackageOpen,
  Users,
  CalendarDays,
  Fish,
  PencilRuler,
  Trophy,
  PawPrint,
  Baby,
  Check,
  ChevronRight,
  Notebook,
} from "lucide-react"

interface OnboardingFeaturesStepProps {
  selectedFeatures: string[]
  onChange: (features: string[]) => void
  onPrev: () => void
  onNext: () => void
}

export function OnboardingFeaturesStep({
  selectedFeatures,
  onChange,
  onPrev,
  onNext,
}: OnboardingFeaturesStepProps) {
  const { t } = useTranslation()

  const categories = [
    { id: "mods", icon: Puzzle, gradient: "from-purple-500/10 to-indigo-500/10" },
    { id: "crops", icon: Sprout, gradient: "from-emerald-500/10 to-teal-500/10" },
    { id: "items", icon: Package, gradient: "from-amber-500/10 to-orange-500/10" },
    { id: "collections", icon: Trophy, gradient: "from-yellow-500/10 to-lime-500/10" },
    { id: "bundles", icon: PackageOpen, gradient: "from-violet-500/10 to-purple-500/10" },
    { id: "animals", icon: PawPrint, gradient: "from-orange-500/10 to-red-500/10" },
    { id: "npcs", icon: Users, gradient: "from-pink-500/10 to-rose-500/10" },
    { id: "calendar", icon: CalendarDays, gradient: "from-blue-500/10 to-sky-500/10" },
    { id: "fishingMap", icon: Fish, gradient: "from-cyan-500/10 to-blue-500/10" },
    { id: "children", icon: Baby, gradient: "from-rose-500/10 to-pink-500/10" },
    { id: "todo", icon: Notebook, gradient: "from-teal-500/10 to-emerald-500/10" },
    { id: "saveEditor", icon: PencilRuler, gradient: "from-yellow-500/10 to-amber-500/10" },
  ]

  const toggleFeature = (id: string) => {
    if (selectedFeatures.includes(id)) {
      onChange(selectedFeatures.filter((f) => f !== id))
    } else {
      onChange([...selectedFeatures, id])
    }
  }

  const handleSelectAllToggle = () => {
    if (selectedFeatures.length === categories.length) {
      onChange([])
    } else {
      onChange(categories.map((c) => c.id))
    }
  }

  const isAllSelected = selectedFeatures.length === categories.length

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="space-y-2 text-center">
        <h2 className="text-xl font-bold tracking-tight text-primary">
          {t("onboarding.features.title")}
        </h2>
        <p className="text-xs text-muted-foreground max-w-sm mx-auto">
          {t("onboarding.features.description")}
        </p>
      </div>

      <div className="flex justify-end px-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleSelectAllToggle}
          className="text-xs h-8 rounded-lg cursor-pointer hover:bg-accent/40"
        >
          {isAllSelected ? t("onboarding.features.deselectAll") : t("onboarding.features.selectAll")}
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[300px] overflow-y-auto pl-3 pr-2 py-1">
        {categories.map((item) => {
          const Icon = item.icon
          const isSelected = selectedFeatures.includes(item.id)
          return (
            <button
              type="button"
              key={item.id}
              onClick={() => toggleFeature(item.id)}
              className={cn(
                "group relative flex items-start text-left p-3 rounded-xl border transition-all duration-200 cursor-pointer bg-card text-card-foreground select-none",
                isSelected
                  ? "border-primary shadow-sm ring-1 ring-primary/20 scale-[1.01]"
                  : "border-border/60 hover:border-border-foreground/30 hover:scale-[1.005]"
              )}
            >
              {/* Background decorator on select */}
              {isSelected && (
                <div className={cn("absolute inset-0 bg-gradient-to-br opacity-[0.15] pointer-events-none rounded-xl", item.gradient)} />
              )}
              
              <div className="flex gap-3 items-center w-full">
                <div className={cn("rounded-lg p-2 bg-primary/10 text-primary shrink-0 transition-all", isSelected && "scale-110")}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="space-y-0.5 flex-1 pr-6 min-w-0">
                  <h4 className="text-xs font-bold text-foreground group-hover:text-primary transition-colors truncate">
                    {t(`onboarding.features.categories.${item.id}Title`)}
                  </h4>
                  <p className="text-[10px] text-muted-foreground leading-normal line-clamp-2">
                    {t(`onboarding.features.categories.${item.id}Desc`)}
                  </p>
                </div>
              </div>

              {/* Check indicator */}
              {isSelected && (
                <div className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 rounded-full bg-primary flex items-center justify-center text-primary-foreground animate-in zoom-in-75 duration-200">
                  <Check className="h-2.5 w-2.5 stroke-[3]" />
                </div>
              )}
            </button>
          )
        })}
      </div>

      <div className="pt-2 flex justify-between gap-4">
        <Button variant="ghost" onClick={onPrev} className="px-5 rounded-xl font-medium">
          {t("onboarding.features.prev")}
        </Button>
        <Button
          onClick={onNext}
          disabled={selectedFeatures.length === 0}
          className="px-6 py-5 rounded-xl flex gap-2 font-semibold"
        >
          {t("onboarding.features.next")}
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
