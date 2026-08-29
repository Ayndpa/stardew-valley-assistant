import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Loader2,
  AlertCircle,
  Heart,
  Smile,
  Utensils,
  PawPrint,
  Home,
} from "lucide-react"
import type { OwnedAnimal, AnimalEncyclopediaEntry } from "./types"

interface MyAnimalsProps {
  loading: boolean
  error: string | null
  animals: OwnedAnimal[]
  encyclopedia: AnimalEncyclopediaEntry[]
}

function friendshipPercent(friendship: number): number {
  return Math.round((friendship / 1000) * 100)
}

function happinessPercent(happiness: number): number {
  return Math.round((happiness / 255) * 100)
}

function happinessColor(pct: number): string {
  if (pct >= 80) return "text-green-500"
  if (pct >= 50) return "text-yellow-500"
  return "text-red-500"
}

function AnimalCard({
  animal,
  encyclopediaEntry,
}: {
  animal: OwnedAnimal
  encyclopediaEntry?: AnimalEncyclopediaEntry
}) {
  const friendPct = friendshipPercent(animal.friendship)
  const happyPct = happinessPercent(animal.happiness)

  return (
    <Card className="border border-border/60 hover:border-primary/30 transition-all">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div className="h-12 w-12 rounded-lg bg-accent/30 border border-border/40 flex items-center justify-center shrink-0 overflow-hidden">
            {encyclopediaEntry?.icon ? (
              <img
                src={encyclopediaEntry.icon}
                alt={animal.typeName}
                className="h-full w-full object-contain [image-rendering:pixelated]"
              />
            ) : (
              <PawPrint className="h-5 w-5 text-muted-foreground" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm truncate">{animal.name}</span>
              {animal.isBaby && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  幼崽
                </Badge>
              )}
              {animal.wasPet && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-pink-500 border-pink-300">
                  已抚摸
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground truncate">
              {animal.typeName}
            </p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-muted-foreground">
              <Heart className="h-3 w-3" />
              <span>好感度 {friendPct}%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-accent/40 overflow-hidden">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${friendPct}%` }} />
            </div>
          </div>
          <div className="space-y-1">
            <div className={`flex items-center gap-1 ${happinessColor(happyPct)}`}>
              <Smile className="h-3 w-3" />
              <span>快乐度 {happyPct}%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-accent/40 overflow-hidden">
              <div className={`h-full rounded-full transition-all ${happyPct >= 80 ? "bg-green-500" : happyPct >= 50 ? "bg-yellow-500" : "bg-red-500"}`} style={{ width: `${happyPct}%` }} />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <Utensils className="h-3 w-3" />
            <span>
              饱食度: {animal.fullness < 30 ? "饥饿" : animal.fullness < 200 ? "一般" : "饱"}
            </span>
          </div>
          {animal.produceItem && (
            <Badge variant="outline" className="text-[10px]">
              有产出
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Home className="h-3 w-3" />
          <span>{animal.homeBuilding || "未知"}</span>
        </div>
      </CardContent>
    </Card>
  )
}

export function MyAnimals({
  loading,
  error,
  animals,
  encyclopedia,
}: MyAnimalsProps) {
  if (loading) {
    return (
      <div className="flex min-h-[30vh] flex-col items-center justify-center gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">正在加载动物数据...</p>
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

  if (animals.length === 0) {
    return (
      <div className="flex min-h-[30vh] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-muted-foreground/30">
        <PawPrint className="h-8 w-8 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">存档中没有找到动物数据</p>
        <p className="text-xs text-muted-foreground/70">请先选择一个包含动物的存档</p>
      </div>
    )
  }

  // Group by building
  const grouped = new Map<string, OwnedAnimal[]>()
  for (const animal of animals) {
    const key = animal.homeBuilding || "未分配"
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key)!.push(animal)
  }

  const encyclopediaMap = new Map<string, AnimalEncyclopediaEntry>()
  for (const entry of encyclopedia) {
    encyclopediaMap.set(entry.id, entry)
  }

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="border border-border/60">
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold text-primary">{animals.length}</div>
            <div className="text-xs text-muted-foreground">动物总数</div>
          </CardContent>
        </Card>
        <Card className="border border-border/60">
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold text-green-500">
              {animals.filter((a) => !a.isBaby).length}
            </div>
            <div className="text-xs text-muted-foreground">成年动物</div>
          </CardContent>
        </Card>
        <Card className="border border-border/60">
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold text-amber-500">
              {animals.filter((a) => a.isBaby).length}
            </div>
            <div className="text-xs text-muted-foreground">幼崽</div>
          </CardContent>
        </Card>
        <Card className="border border-border/60">
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold text-pink-500">
              {animals.filter((a) => a.wasPet).length}
            </div>
            <div className="text-xs text-muted-foreground">已抚摸</div>
          </CardContent>
        </Card>
      </div>

      {/* Grouped by building */}
      {Array.from(grouped.entries()).map(([building, buildingAnimals]) => (
        <div key={building} className="space-y-3">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Home className="h-4 w-4 text-muted-foreground" />
            {building}
            <Badge variant="secondary" className="text-xs">
              {buildingAnimals.length}
            </Badge>
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {buildingAnimals.map((animal) => (
              <AnimalCard
                key={animal.id}
                animal={animal}
                encyclopediaEntry={encyclopediaMap.get(animal.typeName)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
