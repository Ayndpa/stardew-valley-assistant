use super::{Mod, ModConfigField};
use serde::Deserialize;
use serde_json::{Map, Value};
use std::fs::{self, File};
use std::io::ErrorKind;
use std::io::Write;
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

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

/// 把 SMAPI 那套“宽松 JSON”（BOM / 注释 / 尾逗号）整理成标准 JSON。
fn clean_json_content(content: &str) -> String {
    let content = content.strip_prefix('\u{feff}').unwrap_or(content);

    // 1. 去掉行注释与块注释（字符串字面量内的内容原样保留）
    let mut stripped = String::with_capacity(content.len());
    let mut chars = content.chars().peekable();
    let mut in_string = false;
    let mut escaped = false;
    while let Some(c) = chars.next() {
        if in_string {
            let was_escaped = escaped;
            escaped = !was_escaped && c == '\\';
            if !was_escaped && c == '"' {
                in_string = false;
            }
            stripped.push(c);
        } else if c == '/' && chars.peek() == Some(&'/') {
            chars.next();
            while chars.peek().is_some_and(|&n| n != '\n') {
                chars.next();
            }
        } else if c == '/' && chars.peek() == Some(&'*') {
            chars.next();
            while let Some(n) = chars.next() {
                if n == '*' && chars.peek() == Some(&'/') {
                    chars.next();
                    break;
                }
            }
        } else {
            in_string |= c == '"';
            stripped.push(c);
        }
    }

    // 2. 去掉对象 / 数组末尾的多余逗号
    let mut cleaned = String::with_capacity(stripped.len());
    let mut rest = stripped.as_str();
    while let Some(pos) = rest.find(',') {
        let after = rest[pos + 1..].trim_start();
        if after.starts_with('}') || after.starts_with(']') {
            cleaned.push_str(&rest[..pos]);
            rest = after;
        } else {
            cleaned.push_str(&rest[..=pos]);
            rest = &rest[pos + 1..];
        }
    }
    cleaned.push_str(rest);
    cleaned
}

/// 解析并读取宽松 JSON 文件。
fn read_loose_json(path: &Path) -> Option<Value> {
    let content = fs::read_to_string(path).ok()?;
    serde_json::from_str(&clean_json_content(&content)).ok()
}

/// 读取宽松 JSON 文件，解析失败或文件不存在时回退到空对象。
fn read_loose_json_object(path: &Path) -> Value {
    read_loose_json(path).unwrap_or_else(|| serde_json::json!({}))
}

/// 用于错误提示的文件名，例如 "zh.json"。
fn file_label(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default()
}

fn write_json_pretty(path: &Path, value: &Value) -> Result<(), String> {
    let content = serde_json::to_string_pretty(value)
        .map_err(|e| format!("Failed to serialize {}: {}", file_label(path), e))?;
    fs::write(path, content).map_err(|e| format!("Failed to write {}: {}", file_label(path), e))
}

/// Recursively scan a directory for mods (folders containing manifest.json).
/// `relative_path` is the path relative to the Mods/ root (e.g. "美化类/xxx美化Mod").
fn scan_mods_recursive(dir: &Path, mods_root: &Path, results: &mut Vec<Mod>) -> Result<(), String> {
    // If the directory itself has a manifest.json, parse it as a mod and stop recursing!
    if dir != mods_root && dir.join("manifest.json").exists() {
        match parse_mod_folder(dir, mods_root) {
            Ok(mod_entry) => {
                if !results.iter().any(|m| m.folder_name == mod_entry.folder_name) {
                    results.push(mod_entry);
                }
            }
            Err(e) => println!("Skipping mod folder {:?}: {}", dir, e),
        }
        return Ok(());
    }

    // Otherwise, loop through subdirectories.
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) => {
            // Log directory read errors instead of crashing the entire mod scan
            println!("Failed to read folder {:?}: {}", dir, e);
            return Ok(());
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            scan_mods_recursive(&path, mods_root, results)?;
        }
    }

    Ok(())
}

