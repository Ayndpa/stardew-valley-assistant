//! 游戏安装包的识别与导入。
//!
//! 移动端拿不到"游戏安装目录"，玩家手里只有一个安装包文件。这个模块负责：
//!
//! 1. **识别** —— 读安装包里的二进制清单和条目表，确认这确实是星露谷物语，
//!    并把版本号、架构、资源体积报给界面，让玩家在真正开始导入前就能确认。
//! 2. **导入** —— 把 `assets/Content/` 下的游戏资源解到应用私有目录，
//!    之后所有数据查询都直接读这里，不再依赖原安装包。
//!
//! 导入是耗时操作（资源接近三千个文件），所以全程通过事件汇报进度，并支持取消。

pub mod axml;
pub mod axml_write;
pub mod repack;
pub mod sign;

use crate::paths;
use crate::utils::{dir_stats, safe_join};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::fs::{self, File};
use std::io::{BufReader, Read, Seek, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

/// 官方安装包的包名。第三方重打包会改这个，所以它只是判定依据之一。
const OFFICIAL_PACKAGE: &str = "com.chucklefish.stardewvalley";

/// 游戏资源在安装包里的前缀。
const CONTENT_PREFIX: &str = "assets/Content/";

/// 只认这个原生库存在与否来判断"包里真的有游戏"，比包名可靠：
/// 重打包能改包名，但改不掉游戏程序集本身。
const GAME_ASSEMBLY_MARKER: &str = "libaot-StardewValley.dll.so";

/// 导入进度事件名。前端监听这个事件刷新进度条。
pub const IMPORT_EVENT: &str = "game-import-progress";

/// 识别安装包得到的信息，只读不落盘。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageInfo {
    pub package_name: String,
    pub version_name: String,
    pub version_code: i64,
    pub label: Option<String>,
    pub min_sdk: Option<i64>,
    pub target_sdk: Option<i64>,
    /// 安装包里带的所有 ABI，例如 `arm64-v8a`。
    pub abis: Vec<String>,
    pub main_activity: Option<String>,
    /// 综合判定：是不是可以导入的星露谷物语安装包。
    pub is_stardew_valley: bool,
    pub has_content: bool,
    pub content_file_count: u64,
    /// 资源解压后的字节数，用来提示玩家需要多少空间。
    pub content_bytes: u64,
    pub total_entries: u64,
    pub file_size: u64,
    /// 不阻塞导入、但值得提示玩家的问题。
    pub warnings: Vec<String>,
}

/// 已导入游戏的记录，落盘为 `game/meta.json`。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledGame {
    pub package_name: String,
    pub version_name: String,
    pub version_code: i64,
    pub abis: Vec<String>,
    /// Unix 毫秒时间戳。
    pub installed_at: i64,
    pub content_file_count: u64,
    pub content_bytes: u64,
    pub source_file_name: String,
    /// 是否留存了原始安装包（打 Mod 启动需要它）。
    pub package_retained: bool,
}

/// 导入状态，界面据此决定显示"导入引导"还是"数据首页"。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameInstallStatus {
    pub installed: bool,
    pub game: Option<InstalledGame>,
    /// `Content` 目录的实际路径，便于排查问题。
    pub content_path: Option<String>,
    /// 实际磁盘占用，和记录里的值可能因手动删改而不一致。
    pub actual_file_count: u64,
    pub actual_bytes: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportProgress<'a> {
    task_id: &'a str,
    stage: &'a str,
    processed: u64,
    total: u64,
    percent: f64,
    message: &'a str,
    current_file: Option<&'a str>,
}

fn emit_progress(
    app: &AppHandle,
    task_id: &str,
    stage: &str,
    processed: u64,
    total: u64,
    message: &str,
    current_file: Option<&str>,
) {
    let percent = if total == 0 {
        0.0
    } else {
        (processed as f64 / total as f64 * 100.0).clamp(0.0, 100.0)
    };
    let _ = app.emit(
        IMPORT_EVENT,
        ImportProgress {
            task_id,
            stage,
            processed,
            total,
            percent,
            message,
            current_file,
        },
    );
}

/// 正在进行的导入任务，用来支持取消。
#[derive(Default)]
pub struct ImportTasks {
    inner: Mutex<Vec<(String, Arc<AtomicBool>)>>,
}

