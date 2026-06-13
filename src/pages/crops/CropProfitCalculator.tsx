import { useState, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Sprout, ArrowUpDown, ArrowDownAZ, ArrowUpAZ } from "lucide-react"
import { Crop, ProfitSortField, ProfitSortDirection } from "./types"

interface CropProfitCalculatorProps {
  encyclopediaCrops: Crop[]
}

export function CropProfitCalculator({ encyclopediaCrops }: CropProfitCalculatorProps) {
  const [profitSortField, setProfitSortField] = useState<ProfitSortField>("dailyProfit")
  const [profitSortDirection, setProfitSortDirection] = useState<ProfitSortDirection>("desc")

  const profitSortedCrops = useMemo(() => {
    return [...encyclopediaCrops].sort((a, b) => {
      const getDailyProfit = (crop: Crop) =>
        crop.growDays > 0 ? Math.round((crop.sellPrice / crop.growDays) * 10) / 10 : 0

      const compareValue = (() => {
        switch (profitSortField) {
          case "sellPrice":
            return a.sellPrice - b.sellPrice
          case "growDays":
            return a.growDays - b.growDays
          case "name":
            return a.name.localeCompare(b.name, "zh-CN")
          case "dailyProfit":
          default:
            return getDailyProfit(a) - getDailyProfit(b)
        }
      })()

      return profitSortDirection === "asc" ? compareValue : -compareValue
    })
  }, [encyclopediaCrops, profitSortField, profitSortDirection])

  return (
    <Card>
      <CardHeader>
        <CardTitle>收益计算器</CardTitle>
        <CardDescription>计算不同作物的收益</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <p className="text-sm text-muted-foreground">
              以下是按照单次收获的售价与生长期计算的每日理论平均收益：
            </p>
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
                单价
              </Button>
              <Button
                variant={profitSortField === "growDays" ? "default" : "outline"}
                size="sm"
                onClick={() => setProfitSortField("growDays")}
              >
                生长天数
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
              {profitSortField === "sellPrice" && "单价"}
              {profitSortField === "growDays" && "生长天数"}
              {profitSortField === "name" && "名称"}
            </span>
            {profitSortDirection === "desc" ? "从高到低" : "从低到高"}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {profitSortedCrops.map((crop) => {
              const dailyProfit =
                crop.growDays > 0 ? Math.round((crop.sellPrice / crop.growDays) * 10) / 10 : 0
              return (
                <div
                  key={crop.harvestId || crop.seedId || crop.name}
                  className="flex justify-between items-center gap-3 p-3 rounded-lg border bg-accent/30"
                >
                  <div className="flex items-center gap-3 min-w-0">
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
                        {crop.season} · 生长 {crop.growDays} 天
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-bold text-sm text-yellow-500">{dailyProfit} g/天</p>
                    <p className="text-[10px] text-muted-foreground font-semibold">单价 {crop.sellPrice}g</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
