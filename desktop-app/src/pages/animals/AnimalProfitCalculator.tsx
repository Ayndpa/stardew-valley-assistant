import { useState, useMemo } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Coins,
  TrendingUp,
  Calendar,
  PawPrint,
  ArrowDownAZ,
  ArrowUpAZ,
} from "lucide-react"
import type { AnimalEncyclopediaEntry } from "./types"

type SortField = "dailyProfit" | "seasonProfit" | "yearProfit" | "purchasePrice" | "name"
type SortDirection = "asc" | "desc"

interface AnimalProfitCalculatorProps {
  encyclopedia: AnimalEncyclopediaEntry[]
}

function AnimalProfitCard({ animal }: { animal: AnimalEncyclopediaEntry }) {
  const [count, setCount] = useState(1)

  // Calculate daily profit per animal
  const dailyProfit = useMemo(() => {
    if (animal.daysToProduce <= 0) return 0
    // Use first produce item's sell price as approximation
    // In reality, produce price comes from Objects.xnb, but we use sellPrice as base
    const produceValue = animal.sellPrice || 0
    return Math.floor(produceValue / animal.daysToProduce)
  }, [animal])

  const totalDaily = dailyProfit * count
  const totalSeason = totalDaily * 28
  const totalYear = totalSeason * 4

  return (
    <Card className="border border-border/60 hover:border-primary/30 transition-all">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-accent/30 border border-border/40 flex items-center justify-center shrink-0 overflow-hidden">
            {animal.icon ? (
              <img
                src={animal.icon}
                alt={animal.name}
                className="h-full w-full object-contain [image-rendering:pixelated]"
              />
            ) : (
              <PawPrint className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm truncate">{animal.name}</div>
            <div className="text-xs text-muted-foreground">{animal.houseDisplay}</div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">数量:</span>
            <Input
              type="number"
              min={1}
              max={999}
              value={count}
              onChange={(e) => setCount(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-16 h-7 text-xs text-center"
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="rounded-lg bg-accent/20 p-2 text-center">
            <div className="text-muted-foreground">每日收益</div>
            <div className="font-bold text-green-500">{totalDaily.toLocaleString()}g</div>
          </div>
          <div className="rounded-lg bg-accent/20 p-2 text-center">
            <div className="text-muted-foreground">每季收益</div>
            <div className="font-bold text-blue-500">{totalSeason.toLocaleString()}g</div>
          </div>
          <div className="rounded-lg bg-accent/20 p-2 text-center">
            <div className="text-muted-foreground">每年收益</div>
            <div className="font-bold text-purple-500">{totalYear.toLocaleString()}g</div>
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            <span>产出间隔: {animal.daysToProduce}天</span>
          </div>
          {animal.purchasePrice > 0 && (
            <div className="flex items-center gap-1">
              <Coins className="h-3 w-3" />
              <span>购入价: {animal.purchasePrice.toLocaleString()}g</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export function AnimalProfitCalculator({
  encyclopedia,
}: AnimalProfitCalculatorProps) {
  const [sortField, setSortField] = useState<SortField>("dailyProfit")
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc")

  const sorted = useMemo(() => {
    return [...encyclopedia]
      .filter((a) => a.sellPrice > 0 && a.daysToProduce > 0)
      .sort((a, b) => {
        const dailyA = Math.floor(a.sellPrice / a.daysToProduce)
        const dailyB = Math.floor(b.sellPrice / b.daysToProduce)

        const compareValue = (() => {
          switch (sortField) {
            case "dailyProfit":
              return dailyA - dailyB
            case "seasonProfit":
              return dailyA * 28 - dailyB * 28
            case "yearProfit":
              return dailyA * 28 * 4 - dailyB * 28 * 4
            case "purchasePrice":
              return a.purchasePrice - b.purchasePrice
            case "name":
              return a.name.localeCompare(b.name)
            default:
              return 0
          }
        })()

        if (compareValue !== 0) {
          return sortDirection === "asc" ? compareValue : -compareValue
        }
        // Fallback: sort by name
        return a.name.localeCompare(b.name)
      })
  }, [encyclopedia, sortField, sortDirection])

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border/40 bg-accent/10 p-4 text-xs text-muted-foreground">
        <p>
          <TrendingUp className="inline h-3.5 w-3.5 mr-1" />
          收益计算基于动物基础售价和产出间隔，实际收益可能因好感度、品质等因素有所不同。
          高级产出（如大瓶牛奶、铱星品质等）会显著提高实际收益。
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={sortField === "dailyProfit" ? "default" : "outline"}
          size="sm"
          onClick={() => setSortField("dailyProfit")}
        >
          每日收益
        </Button>
        <Button
          variant={sortField === "seasonProfit" ? "default" : "outline"}
          size="sm"
          onClick={() => setSortField("seasonProfit")}
        >
          每季收益
        </Button>
        <Button
          variant={sortField === "yearProfit" ? "default" : "outline"}
          size="sm"
          onClick={() => setSortField("yearProfit")}
        >
          每年收益
        </Button>
        <Button
          variant={sortField === "purchasePrice" ? "default" : "outline"}
          size="sm"
          onClick={() => setSortField("purchasePrice")}
        >
          购入价
        </Button>
        <Button
          variant={sortField === "name" ? "default" : "outline"}
          size="sm"
          onClick={() => setSortField("name")}
        >
          名称
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setSortDirection((d) => (d === "desc" ? "asc" : "desc"))}
        >
          {sortDirection === "desc" ? (
            <ArrowDownAZ className="h-4 w-4" />
          ) : (
            <ArrowUpAZ className="h-4 w-4" />
          )}
          {sortDirection === "desc" ? "从高到低" : "从低到高"}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {sorted.map((animal) => (
          <AnimalProfitCard key={animal.id} animal={animal} />
        ))}
      </div>

      {sorted.length === 0 && encyclopedia.length > 0 && (
        <div className="flex min-h-[20vh] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-muted-foreground/30">
          <PawPrint className="h-6 w-6 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">没有可计算收益的动物</p>
        </div>
      )}
    </div>
  )
}