impl ImportTasks {
    fn register(&self, task_id: &str) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        let mut guard = self.inner.lock().unwrap();
        guard.retain(|(id, _)| id != task_id);
        guard.push((task_id.to_string(), flag.clone()));
        flag
    }

    fn finish(&self, task_id: &str) {
        self.inner.lock().unwrap().retain(|(id, _)| id != task_id);
    }

    fn cancel(&self, task_id: &str) -> bool {
        let guard = self.inner.lock().unwrap();
        match guard.iter().find(|(id, _)| id == task_id) {
            Some((_, flag)) => {
                flag.store(true, Ordering::SeqCst);
                true
            }
            None => false,
        }
    }
}

/// 从清单元素里读出识别所需的字段。
fn read_manifest_fields(root: &axml::AxmlElement, info: &mut PackageInfo) {
    info.package_name = root
        .attr("package")
        .and_then(axml::AxmlValue::as_str)
        .unwrap_or_default()
        .to_string();

    info.version_name = root
        .android_attr("versionName")
        .map(axml::AxmlValue::as_display_string)
        .unwrap_or_default();

    info.version_code = root
        .android_attr("versionCode")
        .and_then(axml::AxmlValue::as_i64)
        .unwrap_or_default();

    if let Some(uses_sdk) = root.child("uses-sdk") {
        info.min_sdk = uses_sdk
            .android_attr("minSdkVersion")
            .and_then(axml::AxmlValue::as_i64);
        info.target_sdk = uses_sdk
            .android_attr("targetSdkVersion")
            .and_then(axml::AxmlValue::as_i64);
    }

    if let Some(application) = root.child("application") {
        // 只有字面量标签有意义；`@0x7f...` 这种资源引用读不到内容，忽略。
        info.label = application
            .android_attr("label")
            .and_then(axml::AxmlValue::as_str)
            .map(str::to_string);

        // 入口 Activity：带 MAIN/LAUNCHER 过滤器的那个。
        for activity in application.children_named("activity") {
            let is_launcher = activity.children_named("intent-filter").any(|filter| {
                let has_main = filter.children_named("action").any(|a| {
                    a.android_attr("name").and_then(axml::AxmlValue::as_str)
                        == Some("android.intent.action.MAIN")
                });
                let has_launcher = filter.children_named("category").any(|c| {
                    c.android_attr("name").and_then(axml::AxmlValue::as_str)
                        == Some("android.intent.category.LAUNCHER")
                });
                has_main && has_launcher
            });
            if is_launcher {
                info.main_activity = activity
                    .android_attr("name")
                    .and_then(axml::AxmlValue::as_str)
                    .map(str::to_string);
                break;
            }
        }
    }
}

/// 扫描安装包条目，统计资源与架构。
fn scan_entries<R: Read + Seek>(
    zip: &mut zip::ZipArchive<R>,
    info: &mut PackageInfo,
) -> Result<bool, String> {
    let mut abis: BTreeSet<String> = BTreeSet::new();
    let mut has_game_assembly = false;

    info.total_entries = zip.len() as u64;

    for index in 0..zip.len() {
        let entry = zip
            .by_index_raw(index)
            .map_err(|e| format!("读取安装包条目失败: {}", e))?;
        let name = entry.name();
        if name.ends_with('/') {
            continue;
        }

        if let Some(rest) = name.strip_prefix(CONTENT_PREFIX) {
            if !rest.is_empty() {
                info.content_file_count += 1;
                info.content_bytes += entry.size();
            }
            continue;
        }

        if let Some(rest) = name.strip_prefix("lib/") {
            if let Some((abi, file)) = rest.split_once('/') {
                abis.insert(abi.to_string());
                if file == GAME_ASSEMBLY_MARKER {
                    has_game_assembly = true;
                }
            }
        }
    }

    info.abis = abis.into_iter().collect();
    info.has_content = info.content_file_count > 0;
    Ok(has_game_assembly)
}

fn read_manifest_bytes<R: Read + Seek>(zip: &mut zip::ZipArchive<R>) -> Option<Vec<u8>> {
    let mut entry = zip.by_name("AndroidManifest.xml").ok()?;
    let mut buffer = Vec::with_capacity(entry.size() as usize);
    entry.read_to_end(&mut buffer).ok()?;
    Some(buffer)
}

/// 既可读又可定位的输入。ZIP 目录在文件末尾，必须能 seek。
pub trait ReadSeek: Read + Seek {}
impl<T: Read + Seek> ReadSeek for T {}

/// 打开的安装包来源。
pub struct PackageSource {
    pub reader: Box<dyn ReadSeek>,
    pub size: u64,
    /// 展示用的文件名，导入记录里会存下来。
    pub file_name: String,
}

