use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use serde::Serialize;
use crate::utils::{download_file, extract_zip, copy_dir_all};

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SmapiStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub path: Option<String>,
}

#[tauri::command]
pub fn check_smapi_status(game_dir: String) -> SmapiStatus {
    let game_path = Path::new(&game_dir);
    if !game_path.exists() {
        return SmapiStatus {
            installed: false,
            version: None,
            path: None,
        };
    }

    #[cfg(target_os = "windows")]
    let exe_name = "StardewModdingAPI.exe";
    #[cfg(not(target_os = "windows"))]
    let exe_name = "StardewModdingAPI";

    let api_exe = game_path.join(exe_name);
    let installed = api_exe.exists();

    let mut version = None;
    if installed {
        let log_path = get_smapi_log_path();
        if let Some(path) = log_path {
            if path.exists() {
                if let Ok(file) = File::open(path) {
                    let reader = BufReader::new(file);
                    for line in reader.lines() {
                        if let Ok(line_str) = line {
                            if line_str.contains("INFO  SMAPI] SMAPI") {
                                if let Some(ver_idx) = line_str.find("SMAPI ") {
                                    let rest = &line_str[ver_idx + 6..];
                                    let parts: Vec<&str> = rest.split_whitespace().collect();
                                    if !parts.is_empty() {
                                        version = Some(parts[0].to_string());
                                    }
                                }
                                break;
                            }
                        }
                    }
                }
            }
        }
    }

    SmapiStatus {
        installed,
        version,
        path: if installed { Some(api_exe.to_string_lossy().to_string()) } else { None },
    }
}

pub fn get_smapi_log_path() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var("APPDATA").ok()?;
        Some(PathBuf::from(appdata).join("StardewValley").join("ErrorLogs").join("SMAPI-latest.txt"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        let home = std::env::var("HOME").ok()?;
        Some(PathBuf::from(home).join(".config").join("StardewValley").join("ErrorLogs").join("SMAPI-latest.txt"))
    }
}

#[tauri::command]
pub async fn install_smapi(game_dir: String, download_url: String) -> Result<(), String> {
    let game_path = Path::new(&game_dir);
    if !game_path.exists() {
        return Err("游戏安装目录不存在。".to_string());
    }

    let temp_dir = game_path.join(".smapi_temp");
    if temp_dir.exists() {
        let _ = fs::remove_dir_all(&temp_dir);
    }
    fs::create_dir_all(&temp_dir).map_err(|e| format!("无法创建临时文件夹: {}", e))?;

    let zip_path = temp_dir.join("smapi_installer.zip");

    // Download
    download_file(&download_url, &zip_path)?;

    // Extract
    let extract_dir = temp_dir.join("extracted");
    fs::create_dir_all(&extract_dir).map_err(|e| format!("无法创建解压文件夹: {}", e))?;
    extract_zip(&zip_path, &extract_dir)?;

    // Search for internal folder
    fn find_internal(dir: &Path) -> Option<PathBuf> {
        if let Some(name) = dir.file_name() {
            if name.to_string_lossy().to_lowercase() == "internal" {
                return Some(dir.to_path_buf());
            }
        }
        if dir.is_dir() {
            if let Ok(entries) = fs::read_dir(dir) {
                for entry in entries.flatten() {
                    if let Some(p) = find_internal(&entry.path()) {
                        return Some(p);
                    }
                }
            }
        }
        None
    }

    let found_internal = find_internal(&extract_dir)
        .ok_or_else(|| "在下载的安装包中未找到 internal 文件夹。".to_string())?;

    // Find platform folder
    #[cfg(target_os = "windows")]
    let platform_name = "windows";
    #[cfg(target_os = "macos")]
    let platform_name = "mac";
    #[cfg(target_os = "linux")]
    let platform_name = "linux";

    let mut platform_path = None;
    if let Ok(entries) = fs::read_dir(&found_internal) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_lowercase();
            if name == platform_name || (platform_name == "mac" && name.contains("mac")) {
                platform_path = Some(entry.path());
                break;
            }
        }
    }

    let plat_path = platform_path.unwrap_or(found_internal);

    // Copy to game folder
    copy_dir_all(&plat_path, game_path)
        .map_err(|e| format!("拷贝文件到游戏目录失败: {}", e))?;

    // Cleanup
    let _ = fs::remove_dir_all(&temp_dir);

    Ok(())
}

#[tauri::command]
pub fn uninstall_smapi(game_dir: String) -> Result<(), String> {
    let game_path = Path::new(&game_dir);
    if !game_path.exists() {
        return Err("游戏安装目录不存在。".to_string());
    }

    let files_to_delete = vec![
        "StardewModdingAPI.exe",
        "StardewModdingAPI.dll",
        "StardewModdingAPI.deps.json",
        "StardewModdingAPI.runtimeconfig.json",
        "StardewModdingAPI.pdb",
        "StardewModdingAPI.xml",
        "StardewModdingAPI",
    ];

    for file in files_to_delete {
        let p = game_path.join(file);
        if p.exists() {
            fs::remove_file(p).map_err(|e| format!("删除文件 {} 失败: {}", file, e))?;
        }
    }

    let dirs_to_delete = vec![
        "smapi-internal",
    ];

    for dir in dirs_to_delete {
        let p = game_path.join(dir);
        if p.exists() {
            fs::remove_dir_all(p).map_err(|e| format!("删除文件夹 {} 失败: {}", dir, e))?;
        }
    }

    Ok(())
}
