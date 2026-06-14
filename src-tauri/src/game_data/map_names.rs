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
