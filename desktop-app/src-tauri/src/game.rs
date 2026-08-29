use std::fs::File;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{LazyLock, Mutex};
use sysinfo::System;
use tauri::{AppHandle, Emitter};

use crate::utils::run_without_window;

#[cfg(target_os = "windows")]
fn get_steam_path_from_registry() -> Option<String> {
    use std::process::Command;
    let mut command = Command::new("reg");
    let output = run_without_window(command.args(&[
        "query",
        "HKCU\\Software\\Valve\\Steam",
        "/v",
        "SteamPath",
    ]))
    .output()
    .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        if line.contains("SteamPath") {
            let parts: Vec<&str> = line.split("REG_SZ").collect();
            if parts.len() > 1 {
                let path = parts[1].trim().replace("/", "\\");
                return Some(path);
            }
        }
    }
    None
}

#[cfg(not(target_os = "windows"))]
fn get_steam_path_from_registry() -> Option<String> {
    None
}

fn get_library_folders(steam_path: &str) -> Vec<PathBuf> {
    let mut folders = Vec::new();

    // Add default steamapps path
    let default_path = PathBuf::from(steam_path).join("steamapps");
    folders.push(default_path);

    let vdf_path = Path::new(steam_path)
        .join("steamapps")
        .join("libraryfolders.vdf");
    if !vdf_path.exists() {
        return folders;
    }

    if let Ok(file) = File::open(vdf_path) {
        let reader = BufReader::new(file);
        for line in reader.lines() {
            if let Ok(line_str) = line {
                if line_str.to_lowercase().contains("\"path\"") {
                    let parts: Vec<&str> = line_str.split('"').collect();
                    if parts.len() >= 4 {
                        let path_str = parts[3].replace("\\\\", "\\");
                        let path = PathBuf::from(path_str).join("steamapps");
                        folders.push(path);
                    }
                }
            }
        }
    }

    folders
}

pub(crate) fn find_stardew_valley() -> Option<String> {
    if let Some(steam_path) = get_steam_path_from_registry() {
        let folders = get_library_folders(&steam_path);
        for folder in folders {
            let stardew_path = folder.join("common").join("Stardew Valley");
            if stardew_path.exists() {
                return Some(stardew_path.to_string_lossy().to_string());
            }
        }
    }

    let mut paths_to_check = Vec::new();

    if let Some(home) = std::env::var_os("HOME") {
        let home_path = PathBuf::from(home);
        paths_to_check.push(
            home_path.join("Library/Application Support/Steam/steamapps/common/Stardew Valley"),
        );
        paths_to_check.push(home_path.join(".steam/steam/steamapps/common/Stardew Valley"));
        paths_to_check.push(home_path.join(".local/share/Steam/steamapps/common/Stardew Valley"));
    }

    paths_to_check.push(PathBuf::from(
        "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Stardew Valley",
    ));
    paths_to_check.push(PathBuf::from(
        "C:\\Program Files\\Steam\\steamapps\\common\\Stardew Valley",
    ));
    paths_to_check.push(PathBuf::from(
        "D:\\SteamLibrary\\steamapps\\common\\Stardew Valley",
    ));

    for path in paths_to_check {
        if path.exists() {
            return Some(path.to_string_lossy().to_string());
        }
    }

    None
}

#[tauri::command(async)]
pub fn auto_detect_game_dir() -> Option<String> {
    find_stardew_valley()
}

