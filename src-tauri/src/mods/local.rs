use std::fs::{self, File};
use std::io::{BufReader, Write};
use std::path::Path;
use serde::Deserialize;
use serde_json::Value;
use super::{Mod, ModConfigField};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use std::io::ErrorKind;

#[derive(Deserialize, Debug)]
struct Manifest {
    #[serde(alias = "Name", alias = "name")]
    name: Option<String>,
    #[serde(alias = "Author", alias = "author")]
    author: Option<String>,
    #[serde(alias = "Version", alias = "version")]
    version: Option<String>,
    #[serde(alias = "Description", alias = "description")]
    description: Option<String>,
    #[serde(alias = "UniqueID", alias = "uniqueId", alias = "unique_id")]
    unique_id: Option<String>,
    #[serde(alias = "UpdateKeys", alias = "updateKeys", alias = "update_keys")]
    update_keys: Option<Vec<String>>,
    #[serde(alias = "Dependencies", alias = "dependencies")]
    dependencies: Option<Vec<ManifestDependency>>,
}

#[derive(Deserialize, Debug)]
struct ManifestDependency {
    #[serde(alias = "UniqueID", alias = "uniqueId", alias = "unique_id")]
    unique_id: Option<String>,
}

#[tauri::command]
pub fn list_installed_mods(game_dir: String) -> Result<Vec<Mod>, String> {
    let mods_dir = Path::new(&game_dir).join("Mods");
    if !mods_dir.exists() {
        return Ok(Vec::new());
    }

    let mut installed_mods = Vec::new();
    let entries = fs::read_dir(&mods_dir)
        .map_err(|e| format!("Failed to read Mods folder: {}", e))?;

    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let folder_name = entry.file_name().to_string_lossy().to_string();
        let is_enabled = !folder_name.starts_with('.');

        let manifest_path = path.join("manifest.json");
        if !manifest_path.exists() {
            continue;
        }

        let manifest_file = File::open(&manifest_path)
            .map_err(|e| format!("Failed to open manifest.json in {}: {}", folder_name, e))?;
        
        let manifest: Manifest = match serde_json::from_reader(BufReader::new(manifest_file)) {
            Ok(m) => m,
            Err(e) => {
                println!("Error parsing manifest.json in {}: {}", folder_name, e);
                continue;
            }
        };

        let id = manifest.unique_id.clone().unwrap_or_else(|| folder_name.clone());
        let name = manifest.name.clone().unwrap_or_else(|| folder_name.clone());
        let english_name = folder_name.trim_start_matches('.').to_string();
        let version = manifest.version.clone().unwrap_or_else(|| "1.0.0".to_string());
        let author = manifest.author.unwrap_or_else(|| "Unknown".to_string());
        let description = manifest.description.unwrap_or_else(|| "No description provided.".to_string());

        let mut nexus_id = None;
        if let Some(keys) = manifest.update_keys {
            for key in keys {
                if key.to_lowercase().starts_with("nexus:") {
                    if let Some(id_str) = key.split(':').nth(1) {
                        if let Ok(id_num) = id_str.trim().parse::<u64>() {
                            nexus_id = Some(id_num);
                        }
                    }
                }
            }
        }

        let mut dependencies = Vec::new();
        if let Some(deps) = manifest.dependencies {
            for dep in deps {
                if let Some(dep_id) = dep.unique_id {
                    dependencies.push(dep_id);
                }
            }
        }

        let mut config_fields = Vec::new();
        let config_path = path.join("config.json");
        if config_path.exists() {
            if let Ok(config_file) = File::open(&config_path) {
                if let Ok(config_val) = serde_json::from_reader::<_, serde_json::Value>(BufReader::new(config_file)) {
                    if let Some(obj) = config_val.as_object() {
                        for (k, v) in obj {
                            let r#type = match v {
                                serde_json::Value::Bool(_) => "boolean".to_string(),
                                serde_json::Value::Number(_) => "number".to_string(),
                                serde_json::Value::String(_) => "string".to_string(),
                                _ => "string".to_string(),
                            };
                            config_fields.push(ModConfigField {
                                key: k.clone(),
                                label: k.clone(),
                                r#type,
                                value: v.clone(),
                                description: String::new(),
                            });
                        }
                    }
                }
            }
        }

        let mut category = "utility".to_string();
        let id_lower = id.to_lowercase();
        if id_lower == "pathoschild.contentpatcher" {
            category = "core".to_string();
        } else if id_lower.contains("contentpatcher") || dependencies.iter().any(|d| d.to_lowercase().contains("contentpatcher")) {
            category = "content".to_string();
        } else if id_lower.contains("expansion") || id_lower.contains("sve") || folder_name.to_lowercase().contains("expansion") {
            category = "expansion".to_string();
        }

        let local_path = format!("Mods/{}", folder_name);

        installed_mods.push(Mod {
            id,
            name,
            english_name,
            version: version.clone(),
            latest_version: version,
            author,
            description,
            category,
            is_enabled,
            nexus_id,
            local_path,
            folder_name,
            dependencies,
            config: config_fields,
        });
    }

    Ok(installed_mods)
}

