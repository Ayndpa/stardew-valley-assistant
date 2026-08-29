use serde::{Deserialize, Serialize};
use std::fs;
use tokio::task;

use super::backups::{create_backup_with_timestamp, current_backup_timestamp, ensure_save_paths};
use super::parser::{parse_friendship_data, FriendshipInfo, SaveSummary};
use super::xml_utils::{
    extract_tag_i32, extract_tag_string, extract_tag_u64, replace_first_tag_value,
};

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
pub async fn get_save_editor_data(id: String) -> Result<SaveEditorData, String> {
    task::spawn_blocking(move || get_save_editor_data_sync(id))
        .await
        .map_err(|e| format!("读取存档编辑器数据任务失败: {}", e))?
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
        updated_info =
            replace_friendship_points(&updated_info, &friendship.npc_name, clamped_points);
        updated_main =
            replace_friendship_points(&updated_main, &friendship.npc_name, clamped_points);
    }

    fs::write(&save_game_info_path, updated_info)
        .map_err(|e| format!("Failed to write SaveGameInfo: {}", e))?;
    fs::write(&main_save_path, updated_main)
        .map_err(|e| format!("Failed to write main save file: {}", e))?;

    get_save_editor_data_sync(update.id)
}

#[tauri::command]
pub async fn update_save_editor_data(update: SaveEditorUpdate) -> Result<SaveEditorData, String> {
    task::spawn_blocking(move || update_save_editor_data_sync(update))
        .await
        .map_err(|e| format!("保存存档编辑数据任务失败: {}", e))?
}
