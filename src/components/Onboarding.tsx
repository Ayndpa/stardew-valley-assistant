import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { useTheme, ThemeMode, ThemeSeason } from "@/lib/theme-provider"
import {
  Leaf,
  Sprout,
  Users,
  CalendarDays,
  Puzzle,
  FolderOpen,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  Heart,
  ChevronRight,
  Info,
  Search,
  ChevronDown,
  Sun,
  Moon,
  Monitor,
  Palette,
  Check,
} from "lucide-react"

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
}

const PRESET_PATHS = [
  {
    name: "Steam (默认位置)",
    path: "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Stardew Valley",
    platform: "windows",
  },
  {
    name: "Steam (次要盘符)",
    path: "D:\\SteamLibrary\\steamapps\\common\\Stardew Valley",
    platform: "windows",
  },
  {
    name: "GOG Galaxy (默认位置)",
    path: "C:\\GOG Games\\Stardew Valley",
    platform: "windows",
  },
  {
    name: "macOS Steam (默认位置)",
    path: "~/Library/Application Support/Steam/steamapps/common/Stardew Valley",
    platform: "macos",
  },
]

export function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)
  const { themeMode, themeSeason, setThemeMode, setThemeSeason } = useTheme()
  const [directory, setDirectory] = useState("")
  const [isValidPath, setIsValidPath] = useState<boolean | null>(null)
  const [showNotification, setShowNotification] = useState<string | null>(null)
  const [showPresets, setShowPresets] = useState(false)

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
          title: "选择星露谷物语 (Stardew Valley) 安装目录",
          defaultPath: directory || "C:\\Program Files (x86)\\Steam\\steamapps\\common",
        })

        if (selected) {
          const path = Array.isArray(selected) ? selected[0] : selected
          setDirectory(path)
          triggerNotification("已成功选择目录！")
        }
      } catch (err) {
        console.error("Tauri dialog error:", err)
        triggerNotification("打开选择器失败，请手动粘贴路径")
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
      triggerNotification("（Web模式模拟）已填充模拟文件夹路径")
    }
  }

  const handleAutoDetect = async () => {
    const invoke = await getTauriInvoke()
    if (invoke) {
      try {
        triggerNotification("正在自动搜寻游戏目录...")
        const detectedPath = await invoke("auto_detect_game_dir") as string
        if (detectedPath) {
          setDirectory(detectedPath)
          triggerNotification("自动检测成功！已找到游戏安装目录。")
        } else {
          triggerNotification("未能在 Steam 库中找到安装 of 星露谷物语，请手动选择。")
        }
      } catch (err) {
        console.error("Tauri auto detect error:", err)
        triggerNotification("自动检测失败，请手动选择目录。")
      }
    } else {
      // Browser Mock behavior
      triggerNotification("（Web模式模拟）正在自动搜寻...")
      setTimeout(() => {
        const mockPath = "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Stardew Valley"
        setDirectory(mockPath)
        triggerNotification("自动检测成功！已填充 Steam 默认路径。")
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
      triggerNotification("请输入或选择一个文件夹路径")
      return
    }
    setStep(3)
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
          <div className="flex justify-between items-center mb-8 px-4">
            <div className="flex items-center gap-2">
              <span className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${step >= 1 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>1</span>
              <span className="text-xs font-medium">欢迎</span>
            </div>
            <div className={`h-[2px] flex-1 mx-2 transition-colors ${step >= 2 ? "bg-primary" : "bg-muted"}`}></div>
            <div className="flex items-center gap-2">
              <span className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${step >= 2 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>2</span>
              <span className="text-xs font-medium">选择目录</span>
            </div>
            <div className={`h-[2px] flex-1 mx-2 transition-colors ${step >= 3 ? "bg-primary" : "bg-muted"}`}></div>
            <div className="flex items-center gap-2">
              <span className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${step >= 3 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>3</span>
              <span className="text-xs font-medium">外观选择</span>
            </div>
            <div className={`h-[2px] flex-1 mx-2 transition-colors ${step >= 4 ? "bg-primary" : "bg-muted"}`}></div>
            <div className="flex items-center gap-2">
              <span className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${step >= 4 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>4</span>
              <span className="text-xs font-medium">开启旅程</span>
            </div>
          </div>

          {/* STEP 1: WELCOME */}
          {step === 1 && (
            <div className="space-y-6 text-center animate-fade-in">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-inner">
                <Leaf className="h-8 w-8 text-primary animate-pulse" />
              </div>
              <div className="space-y-2">
                <h1 className="text-2xl font-bold tracking-tight text-primary">
                  欢迎来到星露谷助手 !
                </h1>
                <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                  这是你的专属农场助手，能够为你管理游戏模组、提醒作物收获、打理村民关系以及追踪节日。
                </p>
              </div>

              {/* Feature Highlights Grid */}
              <div className="grid grid-cols-2 gap-4 text-left mt-6">
                <div className="p-4 rounded-xl border border-border bg-accent/20 hover:bg-accent/40 transition-colors flex gap-3">
                  <div className="mt-0.5 rounded-lg p-2 bg-primary/10 text-primary">
                    <Puzzle className="h-4 w-4" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold">模组管理</h4>
                    <p className="text-xs text-muted-foreground mt-0.5">一键扫描、启用/禁用、热升级 SMAPI 模组。</p>
                  </div>
                </div>

                <div className="p-4 rounded-xl border border-border bg-accent/20 hover:bg-accent/40 transition-colors flex gap-3">
                  <div className="mt-0.5 rounded-lg p-2 bg-primary/10 text-primary">
                    <Sprout className="h-4 w-4" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold">作物管理</h4>
                    <p className="text-xs text-muted-foreground mt-0.5">记录当前种植，计算成熟时间与提醒。</p>
                  </div>
                </div>

                <div className="p-4 rounded-xl border border-border bg-accent/20 hover:bg-accent/40 transition-colors flex gap-3">
                  <div className="mt-0.5 rounded-lg p-2 bg-primary/10 text-primary">
                    <Users className="h-4 w-4" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold">村民关系</h4>
                    <p className="text-xs text-muted-foreground mt-0.5">记录村民喜好、追踪生日与送礼进度。</p>
                  </div>
                </div>

                <div className="p-4 rounded-xl border border-border bg-accent/20 hover:bg-accent/40 transition-colors flex gap-3">
                  <div className="mt-0.5 rounded-lg p-2 bg-primary/10 text-primary">
                    <CalendarDays className="h-4 w-4" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold">日程提醒</h4>
                    <p className="text-xs text-muted-foreground mt-0.5">完美对接游戏日历，重要事件提前知晓。</p>
                  </div>
                </div>
              </div>

              <div className="pt-4 flex justify-end">
                <Button onClick={() => setStep(2)} className="w-full sm:w-auto px-6 py-5 rounded-xl flex items-center justify-center gap-2 group font-semibold">
                  开始配置
                  <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </Button>
              </div>
            </div>
          )}

          {/* STEP 2: CHOOSE DIRECTORY */}
          {step === 2 && (
            <div className="space-y-6 animate-fade-in">
              <div className="space-y-2 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500 mb-2">
                  <FolderOpen className="h-6 w-6" />
                </div>
                <h2 className="text-xl font-bold tracking-tight">定位游戏目录</h2>
                <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                  我们需要定位您的《星露谷物语》安装目录，以读取您的模组文件和进行数据交互。
                </p>
              </div>

              {/* Input Group */}
              <div className="space-y-3 mt-4">
                <label className="text-xs font-semibold text-muted-foreground tracking-wider uppercase">安装目录路径</label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      placeholder="例如: C:\Program Files (x86)\Steam\steamapps\common\Stardew Valley"
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
                    onClick={handleAutoDetect}
                    variant="default"
                    className="rounded-xl px-4 flex gap-2 font-medium bg-primary text-primary-foreground hover:bg-primary/95 shrink-0"
                  >
                    <Search className="h-4 w-4" />
                    <span>自动检测</span>
                  </Button>
                  <Button
                    onClick={handleBrowse}
                    variant="secondary"
                    className="rounded-xl px-4 hover:bg-secondary/80 flex gap-2 font-medium shrink-0"
                  >
                    <FolderOpen className="h-4 w-4" />
                    <span>浏览</span>
                  </Button>
                </div>

                {/* Validation Feedback */}
                {isValidPath === false && (
                  <p className="text-xs text-amber-500 flex items-center gap-1.5 font-medium px-1">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    <span>该路径看起来不像标准的星露谷物语安装文件夹。</span>
                  </p>
                )}
                {isValidPath === true && (
                  <p className="text-xs text-emerald-500 flex items-center gap-1.5 font-medium px-1">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    <span>已检测到星露谷物语路径标识！</span>
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
                    <span>查看快捷预设路径 (可选安装位置)</span>
                  </h4>
                  <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${showPresets ? "rotate-180" : ""}`} />
                </button>
                {showPresets && (
                  <div className="px-4 pb-4 border-t border-border/50 pt-3 grid grid-cols-1 gap-2">
                    {PRESET_PATHS.map((preset) => (
                      <button
                        key={preset.name}
                        onClick={() => setDirectory(preset.path)}
                        className="text-left text-xs p-2 rounded-lg border border-border/50 bg-background/50 hover:bg-primary/5 hover:border-primary/30 transition-all font-mono truncate text-muted-foreground hover:text-foreground flex justify-between items-center group w-full"
                      >
                        <span className="truncate mr-2 font-sans font-medium">{preset.name}</span>
                        <span className="truncate text-[10px] text-muted-foreground opacity-60 group-hover:opacity-100">{preset.path}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Navigation Action Buttons */}
              <div className="pt-4 flex justify-between gap-4">
                <Button variant="ghost" onClick={() => setStep(1)} className="px-5 rounded-xl font-medium">
                  返回
                </Button>
                <Button onClick={handleConfirm} disabled={!directory.trim()} className="px-6 py-5 rounded-xl flex gap-2 font-semibold">
                  下一步
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* STEP 3: APPEARANCE SELECTION */}
          {step === 3 && (
            <div className="space-y-6 animate-fade-in">
              <div className="space-y-2 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary mb-2">
                  <Palette className="h-6 w-6 animate-pulse" />
                </div>
                <h2 className="text-xl font-bold tracking-tight">个性外观选择</h2>
                <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                  选择您喜欢的主题模式与星露谷季节配色，随时可以去设置中调整。
                </p>
              </div>

              {/* Theme Mode */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">主题模式</h4>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { value: "light" as ThemeMode, label: "浅色", icon: Sun },
                    { value: "dark" as ThemeMode, label: "深色", icon: Moon },
                    { value: "system" as ThemeMode, label: "跟随系统", icon: Monitor },
                  ].map((item) => {
                    const Icon = item.icon
                    const isActive = themeMode === item.value
                    return (
                      <Button
                        key={item.value}
                        variant={isActive ? "default" : "outline"}
                        onClick={() => setThemeMode(item.value)}
                        className={cn(
                          "flex items-center justify-center gap-2 py-3 h-auto transition-all duration-200 cursor-pointer rounded-xl border border-border/80",
                          isActive ? "shadow-md scale-[1.02] font-semibold border-primary" : "hover:bg-accent/40"
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="text-xs">{item.label}</span>
                      </Button>
                    )
                  })}
                </div>
              </div>

              {/* Season Themes */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">季节主题色</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {[
                    {
                      value: "default" as ThemeSeason,
                      label: "经典绿 (Classic Green)",
                      desc: "星露谷的经典底色，自然生机盎然",
                      gradient: "from-emerald-500/90 to-green-600/90",
                      color: "bg-emerald-500",
                    },
                    {
                      value: "spring" as ThemeSeason,
                      label: "春季粉 (Spring Sakura)",
                      desc: "粉色樱花瓣漫天飞舞，浪漫温柔",
                      gradient: "from-pink-400/90 to-rose-500/90",
                      color: "bg-pink-400",
                    },
                    {
                      value: "summer" as ThemeSeason,
                      label: "夏季黄 (Summer Gold)",
                      desc: "金色向日葵傲然绽放，热情洋溢",
                      gradient: "from-amber-400/90 to-yellow-500/90",
                      color: "bg-amber-400",
                    },
                    {
                      value: "fall" as ThemeSeason,
                      label: "秋季橙 (Fall Maple)",
                      desc: "红橙枫叶挂满枝头，丰收的喜悦",
                      gradient: "from-orange-500/90 to-amber-600/90",
                      color: "bg-orange-500",
                    },
                    {
                      value: "winter" as ThemeSeason,
                      label: "冬季蓝 (Winter Frost)",
                      desc: "冰雪覆盖的幽静寒蓝，静谧纯洁",
                      gradient: "from-sky-400/90 to-blue-500/90",
                      color: "bg-sky-400",
                    },
                  ].map((item) => {
                    const isSelected = themeSeason === item.value
                    return (
                      <button
                        type="button"
                        key={item.value}
                        onClick={() => setThemeSeason(item.value)}
                        className={cn(
                          "group relative flex flex-col justify-between text-left p-3 rounded-xl border transition-all duration-300 cursor-pointer overflow-hidden bg-card text-card-foreground",
                          isSelected 
                            ? "border-primary shadow-md ring-2 ring-primary/20 scale-[1.01]" 
                            : "border-border/60 hover:border-border-foreground/45 hover:shadow-md hover:scale-[1.005]"
                        )}
                      >
                        {/* Left color bar decorator */}
                        <div className={cn("absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b", item.gradient)} />
                        
                        <div className="pl-2 space-y-0.5 flex-1 pr-6">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-xs leading-tight text-foreground group-hover:text-primary transition-colors">
                              {item.label}
                            </span>
                            <span className={cn("h-1.5 w-1.5 rounded-full", item.color)} />
                          </div>
                          <p className="text-[10px] text-muted-foreground leading-normal pr-4">
                            {item.desc}
                          </p>
                        </div>

                        {/* Check icon indicator */}
                        {isSelected && (
                          <div className="absolute right-2.5 top-2.5 h-4 w-4 rounded-full bg-primary flex items-center justify-center text-primary-foreground animate-in zoom-in-75 duration-200">
                            <Check className="h-2.5 w-2.5 stroke-[3]" />
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Navigation Action Buttons */}
              <div className="pt-2 flex justify-between gap-4">
                <Button variant="ghost" onClick={() => setStep(2)} className="px-5 rounded-xl font-medium">
                  返回
                </Button>
                <Button onClick={() => setStep(4)} className="px-6 py-5 rounded-xl flex gap-2 font-semibold">
                  下一步
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* STEP 4: CONGRATULATIONS */}
          {step === 4 && (
            <div className="space-y-6 text-center animate-fade-in">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-500 shadow-inner">
                <CheckCircle2 className="h-8 w-8 text-emerald-500 animate-bounce" />
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-bold tracking-tight text-primary">配置已完成！</h2>
                <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                  游戏安装目录与个性外观已配置完成。星露谷助手已经为您准备就绪。
                </p>
              </div>

              {/* Summary card */}
              <div className="bg-primary/5 p-4 rounded-xl border border-primary/10 text-left max-w-md mx-auto space-y-2">
                <div className="flex justify-between items-center text-xs border-b border-primary/10 pb-2">
                  <span className="text-muted-foreground font-medium">已连接游戏目录:</span>
                  <span className="font-mono text-foreground font-bold truncate max-w-[200px]" title={directory}>{directory}</span>
                </div>
                <div className="flex justify-between items-center text-xs border-b border-primary/10 pb-2 pt-1">
                  <span className="text-muted-foreground font-medium">主题模式:</span>
                  <span className="font-semibold text-foreground">
                    {themeMode === "light" && "浅色模式"}
                    {themeMode === "dark" && "深色模式"}
                    {themeMode === "system" && "跟随系统"}
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs border-b border-primary/10 pb-2 pt-1">
                  <span className="text-muted-foreground font-medium">季节主题色:</span>
                  <span className="font-semibold text-foreground">
                    {themeSeason === "default" && "经典绿"}
                    {themeSeason === "spring" && "春季粉"}
                    {themeSeason === "summer" && "夏季黄"}
                    {themeSeason === "fall" && "秋季橙"}
                    {themeSeason === "winter" && "冬季蓝"}
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs pt-1">
                  <span className="text-muted-foreground font-medium">已启用功能:</span>
                  <span className="text-emerald-500 font-semibold flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" /> 模组扫描 · 存档读取 · 日历通知
                  </span>
                </div>
              </div>

              <div className="pt-4 flex justify-between gap-4">
                <Button variant="ghost" onClick={() => setStep(3)} className="px-5 rounded-xl font-medium">
                  返回
                </Button>
                <Button onClick={() => onComplete(directory)} className="flex-1 py-6 rounded-xl text-md font-bold flex gap-2 shadow-lg hover:shadow-xl transition-all justify-center items-center">
                  进入助手
                  <Heart className="h-5 w-5 fill-primary-foreground animate-pulse" />
                </Button>
              </div>
            </div>
          )}

        </CardContent>
      </Card>
    </div>
  )
}
