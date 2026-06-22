use super::{Mod, ModConfigField};
use serde::Deserialize;
use serde_json::Value;
use std::fs::{self, File};
use std::io::ErrorKind;
use std::io::{BufReader, Write};
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const ASSISTANT_MOD_DLL: &[u8] =
    include_bytes!("../../bundled-mods/StardewValleyAssistant/bin/Release/StardewValleyAssistant.dll");
const ASSISTANT_MOD_MANIFEST: &[u8] =
    include_bytes!("../../bundled-mods/StardewValleyAssistant/manifest.json");

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

/// Recursively scan a directory for mods (folders containing manifest.json).
/// `relative_path` is the path relative to the Mods/ root (e.g. "美化类/xxx美化Mod").
fn scan_mods_recursive(
    dir: &Path,
    mods_root: &Path,
    results: &mut Vec<Mod>,
) -> Result<(), String> {
    let entries =
        fs::read_dir(dir).map_err(|e| format!("Failed to read folder {:?}: {}", dir, e))?;

    let mut has_manifest = false;
    let manifest_path = dir.join("manifest.json");
    if manifest_path.exists() {
        has_manifest = true;
    }

    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let _dir_name = entry.file_name().to_string_lossy().to_string();

        // If this directory has a manifest.json, parse it as a mod
        // and do NOT recurse further (it's a mod folder, not a category folder)
        if path.join("manifest.json").exists() {
            has_manifest = true;
            match parse_mod_folder(&path, mods_root) {
                Ok(mod_entry) => results.push(mod_entry),
                Err(e) => println!("Skipping mod folder {:?}: {}", path, e),
            }
            continue;
        }

        // No manifest.json — treat as a category/group folder, recurse into it
        scan_mods_recursive(&path, mods_root, results)?;
    }

    // If the directory itself has a manifest.json but we already processed it above
    // (shouldn't happen since we check before the loop), handle edge case
    if has_manifest && results.last().map_or(true, |m| {
        let rel = dir.strip_prefix(mods_root).unwrap_or(dir);
        let expected = rel.to_string_lossy().replace('\\', "/");
        m.folder_name != expected
    }) {
        // The dir itself is a mod folder but wasn't picked up in the loop
        // (this handles the case where the dir has manifest.json AND subdirectories)
        match parse_mod_folder(dir, mods_root) {
            Ok(mod_entry) => {
                // Avoid duplicate if already added
                if !results.iter().any(|m| m.folder_name == mod_entry.folder_name) {
                    results.push(mod_entry);
                }
            }
            Err(e) => println!("Skipping mod folder {:?}: {}", dir, e),
        }
    }

    Ok(())
}

