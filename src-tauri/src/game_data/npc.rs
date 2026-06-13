use std::collections::HashMap;
use std::path::Path;
use serde::{Deserialize, Serialize};

use super::xnb::{load_localized_string_tables, load_xnb_payload, XnbPayloadReader, require_reader};

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NpcProfile {
    pub id: String,
    pub name: String,
    pub birthday: Option<String>,
    pub gender: String,
    pub marriage_candidate: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NpcGameData {
    pub npcs: Vec<NpcProfile>,
}

#[tauri::command]
pub fn get_npc_game_data(game_dir: Option<String>) -> Result<NpcGameData, String> {
    let content_dir = super::locate_content_dir(game_dir.as_deref())?;
    let localized_tables = load_localized_string_tables(
        &content_dir,
        &["Characters", "NPCNames", "UI", "1_6_Strings"],
    );
    let mut npcs = load_npc_profiles(&content_dir, &localized_tables)?;

    npcs.sort_by(|a, b| a.name.cmp(&b.name).then(a.id.cmp(&b.id)));

    Ok(NpcGameData { npcs })
}

pub fn load_npc_profiles(
    content_dir: &Path,
    localized_tables: &HashMap<String, HashMap<String, String>>,
) -> Result<Vec<NpcProfile>, String> {
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
            .read_npc_profile(&key, localized_tables)
            .map_err(|e| format!("Failed to parse character '{}': {}", key, e))?
        {
            npcs.push(npc);
        }
    }

    Ok(npcs)
}