#[tauri::command]
pub fn toggle_mod(game_dir: String, folder_name: String, enable: bool) -> Result<String, String> {
    let mods_dir = Path::new(&game_dir).join("Mods");
    if !mods_dir.exists() {
        return Err("Mods folder does not exist".to_string());
    }

    let src_path = mods_dir.join(&folder_name);
    if !src_path.exists() {
        return Err(format!("Mod folder {} does not exist", folder_name));
    }

    let new_folder_name = if enable {
        if folder_name.starts_with('.') {
            folder_name.trim_start_matches('.').to_string()
        } else {
            folder_name.clone()
        }
    } else {
        if !folder_name.starts_with('.') {
            format!(".{}", folder_name)
        } else {
            folder_name.clone()
        }
    };

    if new_folder_name != folder_name {
        let dest_path = mods_dir.join(&new_folder_name);
        fs::rename(&src_path, &dest_path)
            .map_err(|e| format!("Failed to rename folder from {} to {}: {}", folder_name, new_folder_name, e))?;
    }

    Ok(new_folder_name)
}

#[tauri::command]
pub fn delete_mod(game_dir: String, folder_name: String) -> Result<(), String> {
    let game_path = Path::new(&game_dir);
    if !game_path.exists() {
        return Err("游戏安装目录不存在".to_string());
    }

    let mods_path = game_path.join("Mods");
    if !mods_path.exists() {
        return Err("Mods 文件夹不存在".to_string());
    }

    if folder_name.contains("..") || folder_name.contains(std::path::MAIN_SEPARATOR) {
        return Err("非法的模组文件夹名".to_string());
    }

    let target = mods_path.join(&folder_name);
    if !target.exists() {
        return Err(format!("模组 {} 不存在", folder_name));
    }

    if target.is_dir() {
        fs::remove_dir_all(&target).map_err(|e| format!("删除模组目录失败: {}", e))
    } else {
        fs::remove_file(&target).map_err(|e| format!("删除模组文件失败: {}", e))
    }
}

#[tauri::command]
pub fn save_mod_config(game_dir: String, folder_name: String, config: serde_json::Value) -> Result<(), String> {
    let mods_dir = Path::new(&game_dir).join("Mods");
    let mod_dir = mods_dir.join(&folder_name);
    if !mod_dir.exists() {
        return Err(format!("Mod folder {} does not exist", folder_name));
    }

    let config_path = mod_dir.join("config.json");
    let mut file = File::create(&config_path)
        .map_err(|e| format!("Failed to create config.json: {}", e))?;

    let json_str = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config JSON: {}", e))?;

    file.write_all(json_str.as_bytes())
        .map_err(|e| format!("Failed to write to config.json: {}", e))?;

    Ok(())
}

