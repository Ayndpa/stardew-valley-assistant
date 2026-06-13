use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use crate::farmer_avatar::{render_farmer_avatar, FarmerAppearance};

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SaveSummary {
    pub id: String,
    pub player_name: String,
    pub farm_name: String,
    pub money: i32,
    pub total_money_earned: i32,
    pub day_of_month: i32,
    pub season: i32, // 0: Spring, 1: Summer, 2: Fall, 3: Winter
    pub year: i32,
    pub farming_level: i32,
    pub mining_level: i32,
    pub combat_level: i32,
    pub foraging_level: i32,
    pub fishing_level: i32,
    pub deepest_mine_level: i32,
    pub milliseconds_played: u64,
    pub last_save_time: u64,
    pub farmer_avatar: Option<String>,
    pub farmer_avatar_error: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FriendshipInfo {
    pub npc_name: String,
    pub points: i32,
    pub gifts_this_week: i32,
    pub gifts_today: i32,
    pub talked_to_today: bool,
    pub status: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PlantedCrop {
    pub location: String,
    pub x: i32,
    pub y: i32,
    pub seed_id: String,
    pub harvest_id: String,
    pub current_phase: i32,
    pub day_of_current_phase: i32,
    pub fully_grown: bool,
    pub dead: bool,
    pub is_watered: bool,
    pub phase_days: Vec<i32>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SaveDetail {
    pub summary: SaveSummary,
    pub weather_today: String,
    pub weather_tomorrow: String,
    pub museum_pieces_count: i32,
    pub friendships: Vec<FriendshipInfo>,
    pub farmer_appearance: Option<FarmerAppearance>,
    pub farmer_avatar: Option<String>,
    pub farmer_avatar_error: Option<String>,
}

fn get_tag_value<'a>(xml: &'a str, tag: &str) -> Option<&'a str> {
    let start_tag = format!("<{}>", tag);
    let end_tag = format!("</{}>", tag);
    let start_idx = xml.find(&start_tag)?;
    let end_idx = xml.find(&end_tag)?;
    if start_idx < end_idx {
        Some(&xml[start_idx + start_tag.len()..end_idx])
    } else {
        None
    }
}

fn extract_tag_i32(xml: &str, tag: &str) -> i32 {
    get_tag_value(xml, tag)
        .and_then(|v| v.parse::<i32>().ok())
        .unwrap_or(0)
}

fn extract_tag_u64(xml: &str, tag: &str) -> u64 {
    get_tag_value(xml, tag)
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(0)
}

fn extract_tag_string(xml: &str, tag: &str) -> String {
    get_tag_value(xml, tag)
        .map(|v| v.to_string())
        .unwrap_or_else(|| "".to_string())
}

fn parse_friendship_data(xml: &str) -> Vec<FriendshipInfo> {
    let mut list = Vec::new();
    if let Some(friendship_idx) = xml.find("<friendshipData>") {
        let friendship_end = xml.find("</friendshipData>").unwrap_or(xml.len());
        let section = &xml[friendship_idx..friendship_end];

        let mut search_pos = 0;
        while let Some(item_start) = section[search_pos..].find("<item>") {
            let abs_item_start = search_pos + item_start;
            let item_end = match section[abs_item_start..].find("</item>") {
                Some(offset) => abs_item_start + offset,
                None => break,
            };
            let item_xml = &section[abs_item_start..item_end];

            if let Some(key_start) = item_xml.find("<key>") {
                if let Some(key_end) = item_xml.find("</key>") {
                    let key_xml = &item_xml[key_start..key_end];
                    if let Some(str_start) = key_xml.find("<string>") {
                        if let Some(str_end) = key_xml.find("</string>") {
                            let npc_name = key_xml[str_start + 8..str_end].to_string();

                            let mut points = 0;
                            let mut gifts_this_week = 0;
                            let mut gifts_today = 0;
                            let mut talked_to_today = false;
                            let mut status = "Friendly".to_string();

                            if let Some(val_start) = item_xml.find("<value>") {
                                if let Some(val_end) = item_xml.find("</value>") {
                                    let val_xml = &item_xml[val_start..val_end];

                                    if let Some(pts_start) = val_xml.find("<Points>") {
                                        if let Some(pts_end) = val_xml.find("</Points>") {
                                            points = val_xml[pts_start + 8..pts_end]
                                                .parse::<i32>()
                                                .unwrap_or(0);
                                        }
                                    }
                                    if let Some(gtw_start) = val_xml.find("<GiftsThisWeek>") {
                                        if let Some(gtw_end) = val_xml.find("</GiftsThisWeek>") {
                                            gifts_this_week = val_xml[gtw_start + 15..gtw_end]
                                                .parse::<i32>()
                                                .unwrap_or(0);
                                        }
                                    }
                                    if let Some(gt_start) = val_xml.find("<GiftsToday>") {
                                        if let Some(gt_end) = val_xml.find("</GiftsToday>") {
                                            gifts_today = val_xml[gt_start + 12..gt_end]
                                                .parse::<i32>()
                                                .unwrap_or(0);
                                        }
                                    }
                                    if let Some(ttt_start) = val_xml.find("<TalkedToToday>") {
                                        if let Some(ttt_end) = val_xml.find("</TalkedToToday>") {
                                            talked_to_today =
                                                val_xml[ttt_start + 15..ttt_end].trim() == "true";
                                        }
                                    }
                                    if let Some(st_start) = val_xml.find("<Status>") {
                                        if let Some(st_end) = val_xml.find("</Status>") {
                                            status = val_xml[st_start + 8..st_end].to_string();
                                        }
                                    }
                                }
                            }

                            list.push(FriendshipInfo {
                                npc_name,
                                points,
                                gifts_this_week,
                                gifts_today,
                                talked_to_today,
                                status,
                            });
                        }
                    }
                }
            }
            search_pos = item_end + 7;
        }
    }
    list
}

fn parse_museum_pieces_count(xml: &str) -> i32 {
    if let Some(start_idx) = xml.find("<museumPieces>") {
        if let Some(end_idx) = xml.find("</museumPieces>") {
            let inner = &xml[start_idx + 14..end_idx];
            return inner.matches("<item>").count() as i32;
        }
    }
    0
}

fn parse_weather(xml: &str) -> (String, String) {
    let mut today = "Sun".to_string();
    let mut tomorrow = "Sun".to_string();

    if let Some(start_idx) = xml.find("<locationWeather>") {
        if let Some(end_idx) = xml.find("</locationWeather>") {
            let section = &xml[start_idx..end_idx];
            if let Some(def_idx) = section.find("<string>Default</string>") {
                let sub_sec = &section[def_idx..];

                // Read today's weather
                let mut found_today = false;
                if let Some(w_start) = sub_sec.find("<Weather>") {
                    if let Some(w_end) = sub_sec.find("</Weather>") {
                        let w = sub_sec[w_start + 9..w_end].trim();
                        if !w.is_empty() && !w.contains("xsi:nil") {
                            today = w.to_string();
                            found_today = true;
                        }
                    }
                }

                // Fallback for today using flags if not found
                if !found_today {
                    let is_green_rain = sub_sec.find("<IsGreenRain>true</IsGreenRain>").is_some()
                        || sub_sec.find("<isGreenRain>true</isGreenRain>").is_some();
                    let is_lightning = sub_sec.find("<IsLightning>true</IsLightning>").is_some()
                        || sub_sec.find("<isLightning>true</isLightning>").is_some();
                    let is_raining = sub_sec.find("<IsRaining>true</IsRaining>").is_some()
                        || sub_sec.find("<isRaining>true</isRaining>").is_some();
                    let is_snowing = sub_sec.find("<IsSnowing>true</IsSnowing>").is_some()
                        || sub_sec.find("<isSnowing>true</isSnowing>").is_some();
                    let is_debris = sub_sec
                        .find("<IsDebrisWeather>true</IsDebrisWeather>")
                        .is_some()
                        || sub_sec
                            .find("<isDebrisWeather>true</isDebrisWeather>")
                            .is_some();

                    if is_green_rain {
                        today = "GreenRain".to_string();
                    } else if is_lightning {
                        today = "Storm".to_string();
                    } else if is_raining {
                        today = "Rain".to_string();
                    } else if is_snowing {
                        today = "Snow".to_string();
                    } else if is_debris {
                        today = "Wind".to_string();
                    } else {
                        today = "Sun".to_string();
                    }
                }

                // Read tomorrow's weather
                if let Some(wt_start) = sub_sec.find("<WeatherForTomorrow>") {
                    if let Some(wt_end) = sub_sec.find("</WeatherForTomorrow>") {
                        let wt = sub_sec[wt_start + 20..wt_end].trim();
                        if !wt.is_empty() && !wt.contains("xsi:nil") {
                            tomorrow = wt.to_string();
                        }
                    }
                }
            }
        }
    }
    (today, tomorrow)
}

fn get_saves_dir() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var("APPDATA").ok()?;
        Some(PathBuf::from(appdata).join("StardewValley").join("Saves"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        let home = std::env::var("HOME").ok()?;
        Some(
            PathBuf::from(home)
                .join(".config")
                .join("StardewValley")
                .join("Saves"),
        )
    }
}

#[tauri::command]
pub fn list_save_files(game_dir: Option<String>) -> Result<Vec<SaveSummary>, String> {
    let saves_dir =
        get_saves_dir().ok_or_else(|| "Could not locate APPDATA or HOME directory".to_string())?;

    if !saves_dir.exists() {
        return Ok(Vec::new());
    }

    let mut list = Vec::new();
    let entries =
        fs::read_dir(&saves_dir).map_err(|e| format!("Failed to read Saves directory: {}", e))?;

    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let folder_name = entry.file_name().to_string_lossy().to_string();
        let save_game_info_path = path.join("SaveGameInfo");
        if !save_game_info_path.exists() {
            continue;
        }

        let xml = fs::read_to_string(&save_game_info_path)
            .map_err(|e| format!("Failed to read SaveGameInfo in {}: {}", folder_name, e))?;

        let player_name = extract_tag_string(&xml, "name");
        let farm_name = extract_tag_string(&xml, "farmName");
        let money = extract_tag_i32(&xml, "money");
        let total_money_earned = extract_tag_i32(&xml, "totalMoneyEarned");
        let day_of_month = extract_tag_i32(&xml, "dayOfMonthForSaveGame");
        let season = extract_tag_i32(&xml, "seasonForSaveGame");
        let year = extract_tag_i32(&xml, "yearForSaveGame");
        let farming_level = extract_tag_i32(&xml, "farmingLevel");
        let mining_level = extract_tag_i32(&xml, "miningLevel");
        let combat_level = extract_tag_i32(&xml, "combatLevel");
        let foraging_level = extract_tag_i32(&xml, "foragingLevel");
        let fishing_level = extract_tag_i32(&xml, "fishingLevel");
        let deepest_mine_level = extract_tag_i32(&xml, "deepestMineLevel");
        let milliseconds_played = extract_tag_u64(&xml, "millisecondsPlayed");
        let farmer_appearance = FarmerAppearance::from_save_xml(&xml);
        let (farmer_avatar, farmer_avatar_error) =
            match render_farmer_avatar(&farmer_appearance, game_dir.as_deref()) {
                Ok(data_url) => (Some(data_url), None),
                Err(error) => (None, Some(error)),
            };

        let last_save_time = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);

        list.push(SaveSummary {
            id: folder_name,
            player_name,
            farm_name,
            money,
            total_money_earned,
            day_of_month,
            season,
            year,
            farming_level,
            mining_level,
            combat_level,
            foraging_level,
            fishing_level,
            deepest_mine_level,
            milliseconds_played,
            last_save_time,
            farmer_avatar,
            farmer_avatar_error,
        });
    }

    list.sort_by(|a, b| b.last_save_time.cmp(&a.last_save_time));

    Ok(list)
}

