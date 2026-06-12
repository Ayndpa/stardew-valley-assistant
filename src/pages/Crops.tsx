import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  Search,
  Sprout,
  Droplets,
  Calendar,
  Coins,
  Filter,
} from "lucide-react"

interface Crop {
  name: string
  season: string
  growDays: number
  sellPrice: number
  regrows: boolean
  waterNeeds: string
}

const crops: Crop[] = [
  { name: "防风草", season: "春季", growDays: 4, sellPrice: 35, regrows: false, waterNeeds: "每天" },
  { name: "土豆", season: "春季", growDays: 6, sellPrice: 80, regrows: false, waterNeeds: "每天" },
  { name: "花椰菜", season: "春季", growDays: 12, sellPrice: 175, regrows: false, waterNeeds: "每天" },
  { name: "草莓", season: "春季", growDays: 8, sellPrice: 120, regrows: true, waterNeeds: "每天" },
  { name: "大黄", season: "春季", growDays: 13, sellPrice: 220, regrows: false, waterNeeds: "每天" },
  { name: "甜瓜", season: "夏季", growDays: 12, sellPrice: 250, regrows: false, waterNeeds: "每天" },
  { name: "番茄", season: "夏季", growDays: 11, sellPrice: 60, regrows: true, waterNeeds: "每天" },
  { name: "蓝莓", season: "夏季", growDays: 13, sellPrice: 50, regrows: true, waterNeeds: "每天" },
  { name: "辣椒", season: "夏季", growDays: 5, sellPrice: 40, regrows: true, waterNeeds: "每天" },
  { name: "杨桃", season: "夏季", growDays: 13, sellPrice: 750, regrows: false, waterNeeds: "每天" },
  { name: "玉米", season: "夏秋", growDays: 14, sellPrice: 50, regrows: true, waterNeeds: "每天" },
  { name: "南瓜", season: "秋季", growDays: 13, sellPrice: 320, regrows: false, waterNeeds: "每天" },
  { name: "蔓越莓", season: "秋季", growDays: 7, sellPrice: 75, regrows: true, waterNeeds: "每天" },
  { name: "葡萄", season: "秋季", growDays: 10, sellPrice: 80, regrows: true, waterNeeds: "每天" },
  { name: "古代水果", season: "全季", growDays: 28, sellPrice: 550, regrows: true, waterNeeds: "每天" },
  { name: "星之果实", season: "全季", growDays: 24, sellPrice: 3000, regrows: false, waterNeeds: "每天" },
]

const seasons = ["全部", "春季", "夏季", "秋季", "全季", "夏秋"]

export function Crops() {
  const [searchTerm, setSearchTerm] = useState("")
  const [activeSeason, setActiveSeason] = useState("全部")

  const filteredCrops = crops.filter((crop) => {
    const matchesSearch = crop.name.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesSeason = activeSeason === "全部" || crop.season === activeSeason
    return matchesSearch && matchesSeason
  })

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-3xl font-bold tracking-tight">作物管理</h2>
        <p className="text-muted-foreground mt-1">
          浏览和规划你的作物种植方案
        </p>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索作物..."
            className="pl-10"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.currentTarget.value)}
          />
        </div>
        <Button variant="outline" size="sm" className="gap-2">
          <Filter className="h-4 w-4" />
          筛选
        </Button>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="all" className="space-y-4">
        <TabsList>
          <TabsTrigger value="all">作物图鉴</TabsTrigger>
          <TabsTrigger value="planning">种植规划</TabsTrigger>
          <TabsTrigger value="profit">收益计算</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="space-y-4">
          {/* Season Filter */}
          <div className="flex gap-2 flex-wrap">
            {seasons.map((season) => (
              <Button
                key={season}
                variant={activeSeason === season ? "default" : "outline"}
                size="sm"
                onClick={() => setActiveSeason(season)}
              >
                {season}
              </Button>
            ))}
          </div>

          {/* Crop Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredCrops.map((crop) => (
              <Card key={crop.name} className="hover:shadow-md transition-shadow">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Sprout className="h-4 w-4 text-green-500" />
                      {crop.name}
                    </CardTitle>
                    <Badge variant="secondary">{crop.season}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Calendar className="h-3.5 w-3.5" />
                      <span>生长: {crop.growDays}天</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Coins className="h-3.5 w-3.5" />
                      <span>售价: {crop.sellPrice}g</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Droplets className="h-3.5 w-3.5" />
                      <span>浇水: {crop.waterNeeds}</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Sprout className="h-3.5 w-3.5" />
                      <span>{crop.regrows ? "可再生" : "一次性"}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="planning">
          <Card>
            <CardHeader>
              <CardTitle>种植规划</CardTitle>
              <CardDescription>规划每个季节的种植方案（功能开发中）</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Sprout className="h-12 w-12 text-muted-foreground/50 mb-4" />
                <p className="text-muted-foreground">种植规划功能正在开发中...</p>
                <p className="text-sm text-muted-foreground/70 mt-1">
                  未来你可以在这里规划每个季节的作物布局
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="profit">
          <Card>
            <CardHeader>
              <CardTitle>收益计算器</CardTitle>
              <CardDescription>计算不同作物的收益（功能开发中）</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Coins className="h-12 w-12 text-muted-foreground/50 mb-4" />
                <p className="text-muted-foreground">收益计算器正在开发中...</p>
                <p className="text-sm text-muted-foreground/70 mt-1">
                  未来你可以在这里计算每种作物的每日收益
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
