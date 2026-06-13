import { useState, useEffect } from "react"
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
  getCropGameDataCacheKey,
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
) {
  setEncyclopediaCrops(data.encyclopedia)
  setCropLookup(data.lookup)
  setSeasons(data.seasons || [])
}

export function Crops({ selectedSaveId }: CropsProps) {
  const [plantedCrops, setPlantedCrops] = useState<PlantedCrop[]>([])
  const [loadingCrops, setLoadingCrops] = useState(true)
  const [cropLookup, setCropLookup] = useState<Record<string, CropLookup>>({})
  const [encyclopediaCrops, setEncyclopediaCrops] = useState<Crop[]>([])
  const [seasons, setSeasons] = useState<string[]>([])
  const [loadingGameData, setLoadingGameData] = useState(false)
  const [gameDataError, setGameDataError] = useState<string | null>(null)

  useEffect(() => {
    let canceled = false

    async function loadCropGameData() {
      const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__
      const gameDir = localStorage.getItem("stardewGameDirectory") || ""
      const cacheKey = getCropGameDataCacheKey(gameDir)
      const cached = readCache<CropGameData>(cacheKey)

      if (cached && !canceled) {
        applyCropGameData(
          cached.data,
          setEncyclopediaCrops,
          setCropLookup,
          setSeasons,
        )
        setLoadingGameData(false)
        setGameDataError(null)
      }

      if (!isTauri) {
        if (!canceled) {
          setGameDataError("当前环境不是 Tauri，无法直接读取游戏目录。")
        }
        return
      }

      if (!cached && !canceled) {
        setLoadingGameData(true)
        setGameDataError(null)
      }

      try {
        const { invoke } = await import("@tauri-apps/api/core")
        const data = (await invoke("get_crop_game_data", {
          gameDir: gameDir.trim() || undefined,
        })) as CropGameData

        if (!canceled) {
          applyCropGameData(
            data,
            setEncyclopediaCrops,
            setCropLookup,
            setSeasons,
          )
          setGameDataError(null)
        }
        writeCache(cacheKey, data)
      } catch (err) {
        console.error("Error loading crop game data:", err)
        if (!canceled) {
          setGameDataError(String(err))
          if (!cached) {
            setEncyclopediaCrops([])
            setCropLookup({})
            setSeasons([])
          }
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
  }, [])

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
        <h2 className="text-3xl font-bold tracking-tight">作物管理</h2>
        <p className="text-muted-foreground mt-1">
          实时监测你的农地状态并规划收获方案
        </p>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="my-farm" className="space-y-4">
        <TabsList>
          <TabsTrigger value="my-farm">我的农地</TabsTrigger>
          <TabsTrigger value="all">作物图鉴</TabsTrigger>
          <TabsTrigger value="profit">收益计算</TabsTrigger>
        </TabsList>

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