#[tauri::command]
pub fn get_save_detail(
    id: String,
    game_dir: Option<String>,
    include_avatar: Option<bool>,
) -> Result<SaveDetail, String> {
    let saves_dir =
        get_saves_dir().ok_or_else(|| "Could not locate APPDATA or HOME directory".to_string())?;

    let save_folder = saves_dir.join(&id);
    if !save_folder.exists() {
        return Err(format!("Save folder {} does not exist", id));
    }

    let save_game_info_path = save_folder.join("SaveGameInfo");
    if !save_game_info_path.exists() {
        return Err(format!("SaveGameInfo not found in {}", id));
    }
    let info_xml = fs::read_to_string(&save_game_info_path)
        .map_err(|e| format!("Failed to read SaveGameInfo: {}", e))?;

    let player_name = extract_tag_string(&info_xml, "name");
    let farm_name = extract_tag_string(&info_xml, "farmName");
    let money = extract_tag_i32(&info_xml, "money");
    let total_money_earned = extract_tag_i32(&info_xml, "totalMoneyEarned");
    let day_of_month = extract_tag_i32(&info_xml, "dayOfMonthForSaveGame");
    let season = extract_tag_i32(&info_xml, "seasonForSaveGame");
    let year = extract_tag_i32(&info_xml, "yearForSaveGame");
    let farming_level = extract_tag_i32(&info_xml, "farmingLevel");
    let mining_level = extract_tag_i32(&info_xml, "miningLevel");
    let combat_level = extract_tag_i32(&info_xml, "combatLevel");
    let foraging_level = extract_tag_i32(&info_xml, "foragingLevel");
    let fishing_level = extract_tag_i32(&info_xml, "fishingLevel");
    let deepest_mine_level = extract_tag_i32(&info_xml, "deepestMineLevel");
    let milliseconds_played = extract_tag_u64(&info_xml, "millisecondsPlayed");

    let last_save_time = save_game_info_path
        .metadata()
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let summary = SaveSummary {
        id: id.clone(),
        player_name,
        farm_name,
        money,
        total_money_earned,
        day_of_month,
        season,
        year,
        farming_level,
        mining_level,
        combat_level,
        foraging_level,
        fishing_level,
        deepest_mine_level,
        milliseconds_played,
        last_save_time,
        farmer_avatar: None,
        farmer_avatar_error: None,
    };

    let main_save_path = save_folder.join(&id);
    if !main_save_path.exists() {
        return Err(format!("Main save file {} not found in {}", id, id));
    }
    let main_xml = fs::read_to_string(&main_save_path)
        .map_err(|e| format!("Failed to read main save file {}: {}", id, e))?;

    let (weather_today, weather_tomorrow) = parse_weather(&main_xml);
    let museum_pieces_count = parse_museum_pieces_count(&main_xml);
    let friendships = parse_friendship_data(&info_xml);
    let farmer_appearance = FarmerAppearance::from_save_xml(&info_xml);
    let (farmer_avatar, farmer_avatar_error) = if include_avatar.unwrap_or(false) {
        match render_farmer_avatar(&farmer_appearance, game_dir.as_deref()) {
            Ok(data_url) => (Some(data_url), None),
            Err(error) => (None, Some(error)),
        }
    } else {
        (None, None)
    };

    Ok(SaveDetail {
        summary,
        weather_today,
        weather_tomorrow,
        museum_pieces_count,
        friendships,
        farmer_appearance: Some(farmer_appearance),
        farmer_avatar,
        farmer_avatar_error,
    })
}

