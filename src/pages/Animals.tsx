import { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { MyAnimals } from "./animals/MyAnimals"
import { AnimalEncyclopedia } from "./animals/AnimalEncyclopedia"
import { AnimalProfitCalculator } from "./animals/AnimalProfitCalculator"
import type {
  AnimalGameData,
  OwnedAnimal,
  AnimalEncyclopediaEntry,
} from "./animals/types"
import {
  readCache,
  writeCache,
  getAnimalGameDataCacheKey,
  getSaveAnimalsCacheKey,
} from "./animals/types"

interface AnimalsProps {
  selectedSaveId: string
}

function applyAnimalGameData(
  data: AnimalGameData,
  setEncyclopedia: (value: AnimalEncyclopediaEntry[]) => void,
  setHouses: (value: string[]) => void,
) {
  setEncyclopedia(data.encyclopedia)
  setHouses(data.houses || [])
}

export function Animals({ selectedSaveId }: AnimalsProps) {
  const { t, i18n } = useTranslation()
  const [ownedAnimals, setOwnedAnimals] = useState<OwnedAnimal[]>([])
  const [loadingOwned, setLoadingOwned] = useState(true)
  const [ownedError, setOwnedError] = useState<string | null>(null)

  const [encyclopedia, setEncyclopedia] = useState<AnimalEncyclopediaEntry[]>([])
  const [houses, setHouses] = useState<string[]>([])
  const [loadingGameData, setLoadingGameData] = useState(false)
  const [gameDataError, setGameDataError] = useState<string | null>(null)

  const activeLang = i18n.resolvedLanguage || i18n.language || "zh"

  // Load animal game data (encyclopedia)
  useEffect(() => {
    let canceled = false

    async function loadAnimalGameData() {
      const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__
      const gameDir = localStorage.getItem("stardewGameDirectory") || ""
      const cacheKey = getAnimalGameDataCacheKey(gameDir, activeLang)
      const cached = readCache<AnimalGameData>(cacheKey)

      if (cached && !canceled) {
        applyAnimalGameData(cached.data, setEncyclopedia, setHouses)
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
        const data = (await invoke("get_animal_game_data", {
          gameDir: gameDir.trim() || undefined,
          lang: activeLang,
        })) as AnimalGameData

        if (!canceled) {
          applyAnimalGameData(data, setEncyclopedia, setHouses)
          setGameDataError(null)
        }
        writeCache(cacheKey, data)
      } catch (err) {
        console.error("Error loading animal game data:", err)
        if (!canceled) {
          setGameDataError(String(err))
          if (!cached) {
            setEncyclopedia([])
            setHouses([])
          }
        }
      } finally {
        if (!canceled) {
          setLoadingGameData(false)
        }
      }
    }

    loadAnimalGameData()

    return () => {
      canceled = true
    }
  }, [activeLang])

  // Load owned animals from save
  useEffect(() => {
    let canceled = false

    async function loadOwnedAnimals() {
      if (!selectedSaveId) {
        if (!canceled) {
          setOwnedAnimals([])
          setLoadingOwned(false)
        }
        return
      }

      const cacheKey = getSaveAnimalsCacheKey(selectedSaveId)
      const cached = readCache<OwnedAnimal[]>(cacheKey)

      if (cached && !canceled) {
        setOwnedAnimals(cached.data)
        setLoadingOwned(false)
      } else if (!canceled) {
        setLoadingOwned(true)
      }

      const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__
      if (isTauri) {
        try {
          const { invoke } = await import("@tauri-apps/api/core")
          const animals: OwnedAnimal[] = await invoke("get_save_animals", {
            id: selectedSaveId,
          })
          if (!canceled) {
            setOwnedAnimals(animals)
            setOwnedError(null)
          }
          writeCache(cacheKey, animals)
        } catch (err) {
          console.error("Error loading owned animals:", err)
          if (!canceled) {
            setOwnedError(String(err))
            if (!cached) {
              setOwnedAnimals([])
            }
          }
        } finally {
          if (!canceled) {
            setLoadingOwned(false)
          }
        }
      } else {
        if (!canceled) {
          setLoadingOwned(false)
        }
      }
    }

    loadOwnedAnimals()

    return () => {
      canceled = true
    }
  }, [selectedSaveId])

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-3xl font-bold tracking-tight">{t("animals.title", { defaultValue: "动物管理" })}</h2>
        <p className="text-muted-foreground mt-1">
          {t("animals.description", { defaultValue: "管理农场动物，查看百科信息和收益计算" })}
        </p>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="my-animals" className="space-y-4">
        <TabsList>
          <TabsTrigger value="my-animals">{t("animals.tabs.myAnimals", { defaultValue: "我的动物" })}</TabsTrigger>
          <TabsTrigger value="encyclopedia">{t("animals.tabs.encyclopedia", { defaultValue: "动物百科" })}</TabsTrigger>
          <TabsTrigger value="profit">{t("animals.tabs.profit", { defaultValue: "收益计算" })}</TabsTrigger>
        </TabsList>

        <TabsContent value="my-animals" className="space-y-6">
          <MyAnimals
            loading={loadingOwned}
            error={ownedError}
            animals={ownedAnimals}
            encyclopedia={encyclopedia}
          />
        </TabsContent>

        <TabsContent value="encyclopedia" className="space-y-4">
          <AnimalEncyclopedia
            encyclopedia={encyclopedia}
            houses={houses}
            loading={loadingGameData}
            error={gameDataError}
          />
        </TabsContent>

        <TabsContent value="profit">
          <AnimalProfitCalculator encyclopedia={encyclopedia} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
