import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
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

function getRawDetail(crop: Crop, t: any) {
  if (isRegrowCrop(crop)) {
    return t("crops.profit.details.regrow", {
      regrowDays: crop.regrowDays,
      growDays: crop.growDays,
      defaultValue: `成熟后每 ${crop.regrowDays} 天收一次，首次成熟 ${crop.growDays} 天`,
    })
  }
  return t("crops.profit.details.raw", {
    growDays: crop.growDays,
    defaultValue: `单次成熟 ${crop.growDays} 天`,
  })
}

function getKegResult(crop: Crop, t: any): ProfitResult {
  const internalName = crop.internalName?.toLowerCase().replace(/\s+/g, "")

  if (internalName === "hops") {
    return {
      label: t("crops.profit.items.paleAle", { defaultValue: "淡啤酒" }),
      outputPrice: 300,
      cycleDays: KEG_DAYS.paleAle,
      dailyProfit: roundToTenth(300 / KEG_DAYS.paleAle),
      available: true,
      detail: t("crops.profit.details.hopsKeg", { defaultValue: "啤酒花 -> 淡啤酒" }),
    }
  }

  if (internalName === "wheat") {
    return {
      label: t("crops.profit.items.beer", { defaultValue: "啤酒" }),
      outputPrice: 200,
      cycleDays: KEG_DAYS.beer,
      dailyProfit: roundToTenth(200 / KEG_DAYS.beer),
      available: true,
      detail: t("crops.profit.details.wheatKeg", { defaultValue: "小麦 -> 啤酒" }),
    }
  }

  if (internalName === "coffeebean") {
    return {
      label: t("crops.profit.items.coffee", { defaultValue: "咖啡" }),
      outputPrice: 150,
      cycleDays: KEG_DAYS.coffee,
      dailyProfit: roundToTenth(150 / KEG_DAYS.coffee),
      available: true,
      detail: t("crops.profit.details.coffeeKeg", { defaultValue: "5 咖啡豆 -> 咖啡" }),
    }
  }

  if (internalName === "tealeaves") {
    return {
      label: t("crops.profit.items.greenTea", { defaultValue: "绿茶" }),
      outputPrice: 100,
      cycleDays: KEG_DAYS.greenTea,
      dailyProfit: roundToTenth(100 / KEG_DAYS.greenTea),
      available: true,
      detail: t("crops.profit.details.teaKeg", { defaultValue: "茶叶 -> 绿茶" }),
    }
  }

  if (crop.categoryKey === "fruit") {
    const outputPrice = crop.sellPrice * 3
    return {
      label: t("crops.profit.items.wine", { defaultValue: "果酒" }),
      outputPrice,
      cycleDays: KEG_DAYS.wine,
      dailyProfit: roundToTenth(outputPrice / KEG_DAYS.wine),
      available: true,
      detail: t("crops.profit.details.fruitKeg", { defaultValue: "水果 -> 果酒" }),
    }
  }

  if (crop.categoryKey === "vegetable") {
    const outputPrice = Math.floor(crop.sellPrice * 2.25)
    return {
      label: t("crops.profit.items.juice", { defaultValue: "果汁" }),
      outputPrice,
      cycleDays: KEG_DAYS.juice,
      dailyProfit: roundToTenth(outputPrice / KEG_DAYS.juice),
      available: true,
      detail: t("crops.profit.details.vegetableKeg", { defaultValue: "蔬菜 -> 果汁" }),
    }
  }

  return {
    label: t("crops.profit.unavailable", { defaultValue: "不可加工" }),
    outputPrice: 0,
    cycleDays: 0,
    dailyProfit: 0,
    available: false,
    detail: t("crops.profit.details.kegUnavailable", { defaultValue: "该作物不能放入小桶计算" }),
  }
}

