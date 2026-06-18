use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use super::live_state::LiveGameState;

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ItemPricesResult {
    pub source: String,
    pub save_id: Option<String>,
    pub prices: HashMap<String, i32>,
    pub error: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ItemPricesSnapshot {
    save_id: Option<String>,
    generated_at: Option<String>,
    prices: HashMap<String, i32>,
}

/// Read real-time item prices written by the SMAPI mod.
/// Returns `None` if the snapshot is missing or stale (>30s old).
pub fn read_realtime_item_prices() -> Option<HashMap<String, i32>> {
    let path = realtime_item_prices_snapshot_path()?;

    if !path.exists() {
        return None;
    }

    let metadata = fs::metadata(&path).ok()?;
    let modified = metadata.modified().ok()?;
    let elapsed = std::time::SystemTime::now()
        .duration_since(modified)
        .unwrap_or_else(|_| std::time::Duration::from_secs(0));

    if elapsed.as_secs() > 30 {
        return None;
    }

    let raw = fs::read_to_string(&path).ok()?;
    let snapshot: ItemPricesSnapshot = serde_json::from_str(&raw).ok()?;

    Some(snapshot.prices)
}

/// Merge mod prices into an existing price map.
/// Only overwrites prices for items that exist in both maps.
pub fn merge_mod_prices(base_prices: &mut HashMap<String, i32>, mod_prices: &HashMap<String, i32>) {
    for (id, &price) in mod_prices {
        base_prices.insert(id.clone(), price);
    }
}

/// Get item prices from the mod, with fallback to file.
#[tauri::command]
pub async fn get_item_prices_from_mod(
    live_state: tauri::State<'_, LiveGameState>,
) -> Result<ItemPricesResult, String> {
    // Try live state first (from HTTP server)
    if let Some(payload) = live_state.get_item_prices().await {
        return Ok(ItemPricesResult {
            source: "mod".to_string(),
            save_id: payload.save_id,
            prices: payload.prices,
            error: None,
        });
    }

    // Fall back to file-based
    Ok(get_item_prices_from_file())
}

/// Check if the item prices mod is running.
#[tauri::command]
pub async fn check_item_prices_mod_running(live_state: tauri::State<'_, LiveGameState>) -> Result<bool, String> {
    // Check live state first
    if live_state.is_game_running().await {
        return Ok(true);
    }

    // Fall back to file check
    Ok(check_item_prices_file_running())
}

fn get_item_prices_from_file() -> ItemPricesResult {
    let path = match realtime_item_prices_snapshot_path() {
        Some(p) => p,
        None => {
            return ItemPricesResult {
                source: "unavailable".to_string(),
                save_id: None,
                prices: HashMap::new(),
                error: Some("无法定位星露谷用户数据目录。".to_string()),
            };
        }
    };

    if !path.exists() {
        return ItemPricesResult {
            source: "unavailable".to_string(),
            save_id: None,
            prices: HashMap::new(),
            error: Some("游戏未运行或 Mod 未安装，实时价格不可用。".to_string()),
        };
    }

    let metadata = match fs::metadata(&path) {
        Ok(m) => m,
        Err(e) => {
            return ItemPricesResult {
                source: "error".to_string(),
                save_id: None,
                prices: HashMap::new(),
                error: Some(format!("无法读取价格快照元数据: {}", e)),
            };
        }
    };

    let modified = match metadata.modified() {
        Ok(m) => m,
        Err(e) => {
            return ItemPricesResult {
                source: "error".to_string(),
                save_id: None,
                prices: HashMap::new(),
                error: Some(format!("无法获取价格快照修改时间: {}", e)),
            };
        }
    };

    let elapsed = std::time::SystemTime::now()
        .duration_since(modified)
        .unwrap_or_else(|_| std::time::Duration::from_secs(0));

    if elapsed.as_secs() > 30 {
        return ItemPricesResult {
            source: "stale".to_string(),
            save_id: None,
            prices: HashMap::new(),
            error: Some("游戏未运行，实时价格不可用。".to_string()),
        };
    }

    let raw = match fs::read_to_string(&path) {
        Ok(r) => r,
        Err(e) => {
            return ItemPricesResult {
                source: "error".to_string(),
                save_id: None,
                prices: HashMap::new(),
                error: Some(format!("无法读取价格快照: {}", e)),
            };
        }
    };

    let snapshot: ItemPricesSnapshot = match serde_json::from_str(&raw) {
        Ok(s) => s,
        Err(e) => {
            return ItemPricesResult {
                source: "error".to_string(),
                save_id: None,
                prices: HashMap::new(),
                error: Some(format!("价格快照格式无效: {}", e)),
            };
        }
    };

    ItemPricesResult {
        source: "mod".to_string(),
        save_id: snapshot.save_id,
        prices: snapshot.prices,
        error: None,
    }
}

fn check_item_prices_file_running() -> bool {
    if let Some(path) = realtime_item_prices_snapshot_path() {
        if let Ok(metadata) = fs::metadata(&path) {
            if let Ok(modified) = metadata.modified() {
                if let Ok(elapsed) = std::time::SystemTime::now().duration_since(modified) {
                    return elapsed.as_secs() < 30;
                }
            }
        }
    }
    false
}

fn realtime_item_prices_snapshot_path() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var("APPDATA").ok()?;
        Some(
            PathBuf::from(appdata)
                .join("StardewValley")
                .join("StardewValleyAssistant")
                .join("item-prices.json"),
        )
    }
    #[cfg(not(target_os = "windows"))]
    {
        let home = std::env::var("HOME").ok()?;
        Some(
            PathBuf::from(home)
                .join(".config")
                .join("StardewValley")
                .join("StardewValleyAssistant")
                .join("item-prices.json"),
        )
    }
}
