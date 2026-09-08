//! NPC 档案 Tauri 命令。解析逻辑在 `sdv_game_data::npc`。

use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Mutex};

pub use sdv_game_data::npc::{
    build_npc_game_data_from_xnb, load_npc_profiles, NpcGameData, NpcProfile,
};

static NPC_GAME_DATA_CACHE: LazyLock<Mutex<HashMap<String, Arc<NpcGameData>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[tauri::command(async)]
pub fn get_npc_game_data(
    game_dir: Option<String>,
    lang: Option<String>,
) -> Result<NpcGameData, String> {
    let content_dir = super::locate_content_dir(game_dir.as_deref())?;
    let lang_str = lang.as_deref().unwrap_or("zh").to_string();
    let key = super::snapshot_cache_key(&content_dir, &lang_str);
    let snapshot = super::cached_snapshot(&NPC_GAME_DATA_CACHE, key, || {
        build_npc_game_data_from_xnb(&content_dir, &lang_str)
    })?;
    Ok((*snapshot).clone())
}
