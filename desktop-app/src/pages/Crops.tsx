import { useState, useEffect, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { RefreshCw } from "lucide-react"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { CropEncyclopedia } from "./crops/CropEncyclopedia"
import { CropProfitCalculator } from "./crops/CropProfitCalculator"
import { PlantedCropsDashboard } from "./crops/PlantedCropsDashboard"
import {
  Crop,
  CropLookup,
  PlantedCrop,
  CropGameData,
  readCache,
  writeCache,
  getPlantedCropsCacheKey,
} from "./crops/types"

interface CropsProps {
  selectedSaveId: string
}

function applyCropGameData(
  data: CropGameData,
  setEncyclopediaCrops: (value: Crop[]) => void,
  setCropLookup: (value: Record<string, CropLookup>) => void,
  setSeasons: (value: string[]) => void,
  setDataSource: (value: string) => void,
  setGeneratedAt: (value: string | null) => void,
) {
  setEncyclopediaCrops(data.encyclopedia)
  setCropLookup(data.lookup)
  setSeasons(data.seasons || [])
  setDataSource(data.dataSource || "xnb")
  setGeneratedAt(data.generatedAt || null)
}

export function Crops({ selectedSaveId }: CropsProps) {
  const { t, i18n } = useTranslation()
  const [plantedCrops, setPlantedCrops] = useState<PlantedCrop[]>([])
  const [loadingCrops, setLoadingCrops] = useState(true)
  const [cropLookup, setCropLookup] = useState<Record<string, CropLookup>>({})
  const [encyclopediaCrops, setEncyclopediaCrops] = useState<Crop[]>([])
  const [seasons, setSeasons] = useState<string[]>([])
  const [loadingGameData, setLoadingGameData] = useState(false)
  const [gameDataError, setGameDataError] = useState<string | null>(null)
  const [dataSource, setDataSource] = useState<string>("xnb")
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const activeLang = i18n.resolvedLanguage || i18n.language || "zh"

  const handleRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1)
  }, [])

  useEffect(() => {
    let canceled = false

    async function loadCropGameData() {
      const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__
      const gameDir = localStorage.getItem("stardewGameDirectory") || ""

      if (!isTauri) {
        if (!canceled) {
          setGameDataError(t("crops.notTauri", { defaultValue: "当前环境不是 Tauri，无法直接读取游戏目录。" }))
        }
        return
      }

      if (!canceled) {
        setLoadingGameData(true)
        setGameDataError(null)
      }

      try {
        const { invoke } = await import("@tauri-apps/api/core")
        const data = (await invoke("get_crop_game_data", {
          gameDir: gameDir.trim() || undefined,
          lang: activeLang,
        })) as CropGameData

        if (!canceled) {
          applyCropGameData(
            data,
            setEncyclopediaCrops,
            setCropLookup,
            setSeasons,
            setDataSource,
            setGeneratedAt,
          )
          setGameDataError(null)
        }
      } catch (err) {
        console.error("Error loading crop game data:", err)
        if (!canceled) {
          setGameDataError(String(err))
          setEncyclopediaCrops([])
          setCropLookup({})
          setSeasons([])
        }
      } finally {
        if (!canceled) {
          setLoadingGameData(false)
        }
      }
    }

    loadCropGameData()

    return () => {
      canceled = true
    }
  }, [activeLang, refreshKey])

  // Fetch real crops
  useEffect(() => {
    let canceled = false

    async function loadCrops() {
      if (!selectedSaveId) {
        if (!canceled) {
          setPlantedCrops([])
          setLoadingCrops(false)
        }
        return
      }

      const cacheKey = getPlantedCropsCacheKey(selectedSaveId)
      const cached = readCache<PlantedCrop[]>(cacheKey)

      if (cached && !canceled) {
        setPlantedCrops(cached.data)
        setLoadingCrops(false)
      } else if (!canceled) {
        setLoadingCrops(true)
      }

      const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__
      if (isTauri) {
        try {
          const { invoke } = await import("@tauri-apps/api/core")
          const crops: PlantedCrop[] = await invoke("get_planted_crops", { id: selectedSaveId })
          if (!canceled) {
            setPlantedCrops(crops)
          }
          writeCache(cacheKey, crops)
        } catch (err) {
          console.error("Error loading planted crops:", err)
          if (!cached && !canceled) {
            setPlantedCrops([])
          }
        } finally {
          if (!canceled) {
            setLoadingCrops(false)
          }
        }
      } else {
        if (!canceled) {
          setLoadingCrops(false)
        }
      }
    }
    loadCrops()

    return () => {
      canceled = true
    }
  }, [selectedSaveId])

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-3xl font-bold tracking-tight">{t("crops.title")}</h2>
        <p className="text-muted-foreground mt-1">
          {t("crops.description")}
        </p>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="my-farm" className="space-y-4">
        <TabsList>
          <TabsTrigger value="my-farm">{t("crops.tabs.myFarm")}</TabsTrigger>
          <TabsTrigger value="all">{t("crops.tabs.encyclopedia")}</TabsTrigger>
          <TabsTrigger value="profit">{t("crops.tabs.profitCalculator")}</TabsTrigger>
        </TabsList>

        {/* 数据来源提示 */}
        <div className="flex flex-col gap-2 py-1 w-full text-xs text-muted-foreground">
          {dataSource === "export" ? (
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded bg-blue-500/10 px-1.5 py-0.5 text-blue-500">
                ✓ {t("dataSource.export", { defaultValue: "从游戏导出数据加载" })}
                {generatedAt && (
                  <span className="text-muted-foreground ml-1">
                    · {new Date(generatedAt).toLocaleString()}
                  </span>
                )}
              </span>
              <button
                onClick={handleRefresh}
                disabled={loadingGameData}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50"
                title={t("dataSource.refresh", { defaultValue: "刷新数据" })}
              >
                <RefreshCw className={`h-3 w-3 ${loadingGameData ? "animate-spin" : ""}`} />
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2 p-3 rounded-lg border border-amber-200/50 bg-amber-500/5 text-amber-800 dark:border-amber-800/30 dark:text-amber-300 w-full">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-2 text-xs flex-wrap">
                  <span className="font-semibold">⚙ {t("dataSource.xnbWarningTitle", { defaultValue: "当前正从游戏原始文件解析数据" })}</span>
                  <button
                    onClick={handleRefresh}
                    disabled={loadingGameData}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-amber-500/20 hover:text-amber-900 dark:hover:text-amber-100 transition-colors disabled:opacity-50"
                    title={t("dataSource.refresh", { defaultValue: "刷新数据" })}
                  >
                    <RefreshCw className={`h-3 w-3 ${loadingGameData ? "animate-spin" : ""}`} />
                  </button>
                  <span className="text-muted-foreground hidden sm:inline">·</span>
                  <span className="text-muted-foreground">{t("dataSource.xnbWarningDesc", { defaultValue: "由于未检测到游戏运行时的数据，展示的价格和周期可能无法适配您的模组修改（如微调售价和周期）。用助手启动游戏并加载一次存档即可自动同步。" })}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <TabsContent value="my-farm" className="space-y-6">
          <PlantedCropsDashboard
            selectedSaveId={selectedSaveId}
            loadingCrops={loadingCrops}
            plantedCrops={plantedCrops}
            cropLookup={cropLookup}
          />
        </TabsContent>

        <TabsContent value="all" className="space-y-4">
          <CropEncyclopedia
            encyclopediaCrops={encyclopediaCrops}
            seasons={seasons}
            loadingGameData={loadingGameData}
            gameDataError={gameDataError}
          />
        </TabsContent>

        <TabsContent value="profit">
          <CropProfitCalculator encyclopediaCrops={encyclopediaCrops} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
