import { User } from "lucide-react"
import { cn } from "@/lib/utils"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { useTranslation } from "react-i18next"

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
  museumPieces: string[]
  friendships: FriendshipInfo[]
  farmerAppearance?: FarmerAppearance | null
  farmerAvatar?: string | null
  farmerAvatarError?: string | null
}

interface SaveInfoCardProps {
  loading: boolean
  detail: SaveDetail | null
}

export function SaveInfoCard({ loading, detail }: SaveInfoCardProps) {
  const { t } = useTranslation()
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
            <CardTitle className="text-lg font-bold">{t("settings.saveInfo.title")}</CardTitle>
            <CardDescription>
              {t("settings.saveInfo.description")}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6 pt-2">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-6 space-y-2">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
            <p className="text-xs text-muted-foreground">{t("settings.saveInfo.syncing")}</p>
          </div>
        ) : detail ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
              <div className="border p-3 rounded-lg bg-accent/25 space-y-1">
                <p className="text-muted-foreground font-medium">{t("settings.saveInfo.playerName")}</p>
                <p className="font-bold text-sm text-foreground truncate">{detail.summary.playerName}</p>
              </div>
              <div className="border p-3 rounded-lg bg-accent/25 space-y-1">
                <p className="text-muted-foreground font-medium">{t("settings.saveInfo.farmName")}</p>
                <p className="font-bold text-sm text-foreground truncate">
                  {t("settings.saveInfo.farmNameValue", { name: detail.summary.farmName })}
                </p>
              </div>
              <div className="border p-3 rounded-lg bg-accent/25 space-y-1">
                <p className="text-muted-foreground font-medium">{t("settings.saveInfo.gameDate")}</p>
                <p className="font-bold text-sm text-foreground truncate">
                  {t("settings.saveInfo.gameDateValue", {
                    season: t("seasons." + ["spring", "summer", "fall", "winter"][detail.summary.season]),
                    day: detail.summary.dayOfMonth,
                    year: detail.summary.year
                  })}
                </p>
              </div>
              <div className="border p-3 rounded-lg bg-accent/25 space-y-1">
                <p className="text-muted-foreground font-medium">{t("settings.saveInfo.money")}</p>
                <p className="font-bold text-sm text-yellow-500 truncate">{detail.summary.money.toLocaleString()}g</p>
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                {t("settings.saveInfo.skills")}
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  { name: t("settings.saveInfo.farming"), level: detail.summary.farmingLevel, color: "bg-green-500" },
                  { name: t("settings.saveInfo.mining"), level: detail.summary.miningLevel, color: "bg-blue-500" },
                  { name: t("settings.saveInfo.foraging"), level: detail.summary.foragingLevel, color: "bg-emerald-500" },
                  { name: t("settings.saveInfo.fishing"), level: detail.summary.fishingLevel, color: "bg-cyan-500" },
                  { name: t("settings.saveInfo.combat"), level: detail.summary.combatLevel, color: "bg-red-500" },
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
          <p className="text-xs text-muted-foreground py-4 text-center">{t("settings.saveInfo.noSave")}</p>
        )}
      </CardContent>
    </Card>
  )
}

