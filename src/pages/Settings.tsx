import { useState, useEffect } from "react"
import { cn } from "@/lib/utils"
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

interface SaveSummary {
  id: string
  playerName: string
  farmName: string
  money: number
  totalMoneyEarned: number
  dayOfMonth: number
  season: number // 0: Spring, 1: Summer, 2: Fall, 3: Winter
  year: number
  farmingLevel: number
  miningLevel: number
  combatLevel: number
  foragingLevel: number
  fishingLevel: number
  deepestMineLevel: number
  millisecondsPlayed: number
  lastSaveTime: number
}

interface FriendshipInfo {
  npcName: string
  points: number
}

interface SaveDetail {
  summary: SaveSummary
  weatherToday: string
  weatherTomorrow: string
  museumPiecesCount: number
  friendships: FriendshipInfo[]
}

const MOCK_SAVE_SUMMARY: SaveSummary = {
  id: "MockCharacter_123456789",
  playerName: "农夫阿星",
  farmName: "桃源",
  money: 125840,
  totalMoneyEarned: 245000,
  dayOfMonth: 15,
  season: 0, // Spring
  year: 2,
  farmingLevel: 10,
  miningLevel: 8,
  combatLevel: 7,
  foragingLevel: 8,
  fishingLevel: 6,
  deepestMineLevel: 120,
  millisecondsPlayed: 45 * 3600 * 1000,
  lastSaveTime: Date.now() / 1000,
}

const MOCK_SAVE_DETAIL: SaveDetail = {
  summary: MOCK_SAVE_SUMMARY,
  weatherToday: "Sun",
  weatherTomorrow: "Rain",
  museumPiecesCount: 62,
  friendships: []
}

const SEASONS = ["春季", "夏季", "秋季", "冬季"]

export function Settings({ selectedSaveId }: { selectedSaveId: string }) {
  const [gameDir, setGameDir] = useState(() => {
    return localStorage.getItem("stardewGameDirectory") || ""
  })
  const [isValidPath, setIsValidPath] = useState<boolean | null>(null)

  const [detail, setDetail] = useState<SaveDetail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchDetail() {
      if (!selectedSaveId) return
      setLoading(true)
      const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
      const isMock = selectedSaveId.startsWith("MockCharacter");
      
      if (isTauri && !isMock) {
        try {
          const invoke = await getTauriInvoke()
          if (invoke) {
            const d: SaveDetail = await invoke("get_save_detail", { id: selectedSaveId })
            setDetail(d)
          } else {
            setDetail(MOCK_SAVE_DETAIL)
          }
        } catch (err) {
          console.error("Error loading save detail in Settings:", err)
          setDetail(MOCK_SAVE_DETAIL)
        } finally {
          setLoading(false)
        }
      } else {
        setDetail(MOCK_SAVE_DETAIL)
        setLoading(false)
      }
    }
    fetchDetail()
  }, [selectedSaveId])

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
    const dialog = await getTauriDialog()
    if (dialog) {
      try {
        const selected = await dialog({
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
    const invoke = await getTauriInvoke()
    if (invoke) {
      try {
        const detectedPath = await invoke("auto_detect_game_dir") as string
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
        {/* Active Save Profile Summary Card */}
        <Card className="overflow-hidden border border-border/80">
          <CardHeader className="bg-gradient-to-r from-primary/10 via-transparent to-transparent pb-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20 shrink-0">
                <User className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-lg font-bold">当前存档信息</CardTitle>
                <CardDescription>
                  自动从游戏存档文件中同步
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6 pt-2">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-6 space-y-2">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
                <p className="text-xs text-muted-foreground">正在同步农场存档数据...</p>
              </div>
            ) : detail ? (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                  <div className="border p-3 rounded-lg bg-accent/25 space-y-1">
                    <p className="text-muted-foreground font-medium">农场主姓名</p>
                    <p className="font-bold text-sm text-foreground truncate">{detail.summary.playerName}</p>
                  </div>
                  <div className="border p-3 rounded-lg bg-accent/25 space-y-1">
                    <p className="text-muted-foreground font-medium">农场名称</p>
                    <p className="font-bold text-sm text-foreground truncate">{detail.summary.farmName}农场</p>
                  </div>
                  <div className="border p-3 rounded-lg bg-accent/25 space-y-1">
                    <p className="text-muted-foreground font-medium">游戏日期</p>
                    <p className="font-bold text-sm text-foreground truncate">
                      {SEASONS[detail.summary.season] || "春季"} {detail.summary.dayOfMonth}日 (第{detail.summary.year}年)
                    </p>
                  </div>
                  <div className="border p-3 rounded-lg bg-accent/25 space-y-1">
                    <p className="text-muted-foreground font-medium">持有金币</p>
                    <p className="font-bold text-sm text-yellow-500 truncate">{detail.summary.money.toLocaleString()}g</p>
                  </div>
                </div>

                <div className="space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    技能等级 (Skills)
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {[
                      { name: "耕种 (Farming)", level: detail.summary.farmingLevel, color: "bg-green-500" },
                      { name: "采矿 (Mining)", level: detail.summary.miningLevel, color: "bg-blue-500" },
                      { name: "采集 (Foraging)", level: detail.summary.foragingLevel, color: "bg-emerald-500" },
                      { name: "钓鱼 (Fishing)", level: detail.summary.fishingLevel, color: "bg-cyan-500" },
                      { name: "战斗 (Combat)", level: detail.summary.combatLevel, color: "bg-red-500" },
                    ].map((skill) => (
                      <div key={skill.name} className="space-y-1 text-xs border p-2.5 rounded-lg bg-accent/10">
                        <div className="flex justify-between items-center font-medium">
                          <span>{skill.name}</span>
                          <span className="font-bold">Lv.{skill.level}</span>
                        </div>
                        <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                          <div
                            className={cn("h-full rounded-full", skill.color)}
                            style={{ width: `${(skill.level / 10) * 100}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <p className="text-xs text-muted-foreground py-4 text-center">暂未选定存档文件</p>
            )}
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