fn find_key_in_json_file(path: &Path, key: &str) -> Option<String> {
    let key_lower = key.to_lowercase();
    read_loose_json(path)?
        .as_object()?
        .iter()
        .find(|(k, _)| k.to_lowercase() == key_lower)
        .and_then(|(_, v)| v.as_str())
        .map(str::to_string)
}

/// 从 `{{i18n:Key}}` 占位符中取出 Key。
///
/// 冒号同时接受全角 `：`：占位符被误当成正文送进翻译引擎时，引擎会把半角冒号
/// 转成全角，这类被写坏的值也要能识别出来，否则永远修不掉。
fn parse_i18n_key(value: &str) -> Option<String> {
    let inner = value.trim().strip_prefix("{{")?.strip_suffix("}}")?.trim();
    let split_at = inner.char_indices().nth(4).map(|(i, _)| i)?;
    let (head, rest) = inner.split_at(split_at);
    if !head.eq_ignore_ascii_case("i18n") {
        return None;
    }
    let rest = rest.trim_start();
    let key = rest.strip_prefix(':').or_else(|| rest.strip_prefix('：'))?;
    Some(key.trim().to_string())
}

/// 词条内容本身也可能是被写坏的占位符，这种值不能当正文用。
fn clean_text(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || parse_i18n_key(trimmed).is_some() {
        return None;
    }
    Some(trimmed.to_string())
}

/// 从候选值里挑出第一个可用的正文，跳过空串与 i18n 占位符。
fn first_clean_text(candidates: &[&str]) -> Option<String> {
    candidates.iter().find_map(|c| clean_text(c))
}

fn resolve_i18n_string(value: &str, mod_dir: &Path) -> String {
    let Some(key) = parse_i18n_key(value) else {
        return value.to_string();
    };
    let i18n_dir = mod_dir.join("i18n");
    // zh.json 优先，缺失时回退 default.json
    find_key_in_json_file(&i18n_dir.join("zh.json"), &key)
        .and_then(|text| clean_text(&text))
        .or_else(|| {
            find_key_in_json_file(&i18n_dir.join("default.json"), &key)
                .and_then(|text| clean_text(&text))
        })
        .unwrap_or_else(|| value.to_string())
}