/// 打开安装包。
///
/// 参数既可以是普通文件路径，也可以是系统文件选择器返回的 `content://` URI。
/// 后者在 Android 上直接接管内容提供者给的文件描述符——安装包接近 400 MB，
/// 先复制一份再解析会白白多花一倍时间和空间。
pub fn open_source(source: &str) -> Result<PackageSource, String> {
    #[cfg(target_os = "android")]
    if crate::android::content::is_content_uri(source) {
        let file = crate::android::content::open_readable(source)?;
        let size = file.metadata().map(|m| m.len()).unwrap_or(0);
        let file_name = crate::android::content::display_name(source)
            .unwrap_or_else(|| "game.apk".to_string());
        return Ok(PackageSource {
            reader: Box::new(file),
            size,
            file_name,
        });
    }

    let path = Path::new(source);
    let file = File::open(path).map_err(|e| format!("打开安装包失败: {}", e))?;
    let size = file
        .metadata()
        .map(|m| m.len())
        .map_err(|e| format!("读取安装包信息失败: {}", e))?;
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "game.apk".to_string());
    Ok(PackageSource {
        reader: Box::new(BufReader::with_capacity(256 * 1024, file)),
        size,
        file_name,
    })
}

/// 识别已打开的安装包。不写任何东西，纯读。
pub fn inspect_archive<R: Read + Seek>(
    zip: &mut zip::ZipArchive<R>,
    file_size: u64,
) -> Result<PackageInfo, String> {
    let mut info = PackageInfo {
        package_name: String::new(),
        version_name: String::new(),
        version_code: 0,
        label: None,
        min_sdk: None,
        target_sdk: None,
        abis: Vec::new(),
        main_activity: None,
        is_stardew_valley: false,
        has_content: false,
        content_file_count: 0,
        content_bytes: 0,
        total_entries: 0,
        file_size,
        warnings: Vec::new(),
    };

    match read_manifest_bytes(zip) {
        Some(bytes) => match axml::parse(&bytes) {
            Ok(root) => read_manifest_fields(&root, &mut info),
            Err(e) => info
                .warnings
                .push(format!("清单解析失败，已跳过版本识别: {}", e)),
        },
        None => info
            .warnings
            .push("安装包里没有 AndroidManifest.xml，无法读取版本号。".to_string()),
    }

    let has_game_assembly = scan_entries(zip, &mut info)?;

    // 判定标准：有游戏资源，且（包名匹配 或 带着游戏程序集）。
    // 两者取其一是为了兼容改过包名的重打包安装包。
    let package_matches = info.package_name == OFFICIAL_PACKAGE;
    info.is_stardew_valley = info.has_content && (package_matches || has_game_assembly);

    if info.has_content && !package_matches && has_game_assembly {
        info.warnings.push(format!(
            "包名是 {}，不是官方的 {}。这通常是重打包版本，资源仍可导入。",
            if info.package_name.is_empty() {
                "(未知)"
            } else {
                &info.package_name
            },
            OFFICIAL_PACKAGE
        ));
    }
    if !info.has_content {
        info.warnings.push(
            "安装包里没有 assets/Content 资源目录。分包（split APK）的资源可能在另一个文件里。"
                .to_string(),
        );
    }
    if !info.abis.iter().any(|a| a == "arm64-v8a") && !info.abis.is_empty() {
        info.warnings.push(format!(
            "安装包只带了 {} 架构，当前主流设备需要 arm64-v8a，启动游戏可能不可用（查看数据不受影响）。",
            info.abis.join("、")
        ));
    }

    Ok(info)
}

