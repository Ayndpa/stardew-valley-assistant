//! 应用私有存储的目录布局。
//!
//! 移动端没有"游戏安装目录"这个概念——游戏资源是从用户给的安装包里解出来、
//! 写进应用私有目录的。所有模块都通过这里拿路径，避免各处硬编码目录名之后
//! 对不上。
//!
//! 布局（Android 上根目录是 `/data/user/0/<包名>/files`）：
//!
//! ```text
//! <app_data>/
//!   game/
//!     Content/        从安装包解出来的游戏资源（xnb 等）
//!     meta.json       导入记录：版本号、来源安装包、文件数、字节数
//!     package.apk     可选保留的原始安装包，打 Mod 启动时需要
//!   Mods/             SMAPI 模组
//!   smapi/            SMAPI 运行时载荷
//!   cache/            解压/下载中间产物，可随时清空
//! ```

use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// 应用私有数据根目录。目录不存在时会创建。
pub fn app_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法定位应用数据目录: {}", e))?;
    fs::create_dir_all(&dir).map_err(|e| format!("创建应用数据目录失败: {}", e))?;
    Ok(dir)
}

/// 游戏资源根目录 `<app_data>/game`。
pub fn game_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app_root(app)?.join("game");
    fs::create_dir_all(&dir).map_err(|e| format!("创建游戏目录失败: {}", e))?;
    Ok(dir)
}

/// 游戏资源目录 `<app_data>/game/Content`。
///
/// 注意这里**不会**创建目录：数据查询模块要靠它是否存在来判断"游戏是否已导入"，
/// 顺手创建会把未导入伪装成已导入。
pub fn content_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_root(app)?.join("game").join("Content"))
}

/// 导入记录文件 `<app_data>/game/meta.json`。
pub fn meta_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_root(app)?.join("game").join("meta.json"))
}

/// 保留的原始安装包 `<app_data>/game/package.apk`。
pub fn package_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_root(app)?.join("game").join("package.apk"))
}

/// 模组目录 `<app_data>/Mods`。
pub fn mods_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app_root(app)?.join("Mods");
    fs::create_dir_all(&dir).map_err(|e| format!("创建模组目录失败: {}", e))?;
    Ok(dir)
}

/// SMAPI 载荷目录 `<app_data>/smapi`。
pub fn smapi_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app_root(app)?.join("smapi");
    fs::create_dir_all(&dir).map_err(|e| format!("创建 SMAPI 目录失败: {}", e))?;
    Ok(dir)
}

/// 可随时清空的中间目录 `<app_data>/cache`。
pub fn cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app_root(app)?.join("cache");
    fs::create_dir_all(&dir).map_err(|e| format!("创建缓存目录失败: {}", e))?;
    Ok(dir)
}

/// 在缓存目录下开一个独占的工作目录，用完由调用方删除。
pub fn new_work_dir(app: &AppHandle, prefix: &str) -> Result<PathBuf, String> {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or_default();
    let dir = cache_dir(app)?.join(format!("{}_{}", prefix, stamp));
    if dir.exists() {
        let _ = fs::remove_dir_all(&dir);
    }
    fs::create_dir_all(&dir).map_err(|e| format!("创建临时目录失败: {}", e))?;
    Ok(dir)
}
