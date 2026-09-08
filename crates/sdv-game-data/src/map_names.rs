pub fn map_display_name(map_id: &str) -> Option<&'static str> {
    if let Some(name) = map_name_for_key(map_id) {
        return Some(name);
    }

    let normalized = normalize_map_id(map_id);
    map_name_for_key(normalized.as_str())
}

pub fn map_display_name_zh(map_id: &str) -> Option<&'static str> {
    if let Some(name) = map_name_for_key_zh(map_id) {
        return Some(name);
    }

    let normalized = normalize_map_id(map_id);
    map_name_for_key_zh(normalized.as_str())
}

fn normalize_map_id(map_id: &str) -> String {
    let base = map_id
        .strip_prefix("Maps/")
        .unwrap_or(map_id)
        .trim_end_matches(".xnb");

    let base = match base.split_once('-') {
        Some((prefix, _)) => prefix,
        None => base,
    };

    if base.starts_with("Farm_") {
        return "Farm".to_string();
    }
    if base.starts_with("Beach_") {
        return "Beach".to_string();
    }
    if base.starts_with("Forest_") {
        return "Forest".to_string();
    }
    if base.starts_with("Mountain_") {
        return "Mountain".to_string();
    }
    if base.starts_with("Town_") {
        return "Town".to_string();
    }
    if base.starts_with("Island_SE") {
        return "Island_SE".to_string();
    }
    if base.starts_with("Island_S") {
        return "Island_S".to_string();
    }
    if base.starts_with("Island_N") {
        return "Island_N".to_string();
    }
    if base.starts_with("Island_W") {
        return "Island_W".to_string();
    }
    if base.starts_with("Island_E") {
        return "Island_E".to_string();
    }
    if base.starts_with("Mines/") {
        return "Mines".to_string();
    }

    base.to_string()
}

