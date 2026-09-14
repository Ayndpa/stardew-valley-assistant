import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { AlertCircle, Loader2, Mountain, RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"

import { chestItemLabel, type Goodie } from "@/lib/volcano/loot"
import {
  displayLuck,
  isMonsterFloor,
  isMushroomFloor,
  predictVolcano,
  renderFloorTiles,
  type VolcanoPrediction,
  type VolcanoSettings,
} from "@/lib/volcano/predictor"
import {
  VolcanoTile,
  hasVolcanoLayoutData,
  loadVolcanoLayoutData,
} from "@/lib/volcano/layout-store"

const TILE_COLORS: Record<number, string> = {
  [VolcanoTile.Floor]: "#e7e5e4",
  [VolcanoTile.Wall]: "#1c1917",
  [VolcanoTile.Lava]: "#ef4444",
  [VolcanoTile.Enter]: "#22c55e",
  [VolcanoTile.Exit]: "#f97316",
  [VolcanoTile.SetPiece]: "#facc15",
  [VolcanoTile.Switch]: "#a855f7",
  [VolcanoTile.Monster]: "#06b6d4",
}

const CANVAS_TILE = 8

const DEFAULT_SETTINGS: VolcanoSettings = {
  seed: 0,
  legacyRng: false,
  post164: true,
  hasCaldera: false,
  crackedGoldenCoconut: false,
  specialCharm: false,
  daysPlayed: 1,
  maxLuckLevel: 0,
}

export function VolcanoPredictor() {
  const { t } = useTranslation()

  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [settings, setSettings] = useState<VolcanoSettings>(DEFAULT_SETTINGS)
  const [selected, setSelected] = useState<{ level: number; layout: number } | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false

    // 与其它游戏数据页面保持一致：优先用设置里配置的目录。
    // 不传的话后端只能靠自动探测，而 Steam 把游戏装在第二个库、
    // 或主目录没有 steamapps 时会探测失败。
    const gameDir = localStorage.getItem("stardewGameDirectory") || ""

    setReady(false)
    setError(null)

    loadVolcanoLayoutData(gameDir.trim() || undefined)
      .then(() => {
        if (!cancelled) setReady(true)
      })
      .catch((err) => {
        if (!cancelled) setError(String(err))
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const prediction = useMemo<VolcanoPrediction | null>(() => {
    if (!ready || !hasVolcanoLayoutData()) return null
    try {
      return predictVolcano(settings)
    } catch (err) {
      setError(String(err))
      return null
    }
  }, [ready, settings])

  const update = <K extends keyof VolcanoSettings>(key: K, value: VolcanoSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
    setSelected(null)
  }

  return (
    <div className="flex h-full flex-col gap-4 p-6 overflow-auto">
      <div className="flex items-center gap-2">
        <Mountain className="h-5 w-5" />
        <h1 className="text-xl font-semibold">{t("volcano.title")}</h1>
        {ready && (
          <Badge variant="secondary" className="ml-auto">
            {t("volcano.dataFromGame")}
          </Badge>
        )}
      </div>

      {error && (
        <div className="flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="break-all">{error}</span>
          </div>
          <div className="flex items-center gap-2 pl-6">
            <span className="text-xs opacity-80">{t("volcano.gameDirHint")}</span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 shrink-0 gap-1.5"
              onClick={() => setReloadKey((key) => key + 1)}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {t("volcano.retry")}
            </Button>
          </div>
        </div>
      )}

      {!ready && !error && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("volcano.loadingData")}
        </div>
      )}

      {ready && (
        <>
          <SettingsPanel settings={settings} onChange={update} />

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
            <FloorList
              prediction={prediction}
              selected={selected}
              onSelect={setSelected}
            />
            <MapPanel settings={settings} selected={selected} />
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- 设置区

function SettingsPanel({
  settings,
  onChange,
}: {
  settings: VolcanoSettings
  onChange: <K extends keyof VolcanoSettings>(key: K, value: VolcanoSettings[K]) => void
}) {
  const { t } = useTranslation()

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <NumberField
          label={t("volcano.seed")}
          value={settings.seed}
          onChange={(v) => onChange("seed", v)}
        />
        <NumberField
          label={t("volcano.daysPlayed")}
          value={settings.daysPlayed}
          min={1}
          onChange={(v) => onChange("daysPlayed", Math.max(1, v))}
        />
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium">{t("volcano.maxLuckLevel")}</label>
          <div className="inline-flex overflow-hidden rounded-md border">
            {[0, 1, 2, 3].map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => onChange("maxLuckLevel", level)}
                className={`h-9 w-9 text-sm transition-colors ${
                  settings.maxLuckLevel === level
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-accent"
                }`}
              >
                {level}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onChange("daysPlayed", settings.daysPlayed + 1)}
          >
            <RefreshCw className="mr-1 h-3.5 w-3.5" />
            {t("volcano.nextDay")}
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Toggle
          label={t("volcano.post164")}
          checked={settings.post164}
          onChange={(v) => onChange("post164", v)}
        />
        <Toggle
          label={t("volcano.hasCaldera")}
          checked={settings.hasCaldera}
          onChange={(v) => onChange("hasCaldera", v)}
        />
        <Toggle
          label={t("volcano.crackedCoconut")}
          checked={settings.crackedGoldenCoconut}
          onChange={(v) => onChange("crackedGoldenCoconut", v)}
        />
        <Toggle
          label={t("volcano.specialCharm")}
          checked={settings.specialCharm}
          onChange={(v) => onChange("specialCharm", v)}
        />
        <Toggle
          label={t("volcano.legacyRng")}
          checked={settings.legacyRng}
          onChange={(v) => onChange("legacyRng", v)}
        />
      </div>
    </div>
  )
}

function NumberField({
  label,
  value,
  min,
  onChange,
}: {
  label: string
  value: number
  min?: number
  onChange: (value: number) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium">{label}</label>
      <Input
        type="number"
        value={value}
        min={min}
        onChange={(e) => {
          const next = Number(e.target.value)
          onChange(Number.isFinite(next) ? next : 0)
        }}
      />
    </div>
  )
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      {label}
    </label>
  )
}

// ---------------------------------------------------------------- 楼层列表

function FloorList({
  prediction,
  selected,
  onSelect,
}: {
  prediction: VolcanoPrediction | null
  selected: { level: number; layout: number } | null
  onSelect: (value: { level: number; layout: number } | null) => void
}) {
  const { t } = useTranslation()
  if (!prediction) return null

  return (
    <div className="space-y-2">
      {prediction.layouts.map((layouts, level) => {
        const loots = prediction.loots[level] ?? []
        return (
          <div key={level} className="rounded-lg border bg-card p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-16 shrink-0 text-sm font-medium">
                {t("volcano.floor", { level: level + 1 })}
              </span>
              {layouts.map((entry, i) => (
                <button
                  key={`${entry.value}-${i}`}
                  type="button"
                  onClick={() => onSelect({ level, layout: entry.value })}
                  className={`rounded border px-2 py-1 text-xs transition-colors ${
                    selected?.level === level && selected.layout === entry.value
                      ? "border-primary bg-primary/10"
                      : "hover:bg-accent"
                  }`}
                >
                  #{entry.value}
                  <span className="ml-1 text-muted-foreground">
                    {formatLuckRange(entry.minLuck, entry.maxLuck)}
                  </span>
                </button>
              ))}
              {isMushroomFloor(layouts[0]?.value ?? -1) && (
                <Badge variant="outline">{t("volcano.mushroomFloor")}</Badge>
              )}
              {isMonsterFloor(layouts[0]?.value ?? -1) && (
                <Badge variant="outline">{t("volcano.monsterFloor")}</Badge>
              )}
            </div>

            <div className="mt-2 flex flex-wrap gap-2">
              {loots.length === 0 && (
                <span className="text-xs text-muted-foreground">{t("volcano.noLoot")}</span>
              )}
              {loots.map((entry, i) => (
                <div
                  key={i}
                  className="flex flex-wrap items-center gap-1 rounded border bg-muted/40 px-2 py-1 text-xs"
                >
                  <span className="text-muted-foreground">
                    {formatLuckRange(entry.minLuck, entry.maxLuck)}
                  </span>
                  {entry.value.map((goodie, j) => (
                    <span key={j} className="font-medium">
                      {describeGoodie(goodie, t)}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function describeGoodie(goodie: Goodie, t: (key: string) => string): string {
  switch (goodie.type) {
    case "DragonTooth":
      return t("volcano.dragonTooth")
    case "CommonChest":
      return `${t("volcano.commonChest")}: ${chestItemLabel(goodie.item)}`
    case "RareChest":
      return `${t("volcano.rareChest")}: ${chestItemLabel(goodie.item)}`
    default:
      return chestItemLabel(
        (goodie as Extract<Goodie, { type: "ChanceChest" }>).common,
      )
  }
}

/** 展示用：内部 luckMult 换算回等效每日幸运，保留 4 位小数 */
function formatLuckRange(minLuck: number, maxLuck: number): string {
  const lo = displayLuck(minLuck)
  const hi = displayLuck(maxLuck)
  return `${lo.toFixed(4)}~${hi.toFixed(4)}`
}

// ---------------------------------------------------------------- 地图

function MapPanel({
  settings,
  selected,
}: {
  settings: VolcanoSettings
  selected: { level: number; layout: number } | null
}) {
  const { t } = useTranslation()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !selected) return
    const { tiles } = renderFloorTiles(settings, selected.level, selected.layout)
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    canvas.width = 64 * CANVAS_TILE
    canvas.height = 64 * CANVAS_TILE
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        ctx.fillStyle = TILE_COLORS[tiles[y * 64 + x]] ?? "#e7e5e4"
        ctx.fillRect(x * CANVAS_TILE, y * CANVAS_TILE, CANVAS_TILE, CANVAS_TILE)
      }
    }
  }, [selected, settings])

  return (
    <div className="shrink-0 rounded-lg border bg-card p-3">
      <div className="mb-2 text-sm font-medium">{t("volcano.map")}</div>
      {selected ? (
        <>
          <canvas
            ref={canvasRef}
            style={{ width: 64 * CANVAS_TILE, height: 64 * CANVAS_TILE }}
            className="rounded border image-render-pixelated"
          />
          <div className="mt-2 text-xs text-muted-foreground">
            {t("volcano.floor", { level: selected.level + 1 })} · #{selected.layout}
          </div>
        </>
      ) : (
        <div className="flex h-32 w-64 items-center justify-center text-xs text-muted-foreground">
          {t("volcano.selectLayout")}
        </div>
      )}
    </div>
  )
}
