//! 秘密纸条 Tauri 命令。解析逻辑在 `sdv_game_data::secret_notes`。

use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Mutex};
use tokio::task;

pub use sdv_game_data::secret_notes::{build_secret_notes_from_xnb, SecretNoteEntry};

static SECRET_NOTES_CACHE: LazyLock<Mutex<HashMap<String, Arc<Vec<SecretNoteEntry>>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[tauri::command]
pub async fn get_secret_notes_game_data(
    game_dir: Option<String>,
    lang: Option<String>,
) -> Result<Vec<SecretNoteEntry>, String> {
    task::spawn_blocking(move || {
        let content_dir = super::locate_content_dir(game_dir.as_deref())?;
        let lang_str = lang.as_deref().unwrap_or("zh").to_string();
        let key = super::snapshot_cache_key(&content_dir, &lang_str);

        let snapshot = super::cached_snapshot(&SECRET_NOTES_CACHE, key, || {
            build_secret_notes_from_xnb(&content_dir, lang.as_deref())
        })?;
        Ok((*snapshot).clone())
    })
    .await
    .map_err(|e| format!("读取秘密纸条数据任务失败: {}", e))?
}
