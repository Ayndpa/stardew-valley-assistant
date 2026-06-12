import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import {
  Search,
  Heart,
  Gift,
  Star,
  Sparkles,
  Info,
} from "lucide-react"

// Dynamic imports will be done inline inside useEffect/handlers for reliability


interface FriendshipInfo {
  npcName: string
  points: number
  giftsThisWeek: number
  giftsToday: number
  talkedToToday: boolean
  status: string
}

interface SaveSummary {
  id: string
  playerName: string
  farmName: string
}

interface SaveDetail {
  summary: SaveSummary
  friendships: FriendshipInfo[]
}

interface NPC {
  id: string
  name: string
  birthday: string
  personality: string
  lovedGifts: string[]
  likedGifts: string[]
  gender: "marriageable_male" | "marriageable_female" | "other"
}

const ALL_NPCS: NPC[] = [
  { id: "Abigail", name: "阿比盖尔", birthday: "秋季 13日", personality: "冒险 · 叛逆", lovedGifts: ["紫水晶", "南瓜", "巧克力蛋糕", "香蕉布丁", "辣鳗鱼", "黑莓馅饼"], likedGifts: ["石英", "黄水仙"], gender: "marriageable_female" },
  { id: "Alex", name: "亚历克斯", birthday: "夏季 13日", personality: "运动 · 阳光", lovedGifts: ["完美早餐", "鲑鱼晚餐"], likedGifts: ["所有鸡蛋"], gender: "marriageable_male" },
  { id: "Caroline", name: "卡洛琳", birthday: "冬季 7日", personality: "温和 · 贤淑", lovedGifts: ["鱼卷饼", "绿茶", "夏日亮星", "热带咖喱"], likedGifts: ["水仙花", "野山葵"], gender: "other" },
  { id: "Clint", name: "克林特", birthday: "冬季 26日", personality: "内向 · 铁匠", lovedGifts: ["紫水晶", "蓝晶石", "祖母绿", "金条", "铱条", "翡翠", "全彩地壳", "红宝石", "黄玉"], likedGifts: ["铜条", "铁条"], gender: "other" },
  { id: "Demetrius", name: "德米特里厄斯", birthday: "夏季 19日", personality: "理性 · 科学家", lovedGifts: ["豆子火锅", "冰淇淋", "大米布丁", "草莓"], likedGifts: ["所有水果"], gender: "other" },
  { id: "Elliott", name: "艾略特", birthday: "秋季 5日", personality: "文艺 · 绅士", lovedGifts: ["蟹黄糕", "鸭毛", "龙虾", "石榴", "鱿鱼汁", "椰汁汤"], likedGifts: ["章鱼", "鱿鱼", "香豌豆"], gender: "marriageable_male" },
  { id: "Emily", name: "艾米丽", birthday: "春季 27日", personality: "神秘 · 友善", lovedGifts: ["紫水晶", "蓝晶石", "布料", "祖母绿", "翡翠", "红宝石", "生存汉堡", "黄玉", "羊毛"], likedGifts: ["黄水仙", "石英"], gender: "marriageable_female" },
  { id: "Evelyn", name: "艾芙琳", birthday: "冬季 20日", personality: "慈祥 · 奶奶", lovedGifts: ["甜菜", "巧克力蛋糕", "钻石", "仙女玫瑰", "填料", "郁金香"], likedGifts: ["水仙花", "野山葵"], gender: "other" },
  { id: "George", name: "乔治", birthday: "秋季 24日", personality: "倔强 · 爷爷", lovedGifts: ["炒蘑菇", "韭葱"], likedGifts: ["水仙花"], gender: "other" },
  { id: "Gus", name: "格斯", birthday: "夏季 8日", personality: "热情 · 酒馆老板", lovedGifts: ["法国蜗牛", "鱼卷饼", "橙子", "热带咖喱"], likedGifts: ["黄水仙", "野山葵"], gender: "other" },
  { id: "Haley", name: "海莉", birthday: "春季 14日", personality: "傲娇 · 时尚", lovedGifts: ["椰子", "水果沙拉", "粉红蛋糕", "向日葵"], likedGifts: ["黄水仙"], gender: "marriageable_female" },
  { id: "Harvey", name: "哈维", birthday: "冬季 14日", personality: "温柔 · 医生", lovedGifts: ["咖啡", "腌菜", "超健康餐", "松露油", "葡萄酒"], likedGifts: ["所有水果", "所有鸡蛋"], gender: "marriageable_male" },
  { id: "Jas", name: "贾斯", birthday: "夏季 4日", personality: "害羞 · 孤儿", lovedGifts: ["仙女玫瑰", "粉红蛋糕", "李子布丁"], likedGifts: ["黄水仙", "椰子"], gender: "other" },
  { id: "Jodi", name: "乔迪", birthday: "秋季 11日", personality: "操劳 · 家庭主妇", lovedGifts: ["巧克力蛋糕", "香脆鲈鱼", "钻石", "茄子干酪", "煎鳗鱼", "薄烤饼", "大黄派", "蔬菜什锦"], likedGifts: ["所有水果", "所有鸡蛋"], gender: "other" },
  { id: "Kent", name: "肯特", birthday: "春季 4日", personality: "严肃 · 退伍军人", lovedGifts: ["蕨菜烩饭", "烤榛子"], likedGifts: ["所有鸡蛋", "黄水仙"], gender: "other" },
  { id: "Krobus", name: "科罗布斯", birthday: "冬季 3日", personality: "神秘 · 下水道居民", lovedGifts: ["钻石", "铱条", "南瓜", "虚空蛋", "虚空蛋黄酱", "野山葵"], likedGifts: ["石英"], gender: "other" },
  { id: "Leah", name: "莉亚", birthday: "冬季 23日", personality: "艺术 · 独立", lovedGifts: ["山羊奶酪", "罂粟籽松饼", "沙拉", "蔬菜大杂烩", "松露", "蔬菜什锦", "葡萄酒"], likedGifts: ["黄水仙", "蒲公英", "浮木"], gender: "marriageable_female" },
  { id: "Leo", name: "里奥", birthday: "夏季 26日", personality: "孤僻 · 岛屿少年", lovedGifts: ["鸭毛", "芒果", "鸵鸟蛋", "夏威夷芋泥"], likedGifts: ["鹦鹉螺", "海胆"], gender: "other" },
  { id: "Lewis", name: "刘易斯", birthday: "春季 7日", personality: "体面 · 镇长", lovedGifts: ["秋日恩赐", "琉璃山药", "绿茶", "辣椒", "蔬菜什锦"], likedGifts: ["椰子", "蓝莓"], gender: "other" },
  { id: "Linus", name: "莱纳斯", birthday: "冬季 3日", personality: "孤高 · 流浪汉", lovedGifts: ["蓝莓馅饼", "仙人掌果", "椰子", "大海无量", "山药"], likedGifts: ["黄水仙", "蒲公英", "野山葵"], gender: "other" },
  { id: "Marnie", name: "玛妮", birthday: "秋季 18日", personality: "善良 · 牧场老板", lovedGifts: ["钻石", "农夫午餐", "南瓜派", "粉红蛋糕"], likedGifts: ["所有鸡蛋", "所有牛奶"], gender: "other" },
  { id: "Maru", name: "玛鲁", birthday: "夏季 10日", personality: "聪明 · 发明家", lovedGifts: ["电池组", "花椰菜", "芝士花椰菜", "钻石", "金条", "铱条", "矿工特供", "辣椒爆弹", "大黄派", "草莓"], likedGifts: ["石英", "铜矿石"], gender: "marriageable_female" },
  { id: "Pam", name: "潘姆", birthday: "春季 18日", personality: "嗜酒 · 司机", lovedGifts: ["啤酒", "仙人掌果", "琉璃山药", "蜂蜜酒", "麦酒", "防风草", "防风草汤", "椰林飘香"], likedGifts: ["黄水仙", "所有水果"], gender: "other" },
  { id: "Penny", name: "潘妮", birthday: "秋季 2日", personality: "温柔 · 家庭教师", lovedGifts: ["钻石", "祖母绿", "甜瓜", "罂粟", "罂粟籽松饼", "红酱装盘", "根类拼盘", "沙鱼", "椰汁汤"], likedGifts: ["蒲公英", "韭葱", "黄水仙"], gender: "marriageable_female" },
  { id: "Pierre", name: "皮埃尔", birthday: "春季 26日", personality: "精明 · 杂货铺老板", lovedGifts: ["炸鱿鱼"], likedGifts: ["所有牛奶", "黄水仙"], gender: "other" },
  { id: "Robin", name: "罗宾", birthday: "秋季 21日", personality: "能干 · 木匠", lovedGifts: ["山羊奶酪", "桃子", "意大利面"], likedGifts: ["樱桃", "野山葵", "硬木"], gender: "other" },
  { id: "Sam", name: "山姆", birthday: "夏季 17日", personality: "活泼 · 吉他手", lovedGifts: ["仙人掌果", "枫糖棒", "披萨", "虎眼石"], likedGifts: ["所有鸡蛋", "苹果"], gender: "marriageable_male" },
  { id: "Sandy", name: "桑迪", birthday: "秋季 15日", personality: "热情 · 沙漠店员", lovedGifts: ["藏红花", "黄水仙", "香豌豆", "芒果", "椰子"], likedGifts: ["羊毛", "山羊奶"], gender: "other" },
  { id: "Sebastian", name: "塞巴斯蒂安", birthday: "冬季 10日", personality: "孤僻 · 程序员", lovedGifts: ["冰泪", "黑曜石", "南瓜汤", "生鱼片", "虚空蛋"], likedGifts: ["石英", "比目鱼"], gender: "marriageable_male" },
  { id: "Shane", name: "谢恩", birthday: "春季 20日", personality: "颓废 · 傲慢", lovedGifts: ["啤酒", "辣椒", "辣椒爆弹", "披萨"], likedGifts: ["所有鸡蛋", "所有水果"], gender: "marriageable_male" },
  { id: "Vincent", name: "文森特", birthday: "春季 10日", personality: "活泼 · 顽童", lovedGifts: ["蔓越莓糖果", "姜汁汽水", "葡萄", "粉红蛋糕", "蜗牛"], likedGifts: ["椰子", "水仙花"], gender: "other" },
  { id: "Willy", name: "威利", birthday: "夏季 24日", personality: "豪爽 · 渔夫", lovedGifts: ["鲶鱼", "钻石", "铱条", "章鱼", "南瓜", "海参", "鲟鱼"], likedGifts: ["所有鱼类"], gender: "other" },
  { id: "Wizard", name: "法师", birthday: "冬季 17日", personality: "孤僻 · 魔法师", lovedGifts: ["星之书", "紫色蘑菇", "日光精华", "虚空精华", "超级黄瓜", "虚空蛋"], likedGifts: ["石英"], gender: "other" },
  { id: "Dwarf", name: "矮人", birthday: "夏季 22日", personality: "神秘 · 矿道商人", lovedGifts: ["紫水晶", "蓝晶石", "祖母绿", "翡翠", "红宝石", "黄玉", "全彩地壳"], likedGifts: ["矮人卷轴"], gender: "other" },
]

