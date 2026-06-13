import { useMemo, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ArrowDownAZ, ArrowUpAZ, ArrowUpDown, Sprout } from "lucide-react"
import { Crop, ProfitSortDirection, ProfitSortField } from "./types"

interface CropProfitCalculatorProps {
  encyclopediaCrops: Crop[]
}

type ProcessingMode = "raw" | "keg" | "cask" | "preservesJar"

interface ProfitResult {
  label: string
  outputPrice: number
  dailyProfit: number
  cycleDays: number
  available: boolean
  detail: string
}

const PROCESSING_MODE_LABELS: Record<ProcessingMode, string> = {
  raw: "直售",
  keg: "小桶",
  cask: "木桶",
  preservesJar: "罐头瓶",
}

const KEG_DAYS = {
  wine: 7,
  juice: 4,
  beer: 1.75,
  paleAle: 2.25,
  coffee: 0.0833,
  greenTea: 0.125,
} as const

const PRESERVES_JAR_DAYS = 3
const CASK_DAYS_TO_IRIDIUM = 56

function roundToTenth(value: number) {
  return Math.round(value * 10) / 10
}

function isRegrowCrop(crop: Crop) {
  return crop.regrows && (crop.regrowDays ?? 0) > 0
}

function getRawCycleDays(crop: Crop) {
  if (isRegrowCrop(crop)) {
    return crop.regrowDays ?? crop.growDays
  }
  return crop.growDays
}

function getRawDetail(crop: Crop) {
  if (isRegrowCrop(crop)) {
    return `成熟后每 ${crop.regrowDays} 天收一次，首次成熟 ${crop.growDays} 天`
  }
  return `单次成熟 ${crop.growDays} 天`
}

function getKegResult(crop: Crop): ProfitResult {
  const internalName = crop.internalName?.toLowerCase().replace(/\s+/g, "")

  if (internalName === "hops") {
    return {
      label: "淡啤酒",
      outputPrice: 300,
      cycleDays: KEG_DAYS.paleAle,
      dailyProfit: roundToTenth(300 / KEG_DAYS.paleAle),
      available: true,
      detail: "啤酒花 -> 淡啤酒",
    }
  }

  if (internalName === "wheat") {
    return {
      label: "啤酒",
      outputPrice: 200,
      cycleDays: KEG_DAYS.beer,
      dailyProfit: roundToTenth(200 / KEG_DAYS.beer),
      available: true,
      detail: "小麦 -> 啤酒",
    }
  }

  if (internalName === "coffeebean") {
    return {
      label: "咖啡",
      outputPrice: 150,
      cycleDays: KEG_DAYS.coffee,
      dailyProfit: roundToTenth(150 / KEG_DAYS.coffee),
      available: true,
      detail: "5 咖啡豆 -> 咖啡",
    }
  }

  if (internalName === "tealeaves") {
    return {
      label: "绿茶",
      outputPrice: 100,
      cycleDays: KEG_DAYS.greenTea,
      dailyProfit: roundToTenth(100 / KEG_DAYS.greenTea),
      available: true,
      detail: "茶叶 -> 绿茶",
    }
  }

  if (crop.categoryKey === "fruit") {
    const outputPrice = crop.sellPrice * 3
    return {
      label: "果酒",
      outputPrice,
      cycleDays: KEG_DAYS.wine,
      dailyProfit: roundToTenth(outputPrice / KEG_DAYS.wine),
      available: true,
      detail: "水果 -> 果酒",
    }
  }

  if (crop.categoryKey === "vegetable") {
    const outputPrice = Math.floor(crop.sellPrice * 2.25)
    return {
      label: "果汁",
      outputPrice,
      cycleDays: KEG_DAYS.juice,
      dailyProfit: roundToTenth(outputPrice / KEG_DAYS.juice),
      available: true,
      detail: "蔬菜 -> 果汁",
    }
  }

  return {
    label: "不可加工",
    outputPrice: 0,
    cycleDays: 0,
    dailyProfit: 0,
    available: false,
    detail: "该作物不能放入小桶计算",
  }
}

