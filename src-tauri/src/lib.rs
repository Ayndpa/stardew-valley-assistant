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
            uninstall_smapi
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
