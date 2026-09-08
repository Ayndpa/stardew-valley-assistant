//! SMAPI 载荷的导入与校验。
//!
//! 手机端要加载模组，必须把 SMAPI 的 Android 构建合进游戏安装包里。SMAPI 的
//! Android 版是第三方发布的产物，助手不能凭空造出来，只能由玩家提供一份压缩包。
//! 这个模块负责把它解到应用私有目录并确认内容像回事，供打包环节取用。

use crate::paths;
use crate::utils::{dir_stats, extract_zip_entries};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use tauri::AppHandle;

/// SMAPI 的主程序集。找不到它就说明玩家选错了压缩包。
const SMAPI_ASSEMBLY: &str = "StardewModdingAPI.dll";

/// 导入记录，落盘为 `smapi-meta.json`。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmapiPayload {
    /// 从压缩包里读到的版本号，读不到时为空。
    pub version: Option<String>,
    pub installed_at: i64,
    pub file_count: u64,
    pub bytes: u64,
    pub source_file_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmapiStatus {
    pub installed: bool,
    pub payload: Option<SmapiPayload>,
    pub path: Option<String>,
}

/// 在解出来的目录里找 SMAPI 主程序集。
///
/// 不同来源的压缩包层级不一样（有的根目录就是文件，有的套了一层文件夹），
/// 所以按内容找而不是按固定路径找。
fn find_assembly(root: &Path) -> Option<std::path::PathBuf> {
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path
                .file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.eq_ignore_ascii_case(SMAPI_ASSEMBLY))
            {
                return Some(path);
            }
        }
    }
    None
}

/// 读取 SMAPI 版本号。
///
/// 压缩包里通常带一个 `StardewModdingAPI.deps.json`，里面有 `SMAPI/x.y.z` 字样。
/// 读不到不算失败——版本号只用于界面展示。
fn read_version(root: &Path) -> Option<String> {
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            let is_deps = path
                .file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.eq_ignore_ascii_case("StardewModdingAPI.deps.json"));
            if !is_deps {
                continue;
            }
            let content = fs::read_to_string(&path).ok()?;
            let idx = content.find("SMAPI/")?;
            let rest = &content[idx + 6..];
            let end = rest
                .find(|c: char| !c.is_ascii_digit() && c != '.')
                .unwrap_or(rest.len());
            let version = &rest[..end];
            if !version.is_empty() {
                return Some(version.to_string());
            }
        }
    }
    None
}

/// 导入一份 SMAPI 压缩包。
pub fn import_payload(app: &AppHandle, source: &str) -> Result<SmapiPayload, String> {
    let staging = paths::new_work_dir(app, "smapi")?;
    let cleanup = || {
        let _ = fs::remove_dir_all(&staging);
    };

    // 压缩包只有几 MB，走普通文件读取即可；内容 URI 同样支持。
    let opened = crate::apk::open_source(source)?;
    let source_file_name = opened.file_name.clone();
    let mut zip = zip::ZipArchive::new(opened.reader)
        .map_err(|e| format!("SMAPI 压缩包格式不正确: {}", e))?;

    if let Err(e) = extract_zip_entries(&mut zip, &staging, |_| true, |_, _| {}) {
        cleanup();
        return Err(e);
    }

    if find_assembly(&staging).is_none() {
        cleanup();
        return Err(format!(
            "这个压缩包里没有 {}，不是可用的 SMAPI 安卓版载荷。",
            SMAPI_ASSEMBLY
        ));
    }

    let version = read_version(&staging);

    // 用新载荷整体替换旧的。
    let target = paths::smapi_dir(app)?;
    if target.exists() {
        fs::remove_dir_all(&target).map_err(|e| format!("清理旧 SMAPI 载荷失败: {}", e))?;
    }
    if let Err(rename_err) = fs::rename(&staging, &target) {
        // 跨挂载点改名会失败，退回逐文件复制。
        crate::utils::copy_dir_all(&staging, &target).map_err(|copy_err| {
            format!(
                "写入 SMAPI 载荷失败（改名: {}；复制: {}）",
                rename_err, copy_err
            )
        })?;
        cleanup();
    }

    let (file_count, bytes) = dir_stats(&target);
    let payload = SmapiPayload {
        version,
        installed_at: chrono::Utc::now().timestamp_millis(),
        file_count,
        bytes,
        source_file_name,
    };

    let json =
        serde_json::to_string_pretty(&payload).map_err(|e| format!("序列化载荷记录失败: {}", e))?;
    fs::write(meta_path(app)?, json).map_err(|e| format!("写入载荷记录失败: {}", e))?;

    Ok(payload)
}

/// 载荷记录的位置。
///
/// 刻意放在载荷目录**外面**：打包时整个载荷目录会被原样注入安装包，
/// 混在里面的记账文件会跟着进去。
fn meta_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(paths::app_root(app)?.join("smapi-meta.json"))
}

/// 读取载荷记录。
pub fn read_payload(app: &AppHandle) -> Option<SmapiPayload> {
    let content = fs::read_to_string(meta_path(app).ok()?).ok()?;
    serde_json::from_str(&content).ok()
}

/// SMAPI 载荷是否可用。
pub fn is_ready(app: &AppHandle) -> bool {
    paths::smapi_dir(app)
        .ok()
        .is_some_and(|dir| find_assembly(&dir).is_some())
}

// ---------------------------------------------------------------------------
// Tauri 命令
// ---------------------------------------------------------------------------

#[tauri::command(async)]
pub fn get_smapi_status(app: AppHandle) -> Result<SmapiStatus, String> {
    let dir = paths::smapi_dir(&app)?;
    let installed = find_assembly(&dir).is_some();
    Ok(SmapiStatus {
        installed,
        payload: read_payload(&app),
        path: installed.then(|| dir.to_string_lossy().to_string()),
    })
}

#[tauri::command(async)]
pub fn import_smapi_package(app: AppHandle, path: String) -> Result<SmapiPayload, String> {
    import_payload(&app, &path)
}

#[tauri::command(async)]
pub fn remove_smapi_package(app: AppHandle) -> Result<(), String> {
    let dir = paths::smapi_dir(&app)?;
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| format!("删除 SMAPI 载荷失败: {}", e))?;
    }
    let _ = fs::remove_file(meta_path(&app)?);
    Ok(())
}
