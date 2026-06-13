import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { useTheme } from "@/lib/theme-provider"
import { useNexus } from "@/lib/nexus-provider"
import {
  Bell,
  Database,
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

import { SaveInfoCard, SaveDetail } from "@/components/settings/SaveInfoCard"
import { GamePathCard } from "@/components/settings/GamePathCard"
import { NexusAccountCard } from "@/components/settings/NexusAccountCard"
import { AppearanceCard } from "@/components/settings/AppearanceCard"
import { AboutCard } from "@/components/settings/AboutCard"

const MOCK_SAVE_DETAIL: SaveDetail = {
  summary: {
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
  },
  weatherToday: "Sun",
  weatherTomorrow: "Rain",
  museumPiecesCount: 62,
  friendships: [],
  farmerAppearance: null,
  farmerAvatar: null,
  farmerAvatarError: null,
}

const SEASONS = ["春季", "夏季", "秋季", "冬季"]

export function Settings({
  selectedSaveId,
  onRestartOnboarding,
}: {
  selectedSaveId: string
  onRestartOnboarding?: () => void
}) {
  const { themeMode, themeSeason, setThemeMode, setThemeSeason } = useTheme()
  const {
    nexusLoggedIn,
    nexusUsername,
    nexusChecking,
    nexusLoggingIn,
    nexusApiKey,
    nexusApiKeyLoading,
    nexusApiKeyCopied,
    onLogin,
    onLogout,
    onCopyApiKey,
    onRefreshApiKey,
  } = useNexus()

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
            const d: SaveDetail = await invoke("get_save_detail", {
              id: selectedSaveId,
              gameDir: gameDir.trim() || undefined,
              includeAvatar: true,
            })
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
  }, [selectedSaveId, gameDir])

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
          自定义你的超级星露谷体验
        </p>
      </div>

      <div className="max-w-2xl space-y-6">
        <SaveInfoCard
          loading={loading}
          detail={detail}
          seasons={SEASONS}
        />

        <GamePathCard
          gameDir={gameDir}
          isValidPath={isValidPath}
          onAutoDetect={handleAutoDetect}
          onBrowse={handleBrowse}
          onChangeDir={handleSaveDir}
        />

        <NexusAccountCard
          nexusChecking={nexusChecking}
          nexusLoggedIn={nexusLoggedIn}
          nexusUsername={nexusUsername}
          nexusLoggingIn={nexusLoggingIn}
          nexusApiKey={nexusApiKey}
          nexusApiKeyLoading={nexusApiKeyLoading}
          nexusApiKeyCopied={nexusApiKeyCopied}
          onLogin={onLogin}
          onLogout={onLogout}
          onCopyApiKey={onCopyApiKey}
          onRefreshApiKey={onRefreshApiKey}
        />

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

        <AppearanceCard
          themeMode={themeMode}
          themeSeason={themeSeason}
          setThemeMode={setThemeMode}
          setThemeSeason={setThemeSeason}
        />

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
                <p className="text-sm font-medium">重新新手引导</p>
                <p className="text-xs text-muted-foreground">重新配置游戏路径与首选项</p>
              </div>
              <Button variant="outline" size="sm" onClick={onRestartOnboarding}>重新开始</Button>
            </div>
            <Separator />
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

        <AboutCard />
      </div>
    </div>
  )
}
