import { useState, useEffect, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { RefreshCw } from "lucide-react"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { MyAnimals } from "./animals/MyAnimals"
import { AnimalEncyclopedia } from "./animals/AnimalEncyclopedia"
import { AnimalProfitCalculator } from "./animals/AnimalProfitCalculator"
import type { Page } from "@/App"
import type {
  AnimalGameData,
  OwnedAnimal,
  AnimalEncyclopediaEntry,
} from "./animals/types"
import {
  getSaveAnimalsCacheKey,
  readCache,
  writeCache,
} from "./animals/types"

interface AnimalsProps {
  selectedSaveId: string
  onNavigate?: (page: Page) => void
}

function applyAnimalGameData(
  data: AnimalGameData,
  setEncyclopedia: (value: AnimalEncyclopediaEntry[]) => void,
  setHouses: (value: string[]) => void,
  setDataSource: (value: string) => void,
  setGeneratedAt: (value: string | null) => void,
) {
  setEncyclopedia(data.encyclopedia)
  setHouses(data.houses || [])
  setDataSource(data.dataSource || "xnb")
  setGeneratedAt(data.generatedAt || null)
}

export function Animals({ selectedSaveId, onNavigate }: AnimalsProps) {
  const { t, i18n } = useTranslation()
  const [ownedAnimals, setOwnedAnimals] = useState<OwnedAnimal[]>([])
  const [loadingOwned, setLoadingOwned] = useState(true)
  const [ownedError, setOwnedError] = useState<string | null>(null)

  const [encyclopedia, setEncyclopedia] = useState<AnimalEncyclopediaEntry[]>([])
  const [houses, setHouses] = useState<string[]>([])
  const [loadingGameData, setLoadingGameData] = useState(false)
  const [gameDataError, setGameDataError] = useState<string | null>(null)
  const [dataSource, setDataSource] = useState<string>("xnb")
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const activeLang = i18n.resolvedLanguage || i18n.language || "zh"

  const handleRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1)
  }, [])

  // Load animal game data (encyclopedia)
  useEffect(() => {
    let canceled = false

    async function loadAnimalGameData() {
      const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__
      const gameDir = localStorage.getItem("stardewGameDirectory") || ""

      if (!isTauri) {
        if (!canceled) {
          setGameDataError("当前环境不是 Tauri，无法直接读取游戏目录。")
        }
        return
      }

      if (!canceled) {
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
          applyAnimalGameData(data, setEncyclopedia, setHouses, setDataSource, setGeneratedAt)
          setGameDataError(null)
        }
      } catch (err) {
        console.error("Error loading animal game data:", err)
        if (!canceled) {
          setGameDataError(String(err))
          setEncyclopedia([])
          setHouses([])
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
  }, [activeLang, refreshKey])

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
                  <span className="text-muted-foreground">{t("dataSource.xnbWarningDesc", { defaultValue: "由于未检测到助手伴侣模组的运行数据，展示的价格和周期可能无法适配您的模组修改（如微调售价和周期）。建议前往模组管理页面安装伴侣模组以同步实时数据。" })}</span>
                </div>
                {onNavigate && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs border-amber-300 hover:bg-amber-100 hover:text-amber-900 dark:border-amber-700 dark:hover:bg-amber-950/40 text-amber-800 dark:text-amber-300 flex-shrink-0"
                    onClick={() => onNavigate("mods")}
                  >
                    {t("dataSource.goInstallMod", { defaultValue: "前往模组管理安装" })}
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>

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
