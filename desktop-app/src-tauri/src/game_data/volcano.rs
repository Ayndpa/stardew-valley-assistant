//! 火山地牢布局 Tauri 命令。
//!
//! 解析逻辑（XNB 解包、布局贴图解码、set piece 事件提取）都在 `sdv_game_data::volcano`，
//! 这里只负责定位 Content 目录、做一层内存缓存，以及把解析放到阻塞线程池里跑。

use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Mutex};

use tokio::task;

pub use sdv_game_data::volcano::{
    load_volcano_layout_data, SetPieceFeature, VolcanoLayoutData, VolcanoPieceEvents,
    VolcanoPieceSize, VolcanoTile,
};

/// 解析一次要解包 640×640 的贴图 + 5 个 tBIN 地图，而游戏目录在应用运行期间不会变，
/// 因此按内容目录缓存整份结果。
static CACHE: LazyLock<Mutex<HashMap<String, Arc<VolcanoLayoutData>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[tauri::command]
pub async fn get_volcano_layout_data(
    game_dir: Option<String>,
) -> Result<VolcanoLayoutData, String> {
    task::spawn_blocking(move || {
        let content_dir = super::locate_content_dir(game_dir.as_deref())?;
        let key = content_dir.to_string_lossy().to_string();

        if let Ok(guard) = CACHE.lock() {
            if let Some(hit) = guard.get(&key) {
                return Ok((**hit).clone());
            }
        }

        let data = Arc::new(load_volcano_layout_data(&content_dir)?);
        if let Ok(mut guard) = CACHE.lock() {
            guard.insert(key, data.clone());
        }
        Ok((*data).clone())
    })
    .await
    .map_err(|err| format!("火山布局解析任务失败: {}", err))?
}
