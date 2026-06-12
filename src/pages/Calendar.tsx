import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  CalendarDays,
  PartyPopper,
  Gift,
  Cake,
  Fish,
  Music,
} from "lucide-react"

interface Festival {
  name: string
  date: string
  season: string
  description: string
  icon: React.ReactNode
}

const festivals: Festival[] = [
  { name: "复活节", date: "春季 13日", season: "春季", description: "在镇中心参加彩蛋大寻宝！", icon: <PartyPopper className="h-5 w-5 text-pink-500" /> },
  { name: "沙漠节", date: "春季 15-17日", season: "春季", description: "前往沙漠参加节日活动", icon: <Music className="h-5 w-5 text-yellow-500" /> },
  { name: "花舞节", date: "春季 24日", season: "春季", description: "邀请一位村民跳舞，增进友谊", icon: <Music className="h-5 w-5 text-green-500" /> },
  { name: "夏威夷宴会", date: "夏季 11日", season: "夏季", description: "为百乐汤贡献食材，展示厨艺", icon: <Fish className="h-5 w-5 text-blue-500" /> },
  { name: "月光水母起舞", date: "夏季 28日", season: "夏季", description: "在海滩观赏月光水母", icon: <Fish className="h-5 w-5 text-purple-400" /> },
  { name: "星露谷展览会", date: "秋季 16日", season: "秋季", description: "展示你的农场产品，赢取星星币", icon: <PartyPopper className="h-5 w-5 text-orange-500" /> },
  { name: "万灵节", date: "秋季 27日", season: "秋季", description: "探索镇中心的迷宫", icon: <PartyPopper className="h-5 w-5 text-purple-500" /> },
  { name: "冰雪节", date: "冬季 8日", season: "冬季", description: "在煤矿森林参加冰钓比赛", icon: <Fish className="h-5 w-5 text-cyan-500" /> },
  { name: "鱿鱼节", date: "冬季 12-13日", season: "冬季", description: "在沙滩上享受海鲜美食", icon: <Fish className="h-5 w-5 text-blue-400" /> },
  { name: "夜市", date: "冬季 15-17日", season: "冬季", description: "在海边逛夜市，购买稀有物品", icon: <PartyPopper className="h-5 w-5 text-indigo-500" /> },
  { name: "冬日星盛宴", date: "冬季 25日", season: "冬季", description: "节日大餐和秘密礼物交换", icon: <Gift className="h-5 w-5 text-red-500" /> },
]

const birthdays = [
  { name: "肯特", date: "春季 4日" },
  { name: "文森特", date: "春季 10日" },
  { name: "海莉", date: "春季 14日" },
  { name: "帕姆", date: "春季 18日" },
  { name: "谢恩", date: "春季 20日" },
  { name: "艾米丽", date: "春季 27日" },
  { name: "贾斯", date: "夏季 4日" },
  { name: "格斯", date: "夏季 8日" },
  { name: "玛鲁", date: "夏季 10日" },
  { name: "山姆", date: "夏季 17日" },
  { name: "德米特里", date: "夏季 19日" },
  { name: "矮人", date: "夏季 22日" },
  { name: "威利", date: "夏季 24日" },
  { name: "里奥", date: "夏季 26日" },
  { name: "潘妮", date: "秋季 2日" },
  { name: "艾利欧特", date: "秋季 5日" },
  { name: "乔迪", date: "秋季 11日" },
  { name: "阿比盖尔", date: "秋季 13日" },
  { name: "桑迪", date: "秋季 15日" },
  { name: "玛尼", date: "秋季 18日" },
  { name: "罗宾", date: "秋季 21日" },
  { name: "卡洛琳", date: "冬季 7日" },
  { name: "塞巴斯蒂安", date: "冬季 10日" },
  { name: "哈维", date: "冬季 14日" },
  { name: "莉亚", date: "冬季 23日" },
  { name: "莱纳斯", date: "冬季 3日" },
  { name: "乔治", date: "秋季 24日" },
  { name: "亚历克斯", date: "夏季 13日" },
  { name: "伊芙琳", date: "冬季 20日" },
  { name: "皮埃尔", date: "春季 26日" },
  { name: "巫师", date: "冬季 17日" },
]

const seasons = [
  { name: "春季", color: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" },
  { name: "夏季", color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300" },
  { name: "秋季", color: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300" },
  { name: "冬季", color: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" },
]

export function Calendar() {
  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-3xl font-bold tracking-tight">节日日历</h2>
        <p className="text-muted-foreground mt-1">
          查看鹈鹕镇的节日活动和村民生日
        </p>
      </div>

      <Tabs defaultValue="festivals" className="space-y-6">
        <TabsList>
          <TabsTrigger value="festivals" className="gap-2">
            <PartyPopper className="h-4 w-4" />
            节日活动
          </TabsTrigger>
          <TabsTrigger value="birthdays" className="gap-2">
            <Cake className="h-4 w-4" />
            村民生日
          </TabsTrigger>
          <TabsTrigger value="calendar" className="gap-2">
            <CalendarDays className="h-4 w-4" />
            日历视图
          </TabsTrigger>
        </TabsList>

        <TabsContent value="festivals">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {festivals.map((festival) => (
              <Card key={festival.name} className="hover:shadow-md transition-shadow">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent">
                        {festival.icon}
                      </div>
                      <div>
                        <CardTitle className="text-base">{festival.name}</CardTitle>
                        <CardDescription>{festival.date}</CardDescription>
                      </div>
                    </div>
                    <Badge variant="outline">{festival.season}</Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{festival.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="birthdays">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {seasons.map((season) => (
              <Card key={season.name}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Badge className={season.color}>{season.name}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {birthdays
                    .filter((b) => b.date.startsWith(season.name))
                    .sort((a, b) => {
                      const dayA = parseInt(a.date.match(/\d+/)?.[0] || "0")
                      const dayB = parseInt(b.date.match(/\d+/)?.[0] || "0")
                      return dayA - dayB
                    })
                    .map((b) => (
                      <div key={b.name} className="flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-accent/50 transition-colors">
                        <div className="flex items-center gap-2">
                          <Gift className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-sm">{b.name}</span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {b.date.replace(`${season.name} `, "")}
                        </span>
                      </div>
                    ))}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="calendar">
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-20">
              <CalendarDays className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <p className="text-muted-foreground">日历视图功能正在开发中...</p>
              <p className="text-sm text-muted-foreground/70 mt-1">
                未来你可以在这里以日历形式查看所有事件
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
