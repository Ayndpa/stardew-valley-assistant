import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useTranslation } from "react-i18next"
import {
  FolderOpen,
  Search,
  AlertTriangle,
  CheckCircle2,
  Info,
  ChevronDown,
  ArrowRight,
} from "lucide-react"

const PRESET_PATHS = [
  {
    key: "onboarding.directory.presetSteamDefault",
    defaultName: "Steam (默认位置)",
    path: "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Stardew Valley",
    platform: "windows",
  },
  {
    key: "onboarding.directory.presetSteamSecondary",
    defaultName: "Steam (次要盘符)",
    path: "D:\\SteamLibrary\\steamapps\\common\\Stardew Valley",
    platform: "windows",
  },
  {
    key: "onboarding.directory.presetGog",
    defaultName: "GOG Galaxy (默认位置)",
    path: "C:\\GOG Games\\Stardew Valley",
    platform: "windows",
  },
  {
    key: "onboarding.directory.presetMacos",
    defaultName: "macOS Steam (默认位置)",
    path: "~/Library/Application Support/Steam/steamapps/common/Stardew Valley",
    platform: "macos",
  },
]

interface OnboardingStep2Props {
  directory: string
  setDirectory: (dir: string) => void
  isValidPath: boolean | null
  showPresets: boolean
  setShowPresets: (show: boolean) => void
  onBrowse: () => Promise<void>
  onAutoDetect: () => Promise<void>
  onPrev: () => void
  onConfirm: () => void
}

export function OnboardingStep2({
  directory,
  setDirectory,
  isValidPath,
  showPresets,
  setShowPresets,
  onBrowse,
  onAutoDetect,
  onPrev,
  onConfirm,
}: OnboardingStep2Props) {
  const { t } = useTranslation()

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="space-y-2 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500 mb-2">
          <FolderOpen className="h-6 w-6" />
        </div>
        <h2 className="text-xl font-bold tracking-tight">{t("onboarding.directory.title")}</h2>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          {t("onboarding.directory.description")}
        </p>
      </div>

      {/* Input Group */}
      <div className="space-y-3 mt-4">
        <label className="text-xs font-semibold text-muted-foreground tracking-wider uppercase">{t("onboarding.directory.label")}</label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              placeholder={t("onboarding.directory.placeholder")}
              value={directory}
              onChange={(e) => setDirectory(e.target.value)}
              className="pr-10 rounded-xl py-5 border-border focus-visible:ring-primary focus-visible:border-primary text-sm font-mono"
            />
            {isValidPath !== null && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                {isValidPath ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-amber-500" />
                )}
              </div>
            )}
          </div>
          <Button
            onClick={onAutoDetect}
            variant="default"
            className="rounded-xl px-4 flex gap-2 font-medium bg-primary text-primary-foreground hover:bg-primary/95 shrink-0"
          >
            <Search className="h-4 w-4" />
            <span>{t("onboarding.directory.autoDetect")}</span>
          </Button>
          <Button
            onClick={onBrowse}
            variant="secondary"
            className="rounded-xl px-4 hover:bg-secondary/80 flex gap-2 font-medium shrink-0"
          >
            <FolderOpen className="h-4 w-4" />
            <span>{t("onboarding.directory.browse")}</span>
          </Button>
        </div>

        {/* Validation Feedback */}
        {isValidPath === false && (
          <p className="text-xs text-amber-500 flex items-center gap-1.5 font-medium px-1">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>{t("onboarding.directory.invalid")}</span>
          </p>
        )}
        {isValidPath === true && (
          <p className="text-xs text-emerald-500 flex items-center gap-1.5 font-medium px-1">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            <span>{t("onboarding.directory.valid")}</span>
          </p>
        )}
      </div>

      {/* Presets Collapsible List */}
      <div className="mt-4 bg-muted/30 rounded-xl border border-border overflow-hidden">
        <button
          type="button"
          onClick={() => setShowPresets(!showPresets)}
          className="w-full flex items-center justify-between p-4 hover:bg-muted/50 transition-colors text-left"
        >
          <h4 className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
            <Info className="h-3.5 w-3.5" />
            <span>{t("onboarding.directory.presets")}</span>
          </h4>
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${showPresets ? "rotate-180" : ""}`} />
        </button>
        {showPresets && (
          <div className="px-4 pb-4 border-t border-border/50 pt-3 grid grid-cols-1 gap-2">
            {PRESET_PATHS.map((preset) => (
              <button
                type="button"
                key={preset.key}
                onClick={() => setDirectory(preset.path)}
                className="text-left text-xs p-2 rounded-lg border border-border/50 bg-background/50 hover:bg-primary/5 hover:border-primary/30 transition-all font-mono truncate text-muted-foreground hover:text-foreground flex justify-between items-center group w-full"
              >
                <span className="truncate mr-2 font-sans font-medium">{t(preset.key, preset.defaultName)}</span>
                <span className="truncate text-[10px] text-muted-foreground opacity-60 group-hover:opacity-100">{preset.path}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Navigation Action Buttons */}
      <div className="pt-4 flex justify-between gap-4">
        <Button variant="ghost" onClick={onPrev} className="px-5 rounded-xl font-medium">
          {t("onboarding.directory.prev")}
        </Button>
        <Button onClick={onConfirm} disabled={!directory.trim()} className="px-6 py-5 rounded-xl flex gap-2 font-semibold">
          {t("onboarding.directory.next")}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
