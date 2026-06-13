use super::{ModProfile, ModStateEntry};
use std::fs::{self, File};
use std::io::Write;
use std::path::Path;

fn get_profiles_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data: {}", e))?;
    let profiles_dir = app_data.join("profiles");
    fs::create_dir_all(&profiles_dir)
        .map_err(|e| format!("Failed to create profiles dir: {}", e))?;
    Ok(profiles_dir)
}

#[tauri::command]
pub fn list_profiles(app: tauri::AppHandle) -> Result<Vec<ModProfile>, String> {
    let profiles_dir = get_profiles_dir(&app)?;
    let mut profiles = Vec::new();

    let entries = match fs::read_dir(&profiles_dir) {
        Ok(e) => e,
        Err(_) => return Ok(profiles),
    };

    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("json") {
            if let Ok(content) = fs::read_to_string(&path) {
                if let Ok(profile) = serde_json::from_str::<ModProfile>(&content) {
                    profiles.push(profile);
                }
            }
        }
    }

    // Sort by updated_at descending
    profiles.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(profiles)
}

#[tauri::command]
pub fn save_profile(
    app: tauri::AppHandle,
    name: String,
    mod_states: Vec<ModStateEntry>,
) -> Result<ModProfile, String> {
    let profiles_dir = get_profiles_dir(&app)?;
    let now = chrono_now();
    let id = sanitize_filename(&name);

    // Check if profile with same name exists, update it
    let profile_path = profiles_dir.join(format!("{}.json", id));
    let created_at = if profile_path.exists() {
        if let Ok(content) = fs::read_to_string(&profile_path) {
            if let Ok(existing) = serde_json::from_str::<ModProfile>(&content) {
                existing.created_at
            } else {
                now.clone()
            }
        } else {
            now.clone()
        }
    } else {
        now.clone()
    };

    let profile = ModProfile {
        id: id.clone(),
        name,
        mod_states,
        created_at,
        updated_at: now,
    };

    let json_str =
        serde_json::to_string_pretty(&profile).map_err(|e| format!("Serialize error: {}", e))?;
    fs::write(&profile_path, json_str.as_bytes()).map_err(|e| format!("Write error: {}", e))?;

    Ok(profile)
}

#[tauri::command]
pub fn delete_profile(app: tauri::AppHandle, profile_id: String) -> Result<(), String> {
    let profiles_dir = get_profiles_dir(&app)?;
    let profile_path = profiles_dir.join(format!("{}.json", profile_id));
    if profile_path.exists() {
        fs::remove_file(&profile_path).map_err(|e| format!("Delete error: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub fn apply_profile(
    game_dir: String,
    mod_states: Vec<ModStateEntry>,
) -> Result<Vec<(String, String)>, String> {
    let mods_dir = Path::new(&game_dir).join("Mods");
    if !mods_dir.exists() {
        return Err("Mods folder does not exist".to_string());
    }

    let mut results = Vec::new();

    for entry in &mod_states {
        let clean_name = entry.folder_name.trim_start_matches('.').to_string();

        // Try both enabled and disabled forms
        let enabled_path = mods_dir.join(&clean_name);
        let disabled_path = mods_dir.join(format!(".{}", clean_name));

        if entry.is_enabled {
            // Want enabled: if disabled exists, rename to enabled
            if disabled_path.exists() && !enabled_path.exists() {
                if let Err(e) = fs::rename(&disabled_path, &enabled_path) {
                    println!("Failed to enable {}: {}", clean_name, e);
                    continue;
                }
                results.push((clean_name, "enabled".to_string()));
            }
        } else {
            // Want disabled: if enabled exists, rename to disabled
            if enabled_path.exists() && !disabled_path.exists() {
                if let Err(e) = fs::rename(&enabled_path, &disabled_path) {
                    println!("Failed to disable {}: {}", clean_name, e);
                    continue;
                }
                results.push((clean_name, "disabled".to_string()));
            }
        }
    }

    Ok(results)
}

#[tauri::command]
pub fn export_profile(profile: ModProfile) -> Result<String, String> {
    serde_json::to_string_pretty(&profile).map_err(|e| format!("Export error: {}", e))
}

#[tauri::command]
pub fn import_profile(app: tauri::AppHandle, json_data: String) -> Result<ModProfile, String> {
    let profile: ModProfile =
        serde_json::from_str(&json_data).map_err(|e| format!("Invalid profile JSON: {}", e))?;
    // Re-save with a unique id to avoid conflicts
    let profiles_dir = get_profiles_dir(&app)?;
    let now = chrono_now();
    let mut final_profile = profile;
    final_profile.updated_at = now.clone();
    if final_profile.created_at.is_empty() {
        final_profile.created_at = now;
    }

    // Ensure unique id
    let mut id = sanitize_filename(&final_profile.name);
    let mut counter = 1;
    while profiles_dir.join(format!("{}.json", id)).exists() {
        id = format!("{}-{}", sanitize_filename(&final_profile.name), counter);
        counter += 1;
    }
    final_profile.id = id.clone();

    let json_str = serde_json::to_string_pretty(&final_profile)
        .map_err(|e| format!("Serialize error: {}", e))?;
    fs::write(
        profiles_dir.join(format!("{}.json", id)),
        json_str.as_bytes(),
    )
    .map_err(|e| format!("Write error: {}", e))?;

    Ok(final_profile)
}

fn sanitize_filename(name: &str) -> String {
    name.to_lowercase()
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

fn chrono_now() -> String {
    // Simple ISO 8601 timestamp without external crate
    use std::time::SystemTime;
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("{}", now)
}

#[tauri::command]
pub fn export_profile_to_file(
    _app: tauri::AppHandle,
    profile: ModProfile,
    file_path: String,
) -> Result<String, String> {
    let json_str =
        serde_json::to_string_pretty(&profile).map_err(|e| format!("Export error: {}", e))?;
    let path = std::path::Path::new(&file_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Create dir error: {}", e))?;
    }
    let mut file = File::create(path).map_err(|e| format!("Create file error: {}", e))?;
    file.write_all(json_str.as_bytes())
        .map_err(|e| format!("Write error: {}", e))?;
    Ok(file_path)
}

#[tauri::command]
pub fn import_profile_from_file(
    app: tauri::AppHandle,
    file_path: String,
) -> Result<ModProfile, String> {
    let content = fs::read_to_string(&file_path).map_err(|e| format!("Read file error: {}", e))?;
    import_profile(app, content)
}
