//! 本地模组管理的 Tauri 命令层。
//!
//! manifest 解析、i18n 占位符还原、模组扫描与启用/禁用规则都在 `sdv_mods::local`；
//! 只有 zip 安装留在桌面端——它依赖 `crate::utils` 的解压与目录复制（zip crate），
//! 手机端安装模组的落地方式不同，不适合共用。

use serde_json::Value;
use std::fs;
use std::io::ErrorKind;
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub use sdv_mods::local::{
    clean_json_content, clean_text, first_clean_text, parse_i18n_key, parse_mod_folder,
    read_loose_json, read_loose_json_object, resolve_mod_dir, validate_mod_folder_name,
    write_json_pretty,
};

use crate::game::resolve_game_dir_str;
use crate::mods::Mod;

// 前端传来的 game_dir 一律先过 `resolve_game_dir_str`：macOS 上用户选中的
// 往往是 .app 包的外层目录，而 Mods 目录在 Contents/MacOS 里面。
// 其它平台该函数是恒等变换。

#[tauri::command(async)]
pub fn list_installed_mods(game_dir: String) -> Result<Vec<Mod>, String> {
    sdv_mods::local::list_installed_mods(&resolve_game_dir_str(&game_dir))
}

#[tauri::command]
pub fn toggle_mod(game_dir: String, folder_name: String, enable: bool) -> Result<String, String> {
    sdv_mods::local::toggle_mod(&resolve_game_dir_str(&game_dir), &folder_name, enable)
}

#[tauri::command]
pub fn delete_mod(game_dir: String, folder_name: String) -> Result<(), String> {
    sdv_mods::local::delete_mod(&resolve_game_dir_str(&game_dir), &folder_name)
}

#[tauri::command]
pub fn save_mod_config(
    game_dir: String,
    folder_name: String,
    config: serde_json::Value,
) -> Result<(), String> {
    sdv_mods::local::save_mod_config(&resolve_game_dir_str(&game_dir), &folder_name, &config)
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
    sdv_mods::local::write_mod_translation(
        &resolve_game_dir_str(&game_dir),
        &folder_name,
        original_name,
        original_description,
        &translated_name,
        &translated_description,
    )
}

#[tauri::command]
pub fn rename_local_mod(
    game_dir: String,
    folder_name: String,
    new_name: String,
) -> Result<(), String> {
    sdv_mods::local::rename_local_mod(&resolve_game_dir_str(&game_dir), &folder_name, new_name)
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
    if !Path::new(&game_dir).exists() {
        return Err("游戏安装目录不存在".to_string());
    }
    let game_path = crate::game::resolve_game_dir(&game_dir);

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