pub fn get_stardew_valley_version(game_dir: &str) -> Option<String> {
    let game_path = Path::new(game_dir);
    let mut deps_path = game_path.join("Stardew Valley.deps.json");
    if !deps_path.exists() {
        deps_path = game_path.join("StardewValley.deps.json");
    }

    if deps_path.exists() {
        if let Ok(file) = File::open(deps_path) {
            if let Ok(val) = serde_json::from_reader::<_, serde_json::Value>(BufReader::new(file)) {
                if let Some(libraries) = val.get("libraries") {
                    if let Some(obj) = libraries.as_object() {
                        for key in obj.keys() {
                            if key.to_lowercase().starts_with("stardewvalley/") {
                                let parts: Vec<&str> = key.split('/').collect();
                                if parts.len() > 1 {
                                    let ver = parts[1];
                                    return Some(ver.trim_end_matches(".0").to_string());
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    let exe_name = "Stardew Valley.exe";
    #[cfg(not(target_os = "windows"))]
    let exe_name = "StardewValley";

    if game_path.join(exe_name).exists() {
        return Some("1.6.8".to_string());
    }

    None
}

#[tauri::command(async)]
pub fn get_game_version(game_dir: String) -> Result<String, String> {
    get_stardew_valley_version(&game_dir)
        .ok_or_else(|| "无法检测游戏版本，请确认游戏安装目录是否正确。".to_string())
}

fn pick_smapi_executable(game_dir: &Path) -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let smapi_launcher = game_dir.join("StardewModdingAPI.exe");
        if smapi_launcher.exists() {
            return Some(smapi_launcher);
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let smapi_launcher = game_dir.join("StardewModdingAPI");
        if smapi_launcher.exists() {
            return Some(smapi_launcher);
        }

        let renamed_launcher = game_dir.join("StardewValley");
        let original_exe = game_dir.join("StardewValley-original");
        if renamed_launcher.exists() && original_exe.exists() {
            return Some(renamed_launcher);
        }
    }

    None
}

fn pick_vanilla_executable(game_dir: &Path) -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let game_exe = game_dir.join("Stardew Valley.exe");
        if game_exe.exists() {
            return Some(game_exe);
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let original_exe = game_dir.join("StardewValley-original");
        if original_exe.exists() {
            return Some(original_exe);
        }

        let game_exe = game_dir.join("StardewValley");
        if game_exe.exists() {
            return Some(game_exe);
        }
    }

    None
}

fn pick_executable(game_dir: &Path, launch_mode: Option<&str>) -> Option<PathBuf> {
    match launch_mode.unwrap_or("default") {
        "vanilla" => pick_vanilla_executable(game_dir),
        _ => pick_smapi_executable(game_dir).or_else(|| pick_vanilla_executable(game_dir)),
    }
}

#[tauri::command]
pub fn launch_game(
    app: AppHandle,
    game_dir: String,
    launch_mode: Option<String>,
) -> Result<u32, String> {
    let game_path = Path::new(&game_dir);
    if !game_path.exists() {
        return Err("游戏目录不存在，请先设置正确的目录。".to_string());
    }

    let exe_path = pick_executable(game_path, launch_mode.as_deref()).ok_or_else(|| {
        "未找到可执行文件（StardewModdingAPI.exe / Stardew Valley.exe）。".to_string()
    })?;

    // 写入 SteamAppId.txt，使 Steam 能识别并计入游戏时长
    let steam_app_id_path = game_path.join("SteamAppId.txt");
    if let Ok(mut f) = File::create(&steam_app_id_path) {
        let _ = f.write_all(b"413150\n");
    }

    // 旧版伴侣模组会和新运行时抢同一条命名管道，启动前先清掉残留。
    match crate::runtime::remove_legacy_mod(&game_dir) {
        Ok(true) => println!("[启动] 已移除残留的旧版伴侣模组"),
        Ok(false) => {}
        Err(message) => eprintln!("[启动] 清理旧版伴侣模组失败: {}", message),
    }

    let mut command = Command::new(&exe_path);
    command.current_dir(game_path);

    // 通过 .NET 官方的启动钩子机制把助手运行时载入游戏进程：运行时会在游戏
    // Main 之前加载该程序集。组件位于助手安装目录，游戏目录不落任何文件。
    // 组件缺失时不阻断启动——游戏照常能玩，只是没有实时数据与作弊功能。
    match crate::runtime::startup_hook_path(&app) {
        Ok(hook) => {
            command.env("DOTNET_STARTUP_HOOKS", &hook);
        }
        Err(message) => {
            eprintln!("[启动] 未挂载助手运行时: {}", message);
        }
    }

    let mut child = command
        .spawn()
        .map_err(|e| format!("启动游戏失败: {}", e))?;

    let pid = child.id();
    std::thread::spawn(move || {
        let _ = child.wait();
        let _ = app.emit("game-exited", pid);
    });

    Ok(pid)
}

/// Names of game executables to detect (case-insensitive comparison).
const GAME_PROCESS_NAMES: &[&str] = &[
    "stardewmoddingapi.exe",
    "stardew valley.exe",
    "stardewvalley",          // Linux / macOS
    "stardewmoddingapi",      // Linux / macOS
];

fn is_game_process(name: &str) -> bool {
    let lower = name.to_lowercase();
    GAME_PROCESS_NAMES.iter().any(|&target| lower == target)
}

/// 常驻的进程表，供 5 秒一次的运行状态轮询复用。
///
/// 每次都 `System::new()` 再全量刷新进程的完整信息要 50ms 以上；这里只需要
/// 进程名，因此复用同一个实例并用 `ProcessRefreshKind::nothing()` 跳过
/// 命令行、环境变量、磁盘/CPU 统计等昂贵字段。
static PROCESS_WATCH: LazyLock<Mutex<System>> = LazyLock::new(|| Mutex::new(System::new()));

/// Check whether any Stardew Valley / SMAPI process is currently running.
#[tauri::command(async)]
pub fn check_game_process_running() -> bool {
    let Ok(mut sys) = PROCESS_WATCH.lock() else {
        return false;
    };
    sys.refresh_processes_specifics(
        sysinfo::ProcessesToUpdate::All,
        true,
        sysinfo::ProcessRefreshKind::nothing(),
    );
    sys.processes().iter().any(|(_, proc)| {
        proc.name()
            .to_str()
            .map(is_game_process)
            .unwrap_or(false)
    })
}

/// PIDs of all running Stardew Valley / SMAPI processes.
///
/// 供运行时注入使用：SMAPI 启动时游戏本体就跑在 StardewModdingAPI.exe 这个进程里，
/// 因此两种进程名都是合法的注入目标。
pub fn find_game_pids() -> Vec<u32> {
    let mut sys = System::new();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

    sys.processes()
        .iter()
        .filter(|(_, proc)| {
            proc.name()
                .to_str()
                .map(is_game_process)
                .unwrap_or(false)
        })
        .map(|(pid, _)| pid.as_u32())
        .collect()
}

/// Force-kill all running Stardew Valley / SMAPI processes.
/// Returns a message summarising how many processes were killed.
#[tauri::command(async)]
pub fn force_kill_game() -> Result<String, String> {
    let mut sys = System::new();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

    let targets: Vec<sysinfo::Pid> = sys
        .processes()
        .iter()
        .filter(|(_, proc)| {
            proc.name()
                .to_str()
                .map(is_game_process)
                .unwrap_or(false)
        })
        .map(|(pid, _)| *pid)
        .collect();

    if targets.is_empty() {
        return Err("未检测到正在运行的游戏进程。".to_string());
    }

    let count = targets.len();
    for pid in &targets {
        if let Some(proc) = sys.process(*pid) {
            proc.kill();
        }
    }

    Ok(format!("已终止 {} 个游戏进程。", count))
}