/// Parse a single mod folder into a Mod struct.
/// `mod_dir` must contain a manifest.json.
fn parse_mod_folder(mod_dir: &Path, mods_root: &Path) -> Result<Mod, String> {
    let folder_name = mod_dir
        .strip_prefix(mods_root)
        .unwrap_or(mod_dir)
        .to_string_lossy()
        .replace('\\', "/");

    // is_enabled: check if ANY segment of the path starts with '.'
    let is_enabled = !folder_name.split('/').any(|seg| seg.starts_with('.'));

    let manifest_path = mod_dir.join("manifest.json");
    let manifest_content = fs::read_to_string(&manifest_path)
        .map_err(|e| format!("Failed to read manifest.json: {}", e))?;
    let manifest: Manifest = serde_json::from_str(&clean_json_content(&manifest_content))
        .map_err(|e| format!("Failed to parse manifest.json: {}", e))?;

    let display_folder_name = mod_dir
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| folder_name.clone());

    let id = manifest
        .unique_id
        .unwrap_or_else(|| display_folder_name.clone());
    let raw_name = manifest.name.unwrap_or_else(|| display_folder_name.clone());
    let name = resolve_i18n_string(&raw_name, mod_dir);
    let english_name = display_folder_name.trim_start_matches('.').to_string();
    let version = manifest.version.unwrap_or_else(|| "1.0.0".to_string());
    let author = manifest.author.unwrap_or_else(|| "Unknown".to_string());
    let raw_description = manifest
        .description
        .unwrap_or_else(|| "No description provided.".to_string());
    let description = resolve_i18n_string(&raw_description, mod_dir);
    // 占位符可能出现在 manifest 里，也可能藏在被翻译坏的 i18n 词条里
    let manifest_needs_repair = [&raw_name, &raw_description, &name, &description]
        .iter()
        .any(|text| parse_i18n_key(text).is_some());

    // 有多个 Nexus 更新键时取最后一个，与旧行为一致
    let nexus_id = manifest
        .update_keys
        .unwrap_or_default()
        .iter()
        .filter(|key| key.to_lowercase().starts_with("nexus:"))
        .filter_map(|key| key.split(':').nth(1)?.trim().parse::<u64>().ok())
        .last();

    let dependencies: Vec<String> = manifest
        .dependencies
        .unwrap_or_default()
        .into_iter()
        .filter_map(|dep| dep.unique_id)
        .collect();

    let config_fields = read_loose_json(&mod_dir.join("config.json"))
        .and_then(|value| {
            value.as_object().map(|obj| {
                obj.iter()
                    .map(|(k, v)| ModConfigField {
                        key: k.clone(),
                        label: k.clone(),
                        r#type: match v {
                            Value::Bool(_) => "boolean",
                            Value::Number(_) => "number",
                            _ => "string",
                        }
                        .to_string(),
                        value: v.clone(),
                        description: String::new(),
                    })
                    .collect()
            })
        })
        .unwrap_or_default();

    let id_lower = id.to_lowercase();
    let has_content_patcher_dep = dependencies
        .iter()
        .any(|d| d.to_lowercase().contains("contentpatcher"));
    let category = if id_lower == "pathoschild.contentpatcher" {
        "core"
    } else if id_lower.contains("contentpatcher") || has_content_patcher_dep {
        "content"
    } else if id_lower.contains("expansion")
        || id_lower.contains("sve")
        || folder_name.to_lowercase().contains("expansion")
    {
        "expansion"
    } else {
        "utility"
    }
    .to_string();

    // parent_path: the directory containing the mod, relative to Mods/
    // e.g. for "美化类/xxx美化Mod" -> "美化类"
    // for top-level mods -> ""
    let parent_path = mod_dir
        .parent()
        .and_then(|p| p.strip_prefix(mods_root).ok())
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default();

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
        local_path: format!("Mods/{}", folder_name),
        folder_name,
        parent_path,
        dependencies,
        config: config_fields,
        manifest_needs_repair,
    })
}

/// 拒绝空名、当前目录、路径穿越与绝对路径，避免操作 Mods/ 之外的内容。
fn validate_mod_folder_name(folder_name: &str) -> Result<(), String> {
    if folder_name.trim().is_empty() {
        return Err("模组文件夹名不能为空".to_string());
    }
    if folder_name == "."
        || folder_name.contains("..")
        || folder_name.starts_with('/')
        || folder_name.starts_with('\\')
        || folder_name.as_bytes().get(1) == Some(&b':')
    {
        return Err("非法的模组文件夹名".to_string());
    }
    Ok(())
}

/// 定位 Mods 目录，并校验模组文件夹名。
fn resolve_mod_dir(game_dir: &str, folder_name: &str) -> Result<std::path::PathBuf, String> {
    let mod_dir = Path::new(game_dir).join("Mods").join(folder_name);
    if !mod_dir.exists() {
        return Err(format!("Mod folder {} does not exist", folder_name));
    }
    Ok(mod_dir)
}

