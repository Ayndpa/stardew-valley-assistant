//! SMAPI 模组管理。
//!
//! 扫描、启用/禁用、删除、改配置这些语义全部来自共享 crate `sdv_mods`，
//! 与桌面端是同一份实现——模组的目录约定（用前导点号表示禁用）、宽松 JSON 解析、
//! `{{i18n:Key}}` 占位符处理都必须两端一致，否则同一份模组在两端会显示成不同的样子。
//!
//! 只有"从压缩包安装"是手机端自己实现的：来源可能是 `content://` URI，
//! 而且模组要落到应用私有目录而不是游戏安装目录。

use crate::paths;
use crate::utils::{copy_dir_all, extract_zip_entries};
use sdv_mods::model::Mod;
use serde_json::Value;
use std::fs;
use tauri::AppHandle;

/// `sdv_mods` 按「游戏目录 / Mods」的约定工作，手机端把应用私有目录当作游戏目录，
/// 模组因此落在 `<app_data>/Mods`，与 [`paths::mods_dir`] 一致。
fn mods_root(app: &AppHandle) -> Result<String, String> {
    // 提前建好 Mods 目录，免得首次进入模组页时列表报"目录不存在"。
    paths::mods_dir(app)?;
    Ok(paths::app_root(app)?.to_string_lossy().to_string())
}

#[tauri::command(async)]
pub fn list_installed_mods(app: AppHandle) -> Result<Vec<Mod>, String> {
    sdv_mods::local::list_installed_mods(&mods_root(&app)?)
}

#[tauri::command(async)]
pub fn toggle_mod(app: AppHandle, folder_name: String, enable: bool) -> Result<String, String> {
    sdv_mods::local::toggle_mod(&mods_root(&app)?, &folder_name, enable)
}

#[tauri::command(async)]
pub fn delete_mod(app: AppHandle, folder_name: String) -> Result<(), String> {
    sdv_mods::local::delete_mod(&mods_root(&app)?, &folder_name)
}

#[tauri::command(async)]
pub fn save_mod_config(
    app: AppHandle,
    folder_name: String,
    config: Value,
) -> Result<(), String> {
    sdv_mods::local::save_mod_config(&mods_root(&app)?, &folder_name, &config)
}

#[tauri::command(async)]
pub fn rename_local_mod(
    app: AppHandle,
    folder_name: String,
    new_name: String,
) -> Result<(), String> {
    sdv_mods::local::rename_local_mod(&mods_root(&app)?, &folder_name, new_name)
}

/// 从压缩包安装模组。
///
/// `path` 可以是文件路径，也可以是系统文件选择器返回的 `content://` URI。
#[tauri::command(async)]
pub fn install_mod_from_zip(app: AppHandle, path: String) -> Result<Vec<Mod>, String> {
    let mods_dir = paths::mods_dir(&app)?;
    let staging = paths::new_work_dir(&app, "mod")?;
    let cleanup = || {
        let _ = fs::remove_dir_all(&staging);
    };

    let opened = crate::apk::open_source(&path)?;
    let archive_name = opened.file_name.clone();
    let mut zip = match zip::ZipArchive::new(opened.reader) {
        Ok(zip) => zip,
        Err(e) => {
            cleanup();
            return Err(format!("这不是有效的压缩包: {}", e));
        }
    };

    if let Err(e) = extract_zip_entries(&mut zip, &staging, |_| true, |_, _| {}) {
        cleanup();
        return Err(e);
    }

    let entries: Vec<_> = match fs::read_dir(&staging) {
        Ok(entries) => entries.filter_map(|e| e.ok()).collect(),
        Err(e) => {
            cleanup();
            return Err(format!("读取解压结果失败: {}", e));
        }
    };
    if entries.is_empty() {
        cleanup();
        return Err("压缩包是空的，没有可安装的内容。".to_string());
    }

    // 规范的模组压缩包顶层就是一个模组文件夹，直接搬进 Mods/ 即可。
    // 如果顶层散着文件或有多个文件夹，就用压缩包名新建一层，避免把散件糊到
    // Mods/ 根目录下——那样 SMAPI 会认不出来，玩家也没法单独禁用它。
    let single_folder = entries.len() == 1 && entries[0].path().is_dir();
    let target_root = if single_folder {
        mods_dir.clone()
    } else {
        let stem = archive_name
            .rsplit_once('.')
            .map(|(stem, _)| stem)
            .unwrap_or(&archive_name);
        let dir = mods_dir.join(if stem.is_empty() { "UnknownMod" } else { stem });
        if let Err(e) = fs::create_dir_all(&dir) {
            cleanup();
            return Err(format!("创建模组目录失败: {}", e));
        }
        dir
    };

    for entry in &entries {
        let source = entry.path();
        let target = target_root.join(entry.file_name());

        // 覆盖安装：先清掉同名的旧内容，否则旧版本残留的文件会和新版本混在一起。
        let removed = if target.is_dir() {
            fs::remove_dir_all(&target)
        } else if target.exists() {
            fs::remove_file(&target)
        } else {
            Ok(())
        };
        if let Err(e) = removed {
            cleanup();
            return Err(format!("清理同名模组失败: {}", e));
        }

        let copied = if source.is_dir() {
            copy_dir_all(&source, &target)
        } else {
            fs::copy(&source, &target).map(|_| ())
        };
        if let Err(e) = copied {
            cleanup();
            return Err(format!("写入模组失败: {}", e));
        }
    }

    cleanup();
    sdv_mods::local::list_installed_mods(&mods_root(&app)?)
}