function getCaskResult(crop: Crop, t: any): ProfitResult {
  const kegResult = getKegResult(crop, t)
  const canAgeInCask = [
    t("crops.profit.items.wine", { defaultValue: "果酒" }),
    t("crops.profit.items.beer", { defaultValue: "啤酒" }),
    t("crops.profit.items.paleAle", { defaultValue: "淡啤酒" }),
  ].includes(kegResult.label)

  if (!kegResult.available || !canAgeInCask) {
    return {
      label: t("crops.profit.caskUnavailable", { defaultValue: "不可陈酿" }),
      outputPrice: 0,
      cycleDays: 0,
      dailyProfit: 0,
      available: false,
      detail: t("crops.profit.details.caskUnavailable", { defaultValue: "木桶只计算小桶产出的果酒、啤酒、淡啤酒" }),
    }
  }

  const outputPrice = kegResult.outputPrice * 2
  const cycleDays = kegResult.cycleDays + CASK_DAYS_TO_IRIDIUM

  return {
    label: t("crops.profit.items.iridiumLabel", {
      item: kegResult.label,
      defaultValue: `铱星${kegResult.label}`,
    }),
    outputPrice,
    cycleDays,
    dailyProfit: roundToTenth(outputPrice / cycleDays),
    available: true,
    detail: t("crops.profit.details.caskSuccess", {
      item: kegResult.label,
      defaultValue: `${kegResult.label} -> 木桶陈酿 56 天`,
    }),
  }
}

function getPreservesJarResult(crop: Crop, t: any): ProfitResult {
  if (crop.categoryKey === "fruit") {
    const outputPrice = crop.sellPrice * 2 + 50
    return {
      label: t("crops.profit.items.jelly", { defaultValue: "果酱" }),
      outputPrice,
      cycleDays: PRESERVES_JAR_DAYS,
      dailyProfit: roundToTenth(outputPrice / PRESERVES_JAR_DAYS),
      available: true,
      detail: t("crops.profit.details.fruitJar", { defaultValue: "水果 -> 果酱" }),
    }
  }

  if (crop.categoryKey === "vegetable") {
    const outputPrice = crop.sellPrice * 2 + 50
    return {
      label: t("crops.profit.items.pickles", { defaultValue: "腌菜" }),
      outputPrice,
      cycleDays: PRESERVES_JAR_DAYS,
      dailyProfit: roundToTenth(outputPrice / PRESERVES_JAR_DAYS),
      available: true,
      detail: t("crops.profit.details.vegetableJar", { defaultValue: "蔬菜 -> 腌菜" }),
    }
  }

  return {
    label: t("crops.profit.unavailable", { defaultValue: "不可加工" }),
    outputPrice: 0,
    cycleDays: 0,
    dailyProfit: 0,
    available: false,
    detail: t("crops.profit.details.jarUnavailable", { defaultValue: "该作物不能放入罐头瓶计算" }),
  }
}

function getProfitResult(crop: Crop, mode: ProcessingMode, t: any): ProfitResult {
  if (mode === "raw") {
    const cycleDays = getRawCycleDays(crop)
    const dailyProfit = cycleDays > 0 ? roundToTenth(crop.sellPrice / cycleDays) : 0
    return {
      label: t("crops.profit.modes.raw", { defaultValue: "直售" }),
      outputPrice: crop.sellPrice,
      cycleDays,
      dailyProfit,
      available: cycleDays > 0,
      detail: getRawDetail(crop, t),
    }
  }

  if (mode === "keg") {
    return getKegResult(crop, t)
  }

  if (mode === "cask") {
    return getCaskResult(crop, t)
  }

  return getPreservesJarResult(crop, t)
}

