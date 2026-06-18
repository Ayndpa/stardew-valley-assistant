import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { useTheme } from "@/lib/theme-provider"
import { useNexus } from "@/lib/nexus-provider"
import { useTranslation } from "react-i18next"
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
import { LanguageCard } from "@/components/settings/LanguageCard"
import { AboutCard } from "@/components/settings/AboutCard"
import { FeaturesCard } from "@/components/settings/FeaturesCard"
import { LogCard } from "@/components/settings/LogCard"
import type { Page } from "@/App"

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
  museumPieces: [],
  friendships: [],
  farmerAppearance: null,
  farmerAvatar: null,
  farmerAvatarError: null,
}

export function Settings({
  selectedSaveId,
  onRestartOnboarding,
  enabledFeatures,
  onEnabledFeaturesChange,
  onUpdateFound,
}: {
  selectedSaveId: string
  onRestartOnboarding?: () => void
  enabledFeatures: Page[]
  onEnabledFeaturesChange: (features: Page[]) => void
  onUpdateFound?: (info: any) => void
}) {
  const { t } = useTranslation()
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
          title: t("settings.gamePath.dialogTitle"),
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
      alert(t("settings.gamePath.mockBrowseSuccess"))
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
          alert(t("settings.gamePath.autoDetectSuccess", { path: detectedPath }))
        } else {
          alert(t("settings.gamePath.autoDetectFail"))
        }
      } catch (err) {
        console.error("Tauri auto detect error:", err)
        alert(t("settings.gamePath.autoDetectError"))
      }
    } else {
      // Browser Mock behavior
      const mockPath = "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Stardew Valley"
      setGameDir(mockPath)
      localStorage.setItem("stardewGameDirectory", mockPath)
      alert(t("settings.gamePath.mockAutoDetectSuccess"))
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
        <h2 className="text-3xl font-bold tracking-tight">{t("settings.title")}</h2>
        <p className="text-muted-foreground mt-1">
          {t("settings.description")}
        </p>
      </div>

      <div className="space-y-6">
        <SaveInfoCard
          loading={loading}
          detail={detail}
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

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Bell className="h-5 w-5" />
              {t("settings.notifications.title")}
            </CardTitle>
            <CardDescription>{t("settings.notifications.description")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-3 rounded-lg bg-accent/50">
              <div>
                <p className="text-sm font-medium">{t("settings.notifications.festival")}</p>
                <p className="text-xs text-muted-foreground">{t("settings.notifications.festivalDesc")}</p>
              </div>
              <Button variant="outline" size="sm">{t("settings.notifications.enable")}</Button>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-accent/50">
              <div>
                <p className="text-sm font-medium">{t("settings.notifications.birthday")}</p>
                <p className="text-xs text-muted-foreground">{t("settings.notifications.birthdayDesc")}</p>
              </div>
              <Button variant="outline" size="sm">{t("settings.notifications.enable")}</Button>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-accent/50">
              <div>
                <p className="text-sm font-medium">{t("settings.notifications.crops")}</p>
                <p className="text-xs text-muted-foreground">{t("settings.notifications.cropsDesc")}</p>
              </div>
              <Button variant="outline" size="sm">{t("settings.notifications.enable")}</Button>
            </div>
          </CardContent>
        </Card>

        <AppearanceCard
          themeMode={themeMode}
          themeSeason={themeSeason}
          setThemeMode={setThemeMode}
          setThemeSeason={setThemeSeason}
        />

        <FeaturesCard
          enabledFeatures={enabledFeatures}
          onEnabledFeaturesChange={onEnabledFeaturesChange}
        />

        <LanguageCard />

        <LogCard />

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Database className="h-5 w-5" />
              {t("settings.data.title")}
            </CardTitle>
            <CardDescription>{t("settings.data.description")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{t("settings.data.onboarding")}</p>
                <p className="text-xs text-muted-foreground">{t("settings.data.onboardingDesc")}</p>
              </div>
              <Button variant="outline" size="sm" onClick={onRestartOnboarding}>{t("settings.data.restart")}</Button>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{t("settings.data.export")}</p>
                <p className="text-xs text-muted-foreground">{t("settings.data.exportDesc")}</p>
              </div>
              <Button variant="outline" size="sm">{t("settings.data.exportBtn")}</Button>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{t("settings.data.import")}</p>
                <p className="text-xs text-muted-foreground">{t("settings.data.importDesc")}</p>
              </div>
              <Button variant="outline" size="sm">{t("settings.data.importBtn")}</Button>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-destructive">{t("settings.data.reset")}</p>
                <p className="text-xs text-muted-foreground">{t("settings.data.resetDesc")}</p>
              </div>
              <Button variant="destructive" size="sm">{t("settings.data.resetBtn")}</Button>
            </div>
          </CardContent>
        </Card>

        <AboutCard onUpdateFound={onUpdateFound} />
      </div>
    </div>
  )
}
