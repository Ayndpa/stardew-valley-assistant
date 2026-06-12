import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import {
  Sun,
  CloudRain,
  Coins,
  Heart,
  Pickaxe,
  Fish,
  TreePine,
  Clock,
} from "lucide-react"

const statsCards = [
  {
    title: "金币",
    value: "125,840g",
    icon: <Coins className="h-5 w-5" />,
    description: "较昨日 +2,400g",
    color: "text-yellow-500",
  },
  {
    title: "农场等级",
    value: "等级 8",
    icon: <TreePine className="h-5 w-5" />,
    description: "耕种 Lv.10 · 采矿 Lv.8",
    color: "text-green-500",
  },
  {
    title: "关系进度",
    value: "12 / 28",
    icon: <Heart className="h-5 w-5" />,
    description: "已达满心的村民",
    color: "text-red-400",
  },
  {
    title: "收集进度",
    value: "68%",
    icon: <Pickaxe className="h-5 w-5" />,
    description: "博物馆捐赠 62/95",
    color: "text-blue-500",
  },
]

const todayTasks = [
  { task: "浇水 - 全部作物", done: true },
  { task: "查看旅行货车", done: true },
  { task: "给阿比盖尔送礼物", done: false },
  { task: "矿洞探索 (目标: 120层)", done: false },
  { task: "钓鱼 - 传说鱼类", done: false },
  { task: "收集季节性采集物", done: true },
]

const recentActivities = [
  { icon: <Fish className="h-4 w-4" />, text: "钓到了一条虹鳟鱼", time: "今天 08:30" },
  { icon: <Pickaxe className="h-4 w-4" />, text: "在矿洞发现了紫水晶", time: "今天 10:15" },
  { icon: <Heart className="h-4 w-4" />, text: "与莉亚的好感度提升到 6心", time: "昨天" },
  { icon: <Coins className="h-4 w-4" />, text: "出售作物获得 4,200g", time: "昨天" },
  { icon: <TreePine className="h-4 w-4" />, text: "砍伐了一棵大树获得硬木", time: "2天前" },
]

export function Dashboard() {
  return (
    <div className="p-8 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">仪表盘</h2>
          <p className="text-muted-foreground mt-1">
            春季 第15天 · 星期三
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="secondary" className="gap-1.5 px-3 py-1.5">
            <Sun className="h-4 w-4 text-yellow-500" />
            晴天
          </Badge>
          <Badge variant="secondary" className="gap-1.5 px-3 py-1.5">
            <Clock className="h-4 w-4" />
            06:00 AM
          </Badge>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {statsCards.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.title}
              </CardTitle>
              <div className={stat.color}>{stat.icon}</div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              <p className="text-xs text-muted-foreground mt-1">{stat.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Today's Tasks */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">今日待办</CardTitle>
            <CardDescription>
              已完成 {todayTasks.filter((t) => t.done).length}/{todayTasks.length} 项任务
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {todayTasks.map((item, i) => (
              <div
                key={i}
                className="flex items-center gap-3 p-2 rounded-md hover:bg-accent/50 transition-colors"
              >
                <div
                  className={`h-5 w-5 rounded-full border-2 flex items-center justify-center ${
                    item.done
                      ? "bg-primary border-primary"
                      : "border-muted-foreground/30"
                  }`}
                >
                  {item.done && (
                    <svg className="h-3 w-3 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <span
                  className={`text-sm ${
                    item.done ? "text-muted-foreground line-through" : ""
                  }`}
                >
                  {item.task}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Recent Activities */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">最近活动</CardTitle>
            <CardDescription>你的农场近期发生的事件</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {recentActivities.map((activity, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-accent">
                    {activity.icon}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm">{activity.text}</p>
                    <p className="text-xs text-muted-foreground">{activity.time}</p>
                  </div>
                  {i < recentActivities.length - 1 && (
                    <Separator className="absolute bottom-0 left-11 right-0" />
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Weather Forecast */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">天气预报</CardTitle>
          <CardDescription>未来几天的鹈鹕镇天气</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-3">
            {[
              { day: "今天", weather: "晴", icon: <Sun className="h-6 w-6 text-yellow-500" />, temp: "18°C" },
              { day: "周四", weather: "多云", icon: <CloudRain className="h-6 w-6 text-gray-400" />, temp: "16°C" },
              { day: "周五", weather: "雨", icon: <CloudRain className="h-6 w-6 text-blue-400" />, temp: "14°C" },
              { day: "周六", weather: "晴", icon: <Sun className="h-6 w-6 text-yellow-500" />, temp: "20°C" },
              { day: "周日", weather: "晴", icon: <Sun className="h-6 w-6 text-yellow-500" />, temp: "21°C" },
              { day: "周一", weather: "多云", icon: <CloudRain className="h-6 w-6 text-gray-400" />, temp: "17°C" },
              { day: "周二", weather: "暴风雨", icon: <CloudRain className="h-6 w-6 text-purple-400" />, temp: "13°C" },
            ].map((d) => (
              <div key={d.day} className="flex flex-col items-center gap-2 p-3 rounded-lg bg-accent/50">
                <span className="text-xs font-medium text-muted-foreground">{d.day}</span>
                {d.icon}
                <span className="text-sm font-medium">{d.weather}</span>
                <span className="text-xs text-muted-foreground">{d.temp}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
