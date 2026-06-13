export interface CropLookup {
  name: string
  sellPrice: number
  regrows: boolean
  regrowDays?: number
  icon?: string | null
}

// Comprehensive crop database mapping seedIndex or harvestIndex to metadata
export const cropDb: Record<string, CropLookup> = {
  "472": { name: "防风草", sellPrice: 35, regrows: false },
  "24": { name: "防风草", sellPrice: 35, regrows: false },
  "475": { name: "土豆", sellPrice: 80, regrows: false },
  "192": { name: "土豆", sellPrice: 80, regrows: false },
  "474": { name: "花椰菜", sellPrice: 175, regrows: false },
  "190": { name: "花椰菜", sellPrice: 175, regrows: false },
  "745": { name: "草莓", sellPrice: 120, regrows: true, regrowDays: 4 },
  "400": { name: "草莓", sellPrice: 120, regrows: true, regrowDays: 4 },
  "478": { name: "大黄", sellPrice: 220, regrows: false },
  "252": { name: "大黄", sellPrice: 220, regrows: false },
  "479": { name: "甜瓜", sellPrice: 250, regrows: false },
  "254": { name: "甜瓜", sellPrice: 250, regrows: false },
  "480": { name: "番茄", sellPrice: 60, regrows: true, regrowDays: 4 },
  "256": { name: "番茄", sellPrice: 60, regrows: true, regrowDays: 4 },
  "481": { name: "蓝莓", sellPrice: 50, regrows: true, regrowDays: 4 },
  "258": { name: "蓝莓", sellPrice: 50, regrows: true, regrowDays: 4 },
  "482": { name: "辣椒", sellPrice: 40, regrows: true, regrowDays: 3 },
  "260": { name: "辣椒", sellPrice: 40, regrows: true, regrowDays: 3 },
  "485": { name: "杨桃", sellPrice: 750, regrows: false },
  "268": { name: "杨桃", sellPrice: 750, regrows: false },
  "486": { name: "玉米", sellPrice: 50, regrows: true, regrowDays: 4 },
  "270": { name: "玉米", sellPrice: 50, regrows: true, regrowDays: 4 },
  "490": { name: "南瓜", sellPrice: 320, regrows: false },
  "276": { name: "南瓜", sellPrice: 320, regrows: false },
  "493": { name: "蔓越莓", sellPrice: 75, regrows: true, regrowDays: 5 },
  "282": { name: "蔓越莓", sellPrice: 75, regrows: true, regrowDays: 5 },
  "424": { name: "葡萄", sellPrice: 80, regrows: true, regrowDays: 3 },
  "301": { name: "葡萄", sellPrice: 80, regrows: true, regrowDays: 3 },
  "495": { name: "古代水果", sellPrice: 550, regrows: true, regrowDays: 7 },
  "300": { name: "古代水果", sellPrice: 550, regrows: true, regrowDays: 7 },
  "499": { name: "苋菜", sellPrice: 150, regrows: false },
  "74": { name: "仙人掌果", sellPrice: 75, regrows: true, regrowDays: 3 },
  "90": { name: "仙人掌果", sellPrice: 75, regrows: true, regrowDays: 3 },
  "833": { name: "菠萝", sellPrice: 300, regrows: true, regrowDays: 7 },
  "834": { name: "菠萝", sellPrice: 300, regrows: true, regrowDays: 7 },
  "831": { name: "芋头", sellPrice: 150, regrows: false },
  "830": { name: "芋头", sellPrice: 150, regrows: false },
  "889": { name: "齐瓜", sellPrice: 1, regrows: false },
  "890": { name: "齐瓜", sellPrice: 1, regrows: false },
  "473": { name: "四季豆", sellPrice: 40, regrows: true, regrowDays: 3 },
  "188": { name: "四季豆", sellPrice: 40, regrows: true, regrowDays: 3 },
  "476": { name: "大蒜", sellPrice: 60, regrows: false },
  "248": { name: "大蒜", sellPrice: 60, regrows: false },
  "477": { name: "甘蓝", sellPrice: 110, regrows: false },
  "250": { name: "甘蓝", sellPrice: 110, regrows: false },
  "429": { name: "蓝色爵士乐", sellPrice: 50, regrows: false },
  "597": { name: "蓝色爵士乐", sellPrice: 50, regrows: false },
  "433": { name: "咖啡豆", sellPrice: 15, regrows: true, regrowDays: 2 },
  "CarrotSeeds": { name: "胡萝卜", sellPrice: 35, regrows: false },
  "Carrot": { name: "胡萝卜", sellPrice: 35, regrows: false },
  "SummerSquashSeeds": { name: "夏瓜", sellPrice: 45, regrows: true, regrowDays: 3 },
  "SummerSquash": { name: "夏瓜", sellPrice: 45, regrows: true, regrowDays: 3 },
  "BroccoliSeeds": { name: "西兰花", sellPrice: 70, regrows: true, regrowDays: 4 },
  "Broccoli": { name: "西兰花", sellPrice: 70, regrows: true, regrowDays: 4 },
  "PowdermelonSeeds": { name: "霜瓜", sellPrice: 60, regrows: false },
  "Powdermelon": { name: "霜瓜", sellPrice: 60, regrows: false },
  "487": { name: "红卷心菜", sellPrice: 260, regrows: false },
  "266": { name: "红卷心菜", sellPrice: 260, regrows: false },
  "484": { name: "萝卜", sellPrice: 90, regrows: false },
  "264": { name: "萝卜", sellPrice: 90, regrows: false },
  "483": { name: "小麦", sellPrice: 25, regrows: false },
  "262": { name: "小麦", sellPrice: 25, regrows: false },
  "427": { name: "啤酒花", sellPrice: 25, regrows: true, regrowDays: 1 },
  "304": { name: "啤酒花", sellPrice: 25, regrows: true, regrowDays: 1 },
  "431": { name: "夏日亮星", sellPrice: 90, regrows: false },
  "593": { name: "夏日亮星", sellPrice: 90, regrows: false },
  "425": { name: "向日葵", sellPrice: 80, regrows: false },
  "421": { name: "向日葵", sellPrice: 80, regrows: false },
  "488": { name: "茄子", sellPrice: 60, regrows: true, regrowDays: 5 },
  "272": { name: "茄子", sellPrice: 60, regrows: true, regrowDays: 5 },
  "489": { name: "朝鲜蓟", sellPrice: 160, regrows: false },
  "274": { name: "朝鲜蓟", sellPrice: 160, regrows: false },
  "491": { name: "小白菜", sellPrice: 80, regrows: false },
  "278": { name: "小白菜", sellPrice: 80, regrows: false },
  "492": { name: "山药", sellPrice: 150, regrows: false },
  "280": { name: "山药", sellPrice: 150, regrows: false },
  "494": { name: "甜菜", sellPrice: 100, regrows: false },
  "284": { name: "甜菜", sellPrice: 100, regrows: false },
  "426": { name: "仙女玫瑰", sellPrice: 290, regrows: false },
  "595": { name: "仙女玫瑰", sellPrice: 290, regrows: false },
  "347": { name: "宝石甜莓", sellPrice: 3000, regrows: false },
  "417": { name: "宝石甜莓", sellPrice: 3000, regrows: false },
  // Wild Seeds
  "SpringSeeds": { name: "春季种子 (野生)", sellPrice: 35, regrows: false },
  "SummerSeeds": { name: "夏季种子 (野生)", sellPrice: 55, regrows: false },
  "FallSeeds": { name: "秋季种子 (野生)", sellPrice: 45, regrows: false },
  "WinterSeeds": { name: "冬季种子 (野生)", sellPrice: 30, regrows: false },
}

