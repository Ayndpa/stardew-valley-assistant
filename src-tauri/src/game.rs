use std::fs::File;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
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

#[tauri::command]
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

#[tauri::command]
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

    let mut child = Command::new(&exe_path)
        .current_dir(game_path)
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

/// Check whether any Stardew Valley / SMAPI process is currently running.
#[tauri::command]
pub fn check_game_process_running() -> bool {
    let mut sys = System::new();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
    sys.processes().iter().any(|(_, proc)| {
        proc.name()
            .to_str()
            .map(is_game_process)
            .unwrap_or(false)
    })
}

/// Force-kill all running Stardew Valley / SMAPI processes.
/// Returns a message summarising how many processes were killed.
#[tauri::command]
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
