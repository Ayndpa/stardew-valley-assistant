use serde::{Deserialize, Serialize};
use std::fs;
use tokio::task;

use super::xml_utils::{extract_tag_i32, extract_tag_string, extract_tag_u64};
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
pub struct MonsterKillInfo {
    pub name: String,
    pub count: i32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SaveDetail {
    pub summary: SaveSummary,
    pub weather_today: String,
    pub weather_tomorrow: String,
    pub museum_pieces_count: i32,
    pub museum_pieces: Vec<String>,
    pub friendships: Vec<FriendshipInfo>,
    pub farmer_appearance: Option<FarmerAppearance>,
    pub farmer_avatar: Option<String>,
    pub farmer_avatar_error: Option<String>,
    // Collection tracking fields
    pub shipped_items: Vec<String>,
    pub fish_caught: Vec<String>,
    pub cooking_recipes: Vec<String>,
    pub crafting_recipes: Vec<String>,
    pub recipes_cooked: Vec<String>,
    pub secret_notes_seen: Vec<i32>,
    pub songs_heard: Vec<String>,
    pub mail_received: Vec<String>,
    pub max_stamina: i32,
    pub specific_monsters_killed: Vec<MonsterKillInfo>,
    pub golden_walnuts_found: i32,
}

pub fn parse_friendship_data(xml: &str) -> Vec<FriendshipInfo> {
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

pub fn parse_museum_pieces(xml: &str) -> Vec<String> {
    let mut pieces = Vec::new();
    // In 1.6, museum pieces are in the LibraryMuseum location
    if let Some(museum_start) = xml.find("<GameLocation xsi:type=\"LibraryMuseum\">") {
        let museum_end = xml[museum_start..].find("</GameLocation>").unwrap_or(xml.len()) + museum_start;
        let museum_xml = &xml[museum_start..museum_end];

        if let Some(start_idx) = museum_xml.find("<museumPieces>") {
            if let Some(end_idx) = museum_xml.find("</museumPieces>") {
                let inner = &museum_xml[start_idx + 14..end_idx];
                let mut search_pos = 0;
                while let Some(item_start) = inner[search_pos..].find("<item>") {
                    let abs_start = search_pos + item_start;
                    let Some(item_end_rel) = inner[abs_start..].find("</item>") else {
                        break;
                    };
                    let abs_end = abs_start + item_end_rel;
                    let item_xml = &inner[abs_start + 6..abs_end];

                    // Try to find <value><string>ID</string></value> (1.6 format)
                    let mut id = String::new();
                    if let Some(val_start) = item_xml.find("<value>") {
                        if let Some(val_end) = item_xml.find("</value>") {
                            let val_xml = &item_xml[val_start..val_end];
                            if let Some(s_start) = val_xml.find("<string>") {
                                if let Some(s_end) = val_xml.find("</string>") {
                                    id = val_xml[s_start + 8..s_end].to_string();
                                }
                            }
                        }
                    }

                    // Fallback to <int>ID</int> (Legacy format)
                    if id.is_empty() {
                        id = item_xml
                            .replace("<int>", "")
                            .replace("</int>", "")
                            .trim()
                            .to_string();
                    }

                    if !id.is_empty() {
                        pieces.push(id);
                    }
                    search_pos = abs_end + 7;
                }
            }
        }
    }
    pieces
}

pub fn parse_weather(xml: &str) -> (String, String) {
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

/// Parse a NetStringDictionary<int> section (e.g. basicShipped, cookingRecipes, craftingRecipes, recipesCooked).
/// Returns Vec of (key_string, value_int).
fn parse_string_int_dict(xml: &str, tag: &str) -> Vec<(String, i32)> {
    let mut result = Vec::new();
    let open_tag = format!("<{}>", tag);
    let close_tag = format!("</{}>", tag);
    if let Some(start_idx) = xml.find(&open_tag) {
        if let Some(end_idx) = xml.find(&close_tag) {
            let section = &xml[start_idx + open_tag.len()..end_idx];
            let mut search_pos = 0;
            while let Some(item_start) = section[search_pos..].find("<item>") {
                let abs_start = search_pos + item_start;
                let Some(item_end_rel) = section[abs_start..].find("</item>") else {
                    break;
                };
                let abs_end = abs_start + item_end_rel;
                let item_xml = &section[abs_start..abs_end];

                let mut key = String::new();
                let mut val = 0i32;

                // Extract key string
                if let Some(ks) = item_xml.find("<key>") {
                    if let Some(ke) = item_xml.find("</key>") {
                        let key_section = &item_xml[ks..ke];
                        if let Some(ss) = key_section.find("<string>") {
                            if let Some(se) = key_section.find("</string>") {
                                key = key_section[ss + 8..se].to_string();
                            }
                        }
                    }
                }

                // Extract value int
                if let Some(vs) = item_xml.find("<value>") {
                    if let Some(ve) = item_xml.find("</value>") {
                        let val_section = &item_xml[vs..ve];
                        if let Some(is) = val_section.find("<int>") {
                            if let Some(ie) = val_section.find("</int>") {
                                val = val_section[is + 5..ie].parse::<i32>().unwrap_or(0);
                            }
                        }
                    }
                }

                if !key.is_empty() {
                    result.push((key, val));
                }
                search_pos = abs_end + 7;
            }
        }
    }
    result
}

/// Parse a NetStringIntArrayDictionary section (e.g. fishCaught, archaeologyFound).
/// Returns Vec of (key_string, first_int_value).
fn parse_string_int_array_dict(xml: &str, tag: &str) -> Vec<(String, i32, i32)> {
    let mut result = Vec::new();
    let open_tag = format!("<{}>", tag);
    let close_tag = format!("</{}>", tag);
    if let Some(start_idx) = xml.find(&open_tag) {
        if let Some(end_idx) = xml.find(&close_tag) {
            let section = &xml[start_idx + open_tag.len()..end_idx];
            let mut search_pos = 0;
            while let Some(item_start) = section[search_pos..].find("<item>") {
                let abs_start = search_pos + item_start;
                let Some(item_end_rel) = section[abs_start..].find("</item>") else {
                    break;
                };
                let abs_end = abs_start + item_end_rel;
                let item_xml = &section[abs_start..abs_end];

                let mut key = String::new();
                let mut val0 = 0i32;
                let mut val1 = 0i32;

                // Extract key string
                if let Some(ks) = item_xml.find("<key>") {
                    if let Some(ke) = item_xml.find("</key>") {
                        let key_section = &item_xml[ks..ke];
                        if let Some(ss) = key_section.find("<string>") {
                            if let Some(se) = key_section.find("</string>") {
                                key = key_section[ss + 8..se].to_string();
                            }
                        }
                    }
                }

                // Extract value ArrayOfint -> first two ints
                if let Some(vs) = item_xml.find("<value>") {
                    if let Some(ve) = item_xml.find("</value>") {
                        let val_section = &item_xml[vs..ve];
                        let mut int_search = 0;
                        let mut ints = Vec::new();
                        while let Some(is) = val_section[int_search..].find("<int>") {
                            let abs_is = int_search + is;
                            if let Some(ie) = val_section[abs_is..].find("</int>") {
                                let int_val = val_section[abs_is + 5..abs_is + ie]
                                    .parse::<i32>()
                                    .unwrap_or(0);
                                ints.push(int_val);
                                int_search = abs_is + ie + 6;
                            } else {
                                break;
                            }
                        }
                        if ints.len() >= 2 {
                            val0 = ints[0];
                            val1 = ints[1];
                        } else if ints.len() == 1 {
                            val0 = ints[0];
                        }
                    }
                }

                if !key.is_empty() {
                    result.push((key, val0, val1));
                }
                search_pos = abs_end + 7;
            }
        }
    }
    result
}

/// Parse a set of <int> elements (e.g. secretNotesSeen, achievements).
fn parse_int_set(xml: &str, tag: &str) -> Vec<i32> {
    let mut result = Vec::new();
    let open_tag = format!("<{}>", tag);
    let close_tag = format!("</{}>", tag);
    if let Some(start_idx) = xml.find(&open_tag) {
        if let Some(end_idx) = xml.find(&close_tag) {
            let section = &xml[start_idx + open_tag.len()..end_idx];
            let mut search_pos = 0;
            while let Some(int_start) = section[search_pos..].find("<int>") {
                let abs_start = search_pos + int_start;
                if let Some(int_end) = section[abs_start..].find("</int>") {
                    let val = section[abs_start + 5..abs_start + int_end]
                        .parse::<i32>()
                        .unwrap_or(0);
                    result.push(val);
                    search_pos = abs_start + int_end + 6;
                } else {
                    break;
                }
            }
        }
    }
    result
}

/// Parse a set of <string> elements (e.g. songsHeard, mailReceived).
fn parse_string_set(xml: &str, tag: &str) -> Vec<String> {
    let mut result = Vec::new();
    let open_tag = format!("<{}>", tag);
    let close_tag = format!("</{}>", tag);
    if let Some(start_idx) = xml.find(&open_tag) {
        if let Some(end_idx) = xml.find(&close_tag) {
            let section = &xml[start_idx + open_tag.len()..end_idx];
            let mut search_pos = 0;
            while let Some(str_start) = section[search_pos..].find("<string>") {
                let abs_start = search_pos + str_start;
                if let Some(str_end) = section[abs_start..].find("</string>") {
                    let val = section[abs_start + 8..abs_start + str_end].to_string();
                    result.push(val);
                    search_pos = abs_start + str_end + 9;
                } else {
                    break;
                }
            }
        }
    }
    result
}

/// Parse <specificMonstersKilled> dictionary from stats section.
fn parse_specific_monsters_killed(xml: &str) -> Vec<MonsterKillInfo> {
    let mut result = Vec::new();
    // Find the stats section first
    let stats_tag = "<stats>";
    let stats_close = "</stats>";
    let stats_section = if let Some(s) = xml.find(stats_tag) {
        if let Some(e) = xml.find(stats_close) {
            &xml[s..e]
        } else {
            xml
        }
    } else {
        xml
    };

    let tag = "specificMonstersKilled";
    let open_tag = format!("<{}>", tag);
    let close_tag = format!("</{}>", tag);
    if let Some(start_idx) = stats_section.find(&open_tag) {
        if let Some(end_idx) = stats_section.find(&close_tag) {
            let section = &stats_section[start_idx + open_tag.len()..end_idx];
            let mut search_pos = 0;
            while let Some(item_start) = section[search_pos..].find("<item>") {
                let abs_start = search_pos + item_start;
                let Some(item_end_rel) = section[abs_start..].find("</item>") else {
                    break;
                };
                let abs_end = abs_start + item_end_rel;
                let item_xml = &section[abs_start..abs_end];

                let mut name = String::new();
                let mut count = 0i32;

                if let Some(ks) = item_xml.find("<key>") {
                    if let Some(ke) = item_xml.find("</key>") {
                        let key_section = &item_xml[ks..ke];
                        if let Some(ss) = key_section.find("<string>") {
                            if let Some(se) = key_section.find("</string>") {
                                name = key_section[ss + 8..se].to_string();
                            }
                        }
                    }
                }

                if let Some(vs) = item_xml.find("<value>") {
                    if let Some(ve) = item_xml.find("</value>") {
                        let val_section = &item_xml[vs..ve];
                        if let Some(is) = val_section.find("<int>") {
                            if let Some(ie) = val_section.find("</int>") {
                                count = val_section[is + 5..ie].parse::<i32>().unwrap_or(0);
                            }
                        }
                    }
                }

                if !name.is_empty() {
                    result.push(MonsterKillInfo { name, count });
                }
                search_pos = abs_end + 7;
            }
        }
    }
    result
}

/// Parse goldenWalnutsFound from the top-level save XML.
fn parse_golden_walnuts_found(xml: &str) -> i32 {
    if let Some(val) = super::xml_utils::get_tag_value(xml, "goldenWalnutsFound") {
        val.parse::<i32>().unwrap_or(0)
    } else {
        0
    }
}

pub fn list_save_files_sync(game_dir: Option<String>) -> Result<Vec<SaveSummary>, String> {
    let saves_dir = super::get_saves_dir()
        .ok_or_else(|| "Could not locate APPDATA or HOME directory".to_string())?;

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
pub async fn list_save_files(game_dir: Option<String>) -> Result<Vec<SaveSummary>, String> {
    task::spawn_blocking(move || list_save_files_sync(game_dir))
        .await
        .map_err(|e| format!("读取存档列表任务失败: {}", e))?
}

fn get_save_detail_sync(
    id: String,
    game_dir: Option<String>,
    include_avatar: Option<bool>,
) -> Result<SaveDetail, String> {
    let saves_dir = super::get_saves_dir()
        .ok_or_else(|| "Could not locate APPDATA or HOME directory".to_string())?;

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
    let museum_pieces = parse_museum_pieces(&main_xml);
    let museum_pieces_count = museum_pieces.len() as i32;
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

    // Collection tracking: extract IDs from save data
    let shipped_items: Vec<String> = parse_string_int_dict(&main_xml, "basicShipped")
        .into_iter()
        .map(|(k, _)| k)
        .collect();
    let fish_caught: Vec<String> = parse_string_int_array_dict(&main_xml, "fishCaught")
        .into_iter()
        .map(|(k, _, _)| k)
        .collect();
    let cooking_recipes: Vec<String> = parse_string_int_dict(&main_xml, "cookingRecipes")
        .into_iter()
        .map(|(k, _)| k)
        .collect();
    let crafting_recipes: Vec<String> = parse_string_int_dict(&main_xml, "craftingRecipes")
        .into_iter()
        .map(|(k, _)| k)
        .collect();
    let recipes_cooked: Vec<String> = parse_string_int_dict(&main_xml, "recipesCooked")
        .into_iter()
        .map(|(k, _)| k)
        .collect();
    let secret_notes_seen = parse_int_set(&main_xml, "secretNotesSeen");
    let songs_heard = parse_string_set(&main_xml, "songsHeard");
    let mail_received = parse_string_set(&main_xml, "mailReceived");
    let max_stamina = extract_tag_i32(&main_xml, "maxStamina");
    let specific_monsters_killed = parse_specific_monsters_killed(&main_xml);
    let golden_walnuts_found = parse_golden_walnuts_found(&main_xml);

    Ok(SaveDetail {
        summary,
        weather_today,
        weather_tomorrow,
        museum_pieces_count,
        museum_pieces,
        friendships,
        farmer_appearance: Some(farmer_appearance),
        farmer_avatar,
        farmer_avatar_error,
        shipped_items,
        fish_caught,
        cooking_recipes,
        crafting_recipes,
        recipes_cooked,
        secret_notes_seen,
        songs_heard,
        mail_received,
        max_stamina,
        specific_monsters_killed,
        golden_walnuts_found,
    })
}

#[tauri::command]
pub async fn get_save_detail(
    id: String,
    game_dir: Option<String>,
    include_avatar: Option<bool>,
) -> Result<SaveDetail, String> {
    task::spawn_blocking(move || get_save_detail_sync(id, game_dir, include_avatar))
        .await
        .map_err(|e| format!("读取存档详情任务失败: {}", e))?
}
