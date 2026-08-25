use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// 模组数据导出快照（与 C# Mod 的 ModExportSnapshot 对应）
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModExportSnapshot {
    pub save_id: Option<String>,
    pub generated_at: Option<String>,
    pub items: Vec<ModExportItemEntry>,
    pub crops: Vec<ModExportCropEntry>,
    pub animals: Vec<ModExportAnimalEntry>,
    pub villagers: Vec<ModExportVillagerEntry>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModExportItemEntry {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: i32,
    pub price: i32,
    pub edibility: i32,
    #[serde(rename = "type")]
    pub item_type: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModExportCropEntry {
    pub id: String,
    pub seasons: Vec<String>,
    pub harvest_item_id: String,
    pub regrow_days: i32,
    pub phases: Vec<i32>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModExportAnimalEntry {
    pub id: String,
    pub display_name: String,
    pub house: String,
    pub purchase_price: i32,
    pub days_to_mature: i32,
    pub days_to_produce: i32,
    pub produce_item_ids: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModExportVillagerEntry {
    pub id: String,
    pub display_name: String,
    pub birthday: String,
    pub home_region: String,
    pub can_socialize: String,
    pub loves: Vec<String>,
    pub likes: Vec<String>,
}

fn mod_data_path() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var("APPDATA").ok()?;
        Some(
            PathBuf::from(appdata)
                .join("StardewValley")
                .join("StardewValleyAssistant")
                .join("mod-data.json"),
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
                .join("mod-data.json"),
        )
    }
}

/// 获取模组导出数据
#[tauri::command(async)]
pub fn get_mod_export_data() -> Result<Option<ModExportSnapshot>, String> {
    let path = mod_data_path().ok_or_else(|| "无法定位 APPDATA 目录".to_string())?;
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("读取模组数据文件失败: {}", e))?;
    let snapshot: ModExportSnapshot = serde_json::from_str(&content)
        .map_err(|e| format!("解析模组数据文件失败: {}", e))?;
    Ok(Some(snapshot))
}

/// 将模组导出数据保存到用户指定的文件
#[tauri::command]
pub async fn export_mod_data_to_file(
    _app: tauri::AppHandle,
    target_path: String,
) -> Result<String, String> {
    let path = mod_data_path().ok_or_else(|| "无法定位 APPDATA 目录".to_string())?;
    if !path.exists() {
        return Err("模组数据文件不存在，请先启动游戏并加载存档".to_string());
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("读取模组数据文件失败: {}", e))?;

    // 格式化 JSON
    let snapshot: ModExportSnapshot = serde_json::from_str(&content)
        .map_err(|e| format!("解析模组数据文件失败: {}", e))?;
    let pretty = serde_json::to_string_pretty(&snapshot)
        .map_err(|e| format!("序列化失败: {}", e))?;

    fs::write(&target_path, pretty)
        .map_err(|e| format!("写入文件失败: {}", e))?;
    Ok(target_path)
}
