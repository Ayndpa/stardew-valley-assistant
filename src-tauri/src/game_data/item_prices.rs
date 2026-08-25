use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::SystemTime;

/// 游戏数据导出快照（与 C# Mod 的 ModExportSnapshot 对应）
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GameDataExport {
    pub save_id: Option<String>,
    pub generated_at: Option<String>,
    pub items: Vec<GameDataItemEntry>,
    pub crops: Vec<GameDataCropEntry>,
    pub animals: Vec<GameDataAnimalEntry>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GameDataItemEntry {
    pub id: String,
    pub name: String,
    pub internal_name: String,
    pub description: String,
    pub category: i32,
    pub price: i32,
    pub edibility: i32,
    #[serde(rename = "type")]
    pub item_type: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GameDataCropEntry {
    pub id: String,
    pub seasons: Vec<String>,
    pub harvest_item_id: String,
    pub regrow_days: i32,
    pub phases: Vec<i32>,
    pub needs_watering: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GameDataAnimalEntry {
    pub id: String,
    pub display_name: String,
    pub house: String,
    pub purchase_price: i32,
    pub sell_price: i32,
    pub days_to_mature: i32,
    pub days_to_produce: i32,
    pub can_get_pregnant: bool,
    pub harvest_type: i32,
    pub harvest_tool: String,
    pub produce_item_ids: Vec<String>,
    pub deluxe_produce_item_ids: Vec<String>,
    pub deluxe_produce_min_friendship: i32,
    pub can_swim: bool,
    pub can_eat_golden_crackers: bool,
}

/// 带时间戳的缓存，文件变化时自动失效
struct ExportCache {
    data: GameDataExport,
    modified: SystemTime,
}

static CACHED_EXPORT: Mutex<Option<ExportCache>> = Mutex::new(None);

/// 读取 game-data.json 导出文件。
/// 文件变化时自动重新读取，文件删除后返回 None。
pub fn read_game_data_export() -> Option<GameDataExport> {
    let path = game_data_export_path()?;

    let metadata = fs::metadata(&path).ok()?;
    let modified = metadata.modified().ok()?;

    // 检查缓存是否有效
    if let Ok(cache) = CACHED_EXPORT.lock() {
        if let Some(ref c) = *cache {
            if c.modified == modified {
                return Some(c.data.clone());
            }
        }
    }

    // 重新读取
    let raw = fs::read_to_string(&path).ok()?;
    let data: GameDataExport = serde_json::from_str(&raw).ok()?;

    // 更新缓存
    if let Ok(mut cache) = CACHED_EXPORT.lock() {
        *cache = Some(ExportCache {
            data: data.clone(),
            modified,
        });
    }

    Some(data)
}

/// 导出文件的指纹，用作各类快照缓存的键的一部分。
///
/// 伴侣模组会在游戏运行时重写 game-data.json，凡是读取了导出数据的缓存
/// 都必须把这个指纹算进键里，否则模组更新价格后会一直命中陈旧快照。
pub fn export_fingerprint() -> String {
    let Some(path) = game_data_export_path() else {
        return "noexport".to_string();
    };
    match fs::metadata(&path).and_then(|m| m.modified()) {
        Ok(modified) => match modified.duration_since(SystemTime::UNIX_EPOCH) {
            Ok(age) => format!("{}", age.as_nanos()),
            Err(_) => "unknown".to_string(),
        },
        Err(_) => "noexport".to_string(),
    }
}

/// 从导出文件构建物品价格映射表。
pub fn read_item_prices_from_export() -> Option<HashMap<String, i32>> {
    let export = read_game_data_export()?;
    let map: HashMap<String, i32> = export
        .items
        .iter()
        .filter(|item| item.price > 0)
        .map(|item| (item.id.clone(), item.price))
        .collect();
    Some(map)
}

/// 从导出文件构建物品名称映射表（id -> display name）。
pub fn build_item_name_map_from_export() -> Option<HashMap<String, String>> {
    let export = read_game_data_export()?;
    let map: HashMap<String, String> = export
        .items
        .iter()
        .map(|item| (item.id.clone(), item.name.clone()))
        .collect();
    Some(map)
}

/// 从导出文件构建物品条目映射表（id -> item entry）。
pub fn build_item_map_from_export() -> Option<HashMap<String, GameDataItemEntry>> {
    let export = read_game_data_export()?;
    let map: HashMap<String, GameDataItemEntry> = export
        .items
        .into_iter()
        .map(|item| (item.id.clone(), item))
        .collect();
    Some(map)
}

fn game_data_export_path() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var("APPDATA").ok()?;
        Some(
            PathBuf::from(appdata)
                .join("StardewValley")
                .join("StardewValleyAssistant")
                .join("game-data.json"),
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
                .join("game-data.json"),
        )
    }
}

/// 获取导出图标目录路径。
fn icons_dir_path() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var("APPDATA").ok()?;
        Some(
            PathBuf::from(appdata)
                .join("StardewValley")
                .join("StardewValleyAssistant")
                .join("icons"),
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
                .join("icons"),
        )
    }
}

/// 从 icons/ 目录读取指定 ID 的图标，返回 base64 data URL。
/// `prefix` 可选前缀（如 "animal_"），`id` 为物品/动物 ID。
pub fn read_icon_from_export(prefix: &str, id: &str) -> Option<String> {
    let dir = icons_dir_path()?;
    let path = dir.join(format!("{}{}.png", prefix, id));
    if !path.exists() {
        return None;
    }
    let bytes = fs::read(&path).ok()?;
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Some(format!("data:image/png;base64,{}", b64))
}

