//! 社区中心收集包 Tauri 命令。解析逻辑在 `sdv_game_data::bundles`。

pub use sdv_game_data::bundles::{
    build_bundle_game_data_from_xnb, BundleEntry, BundleGameData, BundleIngredient, RewardItem,
};

#[tauri::command]
pub async fn get_bundle_game_data(
    game_dir: Option<String>,
    lang: Option<String>,
) -> Result<BundleGameData, String> {
    tokio::task::spawn_blocking(move || {
        let content_dir = super::locate_content_dir(game_dir.as_deref())?;
        build_bundle_game_data_from_xnb(&content_dir, lang.as_deref())
    })
    .await
    .map_err(|e| format!("读取收集包数据任务失败: {}", e))?
}