export function CropProfitCalculator({ encyclopediaCrops }: CropProfitCalculatorProps) {
  const { t, i18n } = useTranslation()
  const [profitSortField, setProfitSortField] = useState<ProfitSortField>("dailyProfit")
  const [profitSortDirection, setProfitSortDirection] = useState<ProfitSortDirection>("desc")
  const [processingMode, setProcessingMode] = useState<ProcessingMode>("raw")

  const processingModeLabels: Record<ProcessingMode, string> = {
    raw: t("crops.profit.modes.raw", { defaultValue: "直售" }),
    keg: t("crops.profit.modes.keg", { defaultValue: "小桶" }),
    cask: t("crops.profit.modes.cask", { defaultValue: "木桶" }),
    preservesJar: t("crops.profit.modes.preservesJar", { defaultValue: "罐头瓶" }),
  }

  const profitSortedCrops = useMemo(() => {
    return [...encyclopediaCrops].sort((a, b) => {
      const aResult = getProfitResult(a, processingMode, t)
      const bResult = getProfitResult(b, processingMode, t)

      const compareValue = (() => {
        switch (profitSortField) {
          case "sellPrice":
            return aResult.outputPrice - bResult.outputPrice
          case "growDays":
            return aResult.cycleDays - bResult.cycleDays
          case "name":
            return a.name.localeCompare(b.name, i18n.resolvedLanguage || i18n.language)
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

      return a.name.localeCompare(b.name, i18n.resolvedLanguage || i18n.language)
    })
  }, [encyclopediaCrops, processingMode, profitSortDirection, profitSortField, t, i18n.resolvedLanguage, i18n.language])

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("crops.profit.title")}</CardTitle>
        <CardDescription>{t("crops.profit.description")}</CardDescription>
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
                  {processingModeLabels[mode]}
                </Button>
              ))}
            </div>
            <p className="text-sm text-muted-foreground">
              {t("crops.profit.helperText")}
            </p>
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant={profitSortField === "dailyProfit" ? "default" : "outline"}
                size="sm"
                onClick={() => setProfitSortField("dailyProfit")}
              >
                {t("crops.profit.fields.dailyProfit")}
              </Button>
              <Button
                variant={profitSortField === "sellPrice" ? "default" : "outline"}
                size="sm"
                onClick={() => setProfitSortField("sellPrice")}
              >
                {t("crops.profit.fields.sellPrice")}
              </Button>
              <Button
                variant={profitSortField === "growDays" ? "default" : "outline"}
                size="sm"
                onClick={() => setProfitSortField("growDays")}
              >
                {t("crops.profit.fields.growDays")}
              </Button>
              <Button
                variant={profitSortField === "name" ? "default" : "outline"}
                size="sm"
                onClick={() => setProfitSortField("name")}
              >
                {t("crops.profit.fields.name")}
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
                {profitSortDirection === "desc" ? t("crops.profit.sortDesc") : t("crops.profit.sortAsc")}
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ArrowUpDown className="h-3.5 w-3.5" />
            {t("crops.profit.currentSortLabel")}
            <span className="font-medium text-foreground">
              {profitSortField === "dailyProfit" && t("crops.profit.fields.dailyProfit")}
              {profitSortField === "sellPrice" && t("crops.profit.fields.sellPrice")}
              {profitSortField === "growDays" && t("crops.profit.fields.growDays")}
              {profitSortField === "name" && t("crops.profit.fields.name")}
            </span>
            {profitSortDirection === "desc" ? t("crops.profit.sortRangeHighToLow") : t("crops.profit.sortRangeLowToHigh")}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {profitSortedCrops.map((crop) => {
              const result = getProfitResult(crop, processingMode, t)

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
                      {result.available ? `${result.dailyProfit} ${t("crops.profit.perDaySuffix")}` : "--"}
                    </p>
                    <p className="text-[10px] font-semibold text-muted-foreground">
                      {result.available
                        ? `${t("crops.profit.priceLabel")} ${result.outputPrice}g · ${t("crops.profit.cycleLabel")} ${t("crops.profit.daysUnit", { days: roundToTenth(result.cycleDays) })}`
                        : t("crops.profit.notApplicable")}
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