#[tauri::command]
pub fn get_planted_crops(id: String) -> Result<Vec<PlantedCrop>, String> {
    let saves_dir =
        get_saves_dir().ok_or_else(|| "Could not locate APPDATA or HOME directory".to_string())?;

    let save_folder = saves_dir.join(&id);
    if !save_folder.exists() {
        return Err(format!("Save folder {} does not exist", id));
    }

    let main_save_path = save_folder.join(&id);
    if !main_save_path.exists() {
        return Err(format!("Main save file {} not found in {}", id, id));
    }

    let xml = fs::read_to_string(&main_save_path)
        .map_err(|e| format!("Failed to read main save file: {}", e))?;

    let mut planted_crops = Vec::new();

    let mut location_blocks = Vec::new();
    let mut search_pos = 0;
    while let Some(start_idx) = xml[search_pos..].find("<GameLocation") {
        let abs_start = search_pos + start_idx;
        let block_content = &xml[abs_start..];

        let end_offset = match block_content.find("</GameLocation>") {
            Some(offset) => offset,
            None => break,
        };
        let abs_end = abs_start + end_offset + 15;
        let loc_xml = &xml[abs_start..abs_end];
        location_blocks.push(loc_xml);
        search_pos = abs_end;
    }

    for loc_xml in location_blocks {
        let name = get_tag_value(loc_xml, "name")
            .unwrap_or("Unknown")
            .to_string();

        let mut terrain_features_section = "";
        if let Some(tf_start) = loc_xml.find("<terrainFeatures>") {
            if let Some(tf_end) = loc_xml[tf_start..].find("</terrainFeatures>") {
                terrain_features_section = &loc_xml[tf_start..tf_start + tf_end];
            }
        }

        if terrain_features_section.is_empty() {
            continue;
        }

        let mut item_pos = 0;
        while let Some(item_start) = terrain_features_section[item_pos..].find("<item>") {
            let abs_item_start = item_pos + item_start;
            let item_end = match terrain_features_section[abs_item_start..].find("</item>") {
                Some(offset) => abs_item_start + offset,
                None => break,
            };
            let item_xml = &terrain_features_section[abs_item_start..item_end];

            if item_xml.contains("xsi:type=\"HoeDirt\"") || item_xml.contains("type=\"HoeDirt\"") {
                let mut x = 0;
                let mut y = 0;
                if let Some(key_start) = item_xml.find("<key>") {
                    if let Some(key_end) = item_xml.find("</key>") {
                        let key_xml = &item_xml[key_start..key_end];
                        if let Some(x_start) = key_xml.find("<X>") {
                            if let Some(x_end) = key_xml.find("</X>") {
                                x = key_xml[x_start + 3..x_end].parse::<i32>().unwrap_or(0);
                            }
                        }
                        if let Some(y_start) = key_xml.find("<Y>") {
                            if let Some(y_end) = key_xml.find("</Y>") {
                                y = key_xml[y_start + 3..y_end].parse::<i32>().unwrap_or(0);
                            }
                        }
                    }
                }

                if let Some(val_start) = item_xml.find("<value>") {
                    if let Some(val_end) = item_xml.find("</value>") {
                        let val_xml = &item_xml[val_start..val_end];

                        let mut is_watered = false;
                        if let Some(state_start) = val_xml.find("<state>") {
                            if let Some(state_end) = val_xml.find("</state>") {
                                let state_val = val_xml[state_start + 7..state_end]
                                    .parse::<i32>()
                                    .unwrap_or(0);
                                is_watered = state_val == 1;
                            }
                        }

                        if let Some(crop_start) = val_xml.find("<crop>") {
                            if let Some(crop_end) = val_xml.find("</crop>") {
                                let crop_xml = &val_xml[crop_start..crop_end];

                                let current_phase = extract_tag_i32(crop_xml, "currentPhase");
                                let day_of_current_phase =
                                    extract_tag_i32(crop_xml, "dayOfCurrentPhase");

                                let mut fully_grown = false;
                                if let Some(fg_start) = crop_xml.find("<fullGrown>") {
                                    if let Some(fg_end) = crop_xml.find("</fullGrown>") {
                                        fully_grown =
                                            crop_xml[fg_start + 11..fg_end].trim() == "true";
                                    }
                                }

                                let mut dead = false;
                                if let Some(d_start) = crop_xml.find("<dead>") {
                                    if let Some(d_end) = crop_xml.find("</dead>") {
                                        dead = crop_xml[d_start + 6..d_end].trim() == "true";
                                    }
                                }

                                let seed_id = extract_tag_string(crop_xml, "seedIndex");
                                let harvest_id = extract_tag_string(crop_xml, "indexOfHarvest");

                                let mut phase_days = Vec::new();
                                if let Some(pd_start) = crop_xml.find("<phaseDays>") {
                                    if let Some(pd_end) = crop_xml.find("</phaseDays>") {
                                        let pd_xml = &crop_xml[pd_start..pd_end];
                                        let mut pd_pos = 0;
                                        while let Some(int_start) = pd_xml[pd_pos..].find("<int>") {
                                            let abs_int_start = pd_pos + int_start;
                                            if let Some(int_end) =
                                                pd_xml[abs_int_start..].find("</int>")
                                            {
                                                let abs_int_end = abs_int_start + int_end;
                                                let val_str =
                                                    &pd_xml[abs_int_start + 5..abs_int_end];
                                                if let Ok(val) = val_str.parse::<i32>() {
                                                    phase_days.push(val);
                                                }
                                                pd_pos = abs_int_end + 6;
                                            } else {
                                                break;
                                            }
                                        }
                                    }
                                }

                                planted_crops.push(PlantedCrop {
                                    location: name.clone(),
                                    x,
                                    y,
                                    seed_id,
                                    harvest_id,
                                    current_phase,
                                    day_of_current_phase,
                                    fully_grown,
                                    dead,
                                    is_watered,
                                    phase_days,
                                });
                            }
                        }
                    }
                }
            }
            item_pos = item_end + 7;
        }
    }

    Ok(planted_crops)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_list() {
        match list_save_files(None) {
            Ok(list) => {
                println!("SUCCESS: Listed {} saves", list.len());
                for s in list {
                    println!("  - {} ({})", s.player_name, s.farm_name);
                }
            }
            Err(e) => {
                println!("ERROR listing saves: {}", e);
                panic!("Failed: {}", e);
            }
        }
    }
}
