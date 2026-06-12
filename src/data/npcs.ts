export interface NPC {
  id: string
  name: string
  birthday: string
  personality: string
  lovedGifts: string[]
  likedGifts: string[]
  gender: "marriageable_male" | "marriageable_female" | "other"
}

export const ALL_NPCS: NPC[] = [
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

export const relationshipStatusMap: Record<string, string> = {
  "Friendly": "友好",
  "Dating": "恋爱中 💖",
  "Engaged": "已订婚 💍",
  "Married": "配偶 🏠",
  "Divorced": "离异 💔",
}
