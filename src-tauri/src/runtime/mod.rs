//! 游戏内运行时组件的定位与挂载。
//!
//! 这套组件（Assistant.Runtime.dll 及其依赖、Assistant.Bootstrap.dll、
//! assistant_inject.dll）作为 Tauri 资源随助手一同安装，**始终位于助手自己的
//! 目录内，任何情况下都不会写入游戏目录**——这正是取代旧伴侣模组的核心目的。
//!
//! 挂载有两条路径：
//!
//! 1. **启动钩子（首选）**：助手启动游戏时设置 `DOTNET_STARTUP_HOOKS` 环境变量，
//!    .NET 运行时会在游戏 `Main` 之前把我们的程序集载入 Default ALC。这是运行时
//!    官方支持的机制，不涉及任何进程注入，不会被安全软件拦截。
//!
//! 2. **运行时注入（兜底）**：玩家从 Steam / 桌面快捷方式直接启动时钩子来不及挂，
//!    此时把原生垫片注入到已运行的游戏进程里，再由它经 hostfxr 载入托管部分。

mod inject;

use std::path::{Path, PathBuf};

use serde_json::{json, Value};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};

use crate::game::find_game_pids;

/// 与 tauri.conf.json 中 `bundle.resources` 的相对路径一致。
const RESOURCE_DIR: &str = "runtime-dist";
const RUNTIME_DLL: &str = "Assistant.Runtime.dll";
const INJECTOR_DLL: &str = "assistant_inject.dll";

/// 旧版伴侣模组的目录名与 UniqueID。
const LEGACY_MOD_ID: &str = "StardewValleyAssistant";

/// 移除残留的旧版伴侣模组。
///
/// 助手的管道服务端同时只接受一个客户端（见 game_data/pipe_server.rs），旧模组
/// 与新运行时会争抢同一条管道，抢输的一方将永远连不上。老用户从旧版本升级时
/// 游戏目录里仍留着模组，因此必须清掉。
///
/// 只在 manifest 的 UniqueID 确实是我们自己的模组时才删除，绝不误伤他人的模组。
pub fn remove_legacy_mod(game_dir: &str) -> Result<bool, String> {
    let mod_dir = Path::new(game_dir).join("Mods").join(LEGACY_MOD_ID);
    let manifest_path = mod_dir.join("manifest.json");
    if !manifest_path.exists() {
        return Ok(false);
    }

    let content = std::fs::read_to_string(&manifest_path)
        .map_err(|e| format!("读取旧模组清单失败: {e}"))?;

    // 旧清单可能带 BOM 或注释，解析失败时保守起见不删。
    let manifest: Value = serde_json::from_str(content.trim_start_matches('\u{feff}'))
        .map_err(|e| format!("解析旧模组清单失败: {e}"))?;

    let is_ours = manifest
        .as_object()
        .and_then(|obj| {
            obj.iter()
                .find(|(key, _)| key.eq_ignore_ascii_case("UniqueID"))
                .and_then(|(_, value)| value.as_str())
        })
        .is_some_and(|id| id.eq_ignore_ascii_case(LEGACY_MOD_ID));

    if !is_ours {
        return Ok(false);
    }

    std::fs::remove_dir_all(&mod_dir)
        .map_err(|e| format!("删除旧模组目录失败 ({}): {e}", mod_dir.display()))?;

    Ok(true)
}

/// 供前端在启动时调用，清理从旧版本升级残留的伴侣模组。
#[tauri::command(async)]
pub fn cleanup_legacy_mod(game_dir: String) -> Result<bool, String> {
    remove_legacy_mod(&game_dir)
}

fn runtime_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .resolve(RESOURCE_DIR, BaseDirectory::Resource)
        .map_err(|e| format!("无法定位助手运行时目录: {e}"))
}

fn component(app: &AppHandle, file: &str) -> Result<PathBuf, String> {
    let path = runtime_dir(app)?.join(file);
    if !path.exists() {
        return Err(format!(
            "助手运行时组件缺失: {}。请重新安装助手。",
            path.display()
        ));
    }

    Ok(path)
}