fn map_name_for_key(key: &str) -> Option<&'static str> {
    Some(match key {
        // Location data keys from Locations.xnb (used by fishing)
        "IslandWest" => "Ginger Island West",
        "IslandEast" => "Ginger Island East",
        "IslandNorth" => "Ginger Island North",
        "IslandSouth" => "Ginger Island South",
        "IslandSouthEast" => "Ginger Island Southeast",
        "Temp" => "Temporary",
        "AbandonedJojaMart" => "Abandoned Joja Mart",
        "AdventureGuild" => "Adventurer's Guild",
        "AnimalShop" => "Marnie's Ranch",
        "ArchaeologyHouse" => "Museum",
        "Backwoods" | "Backwoods_GraveSite" | "Backwoods_Staircase" => "Backwoods",
        "Barn" | "Barn2" | "Barn3" => "Barn",
        "BathHouse_Entry" => "Bathhouse Entry",
        "BathHouse_MensLocker" => "Men's Locker Room",
        "BathHouse_Pool" => "Spa",
        "BathHouse_WomensLocker" => "Women's Locker Room",
        "Beach" => "Beach",
        "Beach_SquidFest" => "Beach (Squid Fest)",
        "Beach_SquidFest_Revert" | "Beach_SquidFestSign_Revert" => "Beach (Post Squid Fest)",
        "Beach-Jellies" | "Beach-Jellies2" => "Beach (Dance of the Moonlight Jellies)",
        "Beach-Luau" | "Beach-Luau2" => "Beach (Luau)",
        "Beach-NightMarket" => "Beach (Night Market)",
        "Blacksmith" => "Blacksmith",
        "BoatTunnel" => "Willy's Boat Tunnel",
        "BugLand" => "Mutant Bug Lair",
        "BusStop" => "Bus Stop",
        "Caldera" => "Caldera",
        "Cellar" | "FarmHouse_Cellar" => "Cellar",
        "Club" => "Qi's Casino",
        "CommunityCenter_Joja" => "JojaMart Warehouse",
        "CommunityCenter_Refurbished" => "Community Center",
        "CommunityCenter_Ruins" => "Abandoned Community Center",
        "Coop" | "Coop2" | "Coop3" => "Coop",
        "Darkroom" => "Darkroom",
        "Desert" => "Desert",
        "Desert-Festival" => "Desert (Desert Festival)",
        "ElliottHouse" => "Elliott's Cabin",
        "ElliottSea" => "Elliott's Seaside",
        "EmilyDreamscape" => "Emily's Dreamscape",
        "Farm" => "Farm",
        "Farm_Combat" => "Farm (Wilderness)",
        "Farm_Fishing" => "Farm (Riverland)",
        "Farm_Foraging" => "Farm (Forest)",
        "Farm_FourCorners" => "Farm (Four Corners)",
        "Farm_Mining" => "Farm (Hilltop)",
        "Farm_Ranching" => "Farm (Standard)",
        "Farm_Island" => "Ginger Island Farm",
        "FarmCave" => "Farm Cave",
        "FarmHouse"
        | "FarmHouse1"
        | "FarmHouse1_marriage"
        | "FarmHouse2"
        | "FarmHouse2_marriage" => "Farmhouse",
        "FishShop" => "Willy's Fish Shop",
        "FishingGame" => "Fishing Minigame",
        "Forest" => "Cindersap Forest",
        "Forest_FishingDerby" => "Cindersap Forest (Trout Derby)",
        "Forest_FishingDerby_Revert"
        | "Forest_FishingDerbySign"
        | "Forest_FishingDerbySign_Revert" => "Cindersap Forest (Post Trout Derby)",
        "Forest_RaccoonHouse" => "Cindersap Forest (Restored Tree)",
        "Forest_RaccoonStump" => "Cindersap Forest (Tree Stump)",
        "Forest-FlowerFestival" | "Forest-FlowerFestival2" => "Cindersap Forest (Flower Dance)",
        "Forest-IceFestival" | "Forest-IceFestival2" => "Cindersap Forest (Festival of Ice)",
        "Forest-SewerClean" => "Cindersap Forest (After Sewer Cleanup)",
        "Greenhouse" | "Farm_Greenhouse_Dirt" | "Farm_Greenhouse_Dirt_FourCorners" => "Greenhouse",
        "HaleyHouse" => "Haley and Emily's House",
        "HarveyBalloon" => "Harvey's Balloon",
        "HarveyRoom" => "Harvey's Room",
        "Hospital" => "Harvey's Clinic",
        "Island_CaptainRoom" => "Captain's Room",
        "Island_E" => "Ginger Island East",
        "Island_FarmCave" => "Ginger Island Farm Cave",
        "Island_FieldOffice" => "Field Office",
        "Island_House_Cave" => "Ginger Island Hut Cave",
        "Island_House_Restored" => "Ginger Island Hut",
        "Island_Hut" => "Ginger Island Hut",
        "Island_N" | "Island_N_Trader" => "Ginger Island North",
        "Island_Resort" => "Island Resort",
        "Island_S" => "Ginger Island South",
        "Island_SE" => "Ginger Island Southeast",
        "Island_Secret" => "Ginger Island Secret Area",
        "Island_Shrine" => "Gem Bird Shrine",
        "Island_W" | "Island_W_Obelisk" => "Ginger Island West",
        "IslandFarmHouse" => "Ginger Island Farmhouse",
        "IslandNorthCave1" => "Volcano Cave Entrance",
        "IslandSouthEastCave" => "Pirate Cove",
        "IslandSouthEastCave_pirates" => "Pirate Cove",
        "IslandWestCave1" => "Qi's Walnut Room Entrance",
        "JojaMart" => "JojaMart",
        "JoshHouse" => "Alex's House",
        "LeahHouse" => "Leah's Cottage",
        "LeoTreeHouse" => "Leo's Treehouse",
        "LewisBasement" => "Lewis's Basement",
        "ManorHouse" => "Mayor's Manor",
        "MarnieBarn" => "Marnie's Barn",
        "MaruBasement" => "Maru's Basement",
        "MasteryCave" => "Mastery Cave",
        "MermaidHouse" => "Mermaid's House",
        "Mine" | "Mines" => "The Mines",
        "Mountain" => "Mountain",
        "Mountain_Shortcuts" => "Mountain (Shortcuts Restored)",
        "Mountain-BridgeFixed" => "Mountain (Bridge Repaired)",
        "MovieTheater" => "Movie Theater",
        "MovieTheaterScreen" => "Movie Theater Screen",
        "NightSceneMaruMap" | "NightSceneMaruMap2" => "Maru's Nighttime View",
        "QiNutRoom" => "Qi's Walnut Room",
        "Railroad" => "Railroad",
        "RefurbishedSaloonRoom" => "Refurbished Saloon Room",
        "Saloon" => "Stardrop Saloon",
        "SamHouse" => "Sam's House",
        "SamShow" => "Sam's Concert",
        "SandyHouse" => "Oasis",
        "ScienceHouse" => "Carpenter Shop",
        "SebastianMountain" => "Sebastian's Motorcycle Route",
        "SebastianRide" => "Sebastian's Motorcycle",
        "SebastianRoom" => "Sebastian's Room",
        "SeedShop" => "Pierre's General Store",
        "Sewer" => "Sewers",
        "Shed" | "Shed2" => "Shed",
        "SkullCave" => "Skull Cavern",
        "SkullCaveAltar" => "Skull Cavern Altar",
        "SlimeHutch" => "Slime Hutch",
        "Stadium" => "Stadium",
        "Submarine" => "Submarine",
        "Summit" => "Summit",
        "Sunroom" => "Sunroom",
        "TargetGame" => "Target Minigame",
        "Tent" => "Tent",
        "Town" => "Pelican Town",
        "Town-TrashGone" => "Pelican Town (Trash Removed)",
        "Town-DogHouse" => "Pelican Town (Dog House Repaired)",
        "Town-Christmas" | "Town-Christmas2" => "Pelican Town (Feast of the Winter Star)",
        "Town-EggFestival" | "Town-EggFestival2" => "Pelican Town (Egg Festival)",
        "Town-Fair" | "Town-Fair2" => "Pelican Town (Stardew Valley Fair)",
        "Town-Halloween" | "Town-Halloween2" => "Pelican Town (Spirit's Eve)",
        "Town-Theater" => "Pelican Town (Movie Theater Restored)",
        "Town-TheaterCC" => "Pelican Town (Community Center & Theater Restored)",
        "Town-TheaterCC-Halloween2" => "Pelican Town (Spirit's Eve, Theater Restored)",
        "Trailer" | "Trailer_big" => "Trailer",
        "Tunnel" => "Tunnel",
        "WitchHut" => "Witch's Hut",
        "WitchSwamp" => "Witch's Swamp",
        "WitchWarpCave" => "Witch's Warp Cave",
        "WizardHouse" => "Wizard's Tower",
        "WizardHouseBasement" => "Wizard's Tower Basement",
        "Woods" => "Secret Woods",
        _ => return None,
    })
}