/// 把安装包里的游戏资源导入应用私有目录。
///
/// `keep_package` 为真时会额外留一份原始安装包——打 Mod 启动要用它重新打包，
/// 但会多占几百 MB，所以由界面让玩家自己选。
pub fn import_package(
    app: &AppHandle,
    task_id: &str,
    source: &str,
    keep_package: bool,
    cancel: Arc<AtomicBool>,
) -> Result<InstalledGame, String> {
    emit_progress(app, task_id, "inspecting", 0, 0, "正在识别安装包…", None);

    // 整个导入过程只打开一次安装包：内容 URI 拿到的描述符没法按路径重新打开，
    // 而且再开一次也要重新读一遍几百 MB 的中央目录。
    let opened = open_source(source)?;
    let file_size = opened.size;
    let source_file_name = opened.file_name.clone();
    let mut zip = zip::ZipArchive::new(opened.reader)
        .map_err(|e| format!("这个文件不是有效的安装包（无法按 ZIP 读取）: {}", e))?;

    let info = inspect_archive(&mut zip, file_size)?;
    if !info.is_stardew_valley {
        return Err(if info.has_content {
            "这个安装包里没有星露谷物语的游戏程序，请确认选对了文件。".to_string()
        } else {
            "这个安装包里没有游戏资源，无法导入。".to_string()
        });
    }

    let game_root = paths::game_root(app)?;
    let content_dir = game_root.join("Content");
    // 导入到临时目录再整体替换，中途取消或失败不会破坏已有的资源。
    let staging = paths::new_work_dir(app, "import")?;
    let staging_content = staging.join("Content");

    let cleanup_staging = |staging: &Path| {
        let _ = fs::remove_dir_all(staging);
    };

    let total = info.content_bytes.max(1);
    let mut written: u64 = 0;
    let mut buffer = vec![0u8; 256 * 1024];
    // 事件太密会淹没前端，按字节量节流。
    let mut next_report: u64 = 0;
    let report_step = (total / 200).max(1024 * 1024);

    emit_progress(app, task_id, "extracting", 0, total, "正在导入游戏资源…", None);

    for index in 0..zip.len() {
        if cancel.load(Ordering::SeqCst) {
            cleanup_staging(&staging);
            emit_progress(app, task_id, "cancelled", written, total, "已取消导入", None);
            return Err("已取消导入".to_string());
        }

        let mut entry = zip
            .by_index(index)
            .map_err(|e| format!("读取安装包条目失败: {}", e))?;
        let name = entry.name().to_string();
        if name.ends_with('/') {
            continue;
        }
        let Some(relative) = name.strip_prefix(CONTENT_PREFIX) else {
            continue;
        };
        if relative.is_empty() {
            continue;
        }

        let Some(out_path) = safe_join(&staging_content, relative) else {
            cleanup_staging(&staging);
            return Err(format!("安装包内含非法资源路径: {}", name));
        };
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("创建资源目录失败: {}", e))?;
        }

        let mut out = File::create(&out_path)
            .map_err(|e| format!("写入 {} 失败: {}", out_path.display(), e))?;
        loop {
            let read = entry
                .read(&mut buffer)
                .map_err(|e| format!("解压 {} 失败: {}", name, e))?;
            if read == 0 {
                break;
            }
            out.write_all(&buffer[..read])
                .map_err(|e| format!("写入 {} 失败: {}", out_path.display(), e))?;
            written += read as u64;
        }
        drop(out);

        if written >= next_report {
            next_report = written + report_step;
            emit_progress(
                app,
                task_id,
                "extracting",
                written,
                total,
                "正在导入游戏资源…",
                Some(relative),
            );
        }
    }

    if !staging_content.exists() {
        cleanup_staging(&staging);
        return Err("安装包里没有解出任何游戏资源。".to_string());
    }

    // 用新资源替换旧资源。先删旧的再改名，尽量缩短两者都不完整的时间窗。
    emit_progress(app, task_id, "finalizing", total, total, "正在写入应用目录…", None);
    if content_dir.exists() {
        fs::remove_dir_all(&content_dir).map_err(|e| format!("清理旧游戏资源失败: {}", e))?;
    }
    fs::create_dir_all(&game_root).map_err(|e| format!("创建游戏目录失败: {}", e))?;
    if let Err(rename_err) = fs::rename(&staging_content, &content_dir) {
        // 跨挂载点时改名会失败，退回逐文件复制。
        crate::utils::copy_dir_all(&staging_content, &content_dir).map_err(|copy_err| {
            format!(
                "写入游戏资源失败（改名: {}；复制: {}）",
                rename_err, copy_err
            )
        })?;
    }

    let package_file = paths::package_file(app)?;
    let mut package_retained = false;
    if keep_package {
        emit_progress(app, task_id, "finalizing", total, total, "正在留存安装包…", None);
        // 内容 URI 没有可用的文件路径，没法 `fs::copy`。把读取器从 ZIP 里取回来
        // 倒回开头整份复制，对普通路径同样成立，省得分两条实现。
        match retain_package(zip, &package_file) {
            Ok(_) => package_retained = true,
            Err(e) => {
                // 留存失败不影响数据查看，只是之后打 Mod 启动要重新选一次包。
                let _ = fs::remove_file(&package_file);
                emit_progress(
                    app,
                    task_id,
                    "warning",
                    total,
                    total,
                    &format!("安装包留存失败，稍后打 Mod 启动需要重新选择: {}", e),
                    None,
                );
            }
        }
    } else if package_file.exists() {
        let _ = fs::remove_file(&package_file);
    }

    cleanup_staging(&staging);

    let (actual_files, actual_bytes) = dir_stats(&content_dir);
    let record = InstalledGame {
        package_name: info.package_name,
        version_name: info.version_name,
        version_code: info.version_code,
        abis: info.abis,
        installed_at: chrono::Utc::now().timestamp_millis(),
        content_file_count: actual_files,
        content_bytes: actual_bytes,
        source_file_name,
        package_retained,
    };

    let meta_path = paths::meta_file(app)?;
    let json = serde_json::to_string_pretty(&record)
        .map_err(|e| format!("序列化导入记录失败: {}", e))?;
    fs::write(&meta_path, json).map_err(|e| format!("写入导入记录失败: {}", e))?;

    emit_progress(app, task_id, "finished", total, total, "导入完成", None);
    Ok(record)
}