#[tauri::command(async)]
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
    validate_mod_folder_name(&folder_name)?;

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
        last_name.trim_start_matches('.').to_string()
    } else if last_name.starts_with('.') {
        last_name.clone()
    } else {
        format!(".{}", last_name)
    };

    let new_folder_name = match parent {
        Some(p) => format!("{}/{}", p.to_string_lossy(), new_last_name),
        None => new_last_name,
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

    // 允许嵌套路径（例如 "美化类/xxxMod"），但拒绝穿越与绝对路径
    validate_mod_folder_name(&folder_name)?;

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
    let mod_dir = resolve_mod_dir(&game_dir, &folder_name)?;
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
    for attempt in 1..=3 {
        match fs::copy(source, target) {
            Ok(size) => return Ok(size),
            Err(err) => {
                if err.kind() != ErrorKind::PermissionDenied || attempt >= 3 {
                    return Err(format!("复制压缩包失败: {}", err));
                }
                std::thread::sleep(Duration::from_millis(250 * attempt as u64));
            }
        }
    }

    Err("复制压缩包失败: 未知错误".to_string())
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

    let is_zip = source_zip
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("zip"));
    if !is_zip {
        return Err("请拖入 .zip 文件".to_string());
    }

    let mods_path = game_path.join("Mods");
    fs::create_dir_all(&mods_path).map_err(|e| format!("创建 Mods 目录失败: {}", e))?;

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let working_dir = std::env::temp_dir().join(format!("sv_mod_install_{}", timestamp));
    let zip_target = working_dir.join("mod.zip");
    let extract_dir = working_dir.join("extract");

    let cleanup = || {
        let _ = fs::remove_dir_all(&working_dir);
    };

    cleanup();
    fs::create_dir_all(&working_dir).map_err(|e| format!("创建临时目录失败: {}", e))?;
    copy_with_retry(source_zip, &zip_target)?;
    fs::create_dir_all(&extract_dir).map_err(|e| format!("创建解压目录失败: {}", e))?;

    if let Err(err) = crate::utils::extract_zip(&zip_target, &extract_dir) {
        cleanup();
        return Err(format!("解压失败: {}", err));
    }

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

    let mut installed_any = false;
    for entry in &top_entries {
        let source = entry.path();
        let target = install_target.join(entry.file_name());

        if target.is_dir() {
            fs::remove_dir_all(&target).map_err(|e| format!("清理旧目录失败: {}", e))?;
        } else if target.exists() {
            fs::remove_file(&target).map_err(|e| format!("清理旧文件失败: {}", e))?;
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

    cleanup();
    if !installed_any {
        return Err("安装内容为空，未写入任何文件".to_string());
    }

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

/// 读取 manifest.json 并返回可修改的 JSON 对象。
fn read_manifest_object(mod_dir: &Path) -> Result<(std::path::PathBuf, Value), String> {
    let manifest_path = mod_dir.join("manifest.json");
    if !manifest_path.exists() {
        return Err("manifest.json not found".to_string());
    }
    let manifest_content = fs::read_to_string(&manifest_path)
        .map_err(|e| format!("Failed to read manifest.json: {}", e))?;
    let manifest_val: Value = serde_json::from_str(&clean_json_content(&manifest_content))
        .map_err(|e| format!("Failed to parse manifest.json: {}", e))?;
    if !manifest_val.is_object() {
        return Err("manifest.json must be a JSON object".to_string());
    }
    Ok((manifest_path, manifest_val))
}

/// 大小写不敏感地找出已有键名，找不到时用 `fallback`。
fn actual_key(obj: &Map<String, Value>, wanted: &str, fallback: &str) -> String {
    obj.keys()
        .find(|k| k.eq_ignore_ascii_case(wanted))
        .cloned()
        .unwrap_or_else(|| fallback.to_string())
}

/// 取出 manifest 字段当前对应的原文。
///
/// 旧版本会把字段写成 `{{i18n:...}}`，但 SMAPI 并不解析 manifest 里的 i18n 占位符，
/// 这种模组的原文只能从 i18n 词条里找回来；字段缺失时用调用方给的兜底值。
fn original_manifest_text(
    obj: &Map<String, Value>,
    key: &str,
    mod_dir: &Path,
    fallback: String,
) -> String {
    let Some(raw) = obj.get(key).and_then(|val| val.as_str()) else {
        return fallback;
    };
    match parse_i18n_key(raw).filter(|k| !k.is_empty()) {
        Some(i18n_key) => {
            let i18n_dir = mod_dir.join("i18n");
            // default.json 存的才是原文，zh.json 只是兜底
            find_key_in_json_file(&i18n_dir.join("default.json"), &i18n_key)
                .and_then(|text| clean_text(&text))
                .or_else(|| {
                    find_key_in_json_file(&i18n_dir.join("zh.json"), &i18n_key)
                        .and_then(|text| clean_text(&text))
                })
                .unwrap_or(fallback)
        }
        None => clean_text(raw).unwrap_or(fallback),
    }
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
    let mod_dir = resolve_mod_dir(&game_dir, &folder_name)?;
    let (manifest_path, mut manifest_val) = read_manifest_object(&mod_dir)?;

    let obj = manifest_val
        .as_object_mut()
        .ok_or_else(|| "manifest.json must be a JSON object".to_string())?;
    // 字段名大小写不敏感
    let name_key = actual_key(obj, "name", "Name");
    let desc_key = actual_key(obj, "description", "Description");

    // 兜底名：占位符已经把原名冲掉时，文件夹名是唯一还可信的信息
    let folder_label = mod_dir
        .file_name()
        .map(|n| n.to_string_lossy().trim_start_matches('.').to_string())
        .unwrap_or_else(|| folder_name.clone());

    // 1. 先取回原文，稍后备份进 i18n/default.json 供还原
    let raw_orig_name = original_manifest_text(obj, &name_key, &mod_dir, original_name);
    let raw_orig_desc = original_manifest_text(obj, &desc_key, &mod_dir, original_description);

    // 2. 译文必须以字面量写进 manifest：SMAPI 从不解析 manifest 里的 {{i18n:...}}，
    //    写占位符会让游戏内、SMAPI 日志和 GMCM 直接显示 "{{i18n:ModName}}"。
    //    译文本身也可能是"被翻译过的占位符"（引擎会把冒号转成全角），一律拒收。
    let final_name = first_clean_text(&[&translated_name, &raw_orig_name, &folder_label])
        .unwrap_or_else(|| folder_label.clone());
    let final_desc =
        first_clean_text(&[&translated_description, &raw_orig_desc]).unwrap_or_default();
    obj.insert(name_key, Value::String(final_name));
    obj.insert(desc_key, Value::String(final_desc));
    write_json_pretty(&manifest_path, &manifest_val)?;

    // 3. 原文写入 i18n/default.json，只在缺键时写，避免覆盖模组自带的词条
    let i18n_dir = mod_dir.join("i18n");
    fs::create_dir_all(&i18n_dir).map_err(|e| format!("Failed to create i18n directory: {}", e))?;

    let backup_name =
        first_clean_text(&[&raw_orig_name, &folder_label]).unwrap_or_else(|| folder_label.clone());
    let backup_desc = first_clean_text(&[&raw_orig_desc]).unwrap_or_default();

    let default_path = i18n_dir.join("default.json");
    let mut default_val = read_loose_json_object(&default_path);
    if let Some(def_obj) = default_val.as_object_mut() {
        def_obj
            .entry("ModName".to_string())
            .or_insert_with(|| Value::String(backup_name));
        def_obj
            .entry("ModDescription".to_string())
            .or_insert_with(|| Value::String(backup_desc));
    }
    write_json_pretty(&default_path, &default_val)
}

#[tauri::command]
pub fn rename_local_mod(
    game_dir: String,
    folder_name: String,
    new_name: String,
) -> Result<(), String> {
    let mod_dir = resolve_mod_dir(&game_dir, &folder_name)?;
    let (manifest_path, mut manifest_val) = read_manifest_object(&mod_dir)?;

    let obj = manifest_val
        .as_object_mut()
        .ok_or_else(|| "manifest.json must be a JSON object".to_string())?;
    let name_key = actual_key(obj, "name", "Name");

    // 直接写字面量：SMAPI 不解析 manifest 里的 {{i18n:...}}，改词条不会影响游戏内显示
    obj.insert(name_key, Value::String(new_name));
    write_json_pretty(&manifest_path, &manifest_val)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_clean_json_content() {
        // Test BOM removal
        let with_bom = "\u{feff}{\"a\": 1}";
        assert_eq!(clean_json_content(with_bom), "{\"a\": 1}");

        // Test single line comments
        let with_single_comments = r#"{
            // this is a comment
            "a": 1, // another comment
            "b": "http://example.com"
        }"#;
        let cleaned = clean_json_content(with_single_comments);
        let parsed: serde_json::Value = serde_json::from_str(&cleaned).unwrap();
        assert_eq!(parsed["a"], 1);
        assert_eq!(parsed["b"], "http://example.com");

        // Test block comments
        let with_block_comments = r#"{
            /* block comment
               spanning lines */
            "a": /* inline block comment */ 2
        }"#;
        let cleaned = clean_json_content(with_block_comments);
        let parsed: serde_json::Value = serde_json::from_str(&cleaned).unwrap();
        assert_eq!(parsed["a"], 2);

        // Test trailing commas in objects
        let with_trailing_comma_obj = r#"{
            "a": 1,
            "b": 2,
        }"#;
        let cleaned = clean_json_content(with_trailing_comma_obj);
        let parsed: serde_json::Value = serde_json::from_str(&cleaned).unwrap();
        assert_eq!(parsed["a"], 1);
        assert_eq!(parsed["b"], 2);

        // Test trailing commas in arrays
        let with_trailing_comma_arr = r#"[
            1,
            2,
        ]"#;
        let cleaned = clean_json_content(with_trailing_comma_arr);
        let parsed: serde_json::Value = serde_json::from_str(&cleaned).unwrap();
        assert_eq!(parsed.as_array().unwrap().len(), 2);

        // Test commas and comments inside strings are preserved
        let inside_string = r#"{
            "a": "this has a // comment and a , trailing comma inside string",
            "b": "another /* comment */ inside string"
        }"#;
        let cleaned = clean_json_content(inside_string);
        let parsed: serde_json::Value = serde_json::from_str(&cleaned).unwrap();
        assert_eq!(
            parsed["a"],
            "this has a // comment and a , trailing comma inside string"
        );
        assert_eq!(parsed["b"], "another /* comment */ inside string");
    }

    #[test]
    fn test_parse_i18n_key() {
        assert_eq!(parse_i18n_key("{{i18n:ModName}}").as_deref(), Some("ModName"));
        assert_eq!(parse_i18n_key("  {{ I18N: Mod Name }} ").as_deref(), Some("Mod Name"));
        assert_eq!(parse_i18n_key("{{Other:Key}}"), None);
        assert_eq!(parse_i18n_key("普通名称"), None);
        // 被翻译引擎转成全角冒号的坏值
        assert_eq!(
            parse_i18n_key("{{i18n：ModName}}").as_deref(),
            Some("ModName")
        );
        assert_eq!(parse_i18n_key("{{i18n}}"), None);
        assert_eq!(parse_i18n_key("{{}}"), None);
    }

    #[test]
    fn test_first_clean_text() {
        assert_eq!(
            first_clean_text(&["{{i18n:ModName}}", "  ", "Cool Mod"]).as_deref(),
            Some("Cool Mod")
        );
        assert_eq!(
            first_clean_text(&["{{i18n：ModName}}", "备用名"]).as_deref(),
            Some("备用名")
        );
        assert_eq!(first_clean_text(&["{{i18n:X}}", ""]), None);
    }

    #[test]
    fn test_original_manifest_text() {
        // 词条文件不存在，占位符只能回退到调用方给的兜底值
        let mod_dir = Path::new("__not_a_real_mod_dir__");
        let mut obj = Map::new();

        obj.insert("Name".to_string(), Value::String("Cool Mod".to_string()));
        let got = original_manifest_text(&obj, "Name", mod_dir, "fallback".to_string());
        assert_eq!(got, "Cool Mod");

        obj.insert(
            "Name".to_string(),
            Value::String("{{i18n:ModName}}".to_string()),
        );
        let got = original_manifest_text(&obj, "Name", mod_dir, "fallback".to_string());
        assert_eq!(got, "fallback");

        // 字段缺失
        let got = original_manifest_text(&obj, "Description", mod_dir, "fallback".to_string());
        assert_eq!(got, "fallback");
    }

    #[test]
    fn test_validate_mod_folder_name() {
        assert!(validate_mod_folder_name("美化类/xxxMod").is_ok());
        assert!(validate_mod_folder_name("  ").is_err());
        assert!(validate_mod_folder_name(".").is_err());
        assert!(validate_mod_folder_name("../escape").is_err());
        assert!(validate_mod_folder_name("/abs").is_err());
        assert!(validate_mod_folder_name("C:\\Windows").is_err());
    }
}
