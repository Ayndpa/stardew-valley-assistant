use std::fs::{self, File};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use serde::{Serialize, Deserialize};

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg(target_os = "windows")]
fn get_steam_path_from_registry() -> Option<String> {
    use std::process::Command;
    let output = Command::new("reg")
        .args(&["query", "HKCU\\Software\\Valve\\Steam", "/v", "SteamPath"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    // Parse the path from output:
    // SteamPath    REG_SZ    C:/Program Files (x86)/Steam
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

    let vdf_path = Path::new(steam_path).join("steamapps").join("libraryfolders.vdf");
    if !vdf_path.exists() {
        return folders;
    }

    if let Ok(file) = File::open(vdf_path) {
        let reader = BufReader::new(file);
        for line in reader.lines() {
            if let Ok(line_str) = line {
                // Look for "path" "..."
                if line_str.to_lowercase().contains("\"path\"") {
                    // Extract path between the quotes
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

fn find_stardew_valley() -> Option<String> {
    // 1. Windows Registry method
    if let Some(steam_path) = get_steam_path_from_registry() {
        let folders = get_library_folders(&steam_path);
        for folder in folders {
            let stardew_path = folder.join("common").join("Stardew Valley");
            if stardew_path.exists() {
                return Some(stardew_path.to_string_lossy().to_string());
            }
        }
    }

    // 2. Fallbacks for other platforms or home directory paths
    let mut paths_to_check = Vec::new();

    // macOS default paths
    if let Some(home) = std::env::var_os("HOME") {
        let home_path = PathBuf::from(home);
        paths_to_check.push(home_path.join("Library/Application Support/Steam/steamapps/common/Stardew Valley"));
        paths_to_check.push(home_path.join(".steam/steam/steamapps/common/Stardew Valley"));
        paths_to_check.push(home_path.join(".local/share/Steam/steamapps/common/Stardew Valley"));
    }

    // Standard Windows default paths just in case registry query failed
    paths_to_check.push(PathBuf::from("C:\\Program Files (x86)\\Steam\\steamapps\\common\\Stardew Valley"));
    paths_to_check.push(PathBuf::from("C:\\Program Files\\Steam\\steamapps\\common\\Stardew Valley"));
    paths_to_check.push(PathBuf::from("D:\\SteamLibrary\\steamapps\\common\\Stardew Valley"));

    for path in paths_to_check {
        if path.exists() {
            return Some(path.to_string_lossy().to_string());
        }
    }

    None
}

#[tauri::command]
fn auto_detect_game_dir() -> Option<String> {
    find_stardew_valley()
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModConfigField {
    pub key: String,
    pub label: String,
    pub r#type: String, // "boolean" | "number" | "string"
    pub value: serde_json::Value,
    pub description: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Mod {
    pub id: String,
    pub name: String,
    pub english_name: String,
    pub version: String,
    pub latest_version: String,
    pub author: String,
    pub description: String,
    pub category: String,
    pub is_enabled: bool,
    pub nexus_id: Option<u64>,
    pub local_path: String,
    pub folder_name: String,
    pub dependencies: Vec<String>,
    pub config: Vec<ModConfigField>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SmapiStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub path: Option<String>,
}

#[derive(Deserialize, Debug)]
struct Manifest {
    #[serde(alias = "Name", alias = "name")]
    name: Option<String>,
    #[serde(alias = "Author", alias = "author")]
    author: Option<String>,
    #[serde(alias = "Version", alias = "version")]
    version: Option<String>,
    #[serde(alias = "Description", alias = "description")]
    description: Option<String>,
    #[serde(alias = "UniqueID", alias = "uniqueId", alias = "unique_id")]
    unique_id: Option<String>,
    #[serde(alias = "UpdateKeys", alias = "updateKeys", alias = "update_keys")]
    update_keys: Option<Vec<String>>,
    #[serde(alias = "Dependencies", alias = "dependencies")]
    dependencies: Option<Vec<ManifestDependency>>,
}

#[derive(Deserialize, Debug)]
struct ManifestDependency {
    #[serde(alias = "UniqueID", alias = "uniqueId", alias = "unique_id")]
    unique_id: Option<String>,
}

#[tauri::command]
fn check_smapi_status(game_dir: String) -> SmapiStatus {
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

fn get_smapi_log_path() -> Option<PathBuf> {
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
fn list_installed_mods(game_dir: String) -> Result<Vec<Mod>, String> {
    let mods_dir = Path::new(&game_dir).join("Mods");
    if !mods_dir.exists() {
        return Ok(Vec::new());
    }

    let mut installed_mods = Vec::new();
    let entries = fs::read_dir(&mods_dir)
        .map_err(|e| format!("Failed to read Mods folder: {}", e))?;

    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let folder_name = entry.file_name().to_string_lossy().to_string();
        let is_enabled = !folder_name.starts_with('.');

        let manifest_path = path.join("manifest.json");
        if !manifest_path.exists() {
            continue;
        }

        let manifest_file = File::open(&manifest_path)
            .map_err(|e| format!("Failed to open manifest.json in {}: {}", folder_name, e))?;
        
        let manifest: Manifest = match serde_json::from_reader(BufReader::new(manifest_file)) {
            Ok(m) => m,
            Err(e) => {
                println!("Error parsing manifest.json in {}: {}", folder_name, e);
                continue;
            }
        };

        let id = manifest.unique_id.clone().unwrap_or_else(|| folder_name.clone());
        let name = manifest.name.clone().unwrap_or_else(|| folder_name.clone());
        let english_name = folder_name.trim_start_matches('.').to_string();
        let version = manifest.version.clone().unwrap_or_else(|| "1.0.0".to_string());
        let author = manifest.author.unwrap_or_else(|| "Unknown".to_string());
        let description = manifest.description.unwrap_or_else(|| "No description provided.".to_string());

        let mut nexus_id = None;
        if let Some(keys) = manifest.update_keys {
            for key in keys {
                if key.to_lowercase().starts_with("nexus:") {
                    if let Some(id_str) = key.split(':').nth(1) {
                        if let Ok(id_num) = id_str.trim().parse::<u64>() {
                            nexus_id = Some(id_num);
                        }
                    }
                }
            }
        }

        let mut dependencies = Vec::new();
        if let Some(deps) = manifest.dependencies {
            for dep in deps {
                if let Some(dep_id) = dep.unique_id {
                    dependencies.push(dep_id);
                }
            }
        }

        let mut config_fields = Vec::new();
        let config_path = path.join("config.json");
        if config_path.exists() {
            if let Ok(config_file) = File::open(&config_path) {
                if let Ok(config_val) = serde_json::from_reader::<_, serde_json::Value>(BufReader::new(config_file)) {
                    if let Some(obj) = config_val.as_object() {
                        for (k, v) in obj {
                            let r#type = match v {
                                serde_json::Value::Bool(_) => "boolean".to_string(),
                                serde_json::Value::Number(_) => "number".to_string(),
                                serde_json::Value::String(_) => "string".to_string(),
                                _ => "string".to_string(),
                            };
                            config_fields.push(ModConfigField {
                                key: k.clone(),
                                label: k.clone(),
                                r#type,
                                value: v.clone(),
                                description: String::new(),
                            });
                        }
                    }
                }
            }
        }

        let mut category = "utility".to_string();
        let id_lower = id.to_lowercase();
        if id_lower == "pathoschild.contentpatcher" {
            category = "core".to_string();
        } else if id_lower.contains("contentpatcher") || dependencies.iter().any(|d| d.to_lowercase().contains("contentpatcher")) {
            category = "content".to_string();
        } else if id_lower.contains("expansion") || id_lower.contains("sve") || folder_name.to_lowercase().contains("expansion") {
            category = "expansion".to_string();
        }

        let local_path = format!("Mods/{}", folder_name);

        installed_mods.push(Mod {
            id,
            name,
            english_name,
            version: version.clone(),
            latest_version: version,
            author,
            description,
            category,
            is_enabled,
            nexus_id,
            local_path,
            folder_name,
            dependencies,
            config: config_fields,
        });
    }

    Ok(installed_mods)
}

#[tauri::command]
fn toggle_mod(game_dir: String, folder_name: String, enable: bool) -> Result<String, String> {
    let mods_dir = Path::new(&game_dir).join("Mods");
    if !mods_dir.exists() {
        return Err("Mods folder does not exist".to_string());
    }

    let src_path = mods_dir.join(&folder_name);
    if !src_path.exists() {
        return Err(format!("Mod folder {} does not exist", folder_name));
    }

    let new_folder_name = if enable {
        if folder_name.starts_with('.') {
            folder_name.trim_start_matches('.').to_string()
        } else {
            folder_name.clone()
        }
    } else {
        if !folder_name.starts_with('.') {
            format!(".{}", folder_name)
        } else {
            folder_name.clone()
        }
    };

    if new_folder_name != folder_name {
        let dest_path = mods_dir.join(&new_folder_name);
        fs::rename(&src_path, &dest_path)
            .map_err(|e| format!("Failed to rename folder from {} to {}: {}", folder_name, new_folder_name, e))?;
    }

    Ok(new_folder_name)
}

#[tauri::command]
fn save_mod_config(game_dir: String, folder_name: String, config: serde_json::Value) -> Result<(), String> {
    let mods_dir = Path::new(&game_dir).join("Mods");
    let mod_dir = mods_dir.join(&folder_name);
    if !mod_dir.exists() {
        return Err(format!("Mod folder {} does not exist", folder_name));
    }

    let config_path = mod_dir.join("config.json");
    let mut file = File::create(&config_path)
        .map_err(|e| format!("Failed to create config.json: {}", e))?;

    let json_str = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config JSON: {}", e))?;

    file.write_all(json_str.as_bytes())
        .map_err(|e| format!("Failed to write to config.json: {}", e))?;

    Ok(())
}

#[tauri::command]
fn open_in_file_manager(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err("Path does not exist".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(p)
            .spawn()
            .map_err(|e| format!("Failed to open explorer: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(p)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(p)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    Ok(())
}

fn get_stardew_valley_version(game_dir: &str) -> Option<String> {
    let game_path = Path::new(game_dir);
    
    // Check Stardew Valley.deps.json or StardewValley.deps.json
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

    // Fallback: check if there's an executable
    #[cfg(target_os = "windows")]
    let exe_name = "Stardew Valley.exe";
    #[cfg(not(target_os = "windows"))]
    let exe_name = "StardewValley";

    if game_path.join(exe_name).exists() {
        return Some("1.6.8".to_string());
    }

    None
}

fn download_file(url: &str, dest: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        // Try Powershell first
        let output = std::process::Command::new("powershell")
            .args(&[
                "-NoProfile",
                "-Command",
                &format!("Invoke-WebRequest -Uri '{}' -OutFile '{}'", url, dest.to_string_lossy())
            ])
            .output();
        
        if let Ok(out) = output {
            if out.status.success() {
                return Ok(());
            }
        }
        
        // Fallback to curl
        let output = std::process::Command::new("curl")
            .args(&["-L", "-o", &dest.to_string_lossy(), url])
            .output()
            .map_err(|e| format!("Failed to run curl: {}", e))?;
        
        if output.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).to_string())
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let output = std::process::Command::new("curl")
            .args(&["-L", "-o", &dest.to_string_lossy(), url])
            .output()
            .map_err(|e| format!("Failed to run curl: {}", e))?;
        
        if output.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).to_string())
        }
    }
}

fn extract_zip(zip_path: &Path, dest_dir: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let output = std::process::Command::new("powershell")
            .args(&[
                "-NoProfile",
                "-Command",
                &format!(
                    "Expand-Archive -Path '{}' -DestinationPath '{}' -Force",
                    zip_path.to_string_lossy(),
                    dest_dir.to_string_lossy()
                )
            ])
            .output()
            .map_err(|e| format!("Failed to run PowerShell Expand-Archive: {}", e))?;
        
        if output.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).to_string())
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let output = std::process::Command::new("unzip")
            .args(&[
                "-o",
                &zip_path.to_string_lossy(),
                "-d",
                &dest_dir.to_string_lossy()
            ])
            .output()
            .map_err(|e| format!("Failed to run unzip: {}", e))?;
        
        if output.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).to_string())
        }
    }
}

