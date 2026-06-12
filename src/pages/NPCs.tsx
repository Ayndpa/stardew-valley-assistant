import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import {
  Search,
  Heart,
  Gift,
  Star,
} from "lucide-react"

interface NPC {
  name: string
  birthday: string
  personality: string
  lovedGifts: string[]
  likedGifts: string[]
  hearts: number
  maxHearts: number
}

const npcs: NPC[] = [
  {
    name: "阿比盖尔",
    birthday: "秋季 13日",
    personality: "冒险",
    lovedGifts: ["紫水晶", "南瓜", "巧克力蛋糕"],
    likedGifts: ["黄水仙", "韭葱", "炒鳗鱼"],
    hearts: 8,
    maxHearts: 10,
  },
  {
    name: "塞巴斯蒂安",
    birthday: "冬季 10日",
    personality: "内向",
    lovedGifts: ["冷冻泪珠", "生鱼片", "南瓜汤"],
    likedGifts: ["椰子", "石榴", "炒蘑菇"],
    hearts: 6,
    maxHearts: 10,
  },
  {
    name: "莉亚",
    birthday: "冬季 23日",
    personality: "艺术",
    lovedGifts: ["沙拉", "松露", "葡萄酒"],
    likedGifts: ["蒲公英", "韭葱", "水果"],
    hearts: 10,
    maxHearts: 10,
  },
  {
    name: "哈维",
    birthday: "冬季 14日",
    personality: "温和",
    lovedGifts: ["咖啡", "腌菜", "松露"],
    likedGifts: ["黄水仙", "水果", "鸡蛋"],
    hearts: 4,
    maxHearts: 10,
  },
  {
    name: "玛鲁",
    birthday: "夏季 10日",
    personality: "聪明",
    lovedGifts: ["电池组", "花椰菜", "钻石"],
    likedGifts: ["铜矿石", "金矿石", "草莓"],
    hearts: 7,
    maxHearts: 10,
  },
  {
    name: "艾米丽",
    birthday: "春季 27日",
    personality: "友善",
    lovedGifts: ["布料", "翡翠", "向日葵"],
    likedGifts: ["黄水仙", "羊毛", "水果"],
    hearts: 10,
    maxHearts: 10,
  },
  {
    name: "谢恩",
    birthday: "春季 20日",
    personality: "暴躁",
    lovedGifts: ["啤酒", "辣椒", "披萨"],
    likedGifts: ["面包", "鸡蛋", "蘑菇"],
    hearts: 3,
    maxHearts: 10,
  },
  {
    name: "山姆",
    birthday: "夏季 17日",
    personality: "活泼",
    lovedGifts: ["披萨", "仙人掌果", "枫糖棒"],
    likedGifts: ["黄水仙", "水果", "面包"],
    hearts: 5,
    maxHearts: 10,
  },
  {
    name: "佩妮",
    birthday: "秋季 2日",
    personality: "温柔",
    lovedGifts: ["甜瓜", "钻石", "南瓜"],
    likedGifts: ["蒲公英", "韭葱", "黄水仙"],
    hearts: 2,
    maxHearts: 10,
  },
  {
    name: "艾利欧特",
    birthday: "秋季 5日",
    personality: "浪漫",
    lovedGifts: ["螃蟹蛋糕", "石榴", "鱿鱼"],
    likedGifts: ["黄水仙", "水果", "披萨"],
    hearts: 9,
    maxHearts: 10,
  },
]

function HeartBar({ hearts, maxHearts }: { hearts: number; maxHearts: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: maxHearts }).map((_, i) => (
        <Heart
          key={i}
          className={`h-3.5 w-3.5 ${
            i < hearts ? "fill-red-500 text-red-500" : "text-muted-foreground/30"
          }`}
        />
      ))}
    </div>
  )
}

export function NPCs() {
  const [searchTerm, setSearchTerm] = useState("")
  const [selectedNPC, setSelectedNPC] = useState<NPC | null>(null)

  const filteredNPCs = npcs.filter((npc) =>
    npc.name.toLowerCase().includes(searchTerm.toLowerCase())
  )

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-3xl font-bold tracking-tight">村民关系</h2>
        <p className="text-muted-foreground mt-1">
          管理你与鹈鹕镇村民的关系和礼物偏好
        </p>
      </div>

      <div className="flex gap-6">
        {/* NPC List */}
        <div className="w-80 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="搜索村民..."
              className="pl-10"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.currentTarget.value)}
            />
          </div>

          <div className="space-y-2">
            {filteredNPCs.map((npc) => (
              <button
                key={npc.name}
                className={`w-full flex items-center gap-3 p-3 rounded-lg text-left transition-colors ${
                  selectedNPC?.name === npc.name
                    ? "bg-accent"
                    : "hover:bg-accent/50"
                }`}
                onClick={() => setSelectedNPC(npc)}
              >
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <span className="text-sm font-bold text-primary">
                    {npc.name.charAt(0)}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{npc.name}</p>
                  <HeartBar hearts={npc.hearts} maxHearts={npc.maxHearts} />
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* NPC Detail */}
        <div className="flex-1">
          {selectedNPC ? (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-4">
                  <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                    <span className="text-2xl font-bold text-primary">
                      {selectedNPC.name.charAt(0)}
                    </span>
                  </div>
                  <div>
                    <CardTitle className="text-2xl">{selectedNPC.name}</CardTitle>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="secondary">{selectedNPC.personality}</Badge>
                      <span className="text-sm text-muted-foreground">
                        生日: {selectedNPC.birthday}
                      </span>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Hearts */}
                <div>
                  <h3 className="text-sm font-medium mb-2">好感度</h3>
                  <div className="flex items-center gap-2">
                    <HeartBar hearts={selectedNPC.hearts} maxHearts={selectedNPC.maxHearts} />
                    <span className="text-sm text-muted-foreground">
                      {selectedNPC.hearts}/{selectedNPC.maxHearts} 心
                    </span>
                  </div>
                </div>

                <Separator />

                {/* Loved Gifts */}
                <div>
                  <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                    <Heart className="h-4 w-4 text-red-500 fill-red-500" />
                    最爱的礼物
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {selectedNPC.lovedGifts.map((gift) => (
                      <Badge key={gift} className="gap-1">
                        <Star className="h-3 w-3" />
                        {gift}
                      </Badge>
                    ))}
                  </div>
                </div>

                {/* Liked Gifts */}
                <div>
                  <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                    <Gift className="h-4 w-4 text-green-500" />
                    喜欢的礼物
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {selectedNPC.likedGifts.map((gift) => (
                      <Badge key={gift} variant="secondary" className="gap-1">
                        {gift}
                      </Badge>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-20">
                <Users className="h-12 w-12 text-muted-foreground/50 mb-4" />
                <p className="text-muted-foreground">选择一个村民查看详细信息</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

function Users({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
    </svg>
  )
}
