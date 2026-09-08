//! 打 Mod 的游戏：状态查询、安装、启动。
//!
//! 助手是 Rust + WebView 应用，进程里没有 .NET 运行时，没法像桌面端那样把
//! 运行时注入到游戏进程里。手机端走的是另一条路：把 SMAPI 载荷合进游戏安装包、
//! 改包名重新签名，装成一个**独立的应用**再启动它。
//!
//! 改包名不是可选项——沿用原包名会和玩家已装的正版游戏撞签名，系统直接拒绝安装。

use crate::apk::{axml_write::ManifestEditor, repack, sign};
use crate::paths;
use serde::Serialize;
use std::fs;
use std::io::Read;
use tauri::{AppHandle, Emitter};

/// 打好 Mod 的游戏安装成什么包名。
///
/// 挂在助手自己的命名空间下，避免和其它重打包版本互相覆盖。
pub const MODDED_PACKAGE: &str = "io.github.ayndpa.sdv_assistant_mobile.game";

/// 打包产物的文件名。
pub const MODDED_APK_NAME: &str = "stardew-modded.apk";

/// 打包进度事件名。
pub const BUILD_EVENT: &str = "modded-build-progress";

/// 装好的应用在启动器里显示的名字，和原版区分开。
const MODDED_LABEL: &str = "星露谷物语（Mod）";

/// 只有 v2 签名的安装包在 API 21~23 上装不上——那些系统只认 JAR 签名。
/// 把 minSdk 抬到 24 让签名方案自洽，代价是不再支持 Android 5/6。
const MODDED_MIN_SDK: u32 = 24;

/// 游戏程序集里的授权校验，重打包后必然失效，留着只会让游戏启动就崩。
const LICENSE_PERMISSION: &str = "com.android.vending.CHECK_LICENSE";

/// 模组在安装包内的位置。
const MODS_ZIP_PREFIX: &str = "assets/Mods";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BuildProgress<'a> {
    stage: &'a str,
    message: &'a str,
}

