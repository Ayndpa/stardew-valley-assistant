//! 钓鱼地图 Tauri 命令。地图解析、深度计算与磁盘缓存都在 `sdv_game_data::fishing`，
//! 桌面端只负责把 tauri 的 app data 目录换算成共享 crate 需要的 `cache_dir`。

use std::path::PathBuf;
use tauri::Manager;
use tokio::task;

pub use sdv_game_data::fishing::{
    build_fishing_map_data, build_fishing_map_detail, content_cache_key,
    fingerprint_fishing_map_files, get_or_build_fishing_map_cache,
    get_or_render_fishing_map_preview, load_fishing_areas_for_map, parse_fish_conditions,
    parse_fishing_map, CachedFishingMapPreview, CachedFishingMapPreviews, CachedFishingMaps,
    FishingArea, FishingAreaFish, FishingMapCacheFingerprint, FishingMapData, FishingMapDetail,
    FishingMapSummary, FishingTile,
};

/// 共享 crate 会在这个目录下自建 `cache/` 与 `cache/previews/`。
fn cache_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data: {}", e))
}

#[tauri::command]
pub async fn get_fishing_map_data(
    app: tauri::AppHandle,
    game_dir: Option<String>,
    force_refresh: Option<bool>,
    lang: Option<String>,
) -> Result<FishingMapData, String> {
    let _ = lang;
    task::spawn_blocking(move || {
        let cache_dir = cache_dir(&app)?;
        let content_dir = super::locate_content_dir(game_dir.as_deref())?;
        build_fishing_map_data(&cache_dir, &content_dir, force_refresh.unwrap_or(false))
    })
    .await
    .map_err(|err| format!("钓鱼地图解析任务失败: {}", err))?
}

#[tauri::command]
pub async fn get_fishing_map_detail(
    app: tauri::AppHandle,
    game_dir: Option<String>,
    map_id: String,
    force_refresh: Option<bool>,
    lang: Option<String>,
) -> Result<FishingMapDetail, String> {
    task::spawn_blocking(move || {
        let cache_dir = cache_dir(&app)?;
        let content_dir = super::locate_content_dir(game_dir.as_deref())?;
        // 价格来自游戏内运行时的导出文件，属于桌面端专属数据源，因此在这里读好再传进去。
        let mod_prices = super::item_prices::read_item_prices_from_export();
        build_fishing_map_detail(
            &cache_dir,
            &content_dir,
            &map_id,
            force_refresh.unwrap_or(false),
            lang.as_deref(),
            mod_prices.as_ref(),
        )
    })
    .await
    .map_err(|err| format!("钓鱼地图详情任务失败: {}", err))?
}
