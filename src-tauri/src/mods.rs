use std::fs::{self, File};
use std::io::{BufReader, Write};
use std::path::Path;
use serde::{Serialize, Deserialize};

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
pub fn list_installed_mods(game_dir: String) -> Result<Vec<Mod>, String> {
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
pub fn toggle_mod(game_dir: String, folder_name: String, enable: bool) -> Result<String, String> {
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
pub fn save_mod_config(game_dir: String, folder_name: String, config: serde_json::Value) -> Result<(), String> {
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
pub async fn fetch_smapi_compatibility_mods() -> Result<Vec<serde_json::Value>, String> {
    let temp_dir = std::env::temp_dir();
    let temp_html_path = temp_dir.join("smapi_mods_temp.html");
    let temp_json_path = temp_dir.join("smapi_mods_temp.json");

    // 1. Download smapi.io HTML page
    let html_url = "https://smapi.io/mods";
    crate::utils::download_file(html_url, &temp_html_path)
        .map_err(|e| format!("Failed to download SMAPI compatibility HTML: {}", e))?;

    // 2. Read HTML content to find the JSON link
    let html_content = fs::read_to_string(&temp_html_path)
        .map_err(|e| format!("Failed to read temporary HTML file: {}", e))?;

    let fetch_uri = extract_fetch_uri(&html_content)
        .ok_or_else(|| "Could not find fetchUri inside smapi.io/mods page. The page format may have changed.".to_string())?;

    // 3. Download JSON file
    crate::utils::download_file(&fetch_uri, &temp_json_path)
        .map_err(|e| format!("Failed to download SMAPI compatibility JSON: {}", e))?;

    // 4. Read and parse JSON content
    let json_content = fs::read_to_string(&temp_json_path)
        .map_err(|e| format!("Failed to read temporary JSON file: {}", e))?;

    let parsed_json: Vec<serde_json::Value> = serde_json::from_str(&json_content)
        .map_err(|e| format!("Failed to parse SMAPI compatibility JSON: {}", e))?;

    // 5. Clean up temporary files
    let _ = fs::remove_file(&temp_html_path);
    let _ = fs::remove_file(&temp_json_path);

    Ok(parsed_json)
}

fn extract_fetch_uri(html: &str) -> Option<String> {
    let key = "fetchUri: \"";
    if let Some(start_idx) = html.find(key) {
        let after_key = &html[start_idx + key.len()..];
        if let Some(end_idx) = after_key.find('"') {
            return Some(after_key[..end_idx].to_string());
        }
    }
    None
}