function getCaskResult(crop: Crop): ProfitResult {
  const kegResult = getKegResult(crop)
  const canAgeInCask = ["果酒", "啤酒", "淡啤酒"].includes(kegResult.label)

  if (!kegResult.available || !canAgeInCask) {
    return {
      label: "不可陈酿",
      outputPrice: 0,
      cycleDays: 0,
      dailyProfit: 0,
      available: false,
      detail: "木桶只计算小桶产出的果酒、啤酒、淡啤酒",
    }
  }

  const outputPrice = kegResult.outputPrice * 2
  const cycleDays = kegResult.cycleDays + CASK_DAYS_TO_IRIDIUM

  return {
    label: `铱星${kegResult.label}`,
    outputPrice,
    cycleDays,
    dailyProfit: roundToTenth(outputPrice / cycleDays),
    available: true,
    detail: `${kegResult.label} -> 木桶陈酿 56 天`,
  }
}

function getPreservesJarResult(crop: Crop): ProfitResult {
  if (crop.categoryKey === "fruit") {
    const outputPrice = crop.sellPrice * 2 + 50
    return {
      label: "果酱",
      outputPrice,
      cycleDays: PRESERVES_JAR_DAYS,
      dailyProfit: roundToTenth(outputPrice / PRESERVES_JAR_DAYS),
      available: true,
      detail: "水果 -> 果酱",
    }
  }

  if (crop.categoryKey === "vegetable") {
    const outputPrice = crop.sellPrice * 2 + 50
    return {
      label: "腌菜",
      outputPrice,
      cycleDays: PRESERVES_JAR_DAYS,
      dailyProfit: roundToTenth(outputPrice / PRESERVES_JAR_DAYS),
      available: true,
      detail: "蔬菜 -> 腌菜",
    }
  }

  return {
    label: "不可加工",
    outputPrice: 0,
    cycleDays: 0,
    dailyProfit: 0,
    available: false,
    detail: "该作物不能放入罐头瓶计算",
  }
}

function getProfitResult(crop: Crop, mode: ProcessingMode): ProfitResult {
  if (mode === "raw") {
    const cycleDays = getRawCycleDays(crop)
    const dailyProfit = cycleDays > 0 ? roundToTenth(crop.sellPrice / cycleDays) : 0
    return {
      label: "直售",
      outputPrice: crop.sellPrice,
      cycleDays,
      dailyProfit,
      available: cycleDays > 0,
      detail: getRawDetail(crop),
    }
  }

  if (mode === "keg") {
    return getKegResult(crop)
  }

  if (mode === "cask") {
    return getCaskResult(crop)
  }

  return getPreservesJarResult(crop)
}