/// 供 `launch_game` 设置到游戏进程环境中的启动钩子路径。
pub fn startup_hook_path(app: &AppHandle) -> Result<PathBuf, String> {
    component(app, RUNTIME_DLL)
}

/// 运行时组件是否可用（构建时可能因缺少 .NET SDK 而被跳过）。
#[tauri::command]
pub fn runtime_available(app: AppHandle) -> bool {
    component(&app, RUNTIME_DLL).is_ok() && component(&app, INJECTOR_DLL).is_ok()
}

/// 向所有正在运行的游戏进程注入助手运行时。
///
/// 幂等：若目标进程已经通过启动钩子加载过运行时，注入进去的初始化调用会被
/// 运行时自身的幂等保护挡掉，不会重复挂载。
#[tauri::command(async)]
pub fn attach_runtime(app: AppHandle) -> Result<Value, String> {
    let injector = component(&app, INJECTOR_DLL)?;
    // 注入器会从自身所在目录推导出托管程序集的位置，因此这两个文件必须同目录。
    component(&app, RUNTIME_DLL)?;

    let pids = find_game_pids();
    if pids.is_empty() {
        return Err("未检测到正在运行的游戏进程。".to_string());
    }

    let mut attached = Vec::new();
    let mut failures = Vec::new();

    for pid in pids {
        match inject::inject(pid, &injector) {
            Ok(()) => attached.push(pid),
            Err(message) => failures.push(format!("PID {pid}: {message}")),
        }
    }

    if attached.is_empty() {
        return Err(failures.join("；"));
    }

    Ok(json!({
        "attached": attached,
        "failures": failures,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 建一个假的游戏目录，Mods/StardewValleyAssistant/manifest.json 内容由调用方给定。
    fn fake_game_dir(label: &str, manifest: Option<&str>) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("sva-legacy-test-{label}"));
        let _ = std::fs::remove_dir_all(&dir);

        if let Some(manifest) = manifest {
            let mod_dir = dir.join("Mods").join(LEGACY_MOD_ID);
            std::fs::create_dir_all(&mod_dir).unwrap();
            std::fs::write(mod_dir.join("manifest.json"), manifest).unwrap();
            // 放个额外文件，确认整个目录都被清掉
            std::fs::write(mod_dir.join("StardewValleyAssistant.dll"), b"stub").unwrap();
        } else {
            std::fs::create_dir_all(dir.join("Mods")).unwrap();
        }

        dir
    }

    fn mod_dir_exists(game_dir: &Path) -> bool {
        game_dir.join("Mods").join(LEGACY_MOD_ID).exists()
    }

    #[test]
    fn removes_our_own_legacy_mod() {
        let dir = fake_game_dir("ours", Some(r#"{"UniqueID": "StardewValleyAssistant"}"#));

        assert_eq!(remove_legacy_mod(dir.to_str().unwrap()), Ok(true));
        assert!(!mod_dir_exists(&dir));

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// SMAPI 的 UniqueID 大小写不敏感，清单里可能写成别的大小写形式。
    #[test]
    fn matches_unique_id_case_insensitively() {
        let dir = fake_game_dir("case", Some(r#"{"uniqueId": "stardewvalleyassistant"}"#));

        assert_eq!(remove_legacy_mod(dir.to_str().unwrap()), Ok(true));
        assert!(!mod_dir_exists(&dir));

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 同名目录但属于别人的模组，绝不能删。
    #[test]
    fn keeps_third_party_mod_in_same_folder() {
        let dir = fake_game_dir("third-party", Some(r#"{"UniqueID": "SomeoneElse.CoolMod"}"#));

        assert_eq!(remove_legacy_mod(dir.to_str().unwrap()), Ok(false));
        assert!(mod_dir_exists(&dir));

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 清单损坏时保守处理：报错而不是盲删。
    #[test]
    fn keeps_mod_when_manifest_is_unparsable() {
        let dir = fake_game_dir("broken", Some("{ this is not json"));

        assert!(remove_legacy_mod(dir.to_str().unwrap()).is_err());
        assert!(mod_dir_exists(&dir));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn reports_nothing_removed_when_absent() {
        let dir = fake_game_dir("absent", None);

        assert_eq!(remove_legacy_mod(dir.to_str().unwrap()), Ok(false));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
