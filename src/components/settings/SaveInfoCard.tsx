import { User } from "lucide-react"
import { cn } from "@/lib/utils"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"

export interface SaveSummary {
  id: string
  playerName: string
  farmName: string
  money: number
  totalMoneyEarned: number
  dayOfMonth: number
  season: number // 0: Spring, 1: Summer, 2: Fall, 3: Winter
  year: number
  farmingLevel: number
  miningLevel: number
  combatLevel: number
  foragingLevel: number
  fishingLevel: number
  deepestMineLevel: number
  millisecondsPlayed: number
  lastSaveTime: number
  farmerAvatar?: string | null
  farmerAvatarError?: string | null
}

export interface FriendshipInfo {
  npcName: string
  points: number
}

export interface RgbaColor {
  r: number
  g: number
  b: number
  a: number
}

export interface FarmerAppearance {
  gender: string
  isMale: boolean
  hair: number
  skin: number
  shoes: string
  shirt: string
  pants: string
  accessory: number
  hatIndex?: number | null
  hatIgnoreHairstyleOffset: boolean
  hatHairDrawType?: number | null
  shirtIndex: number
  pantsIndex: number
  hairColor: RgbaColor
  eyeColor: RgbaColor
  pantsColor: RgbaColor
  shirtColor: RgbaColor
}

export interface SaveDetail {
  summary: SaveSummary
  weatherToday: string
  weatherTomorrow: string
  museumPiecesCount: number
  friendships: FriendshipInfo[]
  farmerAppearance?: FarmerAppearance | null
  farmerAvatar?: string | null
  farmerAvatarError?: string | null
}

interface SaveInfoCardProps {
  loading: boolean
  detail: SaveDetail | null
  seasons: string[]
}

export function SaveInfoCard({ loading, detail, seasons }: SaveInfoCardProps) {
  const farmerAvatar = detail?.farmerAvatar

  return (
    <Card className="overflow-hidden border border-border/80">
      <CardHeader className="bg-gradient-to-r from-primary/10 via-transparent to-transparent pb-4">
        <div className="flex items-center gap-3">
          <div className="h-16 w-14 rounded-md bg-primary/10 flex items-center justify-center border border-primary/20 shrink-0 overflow-hidden">
            {farmerAvatar ? (
              <img
                src={farmerAvatar}
                alt={detail?.summary.playerName || "Farmer"}
                className="h-full w-auto object-contain [image-rendering:pixelated]"
                draggable={false}
              />
            ) : (
              <User className="h-6 w-6 text-primary" />
            )}
          </div>
          <div>
            <CardTitle className="text-lg font-bold">当前存档信息</CardTitle>
            <CardDescription>
              自动从游戏存档文件中同步
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6 pt-2">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-6 space-y-2">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
            <p className="text-xs text-muted-foreground">正在同步农场存档数据...</p>
          </div>
        ) : detail ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
              <div className="border p-3 rounded-lg bg-accent/25 space-y-1">
                <p className="text-muted-foreground font-medium">农场主姓名</p>
                <p className="font-bold text-sm text-foreground truncate">{detail.summary.playerName}</p>
              </div>
              <div className="border p-3 rounded-lg bg-accent/25 space-y-1">
                <p className="text-muted-foreground font-medium">农场名称</p>
                <p className="font-bold text-sm text-foreground truncate">{detail.summary.farmName}农场</p>
              </div>
              <div className="border p-3 rounded-lg bg-accent/25 space-y-1">
                <p className="text-muted-foreground font-medium">游戏日期</p>
                <p className="font-bold text-sm text-foreground truncate">
                  {seasons[detail.summary.season] || "春季"} {detail.summary.dayOfMonth}日 (第{detail.summary.year}年)
                </p>
              </div>
              <div className="border p-3 rounded-lg bg-accent/25 space-y-1">
                <p className="text-muted-foreground font-medium">持有金币</p>
                <p className="font-bold text-sm text-yellow-500 truncate">{detail.summary.money.toLocaleString()}g</p>
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                技能等级 (Skills)
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  { name: "耕种 (Farming)", level: detail.summary.farmingLevel, color: "bg-green-500" },
                  { name: "采矿 (Mining)", level: detail.summary.miningLevel, color: "bg-blue-500" },
                  { name: "采集 (Foraging)", level: detail.summary.foragingLevel, color: "bg-emerald-500" },
                  { name: "钓鱼 (Fishing)", level: detail.summary.fishingLevel, color: "bg-cyan-500" },
                  { name: "战斗 (Combat)", level: detail.summary.combatLevel, color: "bg-red-500" },
                ].map((skill) => (
                  <div key={skill.name} className="space-y-1 text-xs border p-2.5 rounded-lg bg-accent/10">
                    <div className="flex justify-between items-center font-medium">
                      <span>{skill.name}</span>
                      <span className="font-bold">Lv.{skill.level}</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                      <div
                        className={cn("h-full rounded-full", skill.color)}
                        style={{ width: `${(skill.level / 10) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground py-4 text-center">暂未选定存档文件</p>
        )}
      </CardContent>
    </Card>
  )
}
