import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Zap,
  Heart,
  Activity,
  Clock,
  Droplets,
  Sprout,
  MapPin,
  Package,
  Coins,
  Users,
  Sword,
  Cloud,
  LoaderCircle,
  ShieldAlert,
  TriangleAlert,
  Wifi,
  WifiOff,
} from "lucide-react"

interface CheatResponse {
  success: boolean
  message: string
  speedEnabled: boolean
  freezeTimeEnabled: boolean
}

interface CheatLogEntry {
  id: number
  action: string
  message: string
  success: boolean
  timestamp: Date
}

const TELEPORT_LOCATIONS = [
  { value: "farm", label: "农场" },
  { value: "town", label: "城镇" },
  { value: "forest", label: "森林" },
  { value: "mountain", label: "山区" },
  { value: "mine", label: "矿井" },
  { value: "beach", label: "海滩" },
  { value: "desert", label: "沙漠" },
  { value: "island", label: "姜岛" },
]

const WEATHER_OPTIONS = [
  { value: "sunny", label: "晴天", icon: "☀️" },
  { value: "rain", label: "雨天", icon: "🌧️" },
  { value: "thunder", label: "雷暴", icon: "⛈️" },
  { value: "snow", label: "雪天", icon: "❄️" },
]

export function Cheats({
  onShowToast,
  warningAcknowledged,
  onAcknowledgeWarning,
  onCancel,
}: {
  onShowToast: (message: string, type: "success" | "info" | "warning") => void
  warningAcknowledged: boolean
  onAcknowledgeWarning: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(false)
  const [pipeConnected, setPipeConnected] = useState(false)
  const [gameRunning, setGameRunning] = useState(false)
  const [speedEnabled, setSpeedEnabled] = useState(false)
  const [freezeTimeEnabled, setFreezeTimeEnabled] = useState(false)
  const [logs, setLogs] = useState<CheatLogEntry[]>([])
  const [teleportLocation, setTeleportLocation] = useState("farm")
  const [itemId, setItemId] = useState("")
  const [itemCount, setItemCount] = useState("1")
  const [moneyAmount, setMoneyAmount] = useState("10000")
  const logIdRef = useRef(0)

  // 轮询管道连接状态
  useEffect(() => {
    if (!warningAcknowledged) return

    const checkStatus = async () => {
      try {
        const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__
        if (!isTauri) return
        const { invoke } = await import("@tauri-apps/api/core")
        const status = await invoke<{ pipeConnected: boolean; gameRunning: boolean }>("check_pipe_status")
        setPipeConnected(status.pipeConnected)
        setGameRunning(status.gameRunning)
      } catch {
        // ignore
      }
    }

    checkStatus()
    const interval = setInterval(checkStatus, 5000)
    return () => clearInterval(interval)
  }, [warningAcknowledged])

  const addLog = useCallback((action: string, message: string, success: boolean) => {
    logIdRef.current += 1
    setLogs((prev) => [
      { id: logIdRef.current, action, message, success, timestamp: new Date() },
      ...prev.slice(0, 49),
    ])
  }, [])

  const invokeCheat = useCallback(
    async (command: string, args?: Record<string, unknown>) => {
      const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__
      if (!isTauri) {
        onShowToast(t("cheats.toast.webModeError"), "warning")
        return
      }

      setLoading(true)
      try {
        const { invoke } = await import("@tauri-apps/api/core")
        const result = await invoke<CheatResponse>(command, args)
        addLog(command, result.message, result.success)
        if (result.success) {
          onShowToast(result.message, "success")
        } else {
          onShowToast(result.message, "warning")
        }
        // 更新开关状态
        setSpeedEnabled(result.speedEnabled)
        setFreezeTimeEnabled(result.freezeTimeEnabled)
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        addLog(command, errorMsg, false)
        onShowToast(errorMsg, "warning")
      } finally {
        setLoading(false)
      }
    },
    [addLog, onShowToast, t],
  )

  if (!warningAcknowledged) {
    return (
      <div className="p-8">
        <div className="mx-auto max-w-4xl space-y-6">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">{t("cheats.warningTitle")}</h2>
            <p className="text-muted-foreground mt-2">{t("cheats.warningDesc")}</p>
          </div>

          <Card className="border-amber-300 bg-amber-50/80 dark:border-amber-900/70 dark:bg-amber-950/30">
            <CardHeader>
              <CardTitle className="text-xl flex items-center gap-2 text-amber-900 dark:text-amber-100">
                <TriangleAlert className="h-5 w-5" />
                {t("cheats.warningCardTitle")}
              </CardTitle>
              <CardDescription className="text-amber-800/90 dark:text-amber-200/90">
                {t("cheats.warningCardDesc")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm leading-7 text-amber-950 dark:text-amber-50">
              <p>{t("cheats.warningP1")}</p>
              <p>{t("cheats.warningP2")}</p>
              <p>{t("cheats.warningP3")}</p>
              <p>{t("cheats.warningP4")}</p>
              <p>{t("cheats.warningP5")}</p>
              <p className="font-medium">{t("cheats.warningP6")}</p>
            </CardContent>
          </Card>

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={onCancel}>
              {t("cheats.backToDashboard")}
            </Button>
            <Button variant="destructive" onClick={onAcknowledgeWarning}>
              {t("cheats.acknowledgeAndContinue")}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <Zap className="h-8 w-8 text-amber-500" />
            {t("cheats.title")}
          </h2>
          <p className="text-muted-foreground mt-1">{t("cheats.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          {pipeConnected ? (
            <Badge variant="default" className="bg-green-600 hover:bg-green-600">
              <Wifi className="h-3 w-3 mr-1" />
              {t("cheats.connected")}
            </Badge>
          ) : (
            <Badge variant="secondary">
              <WifiOff className="h-3 w-3 mr-1" />
              {t("cheats.disconnected")}
            </Badge>
          )}
          {gameRunning && (
            <Badge variant="outline">{t("cheats.gameRunning")}</Badge>
          )}
        </div>
      </div>

      {/* Connection warning */}
      {!pipeConnected && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100">
          <div className="flex items-start gap-3">
            <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
            <p>{t("cheats.connectionWarning")}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="space-y-6">
          {/* Survival */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Heart className="h-5 w-5 text-red-500" />
                {t("cheats.survival.title")}
              </CardTitle>
              <CardDescription>{t("cheats.survival.desc")}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              <Button
                variant="outline"
                className="justify-start gap-2 h-12"
                onClick={() => invokeCheat("cheat_refill_energy")}
                disabled={loading || !pipeConnected}
              >
                <Activity className="h-4 w-4 text-green-500" />
                {t("cheats.survival.refillEnergy")}
              </Button>
              <Button
                variant="outline"
                className="justify-start gap-2 h-12"
                onClick={() => invokeCheat("cheat_refill_health")}
                disabled={loading || !pipeConnected}
              >
                <Heart className="h-4 w-4 text-red-500" />
                {t("cheats.survival.refillHealth")}
              </Button>
              <Button
                variant={speedEnabled ? "default" : "outline"}
                className="justify-start gap-2 h-12"
                onClick={() => invokeCheat("cheat_toggle_speed", { enabled: !speedEnabled })}
                disabled={loading || !pipeConnected}
              >
                <Zap className="h-4 w-4 text-yellow-500" />
                {speedEnabled ? t("cheats.survival.speedOn") : t("cheats.survival.speedOff")}
              </Button>
            </CardContent>
          </Card>

          {/* Time Control */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Clock className="h-5 w-5 text-blue-500" />
                {t("cheats.time.title")}
              </CardTitle>
              <CardDescription>{t("cheats.time.desc")}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant={freezeTimeEnabled ? "default" : "outline"}
                className="justify-start gap-2 h-12 w-full md:w-auto"
                onClick={() => invokeCheat("cheat_toggle_freeze_time", { enabled: !freezeTimeEnabled })}
                disabled={loading || !pipeConnected}
              >
                <Clock className="h-4 w-4 text-blue-500" />
                {freezeTimeEnabled ? t("cheats.time.freezeOn") : t("cheats.time.freezeOff")}
              </Button>
            </CardContent>
          </Card>

          {/* Farm */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Sprout className="h-5 w-5 text-green-500" />
                {t("cheats.farm.title")}
              </CardTitle>
              <CardDescription>{t("cheats.farm.desc")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <Button
                  variant="outline"
                  className="justify-start gap-2 h-12"
                  onClick={() => invokeCheat("cheat_water_crops")}
                  disabled={loading || !pipeConnected}
                >
                  <Droplets className="h-4 w-4 text-blue-400" />
                  {t("cheats.farm.waterCrops")}
                </Button>
                <Button
                  variant="outline"
                  className="justify-start gap-2 h-12"
                  onClick={() => invokeCheat("cheat_grow_crops")}
                  disabled={loading || !pipeConnected}
                >
                  <Sprout className="h-4 w-4 text-green-500" />
                  {t("cheats.farm.growCrops")}
                </Button>
              </div>
              <div className="flex gap-2">
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={teleportLocation}
                  onChange={(e) => setTeleportLocation(e.target.value)}
                >
                  {TELEPORT_LOCATIONS.map((loc) => (
                    <option key={loc.value} value={loc.value}>
                      {loc.label}
                    </option>
                  ))}
                </select>
                <Button
                  className="gap-2 shrink-0"
                  onClick={() => invokeCheat("cheat_teleport", { location: teleportLocation })}
                  disabled={loading || !pipeConnected}
                >
                  <MapPin className="h-4 w-4" />
                  {t("cheats.farm.teleport")}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Economy */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Coins className="h-5 w-5 text-yellow-500" />
                {t("cheats.economy.title")}
              </CardTitle>
              <CardDescription>{t("cheats.economy.desc")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input
                  type="number"
                  placeholder={t("cheats.economy.moneyPlaceholder")}
                  value={moneyAmount}
                  onChange={(e) => setMoneyAmount(e.target.value)}
                  className="flex-1"
                />
                <Button
                  className="gap-2 shrink-0"
                  onClick={() => invokeCheat("cheat_add_money", { amount: parseInt(moneyAmount) || 0 })}
                  disabled={loading || !pipeConnected}
                >
                  <Coins className="h-4 w-4" />
                  {t("cheats.economy.addMoney")}
                </Button>
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder={t("cheats.economy.itemPlaceholder")}
                  value={itemId}
                  onChange={(e) => setItemId(e.target.value)}
                  className="flex-1"
                />
                <Input
                  type="number"
                  placeholder={t("cheats.economy.countPlaceholder")}
                  value={itemCount}
                  onChange={(e) => setItemCount(e.target.value)}
                  className="w-24"
                />
                <Button
                  className="gap-2 shrink-0"
                  onClick={() => invokeCheat("cheat_add_item", { itemId, count: parseInt(itemCount) || 1 })}
                  disabled={loading || !pipeConnected || !itemId.trim()}
                >
                  <Package className="h-4 w-4" />
                  {t("cheats.economy.addItem")}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Social & Combat */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Users className="h-5 w-5 text-purple-500" />
                {t("cheats.social.title")}
              </CardTitle>
              <CardDescription>{t("cheats.social.desc")}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              <Button
                variant="outline"
                className="justify-start gap-2 h-12"
                onClick={() => invokeCheat("cheat_max_friendship")}
                disabled={loading || !pipeConnected}
              >
                <Users className="h-4 w-4 text-purple-500" />
                {t("cheats.social.maxFriendship")}
              </Button>
              <Button
                variant="outline"
                className="justify-start gap-2 h-12"
                onClick={() => invokeCheat("cheat_kill_monsters")}
                disabled={loading || !pipeConnected}
              >
                <Sword className="h-4 w-4 text-red-500" />
                {t("cheats.social.killMonsters")}
              </Button>
            </CardContent>
          </Card>

          {/* Weather */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Cloud className="h-5 w-5 text-sky-500" />
                {t("cheats.weather.title")}
              </CardTitle>
              <CardDescription>{t("cheats.weather.desc")}</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {WEATHER_OPTIONS.map((w) => (
                <Button
                  key={w.value}
                  variant="outline"
                  className="justify-start gap-2 h-12"
                  onClick={() => invokeCheat("cheat_set_weather", { weather: w.value })}
                  disabled={loading || !pipeConnected}
                >
                  <span className="text-lg">{w.icon}</span>
                  {w.label}
                </Button>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Log Panel */}
        <Card className="min-h-[640px]">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Zap className="h-5 w-5 text-amber-500" />
              {t("cheats.log.title")}
            </CardTitle>
            <CardDescription>{t("cheats.log.desc")}</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {loading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-3">
                <LoaderCircle className="h-4 w-4 animate-spin" />
                {t("cheats.log.executing")}
              </div>
            )}
            <ScrollArea className="h-[560px] pr-3">
              {logs.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">{t("cheats.log.empty")}</p>
              ) : (
                <div className="space-y-2">
                  {logs.map((log) => (
                    <div
                      key={log.id}
                      className={`rounded-lg border p-3 text-sm ${
                        log.success
                          ? "border-green-200 bg-green-50/50 dark:border-green-900/50 dark:bg-green-950/20"
                          : "border-red-200 bg-red-50/50 dark:border-red-900/50 dark:bg-red-950/20"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className={`font-medium ${log.success ? "text-green-700 dark:text-green-300" : "text-red-700 dark:text-red-300"}`}>
                          {log.message}
                        </p>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {log.timestamp.toLocaleTimeString()}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{log.action}</p>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