/// Parse a single mod folder into a Mod struct.
/// `mod_dir` must contain a manifest.json.
fn parse_mod_folder(mod_dir: &Path, mods_root: &Path) -> Result<Mod, String> {
    let relative = mod_dir
        .strip_prefix(mods_root)
        .unwrap_or(mod_dir)
        .to_string_lossy()
        .replace('\\', "/");
    let folder_name = relative.clone();

    // is_enabled: check if ANY segment of the path starts with '.'
    let is_enabled = !folder_name.split('/').any(|seg| seg.starts_with('.'));

    let manifest_path = mod_dir.join("manifest.json");
    let manifest_file = File::open(&manifest_path)
        .map_err(|e| format!("Failed to open manifest.json: {}", e))?;

    let manifest: Manifest = serde_json::from_reader(BufReader::new(manifest_file))
        .map_err(|e| format!("Failed to parse manifest.json: {}", e))?;

    let display_folder_name = mod_dir
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| folder_name.clone());

    let id = manifest
        .unique_id
        .clone()
        .unwrap_or_else(|| display_folder_name.clone());
    let name = manifest
        .name
        .clone()
        .unwrap_or_else(|| display_folder_name.clone());
    let english_name = display_folder_name.trim_start_matches('.').to_string();
    let version = manifest
        .version
        .clone()
        .unwrap_or_else(|| "1.0.0".to_string());
    let author = manifest.author.unwrap_or_else(|| "Unknown".to_string());
    let description = manifest
        .description
        .unwrap_or_else(|| "No description provided.".to_string());

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
    let config_path = mod_dir.join("config.json");
    if config_path.exists() {
        if let Ok(config_file) = File::open(&config_path) {
            if let Ok(config_val) =
                serde_json::from_reader::<_, serde_json::Value>(BufReader::new(config_file))
            {
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
    } else if id_lower.contains("contentpatcher")
        || dependencies
            .iter()
            .any(|d| d.to_lowercase().contains("contentpatcher"))
    {
        category = "content".to_string();
    } else if id_lower.contains("expansion")
        || id_lower.contains("sve")
        || folder_name.to_lowercase().contains("expansion")
    {
        category = "expansion".to_string();
    }

    // parent_path: the directory containing the mod, relative to Mods/
    // e.g. for "美化类/xxx美化Mod" -> "美化类"
    // for top-level mods -> ""
    let parent_path = mod_dir
        .parent()
        .and_then(|p| p.strip_prefix(mods_root).ok())
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default();

    let local_path = format!("Mods/{}", folder_name);

    Ok(Mod {
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
        parent_path,
        dependencies,
        config: config_fields,
    })
}

#[tauri::command]
pub fn list_installed_mods(game_dir: String) -> Result<Vec<Mod>, String> {
    let mods_dir = Path::new(&game_dir).join("Mods");
    if !mods_dir.exists() {
        return Ok(Vec::new());
    }

    let mut installed_mods = Vec::new();
    scan_mods_recursive(&mods_dir, &mods_dir, &mut installed_mods)?;
    Ok(installed_mods)
}

#[tauri::command]
pub fn toggle_mod(game_dir: String, folder_name: String, enable: bool) -> Result<String, String> {
    let mods_dir = Path::new(&game_dir).join("Mods");
    if !mods_dir.exists() {
        return Err("Mods folder does not exist".to_string());
    }

    // Reject empty or whitespace-only names (would resolve to Mods/ itself)
    if folder_name.trim().is_empty() {
        return Err("模组文件夹名不能为空".to_string());
    }
    // Reject "." (current directory = Mods/)
    if folder_name == "." {
        return Err("非法的模组文件夹名".to_string());
    }
    // Reject path traversal
    if folder_name.contains("..") {
        return Err("非法的模组文件夹名".to_string());
    }

    let src_path = mods_dir.join(&folder_name);
    if !src_path.exists() {
        return Err(format!("Mod folder {} does not exist", folder_name));
    }

    // Split into parent segments and the last (actual mod) folder name
    // e.g. "美化类/.xxxMod" -> parent="美化类", last=".xxxMod"
    let path = Path::new(&folder_name);
    let last_name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| folder_name.clone());
    let parent = path.parent().filter(|p| !p.as_os_str().is_empty());

    let new_last_name = if enable {
        if last_name.starts_with('.') {
            last_name.trim_start_matches('.').to_string()
        } else {
            last_name.clone()
        }
    } else {
        if !last_name.starts_with('.') {
            format!(".{}", last_name)
        } else {
            last_name.clone()
        }
    };

    let new_folder_name = match parent {
        Some(p) => format!("{}/{}", p.to_string_lossy(), new_last_name),
        None => new_last_name.clone(),
    };

    if new_folder_name != folder_name {
        let dest_path = mods_dir.join(&new_folder_name);
        // Ensure parent directories exist (they should, but be safe)
        if let Some(parent_dir) = dest_path.parent() {
            fs::create_dir_all(parent_dir)
                .map_err(|e| format!("Failed to create parent directory: {}", e))?;
        }
        fs::rename(&src_path, &dest_path).map_err(|e| {
            format!(
                "Failed to rename folder from {} to {}: {}",
                folder_name, new_folder_name, e
            )
        })?;
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

    // Reject empty or whitespace-only names (would resolve to Mods/ itself)
    if folder_name.trim().is_empty() {
        return Err("模组文件夹名不能为空".to_string());
    }
    // Reject "." (current directory = Mods/)
    if folder_name == "." {
        return Err("非法的模组文件夹名".to_string());
    }
    // Allow nested paths (e.g. "美化类/xxxMod") but reject path traversal
    if folder_name.contains("..") {
        return Err("非法的模组文件夹名".to_string());
    }
    // Reject absolute paths
    if folder_name.starts_with('/') || folder_name.starts_with('\\') {
        return Err("非法的模组文件夹名".to_string());
    }
    // On Windows, also reject drive letters like C:\
    if folder_name.len() >= 2 && folder_name.as_bytes()[1] == b':' {
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
pub fn save_mod_config(
    game_dir: String,
    folder_name: String,
    config: serde_json::Value,
) -> Result<(), String> {
    let mods_dir = Path::new(&game_dir).join("Mods");
    let mod_dir = mods_dir.join(&folder_name);
    if !mod_dir.exists() {
        return Err(format!("Mod folder {} does not exist", folder_name));
    }

    let config_path = mod_dir.join("config.json");
    let mut file =
        File::create(&config_path).map_err(|e| format!("Failed to create config.json: {}", e))?;

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
    fs::create_dir_all(&working_dir).map_err(|e| format!("创建临时目录失败: {}", e))?;
    copy_with_retry(&source_zip, &zip_target)?;
    fs::create_dir_all(&extract_dir).map_err(|e| format!("创建解压目录失败: {}", e))?;

    if let Err(err) = crate::utils::extract_zip(&zip_target, &extract_dir) {
        cleanup();
        return Err(format!("解压失败: {}", err));
    }

    let mut installed_any = false;

    // Collect top-level entries to decide install strategy
    let top_entries: Vec<_> = fs::read_dir(&extract_dir)
        .map_err(|e| format!("读取解压目录失败: {}", e))?
        .filter_map(|e| e.ok())
        .collect();

    // Determine the copy target directory under Mods/.
    // If the zip has a single top-level folder, use it directly (standard mod layout).
    // Otherwise (files at root or multiple folders), create a subfolder from the zip filename.
    let install_target = if top_entries.len() == 1 && top_entries[0].path().is_dir() {
        mods_path.clone()
    } else {
        let folder_name = source_zip
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("UnknownMod");
        let target = mods_path.join(folder_name);
        fs::create_dir_all(&target).map_err(|e| format!("创建模组子目录失败: {}", e))?;
        target
    };

    for entry in &top_entries {
        let source = entry.path();
        let target = install_target.join(entry.file_name());

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
            fs::copy(&source, &target).map_err(|e| format!("复制文件失败: {}", e))?;
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

/// Write the bundled assistant mod files (DLL + manifest) directly into Mods/StardewValleyAssistant/.
fn write_bundled_mod_files(game_dir: &str) -> Result<(), String> {
    let mod_dir = Path::new(game_dir).join("Mods").join("StardewValleyAssistant");
    fs::create_dir_all(&mod_dir).map_err(|e| format!("创建模组目录失败: {}", e))?;

    fs::write(mod_dir.join("manifest.json"), ASSISTANT_MOD_MANIFEST)
        .map_err(|e| format!("写入 manifest.json 失败: {}", e))?;
    fs::write(mod_dir.join("StardewValleyAssistant.dll"), ASSISTANT_MOD_DLL)
        .map_err(|e| format!("写入 StardewValleyAssistant.dll 失败: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn install_bundled_assistant_mod(game_dir: String) -> Result<Value, String> {
    tokio::task::spawn_blocking(move || {
        write_bundled_mod_files(&game_dir)?;
        Ok(serde_json::json!({
            "success": true,
            "message": "mod installed"
        }))
    })
    .await
    .map_err(|err| format!("安装任务执行失败: {}", err))?
}

/// Parse a semver string like "1.0.0" into a comparable tuple.
fn parse_semver(version: &str) -> Option<(u32, u32, u32)> {
    let parts: Vec<&str> = version.trim().split('.').collect();
    if parts.len() >= 3 {
        let major = parts[0].parse().ok()?;
        let minor = parts[1].parse().ok()?;
        let patch = parts[2].parse().ok()?;
        Some((major, minor, patch))
    } else {
        None
    }
}

/// Auto-upgrade the bundled assistant mod if an older version is already installed.
/// Does nothing if the mod is not installed or is already up to date.
#[tauri::command]
pub async fn auto_upgrade_bundled_mod(game_dir: String) -> Result<Value, String> {
    tokio::task::spawn_blocking(move || {
        // Parse bundled version from the embedded manifest
        let bundled_manifest: Manifest =
            serde_json::from_slice(ASSISTANT_MOD_MANIFEST)
                .map_err(|e| format!("解析内置清单失败: {}", e))?;
        let bundled_version = bundled_manifest
            .version
            .unwrap_or_else(|| "0.0.0".to_string());

        // Check if the mod is already installed
        let mods_dir = Path::new(&game_dir).join("Mods");
        let installed_manifest_path =
            mods_dir.join("StardewValleyAssistant").join("manifest.json");

        if !installed_manifest_path.exists() {
            return Ok(serde_json::json!({
                "upgraded": false,
                "reason": "not_installed",
                "bundled_version": bundled_version,
                "message": "Mod is not installed, skipping auto-upgrade"
            }));
        }

        // Read installed version
        let file = File::open(&installed_manifest_path)
            .map_err(|e| format!("读取已安装清单失败: {}", e))?;
        let installed_manifest: Manifest = serde_json::from_reader(BufReader::new(file))
            .map_err(|e| format!("解析已安装清单失败: {}", e))?;
        let installed_version = installed_manifest
            .version
            .unwrap_or_else(|| "0.0.0".to_string());

        // Compare versions
        let bundled_ver = parse_semver(&bundled_version);
        let installed_ver = parse_semver(&installed_version);

        match (bundled_ver, installed_ver) {
            (Some(bundled), Some(installed)) => {
                if installed >= bundled {
                    return Ok(serde_json::json!({
                        "upgraded": false,
                        "reason": "up_to_date",
                        "installed_version": installed_version,
                        "bundled_version": bundled_version,
                        "message": "Mod is already up to date"
                    }));
                }
            }
            _ => {
                return Ok(serde_json::json!({
                    "upgraded": false,
                    "reason": "version_parse_error",
                    "installed_version": installed_version,
                    "bundled_version": bundled_version,
                    "message": "Could not parse version strings"
                }));
            }
        }

        // Perform the upgrade — overwrite the two files directly
        write_bundled_mod_files(&game_dir)?;

        Ok(serde_json::json!({
            "upgraded": true,
            "from_version": installed_version,
            "to_version": bundled_version,
            "message": format!("Mod upgraded from {} to {}", installed_version, bundled_version)
        }))
    })
    .await
    .map_err(|err| format!("自动升级任务执行失败: {}", err))?
}

#[tauri::command]
pub fn write_mod_translation(
    game_dir: String,
    folder_name: String,
    original_name: String,
    original_description: String,
    translated_name: String,
    translated_description: String,
) -> Result<(), String> {
    let mods_dir = Path::new(&game_dir).join("Mods");
    let mod_dir = mods_dir.join(&folder_name);
    if !mod_dir.exists() {
        return Err(format!("Mod folder {} does not exist", folder_name));
    }

    let manifest_path = mod_dir.join("manifest.json");
    if !manifest_path.exists() {
        return Err("manifest.json not found".to_string());
    }

    // 1. Read manifest.json
    let manifest_content = fs::read_to_string(&manifest_path)
        .map_err(|e| format!("Failed to read manifest.json: {}", e))?;
    
    let mut manifest_val: Value = serde_json::from_str(&manifest_content)
        .map_err(|e| format!("Failed to parse manifest.json: {}", e))?;

    let obj = manifest_val.as_object_mut()
        .ok_or_else(|| "manifest.json must be a JSON object".to_string())?;

    // Find Name and Description fields (case-insensitive)
    let name_key = obj.keys().find(|k| k.eq_ignore_ascii_case("name")).map(|k| k.clone()).unwrap_or_else(|| "Name".to_string());
    let desc_key = obj.keys().find(|k| k.eq_ignore_ascii_case("description")).map(|k| k.clone()).unwrap_or_else(|| "Description".to_string());

    let mut raw_orig_name = original_name;
    let mut raw_orig_desc = original_description;

    let mut need_manifest_write = false;

    if let Some(val) = obj.get(&name_key) {
        if let Some(s) = val.as_str() {
            if !s.starts_with("{{") {
                raw_orig_name = s.to_string();
                obj.insert(name_key.clone(), Value::String("{{i18n:ModName}}".to_string()));
                need_manifest_write = true;
            }
        }
    } else {
        obj.insert(name_key.clone(), Value::String("{{i18n:ModName}}".to_string()));
        need_manifest_write = true;
    }

    if let Some(val) = obj.get(&desc_key) {
        if let Some(s) = val.as_str() {
            if !s.starts_with("{{") {
                raw_orig_desc = s.to_string();
                obj.insert(desc_key.clone(), Value::String("{{i18n:ModDescription}}".to_string()));
                need_manifest_write = true;
            }
        }
    } else {
        obj.insert(desc_key.clone(), Value::String("{{i18n:ModDescription}}".to_string()));
        need_manifest_write = true;
    }

    if need_manifest_write {
        let new_manifest_content = serde_json::to_string_pretty(&manifest_val)
            .map_err(|e| format!("Failed to serialize manifest.json: {}", e))?;
        fs::write(&manifest_path, new_manifest_content)
            .map_err(|e| format!("Failed to write manifest.json: {}", e))?;
    }

    // 2. Create i18n directory if needed
    let i18n_dir = mod_dir.join("i18n");
    if !i18n_dir.exists() {
        fs::create_dir_all(&i18n_dir)
            .map_err(|e| format!("Failed to create i18n directory: {}", e))?;
    }

    // 3. Write/Update i18n/default.json
    let default_path = i18n_dir.join("default.json");
    let mut default_val = if default_path.exists() {
        let content = fs::read_to_string(&default_path).unwrap_or_default();
        serde_json::from_str(&content).unwrap_or_else(|_| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };
    if let Some(def_obj) = default_val.as_object_mut() {
        if !def_obj.contains_key("ModName") {
            def_obj.insert("ModName".to_string(), Value::String(raw_orig_name));
        }
        if !def_obj.contains_key("ModDescription") {
            def_obj.insert("ModDescription".to_string(), Value::String(raw_orig_desc));
        }
    }
    let default_content = serde_json::to_string_pretty(&default_val)
        .map_err(|e| format!("Failed to serialize default.json: {}", e))?;
    fs::write(&default_path, default_content)
        .map_err(|e| format!("Failed to write default.json: {}", e))?;

    // 4. Write/Update i18n/zh.json
    let zh_path = i18n_dir.join("zh.json");
    let mut zh_val = if zh_path.exists() {
        let content = fs::read_to_string(&zh_path).unwrap_or_default();
        serde_json::from_str(&content).unwrap_or_else(|_| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };
    if let Some(zh_obj) = zh_val.as_object_mut() {
        zh_obj.insert("ModName".to_string(), Value::String(translated_name));
        zh_obj.insert("ModDescription".to_string(), Value::String(translated_description));
    }
    let zh_content = serde_json::to_string_pretty(&zh_val)
        .map_err(|e| format!("Failed to serialize zh.json: {}", e))?;
    fs::write(&zh_path, zh_content)
        .map_err(|e| format!("Failed to write zh.json: {}", e))?;

    Ok(())
}