fn map_name_for_key_zh(key: &str) -> Option<&'static str> {
    Some(match key {
        // Location data keys from Locations.xnb (used by fishing)
        "IslandWest" => "姜岛西部",
        "IslandEast" => "姜岛东部",
        "IslandNorth" => "姜岛北部",
        "IslandSouth" => "姜岛南部",
        "IslandSouthEast" => "姜岛东南部",
        "Temp" => "临时区域",
        "AbandonedJojaMart" => "废弃Joja超市",
        "AdventureGuild" => "冒险家公会",
        "AnimalShop" => "玛妮的牧场",
        "ArchaeologyHouse" => "博物馆",
        "Backwoods" | "Backwoods_GraveSite" | "Backwoods_Staircase" => "后巷",
        "Barn" | "Barn2" | "Barn3" => "畜棚",
        "BathHouse_Entry" => "浴室入口",
        "BathHouse_MensLocker" => "男更衣室",
        "BathHouse_Pool" => "温泉",
        "BathHouse_WomensLocker" => "女更衣室",
        "Beach" => "海滩",
        "Beach_SquidFest" => "海滩（鱿鱼节）",
        "Beach_SquidFest_Revert" | "Beach_SquidFestSign_Revert" => "海滩（鱿鱼节后）",
        "Beach-Jellies" | "Beach-Jellies2" => "海滩（月光水母舞会）",
        "Beach-Luau" | "Beach-Luau2" => "海滩（夏威夷宴会）",
        "Beach-NightMarket" => "海滩（夜市）",
        "Blacksmith" => "铁匠铺",
        "BoatTunnel" => "威利的船隧道",
        "BugLand" => "变异虫穴",
        "BusStop" => "巴士站",
        "Caldera" => "火山口",
        "Cellar" | "FarmHouse_Cellar" => "地窖",
        "Club" => "齐先生的赌场",
        "CommunityCenter_Joja" => "Joja仓库",
        "CommunityCenter_Refurbished" => "社区中心",
        "CommunityCenter_Ruins" => "废弃社区中心",
        "Coop" | "Coop2" | "Coop3" => "鸡舍",
        "Darkroom" => "暗房",
        "Desert" => "沙漠",
        "Desert-Festival" => "沙漠（沙漠节）",
        "ElliottHouse" => "艾利欧特的小屋",
        "ElliottSea" => "艾利欧特的海边",
        "EmilyDreamscape" => "艾米丽的梦境",
        "Farm" => "农场",
        "Farm_Combat" => "农场（荒野）",
        "Farm_Fishing" => "农场（河流）",
        "Farm_Foraging" => "农场（森林）",
        "Farm_FourCorners" => "农场（四角）",
        "Farm_Mining" => "农场（山顶）",
        "Farm_Ranching" => "农场（标准）",
        "Farm_Island" => "姜岛农场",
        "FarmCave" => "农场洞穴",
        "FarmHouse"
        | "FarmHouse1"
        | "FarmHouse1_marriage"
        | "FarmHouse2"
        | "FarmHouse2_marriage" => "农舍",
        "FishShop" => "威利的鱼店",
        "FishingGame" => "钓鱼小游戏",
        "Forest" => "煤矿森林",
        "Forest_FishingDerby" => "煤矿森林（鳟鱼大赛）",
        "Forest_FishingDerby_Revert"
        | "Forest_FishingDerbySign"
        | "Forest_FishingDerbySign_Revert" => "煤矿森林（鳟鱼大赛后）",
        "Forest_RaccoonHouse" => "煤矿森林（修复的树）",
        "Forest_RaccoonStump" => "煤矿森林（树桩）",
        "Forest-FlowerFestival" | "Forest-FlowerFestival2" => "煤矿森林（花舞节）",
        "Forest-IceFestival" | "Forest-IceFestival2" => "煤矿森林（冰雪节）",
        "Forest-SewerClean" => "煤矿森林（下水道清理后）",
        "Greenhouse" | "Farm_Greenhouse_Dirt" | "Farm_Greenhouse_Dirt_FourCorners" => "温室",
        "HaleyHouse" => "海莉和艾米丽的家",
        "HarveyBalloon" => "哈维的热气球",
        "HarveyRoom" => "哈维的房间",
        "Hospital" => "哈维的诊所",
        "Island_CaptainRoom" => "船长室",
        "Island_E" => "姜岛东部",
        "Island_FarmCave" => "姜岛农场洞穴",
        "Island_FieldOffice" => "野外办公室",
        "Island_House_Cave" => "姜岛小屋洞穴",
        "Island_House_Restored" => "姜岛小屋",
        "Island_Hut" => "姜岛小屋",
        "Island_N" | "Island_N_Trader" => "姜岛北部",
        "Island_Resort" => "姜岛度假村",
        "Island_S" => "姜岛南部",
        "Island_SE" => "姜岛东南部",
        "Island_Secret" => "姜岛秘密区域",
        "Island_Shrine" => "宝石鸟神殿",
        "Island_W" | "Island_W_Obelisk" => "姜岛西部",
        "IslandFarmHouse" => "姜岛农舍",
        "IslandNorthCave1" => "火山洞穴入口",
        "IslandSouthEastCave" => "海盗湾",
        "IslandSouthEastCave_pirates" => "海盗湾",
        "IslandWestCave1" => "齐先生核桃房入口",
        "JojaMart" => "Joja超市",
        "JoshHouse" => "亚历克斯的家",
        "LeahHouse" => "莉亚的小屋",
        "LeoTreeHouse" => "里奥的树屋",
        "LewisBasement" => "刘易斯的地下室",
        "ManorHouse" => "镇长的庄园",
        "MarnieBarn" => "玛妮的畜棚",
        "MaruBasement" => "玛鲁的地下室",
        "MasteryCave" => "精通洞穴",
        "MermaidHouse" => "美人鱼之家",
        "Mine" | "Mines" => "矿井",
        "Mountain" => "山区",
        "Mountain_Shortcuts" => "山区（捷径修复后）",
        "Mountain-BridgeFixed" => "山区（桥梁修复后）",
        "MovieTheater" => "电影院",
        "MovieTheaterScreen" => "电影院银幕",
        "NightSceneMaruMap" | "NightSceneMaruMap2" => "玛鲁的夜景",
        "QiNutRoom" => "齐先生的核桃房",
        "Railroad" => "铁路",
        "RefurbishedSaloonRoom" => "翻新后的酒吧房间",
        "Saloon" => "星之果实餐吧",
        "SamHouse" => "山姆的家",
        "SamShow" => "山姆的演唱会",
        "SandyHouse" => "绿洲",
        "ScienceHouse" => "木匠商店",
        "SebastianMountain" => "塞巴斯蒂安的摩托车路线",
        "SebastianRide" => "塞巴斯蒂安的摩托车",
        "SebastianRoom" => "塞巴斯蒂安的房间",
        "SeedShop" => "皮埃尔的杂货店",
        "Sewer" => "下水道",
        "Shed" | "Shed2" => "棚屋",
        "SkullCave" => "骷髅洞穴",
        "SkullCaveAltar" => "骷髅洞穴祭坛",
        "SlimeHutch" => "史莱姆屋",
        "Stadium" => "体育场",
        "Submarine" => "潜水艇",
        "Summit" => "山顶",
        "Sunroom" => "日光室",
        "TargetGame" => "射靶小游戏",
        "Tent" => "帐篷",
        "Town" => "鹈鹕镇",
        "Town-TrashGone" => "鹈鹕镇（垃圾清除后）",
        "Town-DogHouse" => "鹈鹕镇（狗屋修复后）",
        "Town-Christmas" | "Town-Christmas2" => "鹈鹕镇（冬星盛宴）",
        "Town-EggFestival" | "Town-EggFestival2" => "鹈鹕镇（彩蛋节）",
        "Town-Fair" | "Town-Fair2" => "鹈鹕镇（星露谷展览会）",
        "Town-Halloween" | "Town-Halloween2" => "鹈鹕镇（万灵节）",
        "Town-Theater" => "鹈鹕镇（电影院修复后）",
        "Town-TheaterCC" => "鹈鹕镇（社区中心和电影院修复后）",
        "Town-TheaterCC-Halloween2" => "鹈鹕镇（万灵节，电影院修复后）",
        "Trailer" | "Trailer_big" => "活动房",
        "Tunnel" => "隧道",
        "WitchHut" => "女巫小屋",
        "WitchSwamp" => "女巫沼泽",
        "WitchWarpCave" => "女巫传送洞穴",
        "WizardHouse" => "法师塔",
        "WizardHouseBasement" => "法师塔地下室",
        "Woods" => "秘密森林",
        _ => return None,
    })
}
