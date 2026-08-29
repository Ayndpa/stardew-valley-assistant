import { useState, useMemo } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Loader2,
  AlertCircle,
  Search,
  PawPrint,
  Coins,
  Calendar,
  Package,
  Droplets,
  Star,
} from "lucide-react"
import type { AnimalEncyclopediaEntry } from "./types"

interface AnimalEncyclopediaProps {
  encyclopedia: AnimalEncyclopediaEntry[]
  houses: string[]
  loading: boolean
  error: string | null
}

function AnimalDetailCard({ animal }: { animal: AnimalEncyclopediaEntry }) {
  return (
    <Card className="border border-border/60 hover:border-primary/30 transition-all overflow-hidden">
      <CardContent className="p-0">
        {/* Header with icon */}
        <div className="flex items-center gap-4 p-4 bg-gradient-to-r from-accent/30 to-transparent">
          <div className="h-16 w-16 rounded-xl bg-accent/40 border border-border/40 flex items-center justify-center shrink-0 overflow-hidden">
            {animal.icon ? (
              <img
                src={animal.icon}
                alt={animal.name}
                className="h-full w-full object-contain [image-rendering:pixelated]"
              />
            ) : (
              <PawPrint className="h-7 w-7 text-muted-foreground" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-base truncate">{animal.name}</h3>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="secondary" className="text-xs">
                {animal.houseDisplay}
              </Badge>
              {animal.canGetPregnant && (
                <Badge variant="outline" className="text-xs text-pink-500 border-pink-300">
                  可繁殖
                </Badge>
              )}
              {animal.canSwim && (
                <Badge variant="outline" className="text-xs text-blue-500 border-blue-300">
                  可游泳
                </Badge>
              )}
              {animal.canEatGoldenCrackers && (
                <Badge variant="outline" className="text-xs text-amber-500 border-amber-300">
                  金饼干
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-3 p-4 text-xs">
          <div className="flex items-center gap-2">
            <Coins className="h-3.5 w-3.5 text-amber-500" />
            <div>
              <div className="text-muted-foreground">购买价格</div>
              <div className="font-semibold">
                {animal.purchasePrice >= 0 ? `${animal.purchasePrice.toLocaleString()}g` : "不可购买"}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Coins className="h-3.5 w-3.5 text-green-500" />
            <div>
              <div className="text-muted-foreground">售价</div>
              <div className="font-semibold">{animal.sellPrice}g</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Calendar className="h-3.5 w-3.5 text-blue-500" />
            <div>
              <div className="text-muted-foreground">成长天数</div>
              <div className="font-semibold">{animal.daysToMature} 天</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Calendar className="h-3.5 w-3.5 text-purple-500" />
            <div>
              <div className="text-muted-foreground">产出间隔</div>
              <div className="font-semibold">{animal.daysToProduce} 天</div>
            </div>
          </div>
        </div>

        {/* Produce */}
        {animal.produceItems.length > 0 && (
          <div className="px-4 pb-3 space-y-2">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Package className="h-3 w-3" />
              <span className="font-medium">普通产出</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {animal.produceItems.map((p) => (
                <Badge key={p.itemId} variant="secondary" className="text-xs font-normal">
                  {p.name}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {animal.deluxeProduceItems.length > 0 && (
          <div className="px-4 pb-3 space-y-2">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Star className="h-3 w-3 text-amber-500" />
              <span className="font-medium">高级产出</span>
              <span className="text-muted-foreground/70">(好感度≥{animal.deluxeProduceMinFriendship})</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {animal.deluxeProduceItems.map((p) => (
                <Badge key={p.itemId} variant="secondary" className="text-xs font-normal">
                  {p.name}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Harvest info */}
        <div className="px-4 pb-4 flex items-center gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <Droplets className="h-3 w-3" />
            <span>{animal.harvestType}</span>
          </div>
          {animal.harvestTool && (
            <div className="flex items-center gap-1">
              <span>· {animal.harvestTool}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export function AnimalEncyclopedia({
  encyclopedia,
  houses,
  loading,
  error,
}: AnimalEncyclopediaProps) {
  const [search, setSearch] = useState("")
  const [selectedHouse, setSelectedHouse] = useState<string | null>(null)

  const filtered = useMemo(() => {
    let result = encyclopedia
    if (selectedHouse) {
      result = result.filter((a) => a.house === selectedHouse)
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.id.toLowerCase().includes(q) ||
          a.produceItems.some((p) => p.name.toLowerCase().includes(q))
      )
    }
    return result
  }, [encyclopedia, search, selectedHouse])

  if (loading) {
    return (
      <div className="flex min-h-[30vh] flex-col items-center justify-center gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">正在加载动物百科数据...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-[30vh] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-destructive/40 bg-destructive/5">
        <AlertCircle className="h-6 w-6 text-destructive" />
        <p className="text-sm text-destructive">{error}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索动物名称或产出..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setSelectedHouse(null)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
              !selectedHouse
                ? "bg-primary text-primary-foreground"
                : "bg-accent/40 text-muted-foreground hover:bg-accent/60"
            }`}
          >
            全部
          </button>
          {houses.map((house) => (
            <button
              key={house}
              onClick={() => setSelectedHouse(selectedHouse === house ? null : house)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                selectedHouse === house
                  ? "bg-primary text-primary-foreground"
                  : "bg-accent/40 text-muted-foreground hover:bg-accent/60"
              }`}
            >
              {house === "Coop" ? "鸡舍" : house === "Barn" ? "畜棚" : house}
            </button>
          ))}
        </div>
      </div>

      {/* Results count */}
      <div className="text-xs text-muted-foreground">
        共 {filtered.length} 种动物
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((animal) => (
          <AnimalDetailCard key={animal.id} animal={animal} />
        ))}
      </div>

      {filtered.length === 0 && encyclopedia.length > 0 && (
        <div className="flex min-h-[20vh] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-muted-foreground/30">
          <PawPrint className="h-6 w-6 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">没有找到匹配的动物</p>
        </div>
      )}
    </div>
  )
}
