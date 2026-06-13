use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::Instant;
use tokio::task;

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

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EditableFriendship {
    pub npc_name: String,
    pub points: i32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SaveEditorData {
    pub summary: SaveSummary,
    pub editable_friendships: Vec<EditableFriendship>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SaveEditorUpdate {
    pub id: String,
    pub money: i32,
    pub total_money_earned: i32,
    pub day_of_month: i32,
    pub season: i32,
    pub year: i32,
    pub farming_level: i32,
    pub mining_level: i32,
    pub combat_level: i32,
    pub foraging_level: i32,
    pub fishing_level: i32,
    pub deepest_mine_level: i32,
    pub friendships: Vec<EditableFriendship>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SaveBackupEntry {
    pub timestamp: u64,
    pub created_at: u64,
    pub info_file_size: u64,
    pub main_file_size: u64,
    pub missing_files: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SaveBackupCatalog {
    pub save_id: String,
    pub save_folder_path: String,
    pub backups: Vec<SaveBackupEntry>,
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

fn replace_first_tag_value(xml: &str, tag: &str, new_value: &str) -> Result<String, String> {
    let start_tag = format!("<{}>", tag);
    let end_tag = format!("</{}>", tag);
    let start_idx = xml
        .find(&start_tag)
        .ok_or_else(|| format!("Tag <{}> not found", tag))?;
    let value_start = start_idx + start_tag.len();
    let end_rel = xml[value_start..]
        .find(&end_tag)
        .ok_or_else(|| format!("Closing tag </{}> not found", tag))?;
    let value_end = value_start + end_rel;

    let mut updated = String::with_capacity(xml.len() + new_value.len());
    updated.push_str(&xml[..value_start]);
    updated.push_str(new_value);
    updated.push_str(&xml[value_end..]);
    Ok(updated)
}

fn replace_friendship_points(xml: &str, npc_name: &str, points: i32) -> String {
    let mut search_pos = 0usize;
    let mut updated = xml.to_string();

    while let Some(item_rel) = updated[search_pos..].find("<item>") {
        let item_start = search_pos + item_rel;
        let Some(item_end_rel) = updated[item_start..].find("</item>") else {
            break;
        };
        let item_end = item_start + item_end_rel + "</item>".len();
        let item_xml = &updated[item_start..item_end];

        if item_xml.contains(&format!("<string>{}</string>", npc_name)) {
            let Some(points_start_rel) = item_xml.find("<Points>") else {
                break;
            };
            let points_start = item_start + points_start_rel + "<Points>".len();
            let Some(points_end_rel) = updated[points_start..].find("</Points>") else {
                break;
            };
            let points_end = points_start + points_end_rel;
            updated.replace_range(points_start..points_end, &points.to_string());
            break;
        }

        search_pos = item_end;
    }

    updated
}

fn current_backup_timestamp() -> Result<u64, String> {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("Failed to get backup timestamp: {}", e))
        .map(|duration| duration.as_secs())
}

fn create_backup_with_timestamp(path: &PathBuf, contents: &str, timestamp: u64) -> Result<(), String> {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Invalid save file name".to_string())?;
    let backup_name = format!("{}.backup-{}", file_name, timestamp);
    let backup_path = path.with_file_name(backup_name);
    fs::write(&backup_path, contents)
        .map_err(|e| format!("Failed to write backup {}: {}", backup_path.display(), e))
}

fn ensure_save_paths(id: &str) -> Result<(PathBuf, PathBuf, PathBuf), String> {
    let saves_dir =
        get_saves_dir().ok_or_else(|| "Could not locate APPDATA or HOME directory".to_string())?;
    let save_folder = saves_dir.join(id);
    if !save_folder.exists() {
        return Err(format!("Save folder {} does not exist", id));
    }

    let save_game_info_path = save_folder.join("SaveGameInfo");
    if !save_game_info_path.exists() {
        return Err(format!("SaveGameInfo not found in {}", id));
    }

    let main_save_path = save_folder.join(id);
    if !main_save_path.exists() {
        return Err(format!("Main save file {} not found in {}", id, id));
    }

    Ok((save_folder, save_game_info_path, main_save_path))
}

fn parse_backup_timestamp(file_name: &str, expected_prefix: &str) -> Option<u64> {
    file_name
        .strip_prefix(expected_prefix)
        .and_then(|value| value.parse::<u64>().ok())
}

fn list_save_backups_sync(id: String) -> Result<SaveBackupCatalog, String> {
    let (save_folder, _, _) = ensure_save_paths(&id)?;
    let info_prefix = "SaveGameInfo.backup-";
    let main_prefix = format!("{}.backup-", id);
    let mut backups = std::collections::BTreeMap::<u64, SaveBackupEntry>::new();

    let entries = fs::read_dir(&save_folder)
        .map_err(|e| format!("Failed to read save folder {}: {}", save_folder.display(), e))?;

    for entry in entries {
        let entry = match entry {
            Ok(value) => value,
            Err(_) => continue,
        };
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let file_name = entry.file_name().to_string_lossy().to_string();
        let backup_match = if let Some(timestamp) = parse_backup_timestamp(&file_name, info_prefix) {
            Some((timestamp, true))
        } else {
            parse_backup_timestamp(&file_name, &main_prefix).map(|timestamp| (timestamp, false))
        };

        let Some((timestamp, is_info_file)) = backup_match else {
            continue;
        };

        let file_size = entry.metadata().map(|meta| meta.len()).unwrap_or(0);
        let backup = backups.entry(timestamp).or_insert_with(|| SaveBackupEntry {
            timestamp,
            created_at: timestamp,
            info_file_size: 0,
            main_file_size: 0,
            missing_files: Vec::new(),
        });

        if is_info_file {
            backup.info_file_size = file_size;
        } else {
            backup.main_file_size = file_size;
        }
    }

    let mut backup_list = backups.into_values().collect::<Vec<_>>();
    for backup in &mut backup_list {
        if backup.info_file_size == 0 {
            backup.missing_files.push("SaveGameInfo".to_string());
        }
        if backup.main_file_size == 0 {
            backup.missing_files.push(id.clone());
        }
    }
    backup_list.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

    Ok(SaveBackupCatalog {
        save_id: id,
        save_folder_path: save_folder.to_string_lossy().to_string(),
        backups: backup_list,
    })
}

#[tauri::command]
pub async fn list_save_backups(id: String) -> Result<SaveBackupCatalog, String> {
    task::spawn_blocking(move || list_save_backups_sync(id))
        .await
        .map_err(|e| format!("读取存档备份列表任务失败: {}", e))?
}

#[tauri::command]
pub async fn create_save_backup(id: String) -> Result<SaveBackupCatalog, String> {
    task::spawn_blocking(move || {
        let (_, save_game_info_path, main_save_path) = ensure_save_paths(&id)?;
        let info_xml = fs::read_to_string(&save_game_info_path)
            .map_err(|e| format!("Failed to read SaveGameInfo: {}", e))?;
        let main_xml = fs::read_to_string(&main_save_path)
            .map_err(|e| format!("Failed to read main save file: {}", e))?;
        let timestamp = current_backup_timestamp()?;
        create_backup_with_timestamp(&save_game_info_path, &info_xml, timestamp)?;
        create_backup_with_timestamp(&main_save_path, &main_xml, timestamp)?;
        list_save_backups_sync(id)
    })
    .await
    .map_err(|e| format!("创建存档备份任务失败: {}", e))?
}

#[tauri::command]
pub async fn restore_save_backup(id: String, timestamp: u64) -> Result<SaveBackupCatalog, String> {
    task::spawn_blocking(move || {
        let (save_folder, save_game_info_path, main_save_path) = ensure_save_paths(&id)?;
        let info_backup_path = save_folder.join(format!("SaveGameInfo.backup-{}", timestamp));
        let main_backup_path = save_folder.join(format!("{}.backup-{}", id, timestamp));
        if !info_backup_path.exists() || !main_backup_path.exists() {
            return Err("选中的备份不完整，无法恢复。".to_string());
        }

        let current_info = fs::read_to_string(&save_game_info_path)
            .map_err(|e| format!("Failed to read SaveGameInfo: {}", e))?;
        let current_main = fs::read_to_string(&main_save_path)
            .map_err(|e| format!("Failed to read main save file: {}", e))?;
        let restore_info = fs::read_to_string(&info_backup_path)
            .map_err(|e| format!("Failed to read backup SaveGameInfo: {}", e))?;
        let restore_main = fs::read_to_string(&main_backup_path)
            .map_err(|e| format!("Failed to read backup main save file: {}", e))?;

        let rollback_timestamp = current_backup_timestamp()?;
        create_backup_with_timestamp(&save_game_info_path, &current_info, rollback_timestamp)?;
        create_backup_with_timestamp(&main_save_path, &current_main, rollback_timestamp)?;

        fs::write(&save_game_info_path, restore_info)
            .map_err(|e| format!("Failed to restore SaveGameInfo: {}", e))?;
        fs::write(&main_save_path, restore_main)
            .map_err(|e| format!("Failed to restore main save file: {}", e))?;

        list_save_backups_sync(id)
    })
    .await
    .map_err(|e| format!("恢复存档备份任务失败: {}", e))?
}

#[tauri::command]
pub async fn delete_save_backup(id: String, timestamp: u64) -> Result<SaveBackupCatalog, String> {
    task::spawn_blocking(move || {
        let (save_folder, _, _) = ensure_save_paths(&id)?;
        let info_backup_path = save_folder.join(format!("SaveGameInfo.backup-{}", timestamp));
        let main_backup_path = save_folder.join(format!("{}.backup-{}", id, timestamp));
        let mut removed_any = false;

        for path in [&info_backup_path, &main_backup_path] {
            if path.exists() {
                fs::remove_file(path)
                    .map_err(|e| format!("Failed to delete backup {}: {}", path.display(), e))?;
                removed_any = true;
            }
        }

        if !removed_any {
            return Err("未找到要删除的备份文件。".to_string());
        }

        list_save_backups_sync(id)
    })
    .await
    .map_err(|e| format!("删除存档备份任务失败: {}", e))?
}

fn upsert_numeric_fields(xml: &str, update: &SaveEditorUpdate) -> Result<String, String> {
    let mut updated = xml.to_string();
    let replacements = [
        ("money", update.money.to_string()),
        ("totalMoneyEarned", update.total_money_earned.to_string()),
        ("dayOfMonthForSaveGame", update.day_of_month.to_string()),
        ("seasonForSaveGame", update.season.to_string()),
        ("yearForSaveGame", update.year.to_string()),
        ("farmingLevel", update.farming_level.to_string()),
        ("miningLevel", update.mining_level.to_string()),
        ("combatLevel", update.combat_level.to_string()),
        ("foragingLevel", update.foraging_level.to_string()),
        ("fishingLevel", update.fishing_level.to_string()),
        ("deepestMineLevel", update.deepest_mine_level.to_string()),
    ];

    for (tag, value) in replacements {
        updated = replace_first_tag_value(&updated, tag, &value)?;
    }

    Ok(updated)
}

fn editable_friendships_from_infos(friendships: Vec<FriendshipInfo>) -> Vec<EditableFriendship> {
    let mut list = friendships
        .into_iter()
        .map(|friendship| EditableFriendship {
            npc_name: friendship.npc_name,
            points: friendship.points,
        })
        .collect::<Vec<_>>();
    list.sort_by(|a, b| a.npc_name.cmp(&b.npc_name));
    list
}

fn get_direct_child_tag_value<'a>(xml: &'a str, tag: &str) -> Option<&'a str> {
    let open_tag = format!("<{}", tag);
    let close_tag = format!("</{}>", tag);
    let mut depth = 0usize;
    let mut pos = 0usize;
    let bytes = xml.as_bytes();

    while pos < xml.len() {
        let Some(rel_start) = xml[pos..].find('<') else {
            break;
        };
        let start = pos + rel_start;
        let Some(rel_end) = xml[start..].find('>') else {
            break;
        };
        let end = start + rel_end;
        let token = &xml[start..=end];

        if token.starts_with("</") {
            depth = depth.saturating_sub(1);
        } else {
            if depth == 1 && token.starts_with(&open_tag) {
                let value_start = end + 1;
                let value_end_rel = xml[value_start..].find(&close_tag)?;
                let value_end = value_start + value_end_rel;
                if !xml[value_start..value_end].contains('<') {
                    return Some(xml[value_start..value_end].trim());
                }
            }

            let self_closing = bytes.get(end.saturating_sub(1)).is_some_and(|b| *b == b'/');
            if !self_closing && !token.starts_with("<?") && !token.starts_with("<!") {
                depth += 1;
            }
        }

        pos = end + 1;
    }

    None
}

fn extract_game_location_blocks(xml: &str) -> Vec<&str> {
    let Some(locations_start) = xml.find("<locations>") else {
        eprintln!("[get_planted_crops] no <locations> section found");
        return Vec::new();
    };
    let Some(locations_end_rel) = xml[locations_start..].find("</locations>") else {
        eprintln!("[get_planted_crops] no </locations> terminator found");
        return Vec::new();
    };
    let locations_end = locations_start + locations_end_rel;
    let locations_xml = &xml[locations_start..locations_end];
    eprintln!(
        "[get_planted_crops] locations section bytes={} start={}",
        locations_xml.len(),
        locations_start
    );

    let mut blocks = Vec::new();
    let mut pos = 0usize;
    let open_tag = "<GameLocation";
    let close_tag = "</GameLocation>";
    let mut location_index = 0usize;

    while let Some(start_rel) = locations_xml[pos..].find(open_tag) {
        let start = pos + start_rel;
        let Some(open_end_rel) = locations_xml[start..].find('>') else {
            eprintln!(
                "[get_planted_crops] malformed GameLocation opening tag at byte {}",
                start
            );
            break;
        };
        let mut search = start + open_end_rel + 1;
        let mut depth = 1usize;
        location_index += 1;
        if location_index <= 10 || location_index % 25 == 0 {
            eprintln!(
                "[get_planted_crops] scanning GameLocation #{} at local byte {}",
                location_index, start
            );
        }

        while depth > 0 {
            let next_open = locations_xml[search..]
                .find(open_tag)
                .map(|idx| search + idx);
            let next_close = locations_xml[search..]
                .find(close_tag)
                .map(|idx| search + idx);

            match (next_open, next_close) {
                (_, None) => {
                    eprintln!(
                        "[get_planted_crops] unterminated GameLocation #{} search={}",
                        location_index, search
                    );
                    return blocks;
                }
                (Some(open_idx), Some(close_idx)) if open_idx < close_idx => {
                    depth += 1;
                    search = open_idx + open_tag.len();
                }
                (_, Some(close_idx)) => {
                    depth -= 1;
                    search = close_idx + close_tag.len();
                }
            }
        }

        blocks.push(&locations_xml[start..search]);
        if location_index <= 10 || location_index % 25 == 0 {
            eprintln!(
                "[get_planted_crops] captured GameLocation #{} bytes={}",
                location_index,
                search - start
            );
        }
        pos = search;
    }

    eprintln!(
        "[get_planted_crops] extracted {} GameLocation blocks",
        blocks.len()
    );

    blocks
}

fn extract_direct_child_blocks<'a>(xml: &'a str, child_tag: &str) -> Vec<&'a str> {
    let open_tag = format!("<{}", child_tag);
    let close_tag = format!("</{}>", child_tag);
    let mut blocks = Vec::new();
    let mut depth = 0usize;
    let mut pos = 0usize;
    let mut current_start: Option<usize> = None;
    let bytes = xml.as_bytes();

    while pos < xml.len() {
        let Some(rel_start) = xml[pos..].find('<') else {
            break;
        };
        let start = pos + rel_start;
        let Some(rel_end) = xml[start..].find('>') else {
            break;
        };
        let end = start + rel_end;
        let token = &xml[start..=end];

        if token.starts_with("</") {
            if depth == 2 && token == close_tag {
                if let Some(block_start) = current_start.take() {
                    blocks.push(&xml[block_start..start + close_tag.len()]);
                }
            }
            depth = depth.saturating_sub(1);
        } else {
            let self_closing = bytes.get(end.saturating_sub(1)).is_some_and(|b| *b == b'/');
            if depth == 1 && token.starts_with(&open_tag) {
                current_start = Some(start);
                if self_closing {
                    blocks.push(&xml[start..=end]);
                    current_start = None;
                }
            }

            if !self_closing && !token.starts_with("<?") && !token.starts_with("<!") {
                depth += 1;
            }
        }

        pos = end + 1;
    }

    blocks
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
pub async fn list_save_files(game_dir: Option<String>) -> Result<Vec<SaveSummary>, String> {
    task::spawn_blocking(move || list_save_files_sync(game_dir))
        .await
        .map_err(|e| format!("读取存档列表任务失败: {}", e))?
}

fn list_save_files_sync(game_dir: Option<String>) -> Result<Vec<SaveSummary>, String> {
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
pub async fn get_save_detail(
    id: String,
    game_dir: Option<String>,
    include_avatar: Option<bool>,
) -> Result<SaveDetail, String> {
    task::spawn_blocking(move || get_save_detail_sync(id, game_dir, include_avatar))
        .await
        .map_err(|e| format!("读取存档详情任务失败: {}", e))?
}

fn get_save_detail_sync(
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
pub async fn get_save_editor_data(id: String) -> Result<SaveEditorData, String> {
    task::spawn_blocking(move || get_save_editor_data_sync(id))
        .await
        .map_err(|e| format!("读取存档编辑器数据任务失败: {}", e))?
}

fn get_save_editor_data_sync(id: String) -> Result<SaveEditorData, String> {
    let (_, save_game_info_path, _) = ensure_save_paths(&id)?;
    let info_xml = fs::read_to_string(&save_game_info_path)
        .map_err(|e| format!("Failed to read SaveGameInfo: {}", e))?;

    let summary = SaveSummary {
        id,
        player_name: extract_tag_string(&info_xml, "name"),
        farm_name: extract_tag_string(&info_xml, "farmName"),
        money: extract_tag_i32(&info_xml, "money"),
        total_money_earned: extract_tag_i32(&info_xml, "totalMoneyEarned"),
        day_of_month: extract_tag_i32(&info_xml, "dayOfMonthForSaveGame"),
        season: extract_tag_i32(&info_xml, "seasonForSaveGame"),
        year: extract_tag_i32(&info_xml, "yearForSaveGame"),
        farming_level: extract_tag_i32(&info_xml, "farmingLevel"),
        mining_level: extract_tag_i32(&info_xml, "miningLevel"),
        combat_level: extract_tag_i32(&info_xml, "combatLevel"),
        foraging_level: extract_tag_i32(&info_xml, "foragingLevel"),
        fishing_level: extract_tag_i32(&info_xml, "fishingLevel"),
        deepest_mine_level: extract_tag_i32(&info_xml, "deepestMineLevel"),
        milliseconds_played: extract_tag_u64(&info_xml, "millisecondsPlayed"),
        last_save_time: save_game_info_path
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0),
        farmer_avatar: None,
        farmer_avatar_error: None,
    };

    Ok(SaveEditorData {
        summary,
        editable_friendships: editable_friendships_from_infos(parse_friendship_data(&info_xml)),
    })
}

#[tauri::command]
pub async fn update_save_editor_data(update: SaveEditorUpdate) -> Result<SaveEditorData, String> {
    task::spawn_blocking(move || update_save_editor_data_sync(update))
        .await
        .map_err(|e| format!("保存存档编辑数据任务失败: {}", e))?
}

fn update_save_editor_data_sync(update: SaveEditorUpdate) -> Result<SaveEditorData, String> {
    if !(1..=28).contains(&update.day_of_month) {
        return Err("Day of month must be between 1 and 28".to_string());
    }
    if !(0..=3).contains(&update.season) {
        return Err("Season must be between 0 and 3".to_string());
    }
    if update.year < 1 {
        return Err("Year must be at least 1".to_string());
    }

    let (_, save_game_info_path, main_save_path) = ensure_save_paths(&update.id)?;

    let info_xml = fs::read_to_string(&save_game_info_path)
        .map_err(|e| format!("Failed to read SaveGameInfo: {}", e))?;
    let main_xml = fs::read_to_string(&main_save_path)
        .map_err(|e| format!("Failed to read main save file: {}", e))?;

    let timestamp = current_backup_timestamp()?;
    create_backup_with_timestamp(&save_game_info_path, &info_xml, timestamp)?;
    create_backup_with_timestamp(&main_save_path, &main_xml, timestamp)?;

    let mut updated_info = upsert_numeric_fields(&info_xml, &update)?;
    let mut updated_main = upsert_numeric_fields(&main_xml, &update)?;

    for friendship in &update.friendships {
        let clamped_points = friendship.points.clamp(0, 2500);
        updated_info = replace_friendship_points(&updated_info, &friendship.npc_name, clamped_points);
        updated_main = replace_friendship_points(&updated_main, &friendship.npc_name, clamped_points);
    }

    fs::write(&save_game_info_path, updated_info)
        .map_err(|e| format!("Failed to write SaveGameInfo: {}", e))?;
    fs::write(&main_save_path, updated_main)
        .map_err(|e| format!("Failed to write main save file: {}", e))?;

    get_save_editor_data_sync(update.id)
}

#[tauri::command]
pub async fn get_planted_crops(id: String) -> Result<Vec<PlantedCrop>, String> {
    task::spawn_blocking(move || get_planted_crops_sync(id))
        .await
        .map_err(|e| format!("读取种植作物任务失败: {}", e))?
}

fn get_planted_crops_sync(id: String) -> Result<Vec<PlantedCrop>, String> {
    let started_at = Instant::now();
    eprintln!("[get_planted_crops] start save_id={}", id);
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
    eprintln!(
        "[get_planted_crops] loaded save bytes={} path={}",
        xml.len(),
        main_save_path.display()
    );

    let mut planted_crops = Vec::new();
    let location_blocks = extract_game_location_blocks(&xml);
    eprintln!(
        "[get_planted_crops] begin processing {} location blocks",
        location_blocks.len()
    );

    for (location_index, loc_xml) in location_blocks.into_iter().enumerate() {
        let location_started_at = Instant::now();
        let name = get_direct_child_tag_value(loc_xml, "name")
            .unwrap_or("Unknown")
            .to_string();
        eprintln!(
            "[get_planted_crops] location-start #{} name={} bytes={}",
            location_index + 1,
            name,
            loc_xml.len()
        );

        let Some(tf_start) = loc_xml.find("<terrainFeatures>") else {
            continue;
        };
        let Some(tf_end_rel) = loc_xml[tf_start..].find("</terrainFeatures>") else {
            continue;
        };
        let terrain_features_section =
            &loc_xml[tf_start..tf_start + tf_end_rel + "</terrainFeatures>".len()];
        let terrain_feature_items = extract_direct_child_blocks(terrain_features_section, "item");
        if terrain_feature_items.is_empty() {
            continue;
        }

        let mut location_hoe_dirt_count = 0usize;
        let mut location_crop_count = 0usize;
        let mut scanned_items = 0usize;
        for item_xml in terrain_feature_items {
            scanned_items += 1;
            if scanned_items % 1000 == 0 {
                eprintln!(
                    "[get_planted_crops] location-progress name={} scanned_items={} hoe_dirt={} parsed_crops={} elapsed_ms={}",
                    name,
                    scanned_items,
                    location_hoe_dirt_count,
                    location_crop_count,
                    location_started_at.elapsed().as_millis()
                );
            }

            if item_xml.contains("xsi:type=\"HoeDirt\"") || item_xml.contains("type=\"HoeDirt\"") {
                location_hoe_dirt_count += 1;
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

                                if seed_id.is_empty() && harvest_id.is_empty() {
                                    continue;
                                }

                                location_crop_count += 1;
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
        }

        eprintln!(
            "[get_planted_crops] location-done name={} scanned_items={} hoe_dirt={} parsed_crops={} running_total={} elapsed_ms={}",
            name,
            scanned_items,
            location_hoe_dirt_count,
            location_crop_count,
            planted_crops.len(),
            location_started_at.elapsed().as_millis()
        );
    }

    eprintln!(
        "[get_planted_crops] finished total_parsed_crops={} total_elapsed_ms={}",
        planted_crops.len(),
        started_at.elapsed().as_millis()
    );
    Ok(planted_crops)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_list() {
        match list_save_files_sync(None) {
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
