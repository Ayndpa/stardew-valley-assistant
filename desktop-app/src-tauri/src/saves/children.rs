use serde::{Deserialize, Serialize};
use std::fs;
use tokio::task;

use super::backups::{create_backup_with_timestamp, current_backup_timestamp, ensure_save_paths};
use super::xml_utils::{extract_tag_i32, extract_tag_string, get_tag_value};

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChildInfo {
    pub name: String,
    pub gender: String,
    pub days_old: i32,
    pub age_stage: i32,
    pub dark_skinned: bool,
    pub id_of_parent: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChildrenData {
    pub children: Vec<ChildInfo>,
    pub has_crib: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChildUpdate {
    pub save_id: String,
    pub child_index: i32,
    pub name: Option<String>,
    pub days_old: Option<i32>,
    pub gender: Option<String>,
    pub dark_skinned: Option<bool>,
}

fn days_to_age_stage(days_old: i32) -> i32 {
    if days_old >= 55 {
        3 // toddler
    } else if days_old >= 27 {
        2 // crawler
    } else if days_old >= 13 {
        1 // baby
    } else {
        0 // newborn
    }
}

fn parse_child_block(block: &str) -> Option<ChildInfo> {
    let name = extract_tag_string(block, "name");
    if name.is_empty() {
        return None;
    }

    let gender = extract_tag_string(block, "Gender");
    let days_old = extract_tag_i32(block, "daysOld");
    let dark_skinned = get_tag_value(block, "darkSkinned")
        .map(|v| v.trim() == "true")
        .unwrap_or(false);
    let id_of_parent = extract_tag_string(block, "idOfParent");

    Some(ChildInfo {
        name,
        gender,
        days_old,
        age_stage: days_to_age_stage(days_old),
        dark_skinned,
        id_of_parent,
    })
}

/// Extract all <Child> blocks from the FarmHouse location's characters list.
fn extract_child_blocks(xml: &str) -> Vec<&str> {
    let mut blocks = Vec::new();

    // Find the FarmHouse location
    let farmhouse_start = xml.find("<GameLocation xsi:type=\"FarmHouse\">");
    let farmhouse_start = match farmhouse_start {
        Some(s) => s,
        None => return blocks,
    };
    let farmhouse_end = xml[farmhouse_start..]
        .find("</GameLocation>")
        .unwrap_or(xml.len() - farmhouse_start)
        + farmhouse_start;
    let farmhouse_xml = &xml[farmhouse_start..farmhouse_end];

    // Find all <characters> sections and extract <Child> blocks
    let mut search_pos = 0;
    while let Some(child_start) = farmhouse_xml[search_pos..].find("<xsi:type=\"Child\">") {
        let abs_start = search_pos + child_start;

        // Walk backwards to find the opening <NPC> or <Character> tag
        // Actually, in Stardew Valley saves, Child elements appear as:
        // <NPC xsi:type="Child"> ... </NPC>
        // Let's find the enclosing NPC block
        let npc_prefix = &farmhouse_xml[..abs_start];
        let npc_open = npc_prefix.rfind("<NPC");
        if npc_open.is_none() {
            search_pos = abs_start + 1;
            continue;
        }
        let npc_open = npc_open.unwrap();

        // Find the closing </NPC> tag
        let search_from = abs_start + "<xsi:type=\"Child\">".len();
        let npc_close = farmhouse_xml[search_from..].find("</NPC>");
        if npc_close.is_none() {
            search_pos = abs_start + 1;
            continue;
        }
        let npc_close = search_from + npc_close.unwrap() + "</NPC>".len();

        let block = &farmhouse_xml[npc_open..npc_close];
        blocks.push(block);
        search_pos = npc_close;
    }

    blocks
}

pub fn parse_children(xml: &str) -> ChildrenData {
    let blocks = extract_child_blocks(xml);
    let children: Vec<ChildInfo> = blocks.iter().filter_map(|b| parse_child_block(b)).collect();

    // Check for crib
    let has_crib = xml.find("<GameLocation xsi:type=\"FarmHouse\">").map_or(false, |start| {
        let end = xml[start..].find("</GameLocation>").unwrap_or(xml.len() - start) + start;
        let section = &xml[start..end];
        if let Some(val) = get_tag_value(section, "cribStyle") {
            val.trim().parse::<i32>().unwrap_or(0) > 0
        } else {
            false
        }
    });

    ChildrenData { children, has_crib }
}

fn get_children_data_sync(id: String) -> Result<ChildrenData, String> {
    let (_, _, main_save_path) = ensure_save_paths(&id)?;
    let main_xml = fs::read_to_string(&main_save_path)
        .map_err(|e| format!("Failed to read main save file: {}", e))?;

    Ok(parse_children(&main_xml))
}

#[tauri::command]
pub async fn get_children_data(id: String) -> Result<ChildrenData, String> {
    task::spawn_blocking(move || get_children_data_sync(id))
        .await
        .map_err(|e| format!("读取孩子数据任务失败: {}", e))?
}

fn replace_child_field(xml: &str, child_index: i32, field: &str, new_value: &str) -> Option<String> {
    let blocks = extract_child_blocks(xml);
    let target_block = blocks.get(child_index as usize)?;

    let block_start = xml.find(target_block)?;
    let block_end = block_start + target_block.len();
    let block_content = &xml[block_start..block_end];

    // Find and replace the field value within this specific block
    let start_tag = format!("<{}>", field);
    let end_tag = format!("</{}>", field);
    let field_start = block_content.find(&start_tag)?;
    let value_start = field_start + start_tag.len();
    let field_end = block_content[value_start..].find(&end_tag)?;
    let value_end = value_start + field_end;

    let mut result = String::with_capacity(xml.len() + new_value.len());
    result.push_str(&xml[..block_start + value_start]);
    result.push_str(new_value);
    result.push_str(&xml[block_start + value_end..]);
    Some(result)
}

fn update_child_sync(update: ChildUpdate) -> Result<ChildrenData, String> {
    let (_, save_game_info_path, main_save_path) = ensure_save_paths(&update.save_id)?;

    let main_xml = fs::read_to_string(&main_save_path)
        .map_err(|e| format!("Failed to read main save file: {}", e))?;
    let info_xml = fs::read_to_string(&save_game_info_path)
        .map_err(|e| format!("Failed to read SaveGameInfo: {}", e))?;

    // Validate child index
    let current_data = parse_children(&main_xml);
    if update.child_index < 0 || update.child_index >= current_data.children.len() as i32 {
        return Err(format!(
            "Child index {} is out of range (0-{})",
            update.child_index,
            current_data.children.len().saturating_sub(1)
        ));
    }

    // Auto-backup
    let timestamp = current_backup_timestamp()?;
    create_backup_with_timestamp(&main_save_path, &main_xml, timestamp)?;
    create_backup_with_timestamp(&save_game_info_path, &info_xml, timestamp)?;

    let mut updated_main = main_xml.clone();
    let mut updated_info = info_xml.clone();

    // Update name
    if let Some(ref name) = update.name {
        if name.trim().is_empty() {
            return Err("孩子姓名不能为空".to_string());
        }
        if let Some(new_xml) = replace_child_field(&updated_main, update.child_index, "name", name) {
            updated_main = new_xml;
        }
        if let Some(new_xml) = replace_child_field(&updated_info, update.child_index, "name", name) {
            updated_info = new_xml;
        }
    }

    // Update daysOld
    if let Some(days_old) = update.days_old {
        if days_old < 0 || days_old > 999 {
            return Err("天数必须在 0-999 之间".to_string());
        }
        let days_str = days_old.to_string();
        if let Some(new_xml) = replace_child_field(&updated_main, update.child_index, "daysOld", &days_str) {
            updated_main = new_xml;
        }
        if let Some(new_xml) = replace_child_field(&updated_info, update.child_index, "daysOld", &days_str) {
            updated_info = new_xml;
        }
    }

    // Update Gender
    if let Some(ref gender) = update.gender {
        if gender != "Male" && gender != "Female" {
            return Err("性别必须是 Male 或 Female".to_string());
        }
        if let Some(new_xml) = replace_child_field(&updated_main, update.child_index, "Gender", gender) {
            updated_main = new_xml;
        }
        if let Some(new_xml) = replace_child_field(&updated_info, update.child_index, "Gender", gender) {
            updated_info = new_xml;
        }
    }

    // Update darkSkinned
    if let Some(dark_skinned) = update.dark_skinned {
        let val = if dark_skinned { "true" } else { "false" };
        if let Some(new_xml) = replace_child_field(&updated_main, update.child_index, "darkSkinned", val) {
            updated_main = new_xml;
        }
        if let Some(new_xml) = replace_child_field(&updated_info, update.child_index, "darkSkinned", val) {
            updated_info = new_xml;
        }
    }

    // Write back
    fs::write(&main_save_path, &updated_main)
        .map_err(|e| format!("Failed to write main save file: {}", e))?;
    fs::write(&save_game_info_path, &updated_info)
        .map_err(|e| format!("Failed to write SaveGameInfo: {}", e))?;

    Ok(parse_children(&updated_main))
}

#[tauri::command]
pub async fn update_child(update: ChildUpdate) -> Result<ChildrenData, String> {
    task::spawn_blocking(move || update_child_sync(update))
        .await
        .map_err(|e| format!("更新孩子数据任务失败: {}", e))?
}