const relationshipStatusMap: Record<string, string> = {
  "Friendly": "友好",
  "Dating": "恋爱中 💖",
  "Engaged": "已订婚 💍",
  "Married": "配偶 🏠",
  "Divorced": "离异 💔",
}

const MOCK_FRIENDSHIPS: FriendshipInfo[] = [
  { npcName: "Abigail", points: 2000, giftsThisWeek: 1, giftsToday: 0, talkedToToday: true, status: "Dating" },
  { npcName: "Sebastian", points: 1500, giftsThisWeek: 0, giftsToday: 0, talkedToToday: false, status: "Friendly" },
  { npcName: "Leah", points: 2500, giftsThisWeek: 2, giftsToday: 1, talkedToToday: true, status: "Married" },
  { npcName: "Harvey", points: 1000, giftsThisWeek: 0, giftsToday: 0, talkedToToday: false, status: "Friendly" },
  { npcName: "Robin", points: 1250, giftsThisWeek: 2, giftsToday: 0, talkedToToday: true, status: "Friendly" },
]

function HeartBar({ hearts, maxHearts }: { hearts: number; maxHearts: number }) {
  return (
    <div className="flex items-center gap-0.5 flex-wrap">
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

interface NPCsProps {
  selectedSaveId: string
}

export function NPCs({ selectedSaveId }: NPCsProps) {
  const [searchTerm, setSearchTerm] = useState("")
  const [selectedNPC, setSelectedNPC] = useState<NPC | null>(null)
  const [friendships, setFriendships] = useState<Record<string, FriendshipInfo>>({})
  const [loading, setLoading] = useState(true)

  // Fetch real relationships
  useEffect(() => {
    async function loadFriendships() {
      if (!selectedSaveId) return
      setLoading(true)

      const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
      const isMock = selectedSaveId.startsWith("MockCharacter")
      if (isTauri && !isMock) {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          const detail: SaveDetail = await invoke("get_save_detail", { id: selectedSaveId })
          const map: Record<string, FriendshipInfo> = {}
          detail.friendships.forEach((f) => {
            map[f.npcName] = f
          })
          setFriendships(map)
        } catch (err) {
          console.error("Error loading friendships:", err)
          const map: Record<string, FriendshipInfo> = {}
          MOCK_FRIENDSHIPS.forEach(f => { map[f.npcName] = f })
          setFriendships(map)
        } finally {
          setLoading(false)
        }
      } else {
        const map: Record<string, FriendshipInfo> = {}
        MOCK_FRIENDSHIPS.forEach(f => { map[f.npcName] = f })
        setFriendships(map)
        setLoading(false)
      }
    }
    loadFriendships()
  }, [selectedSaveId])

  // Map and sort NPCs
  const npcList = ALL_NPCS.map((npc) => {
    const friendData = friendships[npc.id]
    const points = friendData?.points || 0
    const hearts = Math.floor(points / 250)
    const maxHearts = npc.gender !== "other" && friendData?.status === "Married" ? 14 : 10
    
    return {
      ...npc,
      points,
      hearts,
      maxHearts,
      giftsThisWeek: friendData?.giftsThisWeek || 0,
      giftsToday: friendData?.giftsToday || 0,
      talkedToToday: friendData?.talkedToToday || false,
      status: friendData?.status || "Friendly",
      isMet: !!friendData,
    }
  })

  // Filter list by search term
  const filteredNPCs = npcList.filter((npc) =>
    npc.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    npc.id.toLowerCase().includes(searchTerm.toLowerCase())
  ).sort((a, b) => {
    // met first, then sort by points desc, then by name
    if (a.isMet && !b.isMet) return -1
    if (!a.isMet && b.isMet) return 1
    if (b.points !== a.points) return b.points - a.points
    return a.name.localeCompare(b.name)
  })

  // Set default selected NPC
  useEffect(() => {
    if (filteredNPCs.length > 0 && !selectedNPC) {
      setSelectedNPC(ALL_NPCS.find(n => n.id === filteredNPCs[0].id) || null)
    }
  }, [filteredNPCs, selectedNPC])

  // Get active selected NPC details
  const activeNPC = selectedNPC ? npcList.find(n => n.id === selectedNPC.id) : null

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-3xl font-bold tracking-tight">村民关系</h2>
        <p className="text-muted-foreground mt-1">
          管理你与鹈鹕镇村民的关系、送礼进度和喜好偏好
        </p>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* NPC List */}
        <div className="w-full lg:w-80 space-y-4 shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="搜索村民姓名或拼音..."
              className="pl-10"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.currentTarget.value)}
            />
          </div>

          <div className="h-[60vh] overflow-y-auto border rounded-lg p-2 space-y-1 bg-accent/10">
            {loading ? (
              <div className="flex flex-col items-center justify-center h-full space-y-2">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
                <p className="text-xs text-muted-foreground">正在加载好感度...</p>
              </div>
            ) : filteredNPCs.map((npc) => (
              <button
                key={npc.id}
                className={`w-full flex items-center gap-3 p-2.5 rounded-lg text-left transition-colors ${
                  selectedNPC?.id === npc.id
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-accent/50"
                }`}
                onClick={() => setSelectedNPC(ALL_NPCS.find(n => n.id === npc.id) || null)}
              >
                <div className={`h-9 w-9 rounded-full flex items-center justify-center text-sm font-bold ${selectedNPC?.id === npc.id ? "bg-primary-foreground/20 text-primary-foreground" : "bg-primary/10 text-primary"}`}>
                  {npc.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-center">
                    <p className="text-sm font-semibold truncate">{npc.name}</p>
                    {npc.status !== "Friendly" && (
                      <span className={`text-[10px] ${selectedNPC?.id === npc.id ? "text-primary-foreground/80" : "text-primary"}`}>
                        {relationshipStatusMap[npc.status] || npc.status}
                      </span>
                    )}
                  </div>
                  <HeartBar hearts={npc.hearts} maxHearts={npc.maxHearts} />
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* NPC Detail */}
        <div className="flex-1">
          {activeNPC ? (
            <Card className="h-full">
              <CardHeader className="pb-4 border-b bg-accent/5">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center border-2 border-primary/20">
                      <span className="text-2xl font-bold text-primary">
                        {activeNPC.name.charAt(0)}
                      </span>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-2xl font-bold">{activeNPC.name}</CardTitle>
                        <Badge variant="secondary" className="text-xs font-semibold">{activeNPC.personality}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        生日: {activeNPC.birthday} · 内部标识: {activeNPC.id}
                      </p>
                    </div>
                  </div>

                  {/* Talked and Gifted Indicators */}
                  <div className="flex gap-2">
                    {activeNPC.talkedToToday ? (
                      <Badge className="bg-green-500 hover:bg-green-600 text-xs font-medium py-1 px-2.5">
                        今天已交谈 💬
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs font-medium py-1 px-2.5">
                        今天未交谈 🤫
                      </Badge>
                    )}

                    {activeNPC.giftsToday > 0 ? (
                      <Badge className="bg-amber-500 hover:bg-amber-600 text-xs font-medium py-1 px-2.5">
                        今天已送礼 🎁
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs font-medium py-1 px-2.5">
                        今天未送礼 📦
                      </Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6 pt-6">
                {/* Friendship Heart Stats */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-accent/20 p-4 rounded-lg">
                  <div>
                    <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                      <Heart className="h-4 w-4 text-red-500 fill-red-500" />
                      好感度进度
                    </h3>
                    <div className="flex items-center gap-2">
                      <HeartBar hearts={activeNPC.hearts} maxHearts={activeNPC.maxHearts} />
                      <span className="text-sm font-bold">
                        {activeNPC.hearts} / {activeNPC.maxHearts} 心
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      当前点数: {activeNPC.points}g / {(activeNPC.maxHearts * 250)}g (250点/心)
                    </p>
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                      <Gift className="h-4 w-4 text-amber-500" />
                      本周送礼限制 (限2次)
                    </h3>
                    <div className="flex items-center gap-2">
                      <div className="w-full bg-muted rounded-full h-2 overflow-hidden flex-1">
                        <div
                          className="h-full rounded-full bg-amber-500 transition-all duration-300"
                          style={{ width: `${(activeNPC.giftsThisWeek / 2) * 100}%` }}
                        />
                      </div>
                      <span className="text-sm font-bold">{activeNPC.giftsThisWeek} / 2 次</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {activeNPC.giftsThisWeek >= 2 ? "⚠️ 本周送礼已达上限，周日将重置计数" : "本周还可送礼 " + (2 - activeNPC.giftsThisWeek) + " 次"}
                    </p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    <h4 className="text-sm font-bold">村民状态</h4>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                    <div className="border p-2.5 rounded-md bg-background">
                      <p className="text-muted-foreground">关系状态</p>
                      <p className="font-semibold text-sm mt-0.5">{relationshipStatusMap[activeNPC.status] || activeNPC.status}</p>
                    </div>
                    <div className="border p-2.5 rounded-md bg-background">
                      <p className="text-muted-foreground">是否结识</p>
                      <p className="font-semibold text-sm mt-0.5">{activeNPC.isMet ? "已结识" : "未结识 ❓"}</p>
                    </div>
                    <div className="border p-2.5 rounded-md bg-background">
                      <p className="text-muted-foreground">社交类型</p>
                      <p className="font-semibold text-sm mt-0.5">
                        {activeNPC.gender === "marriageable_female" ? "单身女性" : activeNPC.gender === "marriageable_male" ? "单身男性" : "鹈鹕镇居民"}
                      </p>
                    </div>
                    <div className="border p-2.5 rounded-md bg-background">
                      <p className="text-muted-foreground">社交成就点</p>
                      <p className="font-semibold text-sm mt-0.5">{activeNPC.points} 点</p>
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Loved Gifts */}
                <div>
                  <h3 className="text-sm font-bold mb-3 flex items-center gap-2 text-red-500">
                    <Heart className="h-4 w-4 fill-red-500 text-red-500" />
                    最爱礼物 (Loved) - 好感度增加 80 点
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {activeNPC.lovedGifts.map((gift) => (
                      <Badge key={gift} className="gap-1 bg-red-500/10 text-red-500 border border-red-500/20 font-semibold text-xs py-1">
                        <Star className="h-3.5 w-3.5 fill-red-500" />
                        {gift}
                      </Badge>
                    ))}
                  </div>
                </div>

                {/* Liked Gifts */}
                <div>
                  <h3 className="text-sm font-bold mb-3 flex items-center gap-2 text-emerald-500">
                    <Gift className="h-4 w-4 text-emerald-500" />
                    喜欢礼物 (Liked) - 好感度增加 45 点
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {activeNPC.likedGifts.map((gift) => (
                      <Badge key={gift} variant="secondary" className="gap-1 bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 font-semibold text-xs py-1">
                        {gift}
                      </Badge>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="h-full">
              <CardContent className="flex flex-col items-center justify-center py-20">
                <Info className="h-12 w-12 text-muted-foreground/40 mb-4" />
                <p className="text-muted-foreground">正在加载村民关系面板...</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