export interface PlantedCrop {
  location: string
  x: number
  y: number
  seedId: string
  harvestId: string
  currentPhase: number
  dayOfCurrentPhase: number
  fullyGrown: boolean
  dead: boolean
  isWatered: boolean
  phaseDays: number[]
}

export interface Crop {
  seedId?: string
  harvestId?: string
  name: string
  icon?: string | null
  season: string
  seasons?: string[]
  growDays: number
  sellPrice: number
  regrows: boolean
  regrowDays?: number
  needsWatering?: boolean
  waterNeeds: string
}

export const ENCYCLOPEDIA_CROPS: Crop[] = [
  { name: "防风草", season: "春季", growDays: 4, sellPrice: 35, regrows: false, waterNeeds: "每天" },
  { name: "土豆", season: "春季", growDays: 6, sellPrice: 80, regrows: false, waterNeeds: "每天" },
  { name: "花椰菜", season: "春季", growDays: 12, sellPrice: 175, regrows: false, waterNeeds: "每天" },
  { name: "草莓", season: "春季", growDays: 8, sellPrice: 120, regrows: true, waterNeeds: "每天" },
  { name: "大黄", season: "春季", growDays: 13, sellPrice: 220, regrows: false, waterNeeds: "每天" },
  { name: "四季豆", season: "春季", growDays: 10, sellPrice: 40, regrows: true, waterNeeds: "每天" },
  { name: "胡萝卜", season: "春季", growDays: 3, sellPrice: 35, regrows: false, waterNeeds: "每天" },
  { name: "甜瓜", season: "夏季", growDays: 12, sellPrice: 250, regrows: false, waterNeeds: "每天" },
  { name: "番茄", season: "夏季", growDays: 11, sellPrice: 60, regrows: true, waterNeeds: "每天" },
  { name: "蓝莓", season: "夏季", growDays: 13, sellPrice: 50, regrows: true, waterNeeds: "每天" },
  { name: "辣椒", season: "夏季", growDays: 5, sellPrice: 40, regrows: true, waterNeeds: "每天" },
  { name: "杨桃", season: "夏季", growDays: 13, sellPrice: 750, regrows: false, waterNeeds: "每天" },
  { name: "玉米", season: "夏秋", growDays: 14, sellPrice: 50, regrows: true, waterNeeds: "每天" },
  { name: "夏瓜", season: "夏季", growDays: 6, sellPrice: 45, regrows: true, waterNeeds: "每天" },
  { name: "南瓜", season: "秋季", growDays: 13, sellPrice: 320, regrows: false, waterNeeds: "每天" },
  { name: "蔓越莓", season: "秋季", growDays: 7, sellPrice: 75, regrows: true, waterNeeds: "每天" },
  { name: "葡萄", season: "秋季", growDays: 10, sellPrice: 80, regrows: true, waterNeeds: "每天" },
  { name: "西兰花", season: "秋季", growDays: 8, sellPrice: 70, regrows: true, waterNeeds: "每天" },
  { name: "霜瓜", season: "冬季", growDays: 7, sellPrice: 60, regrows: false, waterNeeds: "每天" },
  { name: "古代水果", season: "春夏秋", growDays: 28, sellPrice: 550, regrows: true, waterNeeds: "每天" },
  { name: "宝石甜莓", season: "秋季", growDays: 24, sellPrice: 3000, regrows: false, waterNeeds: "每天" },
  { name: "菠萝", season: "全季", growDays: 14, sellPrice: 300, regrows: true, waterNeeds: "每天" },
]

export const SEASONS = ["全部", "春季", "夏季", "秋季", "冬季", "春夏秋", "全季"]

export const locationMap: Record<string, string> = {
  "Farm": "主要农场",
  "Greenhouse": "温室大棚",
  "IslandWest": "姜岛农场 (西)",
  "IslandNorth": "姜岛农场 (北)",
  "Forest": "煤矿森林",
}
