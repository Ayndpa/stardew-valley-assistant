use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

use super::calendar::resolve_localized_text;
use super::xnb::{
    load_localized_string_tables_with_lang, load_objects_xnb, load_string_dictionary_xnb, load_xnb_payload,
    require_reader, XnbPayloadReader,
};

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NpcProfile {
    pub id: String,
    pub name: String,
    pub birthday: Option<String>,
    pub gender: String,
    pub marriage_candidate: bool,
    pub loved_items: Vec<String>,
    pub hated_items: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NpcGameData {
    pub npcs: Vec<NpcProfile>,
}

#[tauri::command]
pub fn get_npc_game_data(
    game_dir: Option<String>,
    lang: Option<String>,
) -> Result<NpcGameData, String> {
    let content_dir = super::locate_content_dir(game_dir.as_deref())?;
    let lang_str = lang.as_deref().unwrap_or("zh");
    let is_zh = lang_str.to_lowercase().starts_with("zh");
    let localized_tables = load_localized_string_tables_with_lang(
        &content_dir,
        &[
            "Characters",
            "NPCNames",
            "UI",
            "1_6_Strings",
            "StringsFromCSFiles",
            "Objects",
        ],
        Some(lang_str),
    );
    let mut npcs = load_npc_profiles(&content_dir, &localized_tables, is_zh)?;

    npcs.sort_by(|a, b| a.name.cmp(&b.name).then(a.id.cmp(&b.id)));

    Ok(NpcGameData { npcs })
}

pub fn load_npc_profiles(
    content_dir: &Path,
    localized_tables: &HashMap<String, HashMap<String, String>>,
    is_zh: bool,
) -> Result<Vec<NpcProfile>, String> {
    let gift_tastes =
        load_string_dictionary_xnb(&content_dir.join("Data").join("NPCGiftTastes.xnb"))?;
    let objects = load_objects_xnb(&content_dir.join("Data").join("Objects.xnb"))?;
    let universal_loved = parse_taste_labels(
        gift_tastes
            .get("Universal_Love")
            .map(String::as_str)
            .unwrap_or_default(),
        &objects,
        localized_tables,
    );
    let universal_hated = parse_taste_labels(
        gift_tastes
            .get("Universal_Hate")
            .map(String::as_str)
            .unwrap_or_default(),
        &objects,
        localized_tables,
    );

    let path = content_dir.join("Data").join("Characters.xnb");
    let payload = load_xnb_payload(&path)?;
    let mut reader = XnbPayloadReader::new(&payload);
    let type_readers = reader.read_type_readers()?;
    let root_reader = reader.read_7bit_usize()?;
    if root_reader == 0 {
        return Ok(Vec::new());
    }
    require_reader(&type_readers, root_reader, "DictionaryReader")?;

    let count = reader.read_i32()?.max(0) as usize;
    let mut npcs = Vec::new();
    for _ in 0..count {
        let key = reader.read_object_string(&type_readers)?;
        let value_reader = reader.read_7bit_usize()?;
        if value_reader == 0 {
            continue;
        }
        require_reader(&type_readers, value_reader, "ReflectiveReader")
            .map_err(|e| format!("Failed to parse character '{}': {}", key, e))?;
        if let Some(npc) = reader
            .read_npc_profile(&key, localized_tables, is_zh)
            .map_err(|e| format!("Failed to parse character '{}': {}", key, e))?
        {
            let mut npc = npc;
            if let Some(raw_tastes) = gift_tastes.get(&key) {
                let (loved_items, hated_items) = parse_npc_gift_preferences(
                    raw_tastes,
                    &universal_loved,
                    &universal_hated,
                    &objects,
                    localized_tables,
                );
                npc.loved_items = loved_items;
                npc.hated_items = hated_items;
            }
            npcs.push(npc);
        }
    }

    Ok(npcs)
}

fn parse_npc_gift_preferences(
    raw: &str,
    universal_loved: &[String],
    universal_hated: &[String],
    objects: &HashMap<String, super::xnb::RawObjectData>,
    localized_tables: &HashMap<String, HashMap<String, String>>,
) -> (Vec<String>, Vec<String>) {
    let parts: Vec<&str> = raw.split('/').collect();
    if parts.len() < 10 {
        return (Vec::new(), Vec::new());
    }

    let personal_loved = parse_taste_labels(parts[1], objects, localized_tables);
    let personal_hated = parse_taste_labels(parts[7], objects, localized_tables);

    (
        merge_unique(universal_loved, &personal_loved),
        merge_unique(universal_hated, &personal_hated),
    )
}

fn merge_unique(base: &[String], extra: &[String]) -> Vec<String> {
    let mut merged = Vec::with_capacity(base.len() + extra.len());
    for value in base.iter().chain(extra.iter()) {
        if !value.is_empty() && !merged.contains(value) {
            merged.push(value.clone());
        }
    }
    merged
}

fn parse_taste_labels(
    raw: &str,
    objects: &HashMap<String, super::xnb::RawObjectData>,
    localized_tables: &HashMap<String, HashMap<String, String>>,
) -> Vec<String> {
    raw.split_whitespace()
        .filter_map(|token| taste_token_label(token, objects, localized_tables))
        .collect()
}

fn taste_token_label(
    token: &str,
    objects: &HashMap<String, super::xnb::RawObjectData>,
    localized_tables: &HashMap<String, HashMap<String, String>>,
) -> Option<String> {
    let token = token.trim();
    if token.is_empty() {
        return None;
    }

    if let Some(object) = objects.get(token) {
        return Some(resolve_localized_text(
            &object.display_name,
            localized_tables,
        ));
    }

    if let Some(stripped) = token.strip_prefix("(O)") {
        if let Some(object) = objects.get(stripped).or_else(|| objects.get(token)) {
            return Some(resolve_localized_text(
                &object.display_name,
                localized_tables,
            ));
        }
    }

    if let Ok(category) = token.parse::<i32>() {
        let label = category_display_name(category, localized_tables);
        if !label.is_empty() {
            return Some(label);
        }
    }

    Some(format_context_tag(token))
}

fn category_display_name(
    category: i32,
    localized_tables: &HashMap<String, HashMap<String, String>>,
) -> String {
    let strings = localized_tables.get("StringsFromCSFiles");
    let strings_16 = localized_tables.get("1_6_Strings");
    let key = match category {
        -97 => "Boots.cs.12501",
        -100 => "category_clothes",
        -96 => "Ring.cs.1",
        -99 => "Tool.cs.14307",
        -12 | -2 => "Object.cs.12850",
        -75 => "Object.cs.12851",
        -4 => "Object.cs.12852",
        -25 | -7 => "Object.cs.12853",
        -79 => "Object.cs.12854",
        -74 => "Object.cs.12855",
        -19 => "Object.cs.12856",
        -21 => "Object.cs.12857",
        -22 => "Object.cs.12858",
        -24 => "Object.cs.12859",
        -20 => "Object.cs.12860",
        -27 | -26 => "Object.cs.12862",
        -8 => "Object.cs.12863",
        -18 | -14 | -6 | -5 => "Object.cs.12864",
        -80 => "Object.cs.12866",
        -28 => "Object.cs.12867",
        -16 | -15 => "Object.cs.12868",
        -81 => "Object.cs.12869",
        _ => "",
    };

    if !key.is_empty() {
        return strings
            .and_then(|table| table.get(key))
            .cloned()
            .unwrap_or_default();
    }

    match category {
        -102 => strings_16
            .and_then(|table| table.get("Book_Category"))
            .cloned()
            .unwrap_or_default(),
        -103 => strings_16
            .and_then(|table| table.get("skillBook_Category"))
            .cloned()
            .unwrap_or_default(),
        _ => String::new(),
    }
}

fn format_context_tag(tag: &str) -> String {
    tag.replace('_', " ")
}