fn copy_dir_all(src: impl AsRef<Path>, dst: impl AsRef<Path>) -> std::io::Result<()> {
    fs::create_dir_all(&dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        if ty.is_dir() {
            copy_dir_all(entry.path(), dst.as_ref().join(entry.file_name()))?;
        } else {
            fs::copy(entry.path(), dst.as_ref().join(entry.file_name()))?;
        }
    }
    Ok(())
}

#[tauri::command]
fn get_game_version(game_dir: String) -> Result<String, String> {
    get_stardew_valley_version(&game_dir)
        .ok_or_else(|| "无法检测游戏版本，请确认游戏安装目录是否正确。".to_string())
}

#[tauri::command]
async fn install_smapi(game_dir: String, download_url: String) -> Result<(), String> {
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
fn uninstall_smapi(game_dir: String) -> Result<(), String> {
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

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SaveSummary {
    pub id: String,
    pub player_name: String,
    pub farm_name: String,
    pub money: i32,
    pub total_money_earned: i32,
    pub day_of_month: i32,
    pub season: i32, // 0: Spring, 1: Summer, 2: Fall, 3: Winter
    pub year: i32,
    pub farming_level: i32,
    pub mining_level: i32,
    pub combat_level: i32,
    pub foraging_level: i32,
    pub fishing_level: i32,
    pub deepest_mine_level: i32,
    pub milliseconds_played: u64,
    pub last_save_time: u64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FriendshipInfo {
    pub npc_name: String,
    pub points: i32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SaveDetail {
    pub summary: SaveSummary,
    pub weather_today: String,
    pub weather_tomorrow: String,
    pub museum_pieces_count: i32,
    pub friendships: Vec<FriendshipInfo>,
}

fn get_tag_value<'a>(xml: &'a str, tag: &str) -> Option<&'a str> {
    let start_tag = format!("<{}>", tag);
    let end_tag = format!("</{}>", tag);
    let start_idx = xml.find(&start_tag)?;
    let end_idx = xml.find(&end_tag)?;
    if start_idx < end_idx {
        Some(&xml[start_idx + start_tag.len()..end_idx])
    } else {
        None
    }
}

fn extract_tag_i32(xml: &str, tag: &str) -> i32 {
    get_tag_value(xml, tag)
        .and_then(|v| v.parse::<i32>().ok())
        .unwrap_or(0)
}

fn extract_tag_u64(xml: &str, tag: &str) -> u64 {
    get_tag_value(xml, tag)
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(0)
}

fn extract_tag_string(xml: &str, tag: &str) -> String {
    get_tag_value(xml, tag)
        .map(|v| v.to_string())
        .unwrap_or_else(|| "".to_string())
}

fn parse_friendship_data(xml: &str) -> Vec<FriendshipInfo> {
    let mut list = Vec::new();
    if let Some(friendship_idx) = xml.find("<friendshipData>") {
        let friendship_end = xml.find("</friendshipData>").unwrap_or(xml.len());
        let section = &xml[friendship_idx..friendship_end];
        
        let mut search_pos = 0;
        while let Some(item_start) = section[search_pos..].find("<item>") {
            let abs_item_start = search_pos + item_start;
            let item_end = match section[abs_item_start..].find("</item>") {
                Some(offset) => abs_item_start + offset,
                None => break,
            };
            let item_xml = &section[abs_item_start..item_end];
            
            if let Some(key_start) = item_xml.find("<key>") {
                if let Some(key_end) = item_xml.find("</key>") {
                    let key_xml = &item_xml[key_start..key_end];
                    if let Some(str_start) = key_xml.find("<string>") {
                        if let Some(str_end) = key_xml.find("</string>") {
                            let npc_name = key_xml[str_start + 8..str_end].to_string();
                            
                            if let Some(val_start) = item_xml.find("<value>") {
                                if let Some(val_end) = item_xml.find("</value>") {
                                    let val_xml = &item_xml[val_start..val_end];
                                    if let Some(pts_start) = val_xml.find("<Points>") {
                                        if let Some(pts_end) = val_xml.find("</Points>") {
                                            let points_str = &val_xml[pts_start + 8..pts_end];
                                            if let Ok(points) = points_str.parse::<i32>() {
                                                list.push(FriendshipInfo { npc_name, points });
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            search_pos = item_end + 7;
        }
    }
    list
}

fn parse_museum_pieces_count(xml: &str) -> i32 {
    if let Some(start_idx) = xml.find("<museumPieces>") {
        if let Some(end_idx) = xml.find("</museumPieces>") {
            let inner = &xml[start_idx + 14..end_idx];
            return inner.matches("<item>").count() as i32;
        }
    }
    0
}

fn parse_weather(xml: &str) -> (String, String) {
    let mut today = "Sun".to_string();
    let mut tomorrow = "Sun".to_string();
    
    if let Some(start_idx) = xml.find("<locationWeather>") {
        if let Some(end_idx) = xml.find("</locationWeather>") {
            let section = &xml[start_idx..end_idx];
            if let Some(def_idx) = section.find("<string>Default</string>") {
                let sub_sec = &section[def_idx..];
                
                // Read today's weather
                let mut found_today = false;
                if let Some(w_start) = sub_sec.find("<Weather>") {
                    if let Some(w_end) = sub_sec.find("</Weather>") {
                        let w = sub_sec[w_start + 9..w_end].trim();
                        if !w.is_empty() && !w.contains("xsi:nil") {
                            today = w.to_string();
                            found_today = true;
                        }
                    }
                }
                
                // Fallback for today using flags if not found
                if !found_today {
                    let is_green_rain = sub_sec.find("<IsGreenRain>true</IsGreenRain>").is_some() || sub_sec.find("<isGreenRain>true</isGreenRain>").is_some();
                    let is_lightning = sub_sec.find("<IsLightning>true</IsLightning>").is_some() || sub_sec.find("<isLightning>true</isLightning>").is_some();
                    let is_raining = sub_sec.find("<IsRaining>true</IsRaining>").is_some() || sub_sec.find("<isRaining>true</isRaining>").is_some();
                    let is_snowing = sub_sec.find("<IsSnowing>true</IsSnowing>").is_some() || sub_sec.find("<isSnowing>true</isSnowing>").is_some();
                    let is_debris = sub_sec.find("<IsDebrisWeather>true</IsDebrisWeather>").is_some() || sub_sec.find("<isDebrisWeather>true</isDebrisWeather>").is_some();
                    
                    if is_green_rain {
                        today = "GreenRain".to_string();
                    } else if is_lightning {
                        today = "Storm".to_string();
                    } else if is_raining {
                        today = "Rain".to_string();
                    } else if is_snowing {
                        today = "Snow".to_string();
                    } else if is_debris {
                        today = "Wind".to_string();
                    } else {
                        today = "Sun".to_string();
                    }
                }

                // Read tomorrow's weather
                if let Some(wt_start) = sub_sec.find("<WeatherForTomorrow>") {
                    if let Some(wt_end) = sub_sec.find("</WeatherForTomorrow>") {
                        let wt = sub_sec[wt_start + 20..wt_end].trim();
                        if !wt.is_empty() && !wt.contains("xsi:nil") {
                            tomorrow = wt.to_string();
                        }
                    }
                }
            }
        }
    }
    (today, tomorrow)
}

fn get_saves_dir() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var("APPDATA").ok()?;
        Some(PathBuf::from(appdata).join("StardewValley").join("Saves"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        let home = std::env::var("HOME").ok()?;
        Some(PathBuf::from(home).join(".config").join("StardewValley").join("Saves"))
    }
}

#[tauri::command]
fn list_save_files() -> Result<Vec<SaveSummary>, String> {
    let saves_dir = get_saves_dir()
        .ok_or_else(|| "Could not locate APPDATA or HOME directory".to_string())?;
    
    if !saves_dir.exists() {
        return Ok(Vec::new());
    }

    let mut list = Vec::new();
    let entries = fs::read_dir(&saves_dir)
        .map_err(|e| format!("Failed to read Saves directory: {}", e))?;

    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let folder_name = entry.file_name().to_string_lossy().to_string();
        let save_game_info_path = path.join("SaveGameInfo");
        if !save_game_info_path.exists() {
            continue;
        }

        let xml = fs::read_to_string(&save_game_info_path)
            .map_err(|e| format!("Failed to read SaveGameInfo in {}: {}", folder_name, e))?;

        // Extract first occurrence of name (which is player name in SaveGameInfo)
        let player_name = extract_tag_string(&xml, "name");
        let farm_name = extract_tag_string(&xml, "farmName");
        let money = extract_tag_i32(&xml, "money");
        let total_money_earned = extract_tag_i32(&xml, "totalMoneyEarned");
        let day_of_month = extract_tag_i32(&xml, "dayOfMonthForSaveGame");
        let season = extract_tag_i32(&xml, "seasonForSaveGame");
        let year = extract_tag_i32(&xml, "yearForSaveGame");
        let farming_level = extract_tag_i32(&xml, "farmingLevel");
        let mining_level = extract_tag_i32(&xml, "miningLevel");
        let combat_level = extract_tag_i32(&xml, "combatLevel");
        let foraging_level = extract_tag_i32(&xml, "foragingLevel");
        let fishing_level = extract_tag_i32(&xml, "fishingLevel");
        let deepest_mine_level = extract_tag_i32(&xml, "deepestMineLevel");
        let milliseconds_played = extract_tag_u64(&xml, "millisecondsPlayed");

        let last_save_time = entry.metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);

        list.push(SaveSummary {
            id: folder_name,
            player_name,
            farm_name,
            money,
            total_money_earned,
            day_of_month,
            season,
            year,
            farming_level,
            mining_level,
            combat_level,
            foraging_level,
            fishing_level,
            deepest_mine_level,
            milliseconds_played,
            last_save_time,
        });
    }

    // Sort list by last_save_time descending
    list.sort_by(|a, b| b.last_save_time.cmp(&a.last_save_time));

    Ok(list)
}

#[tauri::command]
fn get_save_detail(id: String) -> Result<SaveDetail, String> {
    let saves_dir = get_saves_dir()
        .ok_or_else(|| "Could not locate APPDATA or HOME directory".to_string())?;
    
    let save_folder = saves_dir.join(&id);
    if !save_folder.exists() {
        return Err(format!("Save folder {} does not exist", id));
    }

    // Read SaveGameInfo
    let save_game_info_path = save_folder.join("SaveGameInfo");
    if !save_game_info_path.exists() {
        return Err(format!("SaveGameInfo not found in {}", id));
    }
    let info_xml = fs::read_to_string(&save_game_info_path)
        .map_err(|e| format!("Failed to read SaveGameInfo: {}", e))?;

    // Parse summary
    let player_name = extract_tag_string(&info_xml, "name");
    let farm_name = extract_tag_string(&info_xml, "farmName");
    let money = extract_tag_i32(&info_xml, "money");
    let total_money_earned = extract_tag_i32(&info_xml, "totalMoneyEarned");
    let day_of_month = extract_tag_i32(&info_xml, "dayOfMonthForSaveGame");
    let season = extract_tag_i32(&info_xml, "seasonForSaveGame");
    let year = extract_tag_i32(&info_xml, "yearForSaveGame");
    let farming_level = extract_tag_i32(&info_xml, "farmingLevel");
    let mining_level = extract_tag_i32(&info_xml, "miningLevel");
    let combat_level = extract_tag_i32(&info_xml, "combatLevel");
    let foraging_level = extract_tag_i32(&info_xml, "foragingLevel");
    let fishing_level = extract_tag_i32(&info_xml, "fishingLevel");
    let deepest_mine_level = extract_tag_i32(&info_xml, "deepestMineLevel");
    let milliseconds_played = extract_tag_u64(&info_xml, "millisecondsPlayed");

    let last_save_time = save_game_info_path.metadata()
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let summary = SaveSummary {
        id: id.clone(),
        player_name,
        farm_name,
        money,
        total_money_earned,
        day_of_month,
        season,
        year,
        farming_level,
        mining_level,
        combat_level,
        foraging_level,
        fishing_level,
        deepest_mine_level,
        milliseconds_played,
        last_save_time,
    };

    // Read main save file
    let main_save_path = save_folder.join(&id);
    if !main_save_path.exists() {
        return Err(format!("Main save file {} not found in {}", id, id));
    }
    let main_xml = fs::read_to_string(&main_save_path)
        .map_err(|e| format!("Failed to read main save file {}: {}", id, e))?;

    let (weather_today, weather_tomorrow) = parse_weather(&main_xml);
    let museum_pieces_count = parse_museum_pieces_count(&main_xml);
    let friendships = parse_friendship_data(&info_xml);

    Ok(SaveDetail {
        summary,
        weather_today,
        weather_tomorrow,
        museum_pieces_count,
        friendships,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            auto_detect_game_dir,
            check_smapi_status,
            list_installed_mods,
            toggle_mod,
            save_mod_config,
            open_in_file_manager,
            get_game_version,
            install_smapi,
            uninstall_smapi,
            list_save_files,
            get_save_detail
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