export function CropProfitCalculator({ encyclopediaCrops }: CropProfitCalculatorProps) {
  const [profitSortField, setProfitSortField] = useState<ProfitSortField>("dailyProfit")
  const [profitSortDirection, setProfitSortDirection] = useState<ProfitSortDirection>("desc")
  const [processingMode, setProcessingMode] = useState<ProcessingMode>("raw")

  const profitSortedCrops = useMemo(() => {
    return [...encyclopediaCrops].sort((a, b) => {
      const aResult = getProfitResult(a, processingMode)
      const bResult = getProfitResult(b, processingMode)

      const compareValue = (() => {
        switch (profitSortField) {
          case "sellPrice":
            return aResult.outputPrice - bResult.outputPrice
          case "growDays":
            return aResult.cycleDays - bResult.cycleDays
          case "name":
            return a.name.localeCompare(b.name, "zh-CN")
          case "dailyProfit":
          default:
            return aResult.dailyProfit - bResult.dailyProfit
        }
      })()

      if (compareValue !== 0) {
        return profitSortDirection === "asc" ? compareValue : -compareValue
      }

      if (aResult.available !== bResult.available) {
        return aResult.available ? -1 : 1
      }

      return a.name.localeCompare(b.name, "zh-CN")
    })
  }, [encyclopediaCrops, processingMode, profitSortDirection, profitSortField])

  return (
    <Card>
      <CardHeader>
        <CardTitle>收益计算器</CardTitle>
        <CardDescription>按游戏公式计算直售、小桶、木桶和罐头瓶收益</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {(["raw", "keg", "cask", "preservesJar"] as ProcessingMode[]).map((mode) => (
                <Button
                  key={mode}
                  variant={processingMode === mode ? "default" : "outline"}
                  size="sm"
                  onClick={() => setProcessingMode(mode)}
                >
                  {PROCESSING_MODE_LABELS[mode]}
                </Button>
              ))}
            </div>
            <p className="text-sm text-muted-foreground">
              多次收获作物现在按成熟后的重复收获周期计算日收益，例如草莓会按
              <span className="px-1 text-foreground">8 天首次成熟 + 4 天再收</span>
              中的
              <span className="px-1 text-foreground">4 天循环</span>
              参与排序。
            </p>
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant={profitSortField === "dailyProfit" ? "default" : "outline"}
                size="sm"
                onClick={() => setProfitSortField("dailyProfit")}
              >
                日收益
              </Button>
              <Button
                variant={profitSortField === "sellPrice" ? "default" : "outline"}
                size="sm"
                onClick={() => setProfitSortField("sellPrice")}
              >
                售价
              </Button>
              <Button
                variant={profitSortField === "growDays" ? "default" : "outline"}
                size="sm"
                onClick={() => setProfitSortField("growDays")}
              >
                周期
              </Button>
              <Button
                variant={profitSortField === "name" ? "default" : "outline"}
                size="sm"
                onClick={() => setProfitSortField("name")}
              >
                名称
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => setProfitSortDirection((current) => (current === "desc" ? "asc" : "desc"))}
              >
                {profitSortDirection === "desc" ? (
                  <ArrowDownAZ className="h-4 w-4" />
                ) : (
                  <ArrowUpAZ className="h-4 w-4" />
                )}
                {profitSortDirection === "desc" ? "降序" : "升序"}
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ArrowUpDown className="h-3.5 w-3.5" />
            当前按
            <span className="font-medium text-foreground">
              {profitSortField === "dailyProfit" && "日收益"}
              {profitSortField === "sellPrice" && "售价"}
              {profitSortField === "growDays" && "周期"}
              {profitSortField === "name" && "名称"}
            </span>
            {profitSortDirection === "desc" ? "从高到低" : "从低到高"}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {profitSortedCrops.map((crop) => {
              const result = getProfitResult(crop, processingMode)

              return (
                <div
                  key={crop.harvestId || crop.seedId || crop.name}
                  className="flex items-center justify-between gap-3 rounded-lg border bg-accent/30 p-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    {crop.icon ? (
                      <img
                        src={crop.icon}
                        alt=""
                        className="h-7 w-7 shrink-0 object-contain"
                        style={{ imageRendering: "pixelated" }}
                      />
                    ) : (
                      <Sprout className="h-5 w-5 shrink-0 text-green-500" />
                    )}
                    <div className="min-w-0">
                      <p className="font-semibold text-sm">{crop.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {result.available ? `${result.label} · ${result.detail}` : result.detail}
                      </p>
                    </div>
                  </div>

                  <div className="shrink-0 text-right">
                    <p className={`font-bold text-sm ${result.available ? "text-yellow-500" : "text-muted-foreground"}`}>
                      {result.available ? `${result.dailyProfit} g/天` : "--"}
                    </p>
                    <p className="text-[10px] font-semibold text-muted-foreground">
                      {result.available
                        ? `售价 ${result.outputPrice}g · 周期 ${roundToTenth(result.cycleDays)} 天`
                        : "当前模式不适用"}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
