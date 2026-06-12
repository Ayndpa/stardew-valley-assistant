import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import {
  User,
  Bell,
  Palette,
  Database,
  Info,
  FolderOpen,
  CheckCircle2,
  AlertTriangle,
  Search,
} from "lucide-react"

// Dynamic imports of Tauri plugins for browser compatibility
let openTauriDialog: any = null
let tauriInvoke: any = null

if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
  import("@tauri-apps/plugin-dialog").then((mod) => {
    openTauriDialog = mod.open
  }).catch((err) => {
    console.error("Failed to load Tauri Dialog plugin", err)
  })

  import("@tauri-apps/api/core").then((mod) => {
    tauriInvoke = mod.invoke
  }).catch((err) => {
    console.error("Failed to load Tauri core invoke plugin", err)
  })
}

export function Settings() {
  const [gameDir, setGameDir] = useState(() => {
    return localStorage.getItem("stardewGameDirectory") || ""
  })
  const [isValidPath, setIsValidPath] = useState<boolean | null>(null)

  useEffect(() => {
    if (!gameDir.trim()) {
      setIsValidPath(null)
      return
    }
    const pathLower = gameDir.toLowerCase()
    const isStardewFolder =
      pathLower.includes("stardew") ||
      pathLower.includes("星露谷") ||
      pathLower.includes("mods")
    setIsValidPath(isStardewFolder)
  }, [gameDir])

  const handleBrowse = async () => {
    if (openTauriDialog) {
      try {
        const selected = await openTauriDialog({
          directory: true,
          multiple: false,
          title: "选择星露谷物语 (Stardew Valley) 安装目录",
          defaultPath: gameDir || "C:\\Program Files (x86)\\Steam\\steamapps\\common",
        })
        if (selected) {
          const path = Array.isArray(selected) ? selected[0] : selected
          setGameDir(path)
          localStorage.setItem("stardewGameDirectory", path)
        }
      } catch (err) {
        console.error("Tauri dialog error:", err)
      }
    } else {
      // Fallback preview
      const mockPath = "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Stardew Valley"
      setGameDir(mockPath)
      localStorage.setItem("stardewGameDirectory", mockPath)
      alert("（Web 模式模拟）自动填充默认安装路径成功！")
    }
  }

  const handleAutoDetect = async () => {
    if (tauriInvoke) {
      try {
        const detectedPath = await tauriInvoke("auto_detect_game_dir")
        if (detectedPath) {
          setGameDir(detectedPath)
          localStorage.setItem("stardewGameDirectory", detectedPath)
          alert(`自动检测成功！已找到游戏目录：\n${detectedPath}`)
        } else {
          alert("未能在 Steam 库中找到安装的星露谷物语，请手动选择目录。")
        }
      } catch (err) {
        console.error("Tauri auto detect error:", err)
        alert("自动检测发生错误，请手动选择目录。")
      }
    } else {
      // Browser Mock behavior
      const mockPath = "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Stardew Valley"
      setGameDir(mockPath)
      localStorage.setItem("stardewGameDirectory", mockPath)
      alert("（Web 模式模拟）自动检测成功！已填充默认 Steam 路径。")
    }
  }

  const handleSaveDir = (val: string) => {
    setGameDir(val)
    localStorage.setItem("stardewGameDirectory", val)
  }

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-3xl font-bold tracking-tight">设置</h2>
        <p className="text-muted-foreground mt-1">
          自定义你的星露谷助手体验
        </p>
      </div>

      <div className="max-w-2xl space-y-6">
        {/* Profile Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <User className="h-5 w-5" />
              农场信息
            </CardTitle>
            <CardDescription>设置你的农场和角色信息</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">农场名称</label>
                <Input placeholder="输入农场名称" defaultValue="星露谷农场" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">农场主名称</label>
                <Input placeholder="输入你的名字" defaultValue="农夫" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">当前季节</label>
                <Input placeholder="春季" defaultValue="春季" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">当前天数</label>
                <Input type="number" placeholder="1" defaultValue="15" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Game Directory Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <FolderOpen className="h-5 w-5" />
              游戏目录配置
            </CardTitle>
            <CardDescription>配置星露谷物语安装文件夹，以读取游戏数据与模组</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">安装目录路径</label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    placeholder="输入或选择游戏目录"
                    value={gameDir}
                    onChange={(e) => handleSaveDir(e.target.value)}
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
                <Button variant="default" onClick={handleAutoDetect} className="flex gap-2 font-medium bg-primary text-primary-foreground hover:bg-primary/95 shrink-0">
                  <Search className="h-4 w-4" />
                  自动检测
                </Button>
                <Button variant="outline" onClick={handleBrowse} className="flex gap-2 font-medium shrink-0">
                  <FolderOpen className="h-4 w-4" />
                  浏览
                </Button>
              </div>
              {isValidPath === false && (
                <p className="text-xs text-amber-500 flex items-center gap-1 mt-1 font-medium">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  <span>路径格式可能不正确，标准路径通常包含 "Stardew Valley"</span>
                </p>
              )}
              {isValidPath === true && (
                <p className="text-xs text-emerald-500 flex items-center gap-1 mt-1 font-medium">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>已识别到合法的星露谷物语目录</span>
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Notification Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Bell className="h-5 w-5" />
              提醒设置
            </CardTitle>
            <CardDescription>配置节日和生日提醒</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-3 rounded-lg bg-accent/50">
              <div>
                <p className="text-sm font-medium">节日提前提醒</p>
                <p className="text-xs text-muted-foreground">在节日前一天提醒你</p>
              </div>
              <Button variant="outline" size="sm">开启</Button>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-accent/50">
              <div>
                <p className="text-sm font-medium">生日提醒</p>
                <p className="text-xs text-muted-foreground">在村民生日当天提醒送礼</p>
              </div>
              <Button variant="outline" size="sm">开启</Button>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-accent/50">
              <div>
                <p className="text-sm font-medium">作物成熟提醒</p>
                <p className="text-xs text-muted-foreground">当作物成熟时提醒你收获</p>
              </div>
              <Button variant="outline" size="sm">开启</Button>
            </div>
          </CardContent>
        </Card>

        {/* Theme Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Palette className="h-5 w-5" />
              外观设置
            </CardTitle>
            <CardDescription>自定义应用的外观</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">主题</label>
              <div className="flex gap-3">
                <Button variant="outline" size="sm" className="flex-1">浅色</Button>
                <Button variant="outline" size="sm" className="flex-1">深色</Button>
                <Button variant="default" size="sm" className="flex-1">跟随系统</Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Data Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Database className="h-5 w-5" />
              数据管理
            </CardTitle>
            <CardDescription>管理应用数据</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">导出数据</p>
                <p className="text-xs text-muted-foreground">导出你的所有数据为 JSON 文件</p>
              </div>
              <Button variant="outline" size="sm">导出</Button>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">导入数据</p>
                <p className="text-xs text-muted-foreground">从 JSON 文件导入数据</p>
              </div>
              <Button variant="outline" size="sm">导入</Button>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-destructive">重置数据</p>
                <p className="text-xs text-muted-foreground">清除所有本地数据</p>
              </div>
              <Button variant="destructive" size="sm">重置</Button>
            </div>
          </CardContent>
        </Card>

        {/* About */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Info className="h-5 w-5" />
              关于
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">应用版本</span>
              <span>0.1.0</span>
            </div>
            <Separator />
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">框架</span>
              <span>Tauri + React</span>
            </div>
            <Separator />
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">UI 框架</span>
              <span>shadcn/ui</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
