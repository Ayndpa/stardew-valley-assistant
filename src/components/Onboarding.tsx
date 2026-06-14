import { useState, useEffect } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { useTheme } from "@/lib/theme-provider"
import { useTranslation } from "react-i18next"
import { Info } from "lucide-react"
import { OnboardingLanguageStep } from "./onboarding/OnboardingLanguageStep"
import { OnboardingStep1 } from "./onboarding/OnboardingStep1"
import { OnboardingStep2 } from "./onboarding/OnboardingStep2"
import { OnboardingStep3 } from "./onboarding/OnboardingStep3"
import { OnboardingStep4 } from "./onboarding/OnboardingStep4"

// Helper functions for dynamic imports to ensure web compatibility
async function getTauriDialog() {
  if (typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__) {
    try {
      const mod = await import("@tauri-apps/plugin-dialog");
      return mod.open;
    } catch (err) {
      console.error("Failed to load Tauri Dialog plugin", err);
    }
  }
  return null;
}

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

interface OnboardingProps {
  onComplete: (gameDirectory: string) => void
  initialReason?: string | null
}

export function Onboarding({ onComplete, initialReason }: OnboardingProps) {
  const { t } = useTranslation()
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(() => (initialReason ? 4 : 1))
  const { themeMode, themeSeason, setThemeMode, setThemeSeason } = useTheme()
  const [directory, setDirectory] = useState(() => {
    return localStorage.getItem("stardewGameDirectory") || ""
  })
  const [isValidPath, setIsValidPath] = useState<boolean | null>(null)
  const [showNotification, setShowNotification] = useState<string | null>(null)
  const [showPresets, setShowPresets] = useState(false)

  useEffect(() => {
    if (!initialReason) return
    setStep(4)
    triggerNotification(initialReason)
  }, [initialReason])

  // Basic path format validation
  useEffect(() => {
    if (!directory.trim()) {
      setIsValidPath(null)
      return
    }

    const pathLower = directory.toLowerCase()
    // Stardew Valley standard directory check
    const isStardewFolder =
      pathLower.includes("stardew") ||
      pathLower.includes("星露谷") ||
      pathLower.includes("mods")
    
    setIsValidPath(isStardewFolder)
  }, [directory])

  const handleBrowse = async () => {
    const dialog = await getTauriDialog()
    if (dialog) {
      try {
        const selected = await dialog({
          directory: true,
          multiple: false,
          title: t("settings.gamePath.dialogTitle") || "选择星露谷物语 (Stardew Valley) 安装目录",
          defaultPath: directory || "C:\\Program Files (x86)\\Steam\\steamapps\\common",
        })

        if (selected) {
          const path = Array.isArray(selected) ? selected[0] : selected
          setDirectory(path)
          triggerNotification(t("settings.gamePath.validPath") || "已成功选择目录！")
        }
      } catch (err) {
        console.error("Tauri dialog error:", err)
        triggerNotification(t("settings.gamePath.autoDetectError") || "打开选择器失败，请手动粘贴路径")
      }
    } else {
      // Browser Mock behavior
      const mockPaths = [
        "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Stardew Valley",
        "D:\\SteamLibrary\\steamapps\\common\\Stardew Valley",
        "C:\\GOG Games\\Stardew Valley"
      ]
      const randomMockPath = mockPaths[Math.floor(Math.random() * mockPaths.length)]
      setDirectory(randomMockPath)
      triggerNotification(t("settings.gamePath.mockBrowseSuccess") || "（Web模式模拟）已填充模拟文件夹路径")
    }
  }

  const handleAutoDetect = async () => {
    const invoke = await getTauriInvoke()
    if (invoke) {
      try {
        triggerNotification((t("settings.gamePath.autoDetect") || "正在自动搜寻游戏目录") + "...")
        const detectedPath = await invoke("auto_detect_game_dir") as string
        if (detectedPath) {
          setDirectory(detectedPath)
          triggerNotification(t("settings.gamePath.autoDetectSuccess", { path: detectedPath }) || "自动检测成功！已找到游戏安装目录。")
        } else {
          triggerNotification(t("settings.gamePath.autoDetectFail") || "未能在 Steam 库中找到安装 of 星露谷物语，请手动选择。")
        }
      } catch (err) {
        console.error("Tauri auto detect error:", err)
        triggerNotification(t("settings.gamePath.autoDetectError") || "自动检测失败，请手动选择目录。")
      }
    } else {
      // Browser Mock behavior
      triggerNotification((t("settings.gamePath.autoDetect") || "正在自动搜寻") + "...")
      setTimeout(() => {
        const mockPath = "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Stardew Valley"
        setDirectory(mockPath)
        triggerNotification(t("settings.gamePath.mockAutoDetectSuccess") || "自动检测成功！已填充 Steam 默认路径。")
      }, 1000)
    }
  }

  const triggerNotification = (msg: string) => {
    setShowNotification(msg)
    setTimeout(() => {
      setShowNotification(null)
    }, 3000)
  }

  const handleConfirm = () => {
    if (!directory.trim()) {
      triggerNotification(t("settings.gamePath.placeholder") || "请输入或选择一个文件夹路径")
      return
    }
    setStep(5)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4 transition-all duration-300">
      {/* Toast Notification */}
      {showNotification && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-50 px-4 py-3 rounded-lg bg-primary text-primary-foreground shadow-lg font-medium flex items-center gap-2 animate-bounce">
          <Info className="h-4 w-4" />
          <span>{showNotification}</span>
        </div>
      )}

      {/* Main Cozy Modal Card */}
      <Card className="w-full max-w-xl overflow-hidden border-2 border-primary/20 shadow-2xl bg-gradient-to-b from-card to-background rounded-2xl">
        <CardContent className="p-8 relative">
          
          {/* Visual Step Progress Bar */}
          <div className="flex justify-between items-center mb-8 px-2 sm:px-4">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <span className={`h-5 w-5 sm:h-6 sm:w-6 rounded-full flex items-center justify-center text-[10px] sm:text-xs font-bold transition-colors ${step >= 1 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>1</span>
              <span className="text-[10px] sm:text-xs font-medium">{t("onboarding.steps.language")}</span>
            </div>
            <div className={`h-[2px] flex-1 mx-1 sm:mx-2 transition-colors ${step >= 2 ? "bg-primary" : "bg-muted"}`}></div>
            <div className="flex items-center gap-1.5 sm:gap-2">
              <span className={`h-5 w-5 sm:h-6 sm:w-6 rounded-full flex items-center justify-center text-[10px] sm:text-xs font-bold transition-colors ${step >= 2 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>2</span>
              <span className="text-[10px] sm:text-xs font-medium">{t("onboarding.steps.welcome")}</span>
            </div>
            <div className={`h-[2px] flex-1 mx-1 sm:mx-2 transition-colors ${step >= 3 ? "bg-primary" : "bg-muted"}`}></div>
            <div className="flex items-center gap-1.5 sm:gap-2">
              <span className={`h-5 w-5 sm:h-6 sm:w-6 rounded-full flex items-center justify-center text-[10px] sm:text-xs font-bold transition-colors ${step >= 3 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>3</span>
              <span className="text-[10px] sm:text-xs font-medium">{t("onboarding.steps.appearance")}</span>
            </div>
            <div className={`h-[2px] flex-1 mx-1 sm:mx-2 transition-colors ${step >= 4 ? "bg-primary" : "bg-muted"}`}></div>
            <div className="flex items-center gap-1.5 sm:gap-2">
              <span className={`h-5 w-5 sm:h-6 sm:w-6 rounded-full flex items-center justify-center text-[10px] sm:text-xs font-bold transition-colors ${step >= 4 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>4</span>
              <span className="text-[10px] sm:text-xs font-medium">{t("onboarding.steps.directory")}</span>
            </div>
            <div className={`h-[2px] flex-1 mx-1 sm:mx-2 transition-colors ${step >= 5 ? "bg-primary" : "bg-muted"}`}></div>
            <div className="flex items-center gap-1.5 sm:gap-2">
              <span className={`h-5 w-5 sm:h-6 sm:w-6 rounded-full flex items-center justify-center text-[10px] sm:text-xs font-bold transition-colors ${step >= 5 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>5</span>
              <span className="text-[10px] sm:text-xs font-medium">{t("onboarding.steps.journey")}</span>
            </div>
          </div>

          {initialReason && (
            <div className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
              {initialReason}
            </div>
          )}

          {/* Render Active Step */}
          {step === 1 && <OnboardingLanguageStep onNext={() => setStep(2)} />}
          {step === 2 && <OnboardingStep1 onPrev={() => setStep(1)} onNext={() => setStep(3)} />}
          {step === 3 && (
            <OnboardingStep3
              themeMode={themeMode}
              themeSeason={themeSeason}
              setThemeMode={setThemeMode}
              setThemeSeason={setThemeSeason}
              onPrev={() => setStep(2)}
              onNext={() => setStep(4)}
            />
          )}
          {step === 4 && (
            <OnboardingStep2
              directory={directory}
              setDirectory={setDirectory}
              isValidPath={isValidPath}
              showPresets={showPresets}
              setShowPresets={setShowPresets}
              onBrowse={handleBrowse}
              onAutoDetect={handleAutoDetect}
              onPrev={() => setStep(3)}
              onConfirm={handleConfirm}
            />
          )}
          {step === 5 && (
            <OnboardingStep4
              directory={directory}
              themeMode={themeMode}
              themeSeason={themeSeason}
              onPrev={() => setStep(4)}
              onComplete={() => onComplete(directory)}
            />
          )}

        </CardContent>
      </Card>
    </div>
  )
}