fn copy_with_retry(source: &Path, target: &Path) -> Result<u64, String> {
    let mut last_error: Option<String> = None;

    for attempt in 1..=3 {
        match fs::copy(source, target) {
            Ok(size) => return Ok(size),
            Err(err) => {
                last_error = Some(format!("复制压缩包失败: {}", err));
                if err.kind() != ErrorKind::PermissionDenied || attempt >= 3 {
                    return Err(format!("复制压缩包失败: {}", err));
                }
                std::thread::sleep(Duration::from_millis(250 * attempt as u64));
            }
        }
    }

    Err(last_error.unwrap_or_else(|| "复制压缩包失败: 未知错误".to_string()))
}

#[tauri::command]
pub fn install_mod_from_zip_sync(game_dir: String, zip_path: String) -> Result<Value, String> {
    let game_path = Path::new(&game_dir);
    if !game_path.exists() {
        return Err("游戏安装目录不存在".to_string());
    }

    let source_zip = Path::new(&zip_path);
    if !source_zip.exists() {
        return Err("模组压缩包不存在".to_string());
    }

    let zip_ext = source_zip
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if zip_ext != "zip" {
        return Err("请拖入 .zip 文件".to_string());
    }

    let mods_path = game_path.join("Mods");
    fs::create_dir_all(&mods_path).map_err(|e| format!("创建 Mods 目录失败: {}", e))?;

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| std::time::Duration::from_secs(0))
        .as_millis();
    let working_dir = std::env::temp_dir().join(format!("sv_mod_install_{}", timestamp));
    let zip_target = working_dir.join("mod.zip");
    let extract_dir = working_dir.join("extract");

    let cleanup = || {
        let _ = fs::remove_dir_all(&working_dir);
    };

    if working_dir.exists() {
        let _ = fs::remove_dir_all(&working_dir);
    }
    fs::create_dir_all(&working_dir)
        .map_err(|e| format!("创建临时目录失败: {}", e))?;
    copy_with_retry(&source_zip, &zip_target)?;
    fs::create_dir_all(&extract_dir).map_err(|e| format!("创建解压目录失败: {}", e))?;

    if let Err(err) = crate::utils::extract_zip(&zip_target, &extract_dir) {
        cleanup();
        return Err(format!("解压失败: {}", err));
    }

    let mut installed_any = false;
    let entries = match fs::read_dir(&extract_dir) {
        Ok(e) => e,
        Err(e) => {
            cleanup();
            return Err(format!("读取解压目录失败: {}", e));
        }
    };

    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(err) => {
                cleanup();
                return Err(format!("读取解压项失败: {}", err));
            }
        };
        let source = entry.path();
        let target = mods_path.join(entry.file_name());

        if target.exists() {
            if target.is_dir() {
                fs::remove_dir_all(&target).map_err(|e| format!("清理旧目录失败: {}", e))?;
            } else {
                fs::remove_file(&target).map_err(|e| format!("清理旧文件失败: {}", e))?;
            }
        }

        if source.is_dir() {
            if let Err(err) = crate::utils::copy_dir_all(&source, &target) {
                cleanup();
                return Err(format!("复制目录失败: {}", err));
            }
        } else {
            fs::copy(&source, &target)
                .map_err(|e| format!("复制文件失败: {}", e))?;
        }
        installed_any = true;
    }

    if !installed_any {
        cleanup();
        return Err("安装内容为空，未写入任何文件".to_string());
    }

    cleanup();
    Ok(serde_json::json!({
        "success": true,
        "message": "mod installed"
    }))
}

#[tauri::command]
pub async fn install_mod_from_zip(game_dir: String, zip_path: String) -> Result<Value, String> {
    tokio::task::spawn_blocking(move || install_mod_from_zip_sync(game_dir, zip_path))
        .await
        .map_err(|err| format!("安装任务执行失败: {}", err))?
}
