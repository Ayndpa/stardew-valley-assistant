pub fn map_display_name(map_id: &str) -> Option<&'static str> {
    if let Some(name) = map_name_for_key(map_id) {
        return Some(name);
    }

    let normalized = normalize_map_id(map_id);
    map_name_for_key(normalized.as_str())
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
        "AbandonedJojaMart" => "废弃乔家超市",
        "AdventureGuild" => "探险家公会",
        "AnimalShop" => "玛妮的牧场",
        "ArchaeologyHouse" => "博物馆",
        "Backwoods" | "Backwoods_GraveSite" | "Backwoods_Staircase" => "后山",
        "Barn" | "Barn2" | "Barn3" => "畜棚",
        "BathHouse_Entry" => "浴室入口",
        "BathHouse_MensLocker" => "男更衣室",
        "BathHouse_Pool" => "浴室",
        "BathHouse_WomensLocker" => "女更衣室",
        "Beach" => "沙滩",
        "Beach_SquidFest" => "沙滩（鱿鱼节）",
        "Beach_SquidFest_Revert" | "Beach_SquidFestSign_Revert" => "沙滩（鱿鱼节后）",
        "Beach-Jellies" | "Beach-Jellies2" => "沙滩（月光水母起舞）",
        "Beach-Luau" | "Beach-Luau2" => "沙滩（夏威夷宴会）",
        "Beach-NightMarket" => "沙滩（夜市）",
        "Blacksmith" => "铁匠铺",
        "BoatTunnel" => "威利的船舱",
        "BugLand" => "突变虫穴",
        "BusStop" => "巴士站",
        "Caldera" => "火山口",
        "Cellar" | "FarmHouse_Cellar" => "地窖",
        "Club" => "赌场",
        "CommunityCenter_Joja" => "乔家社区发展仓库",
        "CommunityCenter_Refurbished" => "社区中心",
        "CommunityCenter_Ruins" => "废弃社区中心",
        "Coop" | "Coop2" | "Coop3" => "鸡舍",
        "Darkroom" => "暗室",
        "Desert" => "沙漠",
        "Desert-Festival" => "沙漠（沙漠节）",
        "ElliottHouse" => "艾利欧特小屋",
        "ElliottSea" => "艾利欧特海景",
        "EmilyDreamscape" => "艾米丽的梦境",
        "Farm" => "农场",
        "Farm_Combat" => "农场（荒野）",
        "Farm_Fishing" => "农场（河边）",
        "Farm_Foraging" => "农场（森林）",
        "Farm_FourCorners" => "农场（四角）",
        "Farm_Mining" => "农场（山顶）",
        "Farm_Ranching" => "农场（标准）",
        "Farm_Island" => "姜岛农场",
        "FarmCave" => "农场山洞",
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
        "Forest_RaccoonHouse" => "煤矿森林（大树修复后）",
        "Forest_RaccoonStump" => "煤矿森林（大树桩）",
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
        "Island_FarmCave" => "姜岛农场山洞",
        "Island_FieldOffice" => "岛屿办事处",
        "Island_House_Cave" => "姜岛小屋山洞",
        "Island_House_Restored" => "姜岛小屋",
        "Island_Hut" => "姜岛小屋",
        "Island_N" | "Island_N_Trader" => "姜岛北部",
        "Island_Resort" => "姜岛度假村",
        "Island_S" => "姜岛南部",
        "Island_SE" => "姜岛东南部",
        "Island_Secret" => "姜岛秘密区域",
        "Island_Shrine" => "宝石鸟神龛",
        "Island_W" | "Island_W_Obelisk" => "姜岛西部",
        "IslandFarmHouse" => "姜岛农舍",
        "IslandNorthCave1" => "火山洞穴入口",
        "IslandSouthEastCave" => "海盗湾",
        "IslandSouthEastCave_pirates" => "海盗湾",
        "IslandWestCave1" => "齐先生的核桃房入口",
        "JojaMart" => "乔家超市",
        "JoshHouse" => "亚历克斯的家",
        "LeahHouse" => "莉亚的农舍",
        "LeoTreeHouse" => "雷欧的树屋",
        "LewisBasement" => "刘易斯的地下室",
        "ManorHouse" => "镇长庄园",
        "MarnieBarn" => "玛妮的牲口棚",
        "MaruBasement" => "玛鲁的地下室",
        "MasteryCave" => "精通洞穴",
        "MermaidHouse" => "美人鱼小屋",
        "Mine" | "Mines" => "矿井",
        "Mountain" => "山区",
        "Mountain_Shortcuts" => "山区（捷径修复后）",
        "Mountain-BridgeFixed" => "山区（桥梁修复后）",
        "MovieTheater" => "电影院",
        "MovieTheaterScreen" => "电影院放映厅",
        "NightSceneMaruMap" | "NightSceneMaruMap2" => "玛鲁夜景",
        "QiNutRoom" => "齐先生的核桃房",
        "Railroad" => "铁路",
        "RefurbishedSaloonRoom" => "翻新酒吧房间",
        "Saloon" => "星之果实餐吧",
        "SamHouse" => "山姆的家",
        "SamShow" => "山姆的演出",
        "SandyHouse" => "绿洲",
        "ScienceHouse" => "木匠的商店",
        "SebastianMountain" => "塞巴斯蒂安的摩托车路线",
        "SebastianRide" => "塞巴斯蒂安的摩托车",
        "SebastianRoom" => "塞巴斯蒂安的房间",
        "SeedShop" => "皮埃尔的杂货店",
        "Sewer" => "下水道",
        "Shed" | "Shed2" => "小屋",
        "SkullCave" => "骷髅洞穴",
        "SkullCaveAltar" => "骷髅洞穴祭坛",
        "SlimeHutch" => "史莱姆屋",
        "Stadium" => "体育场",
        "Submarine" => "潜水艇",
        "Summit" => "山顶",
        "Sunroom" => "日光室",
        "TargetGame" => "靶场小游戏",
        "Tent" => "帐篷",
        "Town" => "鹈鹕镇",
        "Town-TrashGone" => "鹈鹕镇（垃圾清理后）",
        "Town-DogHouse" => "鹈鹕镇（狗屋修复后）",
        "Town-Christmas" | "Town-Christmas2" => "鹈鹕镇（冬日星盛宴）",
        "Town-EggFestival" | "Town-EggFestival2" => "鹈鹕镇（复活节）",
        "Town-Fair" | "Town-Fair2" => "鹈鹕镇（星露谷展览会）",
        "Town-Halloween" | "Town-Halloween2" => "鹈鹕镇（万灵节）",
        "Town-Theater" => "鹈鹕镇（电影院修复后）",
        "Town-TheaterCC" => "鹈鹕镇（社区中心与电影院修复后）",
        "Town-TheaterCC-Halloween2" => "鹈鹕镇（万灵节，电影院修复后）",
        "Trailer" | "Trailer_big" => "拖车",
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
