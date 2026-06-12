export interface Festival {
  name: string
  date: string
  day: number
  season: string
  description: string
}

export const FESTIVALS: Festival[] = [
  { name: "复活节 (蛋节)", date: "春季 13日", day: 13, season: "春季", description: "在镇中心参加彩蛋大寻宝！可以向皮埃尔购买草莓种子。" },
  { name: "沙漠节", date: "春季 15-17日", day: 15, season: "春季", description: "春季15-17日，前往沙漠参加节日活动，兑换独特奖励！" },
  { name: "沙漠节", date: "春季 15-17日", day: 16, season: "春季", description: "春季15-17日，前往沙漠参加节日活动，兑换独特奖励！" },
  { name: "沙漠节", date: "春季 15-17日", day: 17, season: "春季", description: "春季15-17日，前往沙漠参加节日活动，兑换独特奖励！" },
  { name: "花舞节", date: "春季 24日", day: 24, season: "春季", description: "在煤矿森林南部举行。邀请一位村民共舞以增加 1 心（250点）好感度。" },
  
  { name: "夏威夷宴会", date: "夏季 11日", day: 11, season: "夏季", description: "在沙滩上向百乐汤中加入食材。优质食材能提升全体镇民的好感度。" },
  { name: "绿雨天气", date: "夏季 约14-16日", day: 14, season: "夏季", description: "天空降下绿色酸雨，野外长满巨型杂草和苔藓，非常适合收集纤维和木材。" },
  { name: "月光水母起舞", date: "夏季 28日", season: "夏季", day: 28, description: "晚上10点在沙滩观赏绿色的月光水母，宣告夏季的结束。" },
  
  { name: "星露谷展览会", date: "秋季 16日", day: 16, season: "秋季", description: "在小镇广场展示9件农产品。根据评分获得星星币以兑换星之果实。" },
  { name: "万灵节", date: "秋季 27日", day: 27, season: "秋季", description: "在镇中心晚上10点举行。探索黄金南瓜迷宫，感受万圣节氛围。" },
  
  { name: "冰雪节", date: "冬季 8日", day: 8, season: "冬季", description: "在煤矿森林上午9点举行。参加冰钓比赛，赢得冰钓冠军奖励。" },
  { name: "鱿鱼节", date: "冬季 12-13日", day: 12, season: "冬季", description: "冬季12-13日，在沙滩进行钓鱿鱼挑战，获取丰厚海洋奖品！" },
  { name: "鱿鱼节", date: "冬季 12-13日", day: 13, season: "冬季", description: "冬季12-13日，在沙滩进行钓鱿鱼挑战，获取丰厚海洋奖品！" },
  { name: "夜市", date: "冬季 15-17日", day: 15, season: "冬季", description: "冬季15-17日傍晚5点在沙滩。购买稀有画作、种子，体验深海垂钓。" },
  { name: "夜市", date: "冬季 15-17日", day: 16, season: "冬季", description: "冬季15-17日傍晚5点在沙滩。购买稀有画作、种子，体验深海垂钓。" },
  { name: "夜市", date: "冬季 15-17日", day: 17, season: "冬季", description: "冬季15-17日傍晚5点在沙滩。购买稀有画作、种子，体验深海垂钓。" },
  { name: "冬日星盛宴", date: "冬季 25日", day: 25, season: "冬季", description: "星露谷的圣诞节。与你的神秘互赠礼友交换礼物，获取5倍好感度加成！" },
]

export interface Birthday {
  name: string
  date: string
  day: number
  season: string
}

export const BIRTHDAYS: Birthday[] = [
  { name: "肯特 (Kent)", date: "春季 4日", day: 4, season: "春季" },
  { name: "刘易斯 (Lewis)", date: "春季 7日", day: 7, season: "春季" },
  { name: "文森特 (Vincent)", date: "春季 10日", day: 10, season: "春季" },
  { name: "海莉 (Haley)", date: "春季 14日", day: 14, season: "春季" },
  { name: "潘姆 (Pam)", date: "春季 18日", day: 18, season: "春季" },
  { name: "谢恩 (Shane)", date: "春季 20日", day: 20, season: "春季" },
  { name: "皮埃尔 (Pierre)", date: "春季 26日", day: 26, season: "春季" },
  
  { name: "贾斯 (Jas)", date: "夏季 4日", day: 4, season: "夏季" },
  { name: "格斯 (Gus)", date: "夏季 8日", day: 8, season: "夏季" },
  { name: "玛鲁 (Maru)", date: "夏季 10日", day: 10, season: "夏季" },
  { name: "亚历克斯 (Alex)", date: "夏季 13日", day: 13, season: "夏季" },
  { name: "山姆 (Sam)", date: "夏季 17日", day: 17, season: "夏季" },
  { name: "德米特里厄斯 (Demetrius)", date: "夏季 19日", day: 19, season: "夏季" },
  { name: "矮人 (Dwarf)", date: "夏季 22日", day: 22, season: "夏季" },
  { name: "威利 (Willy)", date: "夏季 24日", day: 24, season: "夏季" },
  { name: "里奥 (Leo)", date: "夏季 26日", day: 26, season: "夏季" },
  
  { name: "潘妮 (Penny)", date: "秋季 2日", day: 2, season: "秋季" },
  { name: "艾略特 (Elliott)", date: "秋季 5日", day: 5, season: "秋季" },
  { name: "乔迪 (Jodi)", date: "秋季 11日", day: 11, season: "秋季" },
  { name: "阿比盖尔 (Abigail)", date: "秋季 13日", day: 13, season: "秋季" },
  { name: "桑迪 (Sandy)", date: "秋季 15日", day: 15, season: "秋季" },
  { name: "玛妮 (Marnie)", date: "秋季 18日", day: 18, season: "秋季" },
  { name: "罗宾 (Robin)", date: "秋季 21日", day: 21, season: "秋季" },
  { name: "乔治 (George)", date: "秋季 24日", day: 24, season: "秋季" },
  
  { name: "科罗布斯 (Krobus)", date: "冬季 3日", day: 3, season: "冬季" },
  { name: "莱纳斯 (Linus)", date: "冬季 7日", day: 7, season: "冬季" },
  { name: "塞巴斯蒂安 (Sebastian)", date: "冬季 10日", day: 10, season: "冬季" },
  { name: "哈维 (Harvey)", date: "冬季 14日", day: 14, season: "冬季" },
  { name: "法师 (Wizard)", date: "冬季 17日", day: 17, season: "冬季" },
  { name: "艾芙琳 (Evelyn)", date: "冬季 20日", day: 20, season: "冬季" },
  { name: "莉亚 (Leah)", date: "冬季 23日", day: 23, season: "冬季" },
  { name: "克林特 (Clint)", date: "冬季 26日", day: 26, season: "冬季" },
]

export const SEASONS_LIST = ["春季", "夏季", "秋季", "冬季"]
export const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
