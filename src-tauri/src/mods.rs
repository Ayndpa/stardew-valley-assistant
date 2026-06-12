use std::fs::{self, File};
use std::io::{BufReader, Write};
use std::path::Path;
use serde::{Serialize, Deserialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModStateEntry {
    pub folder_name: String,
    pub is_enabled: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModProfile {
    pub id: String,
    pub name: String,
    pub mod_states: Vec<ModStateEntry>,
    pub created_at: String,
    pub updated_at: String,
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
pub async fn open_nexus_ranking_scraper(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;

    // NexusMods most downloaded mods page for Stardew Valley (all time)
    let url_str = "https://www.nexusmods.com/games/stardewvalley/mods?sort=downloads&timeRange=allTime".to_string();
    let url = url_str.parse::<tauri::Url>().map_err(|e| e.to_string())?;

    let handle = app.clone();

    // Resolve persistent data directory for WebView cookie/localStorage persistence
    let data_dir = app
        .path()
        .app_data_dir()
        .ok()
        .map(|p| p.join("webview_data"));
    if let Some(ref dir) = data_dir {
        let _ = fs::create_dir_all(dir);
    }

    tauri::async_runtime::spawn(async move {
        use tauri::Emitter;

        // Destroy old ranking scraper window if it exists
        if let Some(old_window) = handle.get_webview_window("nexus-ranking-scraper") {
            let _ = old_window.destroy();
        }

        let mut builder = tauri::WebviewWindowBuilder::new(
            &handle,
            "nexus-ranking-scraper",
            tauri::WebviewUrl::External(url)
        )
        .title("Nexus 排行榜加载中...")
        .inner_size(960.0, 720.0)
        .min_inner_size(760.0, 560.0)
        .center()
        .visible(true);

        // Set persistent data directory for cookie/localStorage support
        if let Some(dir) = data_dir {
            builder = builder.data_directory(dir);
        }

        let window = match builder.build() {
            Ok(w) => w,
            Err(e) => {
                println!("Failed to build ranking scraper window: {:?}", e);
                return;
            }
        };

        // Start minimized — only show when CF challenge needs user interaction
        let _ = window.minimize();

        let center_over_main = |win: &tauri::WebviewWindow, app_handle: &tauri::AppHandle| {
            if let Some(main_window) = app_handle.get_webview_window("main") {
                if let (Ok(main_pos), Ok(main_size), Ok(win_size)) = (
                    main_window.outer_position(),
                    main_window.inner_size(),
                    win.inner_size(),
                ) {
                    let x = main_pos.x + ((main_size.width as i32 - win_size.width as i32) / 2);
                    let y = main_pos.y + ((main_size.height as i32 - win_size.height as i32) / 2);
                    let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
                    return;
                }
            }
            let _ = win.center();
        };

        center_over_main(&window, &handle);

        // Poll from Rust side via eval()
        let poll_window = window.clone();
        let poll_handle = handle.clone();
        tauri::async_runtime::spawn(async move {
            let timeout = std::time::Instant::now() + std::time::Duration::from_secs(180);
            let mut cf_shown = false;
            let mut last_title = String::new();

            let eval_js = |win: &tauri::WebviewWindow, js: &str| -> Option<String> {
                let (tx, rx) = std::sync::mpsc::channel::<String>();
                if win.eval_with_callback(js, move |result| { let _ = tx.send(result); }).is_err() {
                    return None;
                }
                rx.recv_timeout(std::time::Duration::from_secs(2)).ok()
            };

            loop {
                if std::time::Instant::now() > timeout {
                    println!("[RankingScraper] Timeout reached, destroying window");
                    let _ = poll_handle.emit("respond-nexus-ranking-html", serde_json::json!({
                        "error": "加载超时，请重试"
                    }));
                    let _ = poll_window.destroy();
                    return;
                }

                let snapshot_json = match eval_js(&poll_window, r##"
                    (() => {
                        try {
                            const html = document.documentElement ? document.documentElement.outerHTML : "";
                            const text = document.body ? document.body.innerText : "";
                            const lowerHtml = html.toLowerCase();
                            const lowerTitle = (document.title || "").toLowerCase();
                            const lowerHref = location.href.toLowerCase();
                            // Detect NexusMods new-style mod list page markers (data-e2eid and .mods-grid)
                            const hasModListMarker =
                                !!document.querySelector('[data-e2eid="mod-tile"], .mods-grid, [data-e2eid="result-count"]');
                            const hasNexusListPage =
                                location.hostname.endsWith("nexusmods.com") &&
                                hasModListMarker &&
                                !lowerTitle.includes("just a moment") &&
                                !lowerTitle.includes("checking your browser") &&
                                !lowerTitle.includes("attention required");
                            const hasChallengeMarker =
                                lowerTitle.includes("just a moment") ||
                                lowerTitle.includes("checking your browser") ||
                                lowerTitle.includes("attention required") ||
                                lowerHref.includes("captcha") ||
                                lowerHref.includes("challenge") ||
                                lowerHtml.includes("cf-turnstile") ||
                                lowerHtml.includes("challenges.cloudflare.com") ||
                                lowerHtml.includes("/cdn-cgi/challenge-platform/") ||
                                lowerHtml.includes("cf-challenge") ||
                                lowerHtml.includes("cloudflare ray id") ||
                                text.includes("Checking if the site connection is secure") ||
                                text.includes("Verify you are human");
                            const isChallenge = !hasNexusListPage && hasChallengeMarker;
                            return {
                                readyState: document.readyState,
                                title: document.title || "",
                                href: location.href,
                                isChallenge,
                                hasModList: hasNexusListPage,
                                html
                            };
                        } catch (error) {
                            return {
                                readyState: "error",
                                title: "",
                                href: "",
                                isChallenge: false,
                                hasModList: false,
                                html: "",
                                error: String(error)
                            };
                        }
                    })()
                "##) {
                    None => {
                        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                        continue;
                    }
                    Some(s) => s,
                };

                let snapshot: serde_json::Value = match serde_json::from_str(&snapshot_json) {
                    Ok(value) => value,
                    Err(_) => {
                        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                        continue;
                    }
                };

                let title = snapshot
                    .get("title")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                let href = snapshot
                    .get("href")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                let is_challenge = snapshot
                    .get("isChallenge")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false)
                    || title.contains("Just a moment")
                    || title.contains("Checking your browser")
                    || href.contains("captcha")
                    || href.contains("challenge");

                if is_challenge && !cf_shown {
                    cf_shown = true;
                    last_title = "Nexus 需要验证".to_string();
                    let _ = poll_window.set_title(&last_title);
                    center_over_main(&poll_window, &poll_handle);
                    let _ = poll_window.show();
                    let _ = poll_window.unminimize();
                    let _ = poll_window.set_focus();
                    let _ = poll_handle.emit("respond-nexus-ranking-html", serde_json::json!({
                        "status": "challenge"
                    }));
                }

                if !is_challenge && cf_shown && last_title == "Nexus 需要验证" {
                    last_title = "Nexus 排行榜页面加载中...".to_string();
                    let _ = poll_window.set_title(&last_title);
                    let _ = poll_handle.emit("respond-nexus-ranking-html", serde_json::json!({
                        "status": "loading"
                    }));
                }

                let ready_state = snapshot
                    .get("readyState")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                let has_mod_list = snapshot
                    .get("hasModList")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let html = snapshot
                    .get("html")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();

                if !is_challenge && ready_state == "complete" && has_mod_list {
                    let _ = poll_window.set_title("Nexus 排行榜已获取");
                    println!("[RankingScraper] Got HTML, length: {}", html.len());
                    let _ = poll_handle.emit("respond-nexus-ranking-html", serde_json::json!({
                        "html": html
                    }));
                    let _ = poll_window.destroy();
                    return;
                }

                if !is_challenge && last_title != "Nexus 排行榜页面加载中..." {
                    last_title = "Nexus 排行榜页面加载中...".to_string();
                    let _ = poll_window.set_title(&last_title);
                }

                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            }
        });
    });

    Ok(())
}

#[tauri::command]
pub async fn fetch_smapi_compatibility_mods(app: tauri::AppHandle) -> Result<Vec<serde_json::Value>, String> {
    use tauri::Manager;

    // Determine cache path in app data directory
    let cache_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {}", e))?;
    let _ = fs::create_dir_all(&cache_dir);
    let cache_path = cache_dir.join("smapi_mods_cache.json");

    // Use a temp dir inside app data for intermediate downloads
    let download_dir = cache_dir.join("downloads");
    let _ = fs::create_dir_all(&download_dir);
    let temp_html_path = download_dir.join("smapi_mods_temp.html");
    let temp_json_path = download_dir.join("smapi_mods_temp.json");

    // Try to fetch fresh data
    let fetch_result = (|| -> Result<Vec<serde_json::Value>, String> {
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

        Ok(parsed_json)
    })();

    // Clean up temp download files
    let _ = fs::remove_file(&temp_html_path);
    let _ = fs::remove_file(&temp_json_path);
    let _ = fs::remove_dir(&download_dir);

    match fetch_result {
        Ok(mods) => {
            // Save to cache on success
            let json_str = serde_json::to_string(&mods).unwrap_or_default();
            let _ = fs::write(&cache_path, &json_str);
            Ok(mods)
        }
        Err(e) => {
            // Try to load from cache on failure
            if cache_path.exists() {
                if let Ok(cached) = fs::read_to_string(&cache_path) {
                    if let Ok(mods) = serde_json::from_str::<Vec<serde_json::Value>>(&cached) {
                        println!("Using cached SMAPI mods data due to fetch failure: {}", e);
                        return Ok(mods);
                    }
                }
            }
            Err(e)
        }
    }
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

// ==================== Profile Management ====================

fn get_profiles_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;
    let app_data = app.path().app_data_dir().map_err(|e| format!("Failed to resolve app data: {}", e))?;
    let profiles_dir = app_data.join("profiles");
    fs::create_dir_all(&profiles_dir).map_err(|e| format!("Failed to create profiles dir: {}", e))?;
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
pub fn save_profile(app: tauri::AppHandle, name: String, mod_states: Vec<ModStateEntry>) -> Result<ModProfile, String> {
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

    let json_str = serde_json::to_string_pretty(&profile).map_err(|e| format!("Serialize error: {}", e))?;
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
pub fn apply_profile(game_dir: String, mod_states: Vec<ModStateEntry>) -> Result<Vec<(String, String)>, String> {
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
    let profile: ModProfile = serde_json::from_str(&json_data).map_err(|e| format!("Invalid profile JSON: {}", e))?;
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

    let json_str = serde_json::to_string_pretty(&final_profile).map_err(|e| format!("Serialize error: {}", e))?;
    fs::write(profiles_dir.join(format!("{}.json", id)), json_str.as_bytes()).map_err(|e| format!("Write error: {}", e))?;

    Ok(final_profile)
}

fn sanitize_filename(name: &str) -> String {
    name.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
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
pub fn export_profile_to_file(_app: tauri::AppHandle, profile: ModProfile, file_path: String) -> Result<String, String> {
    let json_str = serde_json::to_string_pretty(&profile).map_err(|e| format!("Export error: {}", e))?;
    let path = std::path::Path::new(&file_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Create dir error: {}", e))?;
    }
    let mut file = File::create(path).map_err(|e| format!("Create file error: {}", e))?;
    file.write_all(json_str.as_bytes()).map_err(|e| format!("Write error: {}", e))?;
    Ok(file_path)
}

#[tauri::command]
pub fn import_profile_from_file(app: tauri::AppHandle, file_path: String) -> Result<ModProfile, String> {
    let content = fs::read_to_string(&file_path).map_err(|e| format!("Read file error: {}", e))?;
    import_profile(app, content)
}

#[tauri::command]
pub async fn open_nexus_login_window(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;

    let url_str = "https://www.nexusmods.com/users/login".to_string();
    let url = url_str.parse::<tauri::Url>().map_err(|e| e.to_string())?;

    let handle = app.clone();

    let data_dir = app
        .path()
        .app_data_dir()
        .ok()
        .map(|p| p.join("webview_data"));
    if let Some(ref dir) = data_dir {
        let _ = fs::create_dir_all(dir);
    }

    tauri::async_runtime::spawn(async move {
        use tauri::Emitter;

        // Destroy old login window if it exists
        if let Some(old_window) = handle.get_webview_window("nexus-login") {
            let _ = old_window.destroy();
        }

        let mut builder = tauri::WebviewWindowBuilder::new(
            &handle,
            "nexus-login",
            tauri::WebviewUrl::External(url)
        )
        .title("NexusMods 登录")
        .inner_size(960.0, 720.0)
        .min_inner_size(760.0, 560.0)
        .center()
        .visible(true);

        if let Some(dir) = data_dir {
            builder = builder.data_directory(dir);
        }

        let window = match builder.build() {
            Ok(w) => w,
            Err(e) => {
                println!("[NexusLogin] Failed to build login window: {:?}", e);
                return;
            }
        };

        // Start minimized — will unminimize when page is ready for user interaction
        let _ = window.minimize();

        let center_over_main = |win: &tauri::WebviewWindow, app_handle: &tauri::AppHandle| {
            if let Some(main_window) = app_handle.get_webview_window("main") {
                if let (Ok(main_pos), Ok(main_size), Ok(win_size)) = (
                    main_window.outer_position(),
                    main_window.inner_size(),
                    win.inner_size(),
                ) {
                    let x = main_pos.x + ((main_size.width as i32 - win_size.width as i32) / 2);
                    let y = main_pos.y + ((main_size.height as i32 - win_size.height as i32) / 2);
                    let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
                    return;
                }
            }
            let _ = win.center();
        };

        center_over_main(&window, &handle);

        let poll_window = window.clone();
        let poll_handle = handle.clone();
        tauri::async_runtime::spawn(async move {
            let timeout = std::time::Instant::now() + std::time::Duration::from_secs(300);
            let mut page_shown = false;

            let eval_js = |win: &tauri::WebviewWindow, js: &str| -> Option<String> {
                let (tx, rx) = std::sync::mpsc::channel::<String>();
                if win.eval_with_callback(js, move |result| { let _ = tx.send(result); }).is_err() {
                    return None;
                }
                rx.recv_timeout(std::time::Duration::from_secs(2)).ok()
            };

            loop {
                if std::time::Instant::now() > timeout {
                    println!("[NexusLogin] Timeout reached, destroying window");
                    let _ = poll_handle.emit("nexus-login-result", serde_json::json!({
                        "status": "timeout"
                    }));
                    let _ = poll_window.destroy();
                    return;
                }

                let snapshot_json = match eval_js(&poll_window, r##"
                    (() => {
                        try {
                            const href = location.href.toLowerCase();
                            const title = (document.title || "").toLowerCase();
                            const html = document.documentElement ? document.documentElement.outerHTML : "";
                            const lowerHtml = html.toLowerCase();
                            // Check if still on login page
                            const isLoginPage = href.includes("/users/login") || href.includes("/login");
                            // Check for Cloudflare challenge
                            const isChallenge =
                                title.includes("just a moment") ||
                                title.includes("checking your browser") ||
                                lowerHtml.includes("cf-turnstile") ||
                                lowerHtml.includes("challenges.cloudflare.com") ||
                                lowerHtml.includes("/cdn-cgi/challenge-platform/");
                            // Check if logged in: user is redirected away from login page,
                            // or we can see profile/avatar elements
                            const isLoggedIn =
                                !isLoginPage &&
                                !isChallenge &&
                                document.readyState === "complete" &&
                                (
                                    !!document.querySelector("[class*='user-avatar'], [class*='user-name'], .header-user, [class*='profile'], [data-user-id]") ||
                                    href.includes("/users/") ||
                                    href.includes("/account")
                                );
                            // Extract username if possible
                            let username = "";
                            const userEl = document.querySelector("[class*='user-name'], .header-user a, [class*='username']");
                            if (userEl) username = userEl.textContent.trim();
                            return {
                                readyState: document.readyState,
                                href: location.href,
                                isLoginPage,
                                isChallenge,
                                isLoggedIn,
                                username
                            };
                        } catch (error) {
                            return {
                                readyState: "error",
                                href: "",
                                isLoginPage: false,
                                isChallenge: false,
                                isLoggedIn: false,
                                username: "",
                                error: String(error)
                            };
                        }
                    })()
                "##) {
                    None => {
                        tokio::time::sleep(std::time::Duration::from_millis(800)).await;
                        continue;
                    }
                    Some(s) => s,
                };

                let snapshot: serde_json::Value = match serde_json::from_str(&snapshot_json) {
                    Ok(value) => value,
                    Err(_) => {
                        tokio::time::sleep(std::time::Duration::from_millis(800)).await;
                        continue;
                    }
                };

                let is_logged_in = snapshot
                    .get("isLoggedIn")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);

                let is_challenge = snapshot
                    .get("isChallenge")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);

                let is_login_page = snapshot
                    .get("isLoginPage")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);

                let ready_state = snapshot
                    .get("readyState")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();

                // Show window when login page is ready or CF challenge appears
                if !page_shown && ready_state == "complete" && (is_login_page || is_challenge) {
                    page_shown = true;
                    let _ = poll_window.unminimize();
                    let _ = poll_window.show();
                    let _ = poll_window.set_focus();
                }

                let username = snapshot
                    .get("username")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();

                if is_logged_in {
                    println!("[NexusLogin] Login successful, user: {}", username);
                    let _ = poll_handle.emit("nexus-login-result", serde_json::json!({
                        "status": "success",
                        "username": username
                    }));
                    let _ = poll_window.destroy();
                    return;
                }

                tokio::time::sleep(std::time::Duration::from_millis(800)).await;
            }
        });
    });

    Ok(())
}

#[tauri::command]
pub async fn check_nexus_login_status(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    use tauri::Manager;

    let data_dir = app
        .path()
        .app_data_dir()
        .ok()
        .map(|p| p.join("webview_data"));

    // If no webview_data dir exists, we're definitely not logged in
    if let Some(ref dir) = data_dir {
        if !dir.exists() {
            return Ok(serde_json::json!({ "loggedIn": false, "username": "" }));
        }
    } else {
        return Ok(serde_json::json!({ "loggedIn": false, "username": "" }));
    }

    let handle = app.clone();
    let url_str = "https://www.nexusmods.com".to_string();
    let url = url_str.parse::<tauri::Url>().map_err(|e| e.to_string())?;

    // Create a hidden window to check login status
    let mut builder = tauri::WebviewWindowBuilder::new(
        &handle,
        "nexus-login-check",
        tauri::WebviewUrl::External(url)
    )
    .title("Checking NexusMods login...")
    .inner_size(1.0, 1.0)
    .visible(false);

    if let Some(dir) = data_dir {
        builder = builder.data_directory(dir);
    }

    let window = builder.build().map_err(|e| format!("Failed to create check window: {}", e))?;

    let poll_window = window.clone();
    let result = tokio::time::timeout(std::time::Duration::from_secs(30), async move {
        let eval_js = |win: &tauri::WebviewWindow, js: &str| -> Option<String> {
            let (tx, rx) = std::sync::mpsc::channel::<String>();
            if win.eval_with_callback(js, move |result| { let _ = tx.send(result); }).is_err() {
                return None;
            }
            rx.recv_timeout(std::time::Duration::from_secs(3)).ok()
        };

        loop {
            let snapshot_json = match eval_js(&poll_window, r##"
                (() => {
                    try {
                        if (document.readyState !== "complete") return { ready: false };
                        const href = location.href.toLowerCase();
                        const lowerHtml = (document.documentElement ? document.documentElement.outerHTML : "").toLowerCase();
                        // Still on challenge page
                        if (lowerHtml.includes("cf-turnstile") || lowerHtml.includes("challenges.cloudflare.com") || lowerHtml.includes("/cdn-cgi/challenge-platform/")) {
                            return { ready: false };
                        }
                        let username = "";
                        const userEl = document.querySelector("[class*='user-name'], .header-user a, [class*='username'], a[href*='/users/']");
                        if (userEl) username = userEl.textContent.trim();
                        const hasLoginBtn = !!document.querySelector("a[href*='/users/login'], [class*='login-btn'], [class*='sign-in']");
                        const loggedIn = !hasLoginBtn && (username.length > 0 || !!document.querySelector("[class*='user-avatar'], [class*='profile']"));
                        return { ready: true, loggedIn, username };
                    } catch (e) {
                        return { ready: false };
                    }
                })()
            "##) {
                None => {
                    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                    continue;
                }
                Some(s) => s,
            };

            let snapshot: serde_json::Value = match serde_json::from_str(&snapshot_json) {
                Ok(v) => v,
                Err(_) => {
                    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                    continue;
                }
            };

            let ready = snapshot.get("ready").and_then(|v| v.as_bool()).unwrap_or(false);
            if ready {
                let logged_in = snapshot.get("loggedIn").and_then(|v| v.as_bool()).unwrap_or(false);
                let username = snapshot.get("username").and_then(|v| v.as_str()).unwrap_or_default().to_string();
                return serde_json::json!({ "loggedIn": logged_in, "username": username });
            }

            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }
    }).await;

    let _ = window.destroy();

    match result {
        Ok(val) => Ok(val),
        Err(_) => Ok(serde_json::json!({ "loggedIn": false, "username": "" })),
    }
}

#[tauri::command]
pub fn logout_nexus(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;

    let data_dir = app
        .path()
        .app_data_dir()
        .ok()
        .map(|p| p.join("webview_data"));

    if let Some(dir) = data_dir {
        if dir.exists() {
            fs::remove_dir_all(&dir).map_err(|e| format!("Failed to clear login data: {}", e))?;
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn open_scraper_window(app: tauri::AppHandle, mod_id: String) -> Result<(), String> {
    use tauri::Manager;

    let url_str = format!("https://www.nexusmods.com/stardewvalley/mods/{}", mod_id);
    let url = url_str.parse::<tauri::Url>().map_err(|e| e.to_string())?;

    let handle = app.clone();

    // Resolve persistent data directory for WebView cookie/localStorage persistence
    let data_dir = app
        .path()
        .app_data_dir()
        .ok()
        .map(|p| p.join("webview_data"));
    if let Some(ref dir) = data_dir {
        let _ = fs::create_dir_all(dir);
    }

    tauri::async_runtime::spawn(async move {
        use tauri::Emitter;

        // Destroy old scraper window if it exists
        if let Some(old_window) = handle.get_webview_window("nexus-scraper") {
            let _ = old_window.destroy();
        }

        let mut builder = tauri::WebviewWindowBuilder::new(
            &handle,
            "nexus-scraper",
            tauri::WebviewUrl::External(url)
        )
        .title("Nexus 验证中...")
        .inner_size(960.0, 720.0)
        .min_inner_size(760.0, 560.0)
        .center()
        .visible(true);

        // Set persistent data directory for cookie/localStorage support
        if let Some(dir) = data_dir {
            builder = builder.data_directory(dir);
        }

        let window = match builder.build() {
            Ok(w) => w,
            Err(e) => {
                println!("Failed to build scraper window: {:?}", e);
                return;
            }
        };

        // Start minimized — only show when CF challenge needs user interaction
        let _ = window.minimize();

        let center_over_main = |win: &tauri::WebviewWindow, app_handle: &tauri::AppHandle| {
            if let Some(main_window) = app_handle.get_webview_window("main") {
                if let (Ok(main_pos), Ok(main_size), Ok(win_size)) = (
                    main_window.outer_position(),
                    main_window.inner_size(),
                    win.inner_size(),
                ) {
                    let x = main_pos.x + ((main_size.width as i32 - win_size.width as i32) / 2);
                    let y = main_pos.y + ((main_size.height as i32 - win_size.height as i32) / 2);
                    let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
                    return;
                }
            }
            let _ = win.center();
        };

        center_over_main(&window, &handle);

        // Poll from Rust side via eval() — no need for __TAURI__ in the webview
        let poll_window = window.clone();
        let poll_handle = handle.clone();
        tauri::async_runtime::spawn(async move {
            let timeout = std::time::Instant::now() + std::time::Duration::from_secs(180);
            let mut cf_shown = false;
            let mut last_title = String::new();

            // Helper: eval JS and get result via channel
            let eval_js = |win: &tauri::WebviewWindow, js: &str| -> Option<String> {
                let (tx, rx) = std::sync::mpsc::channel::<String>();
                if win.eval_with_callback(js, move |result| { let _ = tx.send(result); }).is_err() {
                    return None;
                }
                rx.recv_timeout(std::time::Duration::from_secs(2)).ok()
            };

            loop {
                // Timeout: destroy window and notify frontend
                if std::time::Instant::now() > timeout {
                    println!("[Scraper] Timeout reached, destroying window");
                    let _ = poll_handle.emit("respond-nexus-html", serde_json::json!({
                        "error": "加载超时，请重试"
                    }));
                    let _ = poll_window.destroy();
                    return;
                }

                // Check page state directly. This is more reliable than depending on an injected
                // page script because Nexus/consent/challenge navigations can replace the document.
                let snapshot_json = match eval_js(&poll_window, r##"
                    (() => {
                        try {
                            const html = document.documentElement ? document.documentElement.outerHTML : "";
                            const text = document.body ? document.body.innerText : "";
                            const lowerHtml = html.toLowerCase();
                            const lowerTitle = (document.title || "").toLowerCase();
                            const lowerHref = location.href.toLowerCase();
                            const ogTitle = document.querySelector("meta[property='og:title']")?.getAttribute("content") || "";
                            const ogDescription = document.querySelector("meta[property='og:description']")?.getAttribute("content") || "";
                            const hasNexusDetailMarker =
                                !!document.querySelector("#description-content, #section-mod-description, .mod-description, .tab-description, #pagetitle h1, meta[property='og:title'], meta[property='og:description']");
                            const hasNexusPageMarker =
                                location.hostname.endsWith("nexusmods.com") &&
                                hasNexusDetailMarker &&
                                !lowerTitle.includes("just a moment") &&
                                !lowerTitle.includes("checking your browser") &&
                                !lowerTitle.includes("attention required") &&
                                (
                                    ogTitle.toLowerCase().includes("nexus") ||
                                    ogDescription.length > 0 ||
                                    !!document.querySelector("a[href*='/stardewvalley/mods/'], a[href*='/mods/']")
                                );
                            const hasChallengeMarker =
                                lowerTitle.includes("just a moment") ||
                                lowerTitle.includes("checking your browser") ||
                                lowerTitle.includes("attention required") ||
                                lowerHref.includes("captcha") ||
                                lowerHref.includes("challenge") ||
                                lowerHtml.includes("cf-turnstile") ||
                                lowerHtml.includes("challenges.cloudflare.com") ||
                                lowerHtml.includes("/cdn-cgi/challenge-platform/") ||
                                lowerHtml.includes("cf-challenge") ||
                                lowerHtml.includes("cloudflare ray id") ||
                                text.includes("Checking if the site connection is secure") ||
                                text.includes("Verify you are human");
                            const isChallenge = !hasNexusPageMarker && hasChallengeMarker;
                            return {
                                readyState: document.readyState,
                                title: document.title || "",
                                href: location.href,
                                isChallenge,
                                hasDetails: hasNexusPageMarker,
                                html
                            };
                        } catch (error) {
                            return {
                                readyState: "error",
                                title: "",
                                href: "",
                                isChallenge: false,
                                hasDetails: false,
                                html: "",
                                error: String(error)
                            };
                        }
                    })()
                "##) {
                    None => {
                        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                        continue;
                    }
                    Some(s) => s,
                };

                let snapshot: serde_json::Value = match serde_json::from_str(&snapshot_json) {
                    Ok(value) => value,
                    Err(_) => {
                        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                        continue;
                    }
                };

                // Show window if Cloudflare challenge is active
                let title = snapshot
                    .get("title")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                let href = snapshot
                    .get("href")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                let is_challenge = snapshot
                    .get("isChallenge")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false)
                    || title.contains("Just a moment")
                    || title.contains("Checking your browser")
                    || href.contains("captcha")
                    || href.contains("challenge");

                if is_challenge && !cf_shown {
                    cf_shown = true;
                    last_title = "Nexus 需要验证".to_string();
                    let _ = poll_window.set_title(&last_title);
                    center_over_main(&poll_window, &poll_handle);
                    let _ = poll_window.show();
                    let _ = poll_window.unminimize();
                    let _ = poll_window.set_focus();
                    let _ = poll_handle.emit("respond-nexus-html", serde_json::json!({
                        "status": "challenge"
                    }));
                }

                if !is_challenge && cf_shown && last_title == "Nexus 需要验证" {
                    last_title = "Nexus 页面加载中...".to_string();
                    let _ = poll_window.set_title(&last_title);
                    let _ = poll_handle.emit("respond-nexus-html", serde_json::json!({
                        "status": "loading"
                    }));
                }

                // HTML ready — retrieve and emit. Nexus fills parts of the page asynchronously,
                // so wait for detail markers instead of only DOMContentLoaded.
                let ready_state = snapshot
                    .get("readyState")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                let has_details = snapshot
                    .get("hasDetails")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let html = snapshot
                    .get("html")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();

                if !is_challenge && ready_state == "complete" && has_details {
                    let _ = poll_window.set_title("Nexus 信息已获取");
                    println!("[Scraper] Got HTML, length: {}", html.len());
                    let _ = poll_handle.emit("respond-nexus-html", serde_json::json!({
                        "html": html
                    }));
                    let _ = poll_window.destroy();
                    return;
                }

                if !is_challenge && last_title != "Nexus 页面加载中..." {
                    last_title = "Nexus 页面加载中...".to_string();
                    let _ = poll_window.set_title(&last_title);
                }

                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            }
        });
    });

    Ok(())
}