fn emit_build(app: &AppHandle, stage: &str, message: &str) {
    let _ = app.emit(BUILD_EVENT, BuildProgress { stage, message });
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModdedGameStatus {
    pub package_name: String,
    /// 打好 Mod 的游戏是否已安装。
    pub installed: bool,
    pub version: Option<String>,
    /// 是否留存了原始安装包。没有它就没法重新打包。
    pub source_package_available: bool,
    /// 是否已导入 SMAPI 载荷。
    pub smapi_available: bool,
    /// 已经打好、等待安装的产物路径。
    pub built_apk: Option<String>,
    /// 当前平台是否支持这套流程。桌面预览窗口里为 false。
    pub supported: bool,
}

/// 打包前提是否齐备，不齐备时给出该让玩家先做什么。
pub fn missing_prerequisite(app: &AppHandle) -> Option<String> {
    let package = paths::package_file(app).ok()?;
    if !package.is_file() {
        return Some(
            "还没有留存游戏安装包。请重新导入一次安装包，并在导入时勾选「保留安装包」。"
                .to_string(),
        );
    }
    if !crate::smapi::is_ready(app) {
        return Some("还没有导入 SMAPI 安卓版载荷，无法生成带模组的游戏。".to_string());
    }
    None
}

/// 从原始安装包里取出二进制清单。
fn read_source_manifest(source: &std::path::Path) -> Result<Vec<u8>, String> {
    let file = fs::File::open(source).map_err(|e| format!("打开留存的安装包失败: {}", e))?;
    let mut zip = zip::ZipArchive::new(std::io::BufReader::with_capacity(256 * 1024, file))
        .map_err(|e| format!("留存的安装包已损坏: {}", e))?;
    let mut entry = zip
        .by_name("AndroidManifest.xml")
        .map_err(|_| "留存的安装包里没有 AndroidManifest.xml".to_string())?;
    let mut bytes = Vec::with_capacity(entry.size() as usize);
    entry
        .read_to_end(&mut bytes)
        .map_err(|e| format!("读取清单失败: {}", e))?;
    Ok(bytes)
}

/// 生成带模组的安装包。
///
/// 三步：改清单（换包名、换标签、去掉会失效的授权校验）→ 把 SMAPI 载荷和模组
/// 注入原包 → 用本机密钥做 v2 签名。产物落在 `game/stardew-modded.apk`，
/// 随后由 [`install_modded_game`] 交给系统安装器。
///
/// 换包名是整件事的前提：沿用原包名会和玩家已装的正版游戏撞签名，系统直接拒绝
/// 安装；换掉之后两个应用可以并存，正版存档也不会被动到。
///
/// SMAPI 载荷按它自己的目录结构原样注入到安装包根部，也就是说压缩包里的相对路径
/// 就是它在安装包里的最终位置。载荷的组织方式由发布者决定，助手不做假设也不重排。
#[tauri::command(async)]
pub fn build_modded_game(app: AppHandle) -> Result<String, String> {
    if let Some(missing) = missing_prerequisite(&app) {
        return Err(missing);
    }

    let source = paths::package_file(&app)?;
    let game_root = paths::game_root(&app)?;
    let output = game_root.join(MODDED_APK_NAME);
    let work = paths::new_work_dir(&app, "repack")?;
    let unsigned = work.join("unsigned.apk");
    let cleanup = || {
        let _ = fs::remove_dir_all(&work);
    };

    emit_build(&app, "patching", "正在改写安装包清单…");
    let manifest_bytes = match read_source_manifest(&source) {
        Ok(bytes) => bytes,
        Err(e) => {
            cleanup();
            return Err(e);
        }
    };

    let patched = match patch_manifest(&manifest_bytes) {
        Ok(bytes) => bytes,
        Err(e) => {
            cleanup();
            return Err(e);
        }
    };

    let mut plan = repack::RepackPlan::new();
    plan.set_manifest(patched);
    if let Err(e) = plan.add_dir("", &paths::smapi_dir(&app)?) {
        cleanup();
        return Err(format!("读取 SMAPI 载荷失败: {}", e));
    }
    // 模组目录可以是空的，玩家还没装模组也应该能打出包来。
    let mods_dir = paths::mods_dir(&app)?;
    if let Err(e) = plan.add_dir(MODS_ZIP_PREFIX, &mods_dir) {
        cleanup();
        return Err(format!("读取模组目录失败: {}", e));
    }

    emit_build(&app, "repacking", "正在重新打包，这一步比较慢…");
    if let Err(e) = repack::repack(&source, &unsigned, &plan) {
        cleanup();
        return Err(e);
    }

    emit_build(&app, "signing", "正在签名…");
    let identity = match sign::load_or_create_identity(&sign::keystore_dir(&paths::app_root(&app)?))
    {
        Ok(identity) => identity,
        Err(e) => {
            cleanup();
            return Err(e);
        }
    };
    // 先写到临时文件再替换，签名中途失败不会留下一个装不上的半成品。
    let signed = work.join("signed.apk");
    if let Err(e) = sign::sign_apk_v2(&unsigned, &signed, &identity) {
        cleanup();
        return Err(e);
    }

    if output.exists() {
        let _ = fs::remove_file(&output);
    }
    if let Err(rename_err) = fs::rename(&signed, &output) {
        if let Err(copy_err) = fs::copy(&signed, &output) {
            cleanup();
            return Err(format!(
                "写入打包产物失败（改名: {}；复制: {}）",
                rename_err, copy_err
            ));
        }
    }

    cleanup();
    emit_build(&app, "finished", "打包完成，可以安装了");
    Ok(output.to_string_lossy().to_string())
}

/// 改写清单：换包名、换显示名、抬 minSdk、去掉失效的授权校验。
fn patch_manifest(manifest: &[u8]) -> Result<Vec<u8>, String> {
    let mut editor = ManifestEditor::parse(manifest).map_err(|e| e.to_string())?;
    // 换包名的同时会把相对类名补全、把 provider 的 authority 一起改掉——
    // MonoRuntimeProvider 的 authority 里含包名，不改就会和原版游戏冲突装不上。
    editor
        .set_package(MODDED_PACKAGE)
        .map_err(|e| e.to_string())?;
    editor
        .set_application_label(MODDED_LABEL)
        .map_err(|e| e.to_string())?;
    editor
        .set_min_sdk_version(MODDED_MIN_SDK)
        .map_err(|e| e.to_string())?;
    // 原生库以未压缩方式对齐写入，声明成不解压才能让系统直接 mmap。
    editor
        .set_extract_native_libs(false)
        .map_err(|e| e.to_string())?;
    editor
        .remove_uses_permission(LICENSE_PERMISSION)
        .map_err(|e| e.to_string())?;
    editor.to_bytes().map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn get_modded_game_status(app: AppHandle) -> Result<ModdedGameStatus, String> {
    let source_package_available = paths::package_file(&app)
        .map(|p| p.is_file())
        .unwrap_or(false);
    let built = paths::game_root(&app).ok().map(|d| d.join(MODDED_APK_NAME));
    let built_apk = built
        .filter(|p| p.is_file())
        .map(|p| p.to_string_lossy().to_string());

    #[cfg(target_os = "android")]
    let (installed, version, supported) = {
        let version = crate::android::launcher::installed_version(MODDED_PACKAGE);
        (version.is_some(), version, true)
    };
    #[cfg(not(target_os = "android"))]
    let (installed, version, supported) = (false, None, false);

    Ok(ModdedGameStatus {
        package_name: MODDED_PACKAGE.to_string(),
        installed,
        version,
        source_package_available,
        smapi_available: crate::smapi::is_ready(&app),
        built_apk,
        supported,
    })
}

/// 把已经打好的安装包交给系统安装器。
///
/// 只发起安装，用户还要在系统弹窗里确认。安装可能持续一两分钟，前端应当轮询
/// [`get_modded_game_status`] 直到 `installed` 变为真。
#[tauri::command(async)]
pub fn install_modded_game(app: AppHandle) -> Result<(), String> {
    let apk = paths::game_root(&app)?.join(MODDED_APK_NAME);
    if !apk.is_file() {
        return Err("还没有生成带模组的安装包，请先执行打包。".to_string());
    }

    #[cfg(target_os = "android")]
    {
        crate::android::launcher::install_apk(&apk.to_string_lossy())
    }
    #[cfg(not(target_os = "android"))]
    {
        Err("只有 Android 设备才能安装带模组的游戏。".to_string())
    }
}

#[tauri::command(async)]
pub fn launch_modded_game(_app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        crate::android::launcher::launch(MODDED_PACKAGE)
    }
    #[cfg(not(target_os = "android"))]
    {
        Err("只有 Android 设备才能启动游戏。".to_string())
    }
}

/// 删除打包产物，回收几百 MB 空间。
#[tauri::command(async)]
pub fn remove_modded_package(app: AppHandle) -> Result<(), String> {
    let apk = paths::game_root(&app)?.join(MODDED_APK_NAME);
    if apk.exists() {
        fs::remove_file(&apk).map_err(|e| format!("删除打包产物失败: {}", e))?;
    }
    Ok(())
}