/// 把安装包原样存一份到应用目录，供之后打 Mod 启动时重新打包使用。
fn retain_package(
    zip: zip::ZipArchive<Box<dyn ReadSeek>>,
    target: &Path,
) -> Result<u64, String> {
    let mut reader = zip.into_inner();
    reader
        .seek(std::io::SeekFrom::Start(0))
        .map_err(|e| format!("回到安装包开头失败: {}", e))?;
    let mut out = File::create(target).map_err(|e| format!("创建安装包副本失败: {}", e))?;
    std::io::copy(&mut reader, &mut out).map_err(|e| format!("复制安装包失败: {}", e))
}

/// 识别一个安装包文件。测试与桌面调试用；应用里走 [`inspect_source`]。
pub fn inspect_package(path: &Path) -> Result<PackageInfo, String> {
    inspect_source(&path.to_string_lossy())
}

/// 识别安装包，来源可以是文件路径或 `content://` URI。
pub fn inspect_source(source: &str) -> Result<PackageInfo, String> {
    let opened = open_source(source)?;
    let size = opened.size;
    let mut zip = zip::ZipArchive::new(opened.reader)
        .map_err(|e| format!("这个文件不是有效的安装包（无法按 ZIP 读取）: {}", e))?;
    inspect_archive(&mut zip, size)
}

/// 读取导入记录。
pub fn read_meta(app: &AppHandle) -> Option<InstalledGame> {
    let path = paths::meta_file(app).ok()?;
    let content = fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

// ---------------------------------------------------------------------------
// Tauri 命令
// ---------------------------------------------------------------------------

#[tauri::command(async)]
pub fn inspect_game_package(path: String) -> Result<PackageInfo, String> {
    inspect_source(&path)
}

#[tauri::command(async)]
pub fn install_game_package(
    app: AppHandle,
    path: String,
    task_id: Option<String>,
    keep_package: Option<bool>,
) -> Result<InstalledGame, String> {
    let task_id = task_id.unwrap_or_else(|| "game-import".to_string());
    let tasks = app.state::<ImportTasks>();
    let cancel = tasks.register(&task_id);

    let result = import_package(
        &app,
        &task_id,
        &path,
        keep_package.unwrap_or(false),
        cancel,
    );

    app.state::<ImportTasks>().finish(&task_id);
    if let Err(message) = &result {
        emit_progress(&app, &task_id, "failed", 0, 0, message, None);
    }
    result
}

#[tauri::command]
pub fn cancel_game_import(app: AppHandle, task_id: String) -> bool {
    app.state::<ImportTasks>().cancel(&task_id)
}

#[tauri::command(async)]
pub fn get_game_install_status(app: AppHandle) -> Result<GameInstallStatus, String> {
    let content_dir = paths::content_dir(&app)?;
    let installed = content_dir.is_dir();
    let (actual_file_count, actual_bytes) = if installed {
        dir_stats(&content_dir)
    } else {
        (0, 0)
    };

    Ok(GameInstallStatus {
        installed,
        game: read_meta(&app),
        content_path: installed.then(|| content_dir.to_string_lossy().to_string()),
        actual_file_count,
        actual_bytes,
    })
}

/// 删除已导入的游戏资源。留存的安装包也一并清掉。
#[tauri::command(async)]
pub fn uninstall_game_package(app: AppHandle) -> Result<(), String> {
    let game_root = paths::game_root(&app)?;
    if game_root.exists() {
        fs::remove_dir_all(&game_root).map_err(|e| format!("删除游戏资源失败: {}", e))?;
    }
    fs::create_dir_all(&game_root).map_err(|e| format!("重建游戏目录失败: {}", e))?;
    Ok(())
}
