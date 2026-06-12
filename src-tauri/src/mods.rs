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

// ==================== WebView Helpers ====================

fn create_nexus_webview(
    app: &tauri::AppHandle,
    label: &str,
    title: &str,
    url: tauri::Url,
    always_visible: bool,
) -> Result<tauri::WebviewWindow, String> {
    use tauri::Manager;

    // Destroy old window with same label if it exists
    if let Some(old_window) = app.get_webview_window(label) {
        let _ = old_window.destroy();
    }

    let data_dir = app
        .path()
        .app_data_dir()
        .ok()
        .map(|p| p.join("webview_data"));
    if let Some(ref dir) = data_dir {
        let _ = fs::create_dir_all(dir);
    }

    let is_dev = cfg!(debug_assertions);
    let initially_visible = is_dev || always_visible;

    let mut builder = tauri::WebviewWindowBuilder::new(
        app,
        label,
        tauri::WebviewUrl::External(url)
    )
    .title(title)
    .inner_size(960.0, 720.0)
    .min_inner_size(760.0, 560.0)
    .visible(initially_visible);

    if let Some(dir) = data_dir {
        builder = builder.data_directory(dir);
    }

    let window = builder.build().map_err(|e| format!("Failed to build WebView window ({}): {:?}", label, e))?;

    if !initially_visible {
        let _ = window.minimize();
    }

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

    center_over_main(&window, app);

    Ok(window)
}

fn eval_js_timeout(win: &tauri::WebviewWindow, js: &str, timeout_secs: u64) -> Option<String> {
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    if win.eval_with_callback(js, move |result| { let _ = tx.send(result); }).is_err() {
        return None;
    }
    rx.recv_timeout(std::time::Duration::from_secs(timeout_secs)).ok()
}

fn check_cloudflare_challenge(win: &tauri::WebviewWindow) -> bool {
    let cf_check_js = r##"
        (() => {
            try {
                const t = (document.title||'').toLowerCase();
                const h = location.href.toLowerCase();
                const html = document.documentElement ? document.documentElement.outerHTML : '';
                const x = document.body ? document.body.innerText : '';
                const cf = t.includes('just a moment') || 
                           t.includes('checking your browser') || 
                           t.includes('attention required') || 
                           h.includes('captcha') || 
                           h.includes('challenge') || 
                           html.includes('cf-turnstile') || 
                           html.includes('challenges.cloudflare.com') || 
                           html.includes('/cdn-cgi/challenge-platform/') || 
                           x.includes('checking if the site connection is secure') || 
                           x.includes('verify you are human');
                return cf;
            } catch(e) { return false; }
        })()
    "##;
    eval_js_timeout(win, cf_check_js, 2)
        .and_then(|res| res.parse::<bool>().ok())
        .unwrap_or(false)
}

fn update_window_visibility_for_cf(
    win: &tauri::WebviewWindow,
    app: &tauri::AppHandle,
    is_cf: bool,
    cf_shown: &mut bool,
    always_visible: bool,
    title_on_cf: &str,
    title_on_clear: &str,
) {
    use tauri::Manager;
    let is_dev = cfg!(debug_assertions);
    if is_cf {
        if !*cf_shown {
            *cf_shown = true;
            let _ = win.set_title(title_on_cf);
            
            let center_over_main = |w: &tauri::WebviewWindow, app_handle: &tauri::AppHandle| {
                if let Some(main_window) = app_handle.get_webview_window("main") {
                    if let (Ok(main_pos), Ok(main_size), Ok(win_size)) = (
                        main_window.outer_position(),
                        main_window.inner_size(),
                        w.inner_size(),
                    ) {
                        let x = main_pos.x + ((main_size.width as i32 - win_size.width as i32) / 2);
                        let y = main_pos.y + ((main_size.height as i32 - win_size.height as i32) / 2);
                        let _ = w.set_position(tauri::PhysicalPosition::new(x, y));
                        return;
                    }
                }
                let _ = w.center();
            };
            center_over_main(win, app);
            let _ = win.show();
            let _ = win.unminimize();
            let _ = win.set_focus();
        }
    } else {
        if *cf_shown {
            *cf_shown = false;
            let _ = win.set_title(title_on_clear);
            if !is_dev && !always_visible {
                let _ = win.hide();
            }
        }
    }
}

#[tauri::command]
pub async fn open_nexus_ranking_scraper(app: tauri::AppHandle) -> Result<(), String> {
    // Lightweight page just to pass Cloudflare and obtain session cookies
    let url_str = "https://www.nexusmods.com/robots.txt".to_string();
    let url = url_str.parse::<tauri::Url>().map_err(|e| e.to_string())?;

    let handle = app.clone();

    tauri::async_runtime::spawn(async move {
        use tauri::Emitter;

        let window = match create_nexus_webview(&handle, "nexus-ranking-scraper", "Nexus 排行榜加载中...", url, false) {
            Ok(w) => w,
            Err(e) => {
                println!("[RankingScraper] Failed to build ranking scraper window: {:?}", e);
                return;
            }
        };

        let poll_window = window.clone();
        let poll_handle = handle.clone();

        tauri::async_runtime::spawn(async move {
            let timeout = std::time::Instant::now() + std::time::Duration::from_secs(180);
            let mut cf_shown = false;
            let mut graphql_requested = false;

            let eval_js = |win: &tauri::WebviewWindow, js: &str| -> Option<String> {
                eval_js_timeout(win, js, 10)
            };

            // JS #1: fire the GraphQL fetch, store result in window variable
            let mut graphql_fire_js = r##"
                (() => {
                    try {
                        if (window.__nexusGraphQLDone || window.__nexusGraphQLFetching) return 'skip';
                        window.__nexusGraphQLFetching = true;
                        fetch('https://api-router.nexusmods.com/graphql', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'X-GraphQL-OperationName': 'ModsListing' },
                            body: JSON.stringify({
                                query: `
                                    query ModsListing($count: Int = 0, $facets: ModsFacet, $filter: ModsFilter, $offset: Int, $postFilter: ModsFilter, $sort: [ModsSort!]) {
                                      mods(count: $count, facets: $facets, filter: $filter, offset: $offset, postFilter: $postFilter, sort: $sort, viewUserBlockedContent: false) {
                                        facetsData
                                        nodes { ...ModTileFragment }
                                        totalCount
                                      }
                                    }
                                    fragment ModTileFragment on Mod {
                                      adultContent createdAt downloads endorsements fileSize
                                      game { domainName id name }
                                      modCategory { categoryId name }
                                      modId name status summary
                                      thumbnailUrl thumbnailBlurredUrl uid updatedAt
                                      uploader { avatar memberId name }
                                      viewerDownloaded viewerEndorsed viewerTracked viewerUpdateAvailable viewerIsBlocked
                                    }
                                `,
                                variables: {
                                    count: 20,
                                    facets: { categoryName: [], languageName: [], tag: [] },
                                    filter: { adultContent: [{ op: "EQUALS", value: false }], filter: [], gameDomainName: [{ op: "EQUALS", value: "stardewvalley" }], name: [] },
                                    offset: 0,
                                    postFilter: {},
                                    sort: { downloads: { direction: "DESC" } }
                                },
                                operationName: 'ModsListing'
                            }),
                            credentials: 'include'
                        }).then(r => r.json()).then(json => {
                            window.__nexusGraphQLData = JSON.stringify(json);
                            window.__nexusGraphQLDone = true;
                            //PLACEHOLDER_DEV_ALERT
                        }).catch(e => {
                            window.__nexusGraphQLError = String(e);
                        });
                        return 'started';
                    } catch(e) { return 'error:' + String(e); }
                })()
            "##.to_string();

            if cfg!(debug_assertions) {
                graphql_fire_js = graphql_fire_js.replace(
                    "//PLACEHOLDER_DEV_ALERT",
                    "alert('GraphQL Response:\\n' + JSON.stringify(json, null, 2));"
                );
            }

            // JS #2: check status (tiny return)
            let graphql_status_js = r##"
                (() => {
                    if (window.__nexusGraphQLDone) return {s:"done"};
                    if (window.__nexusGraphQLError) return {s:"error",e:window.__nexusGraphQLError};
                    if (window.__nexusGraphQLFetching) return {s:"fetching"};
                    return {s:"idle"};
                })()
            "##;

            // JS #3: retrieve the data (called only once when status=done)
            let graphql_retrieve_js = r##"
                (() => { try { return JSON.parse(window.__nexusGraphQLData) || null; } catch(e) { return null; } })()
            "##;

            loop {
                // Timeout check
                if std::time::Instant::now() > timeout {
                    let _ = poll_handle.emit("respond-nexus-ranking-html", serde_json::json!({ "error": "加载超时，请重试" }));
                    let _ = poll_window.destroy();
                    return;
                }

                // If GraphQL was requested, poll for its completion via lightweight status check
                if graphql_requested {
                    let status_res = eval_js(&poll_window, graphql_status_js);
                    if cfg!(debug_assertions) {
                        println!("[RankingScraper] GraphQL status raw result: {:?}", status_res);
                    }
                    if let Some(status_str) = status_res {
                        if let Ok(status) = serde_json::from_str::<serde_json::Value>(&status_str) {
                            let s = status.get("s").and_then(|v| v.as_str()).unwrap_or_default();
                            match s {
                                "done" => {
                                    // Retrieve the actual data
                                    if let Some(data_str) = eval_js(&poll_window, graphql_retrieve_js) {
                                        if let Ok(data) = serde_json::from_str::<serde_json::Value>(&data_str) {
                                            let _ = poll_window.set_title("Nexus 排行榜已获取");
                                            println!("[RankingScraper] GraphQL data retrieved!");
                                            let _ = poll_handle.emit("respond-nexus-ranking-html", serde_json::json!({ "mods": data }));
                                        } else {
                                            let _ = poll_handle.emit("respond-nexus-ranking-html", serde_json::json!({ "error": "GraphQL 数据解析失败" }));
                                        }
                                    } else {
                                        let _ = poll_handle.emit("respond-nexus-ranking-html", serde_json::json!({ "error": "无法从 WebView 获取数据" }));
                                    }
                                    let _ = poll_window.destroy();
                                    return;
                                }
                                "error" => {
                                    let err = status.get("e").and_then(|v| v.as_str()).unwrap_or("unknown");
                                    println!("[RankingScraper] GraphQL error: {}", err);
                                    let _ = poll_handle.emit("respond-nexus-ranking-html", serde_json::json!({ "error": format!("GraphQL 请求失败: {}", err) }));
                                    let _ = poll_window.destroy();
                                    return;
                                }
                                _ => {} // still fetching, continue loop
                            }
                        }
                    }
                    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                    continue;
                }

                // CF challenge detection via unified helper
                let is_cf = check_cloudflare_challenge(&poll_window);
                if is_cf && !cf_shown {
                    let _ = poll_handle.emit("respond-nexus-ranking-html", serde_json::json!({ "status": "challenge" }));
                }
                if !is_cf && cf_shown {
                    let _ = poll_handle.emit("respond-nexus-ranking-html", serde_json::json!({ "status": "loading" }));
                }
                update_window_visibility_for_cf(
                    &poll_window,
                    &poll_handle,
                    is_cf,
                    &mut cf_shown,
                    false,
                    "Nexus 需要验证",
                    "Nexus 排行榜加载中...",
                );

                // Page ready & no challenge → fire GraphQL fetch
                if !is_cf {
                    graphql_requested = true;
                    println!("[RankingScraper] Page ready, firing GraphQL request...");
                    let res = eval_js(&poll_window, &graphql_fire_js);
                    println!("[RankingScraper] graphql_fire_js eval result: {:?}", res);
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
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
    let url_str = "https://users.nexusmods.com/auth/sign_in".to_string();
    let url = url_str.parse::<tauri::Url>().map_err(|e| e.to_string())?;

    let handle = app.clone();

    tauri::async_runtime::spawn(async move {
        use tauri::Emitter;

        let window = match create_nexus_webview(&handle, "nexus-login", "NexusMods 登录", url, true) {
            Ok(w) => w,
            Err(e) => {
                println!("[NexusLogin] Failed to build login window: {:?}", e);
                return;
            }
        };

        let poll_window = window.clone();
        let poll_handle = handle.clone();
        tauri::async_runtime::spawn(async move {
            let timeout = std::time::Instant::now() + std::time::Duration::from_secs(300);
            let mut cf_shown = false;

            let eval_js = |win: &tauri::WebviewWindow, js: &str| -> Option<String> {
                eval_js_timeout(win, js, 2)
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

                // Check Cloudflare first
                let is_cf = check_cloudflare_challenge(&poll_window);
                update_window_visibility_for_cf(
                    &poll_window,
                    &poll_handle,
                    is_cf,
                    &mut cf_shown,
                    true,
                    "Nexus 需要验证",
                    "NexusMods 登录",
                );

                let snapshot_json = match eval_js(&poll_window, r##"
                    (() => {
                        try {
                            const href = location.href.toLowerCase();
                            const title = (document.title || "").toLowerCase();
                            const html = document.documentElement ? document.documentElement.outerHTML : "";
                            const lowerHtml = html.toLowerCase();
                            // Check if still on login page
                            const isLoginPage = href.includes("/auth/sign_in") || href.includes("/users/login") || href.includes("/login");
                            // Check for Cloudflare challenge
                            const isChallenge =
                                title.includes("just a moment") ||
                                title.includes("checking your browser") ||
                                lowerHtml.includes("cf-turnstile") ||
                                lowerHtml.includes("challenges.cloudflare.com") ||
                                lowerHtml.includes("/cdn-cgi/challenge-platform/");
                            // Check if logged in: user is redirected away from login page,
                            // or we can see profile/avatar elements
                            const hasLoginBtn = !!document.querySelector("a[href*='/users/login'], a[href*='/auth/sign_in'], [class*='login-btn'], [class*='sign-in']");
                            const hasSignOutBtn = !!document.querySelector("a[href*='sign_out'], a[href*='logout'], a[href*='sign-out']");
                            const hasUserElements = !!document.querySelector("[class*='user-avatar'], [class*='user-name'], .header-user, [class*='profile'], [data-user-id], #user-avatar, .member-avatar, .member-name");
                            const isLoggedIn =
                                !isLoginPage &&
                                !isChallenge &&
                                (document.readyState === "complete" || document.readyState === "interactive") &&
                                (
                                    hasSignOutBtn ||
                                    hasUserElements ||
                                    (!hasLoginBtn && (href.includes("/users/") || href.includes("/account") || href === "https://www.nexusmods.com/" || href === "https://www.nexusmods.com"))
                                );
                            // Extract username if possible
                            let username = "";
                            const welcomeEl = document.querySelector("h1");
                            if (welcomeEl && welcomeEl.textContent.includes("Welcome back")) {
                                username = welcomeEl.textContent.replace("Welcome back", "").trim();
                            }
                            if (!username) {
                                const userEl = document.querySelector("[class*='user-name'], .header-user a, [class*='username'], .member-name");
                                if (userEl) {
                                    username = userEl.textContent.trim();
                                }
                            }
                            if (!username) {
                                const profileLinks = document.querySelectorAll("a[href*='/users/']");
                                for (const link of profileLinks) {
                                    const linkHref = link.getAttribute("href") || "";
                                    if (!linkHref.includes("myaccount") && !linkHref.includes("login") && !linkHref.includes("sign_out")) {
                                        const txt = link.textContent.trim();
                                        if (txt && !txt.includes("Manage") && !txt.includes("Review")) {
                                            username = txt;
                                            break;
                                        }
                                    }
                                }
                            }
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
    let url_str = "https://users.nexusmods.com/account/security".to_string();
    let url = url_str.parse::<tauri::Url>().map_err(|e| e.to_string())?;

    // Create a hidden window using helper
    let window = create_nexus_webview(&handle, "nexus-login-check", "Checking NexusMods login...", url, false)?;

    let poll_window = window.clone();
    let poll_handle = handle.clone();
    let result = tokio::time::timeout(std::time::Duration::from_secs(30), async move {
        let eval_js = |win: &tauri::WebviewWindow, js: &str| -> Option<String> {
            eval_js_timeout(win, js, 3)
        };

        let mut cf_shown = false;

        loop {
            // Check Cloudflare challenge
            let is_cf = check_cloudflare_challenge(&poll_window);
            update_window_visibility_for_cf(
                &poll_window,
                &poll_handle,
                is_cf,
                &mut cf_shown,
                false,
                "Nexus 需要验证",
                "Checking NexusMods login...",
            );

            let snapshot_json = match eval_js(&poll_window, r##"
                (() => {
                    try {
                        if (document.readyState !== "complete" && document.readyState !== "interactive") return { ready: false };
                        const href = location.href.toLowerCase();
                        const html = document.documentElement ? document.documentElement.outerHTML : "";
                        const lowerHtml = html.toLowerCase();
                        
                        // Still on challenge page
                        if (lowerHtml.includes("cf-turnstile") || lowerHtml.includes("challenges.cloudflare.com") || lowerHtml.includes("/cdn-cgi/challenge-platform/")) {
                            return { ready: false };
                        }
                        
                        const bodyText = document.body ? document.body.innerText : "";
                        const hasWelcome = bodyText.toLowerCase().includes("welcome back");
                        const hasLogIn = bodyText.toLowerCase().includes("log in to nexus mods") || href.includes("/auth/sign_in") || href.includes("/login");
                        
                        if (hasWelcome) {
                            let username = "";
                            // Try to match "Welcome back, {username}" or "Welcome back {username}"
                            const match = bodyText.match(/Welcome back[\s,]+([^\n\r!]+)/i);
                            if (match) {
                                username = match[1].trim();
                            }
                            if (!username) {
                                const welcomeEl = document.querySelector("h1");
                                if (welcomeEl && welcomeEl.textContent.includes("Welcome back")) {
                                    username = welcomeEl.textContent.replace(/Welcome back\s*,?\s*/i, "").trim();
                                }
                            }
                            if (!username) {
                                const userEl = document.querySelector("[class*='user-name'], .header-user a, [class*='username'], .member-name");
                                if (userEl) {
                                    username = userEl.textContent.trim();
                                }
                            }
                            return { ready: true, loggedIn: true, username };
                        }
                        
                        if (hasLogIn) {
                            return { ready: true, loggedIn: false, username: "" };
                        }
                        
                        if (document.readyState === "complete") {
                            // If we are fully loaded but neither welcome nor log in matched, check for sign out button
                            const hasSignOutBtn = !!document.querySelector("a[href*='sign_out'], a[href*='logout'], a[href*='sign-out']");
                            if (hasSignOutBtn) {
                                let username = "";
                                const userEl = document.querySelector("[class*='user-name'], .header-user a, [class*='username'], .member-name");
                                if (userEl) {
                                    username = userEl.textContent.trim();
                                }
                                return { ready: true, loggedIn: true, username };
                            }
                            return { ready: true, loggedIn: false, username: "" };
                        }
                        
                        return { ready: false };
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
pub async fn fetch_nexus_api_key(app: tauri::AppHandle, force: Option<bool>) -> Result<serde_json::Value, String> {
    use tauri::Manager;

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data: {}", e))?
        .join("webview_data");

    if !data_dir.exists() {
        return Ok(serde_json::json!({ "apiKey": "", "error": "Not logged in" }));
    }

    // Check if we already have a cached API key
    let api_key_path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data: {}", e))?
        .join("nexus_api_key.txt");

    if force.unwrap_or(false) {
        if api_key_path.exists() {
            let _ = fs::remove_file(&api_key_path);
        }
    } else if api_key_path.exists() {
        if let Ok(cached_key) = fs::read_to_string(&api_key_path) {
            let trimmed = cached_key.trim().to_string();
            if trimmed.len() > 10 {
                println!("[NexusApiKey] Using cached API key");
                return Ok(serde_json::json!({ "apiKey": trimmed }));
            }
        }
    }

    let handle = app.clone();
    let url_str = "https://www.nexusmods.com/robots.txt".to_string();
    let url = url_str.parse::<tauri::Url>().map_err(|e| e.to_string())?;

    // Create a hidden window using helper
    let window = create_nexus_webview(&handle, "nexus-apikey-fetch", "获取 API Key中...", url, false)?;

    let poll_window = window.clone();
    let poll_handle = handle.clone();
    let api_key_path_clone = api_key_path.clone();

    let result = tokio::time::timeout(std::time::Duration::from_secs(60), async move {
        let eval_js = |win: &tauri::WebviewWindow, js: &str| -> Option<String> {
            eval_js_timeout(win, js, 3)
        };

        let mut cf_shown = false;
        let mut graphql_requested = false;

        let graphql_fire_js = r##"
            (() => {
                try {
                    if (window.__nexusGraphQLDone || window.__nexusGraphQLFetching) return 'skip';
                    window.__nexusGraphQLFetching = true;
                    fetch('https://api-router.nexusmods.com/graphql', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-GraphQL-OperationName': 'PersonalApiKey'
                        },
                        body: JSON.stringify({
                            query: `
                                query PersonalApiKey {
                                  personalApiKey {
                                    applicationId
                                    id
                                    key
                                    userId
                                  }
                                }
                            `,
                            operationName: 'PersonalApiKey'
                        }),
                        credentials: 'include'
                    }).then(r => r.json()).then(json => {
                        window.__nexusGraphQLData = JSON.stringify(json);
                        window.__nexusGraphQLDone = true;
                    }).catch(e => {
                        window.__nexusGraphQLError = String(e);
                    });
                    return 'started';
                } catch(e) { return 'error:' + String(e); }
            })()
        "##;

        let graphql_status_js = r##"
            (() => {
                if (window.__nexusGraphQLDone) return {s:"done"};
                if (window.__nexusGraphQLError) return {s:"error",e:window.__nexusGraphQLError};
                if (window.__nexusGraphQLFetching) return {s:"fetching"};
                return {s:"idle"};
            })()
        "##;

        let graphql_retrieve_js = r##"
            (() => { try { return JSON.parse(window.__nexusGraphQLData) || null; } catch(e) { return null; } })()
        "##;

        loop {
            // If GraphQL was requested, poll for its completion
            if graphql_requested {
                if let Some(status_res) = eval_js(&poll_window, graphql_status_js) {
                    if let Ok(status) = serde_json::from_str::<serde_json::Value>(&status_res) {
                        let s = status.get("s").and_then(|v| v.as_str()).unwrap_or_default();
                        match s {
                            "done" => {
                                if let Some(data_str) = eval_js(&poll_window, graphql_retrieve_js) {
                                    if let Ok(data) = serde_json::from_str::<serde_json::Value>(&data_str) {
                                        if let Some(key) = data.get("data")
                                            .and_then(|d| d.get("personalApiKey"))
                                            .and_then(|p| p.get("key"))
                                            .and_then(|k| k.as_str())
                                        {
                                            let key_str = key.trim().to_string();
                                            if !key_str.is_empty() {
                                                return serde_json::json!({ "apiKey": key_str });
                                            }
                                        }
                                        return serde_json::json!({ "apiKey": "", "error": "GraphQL 返回的数据中没有找到 API Key" });
                                    } else {
                                        return serde_json::json!({ "apiKey": "", "error": "GraphQL 数据解析失败" });
                                    }
                                } else {
                                    return serde_json::json!({ "apiKey": "", "error": "无法获取 GraphQL 返回数据" });
                                }
                            }
                            "error" => {
                                let err = status.get("e").and_then(|v| v.as_str()).unwrap_or("unknown");
                                return serde_json::json!({ "apiKey": "", "error": format!("GraphQL 请求失败: {}", err) });
                            }
                            _ => {} // still fetching
                        }
                    }
                }
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                continue;
            }

            // Detect Cloudflare
            let is_cf = check_cloudflare_challenge(&poll_window);
            update_window_visibility_for_cf(
                &poll_window,
                &poll_handle,
                is_cf,
                &mut cf_shown,
                false,
                "Nexus 需要验证",
                "获取 API Key中...",
            );

            if !is_cf {
                graphql_requested = true;
                let _ = eval_js(&poll_window, graphql_fire_js);
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            }

            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }
    }).await;

    let _ = window.destroy();

    match result {
        Ok(val) => {
            let api_key = val.get("apiKey").and_then(|v| v.as_str()).unwrap_or_default().to_string();
            if !api_key.is_empty() {
                let _ = fs::write(&api_key_path_clone, &api_key);
            }
            Ok(val)
        }
        Err(_) => Ok(serde_json::json!({ "apiKey": "", "error": "获取 API Key 超时" })),
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

    // Also clear cached API key file
    if let Some(app_data) = app.path().app_data_dir().ok() {
        let api_key_path = app_data.join("nexus_api_key.txt");
        if api_key_path.exists() {
            let _ = fs::remove_file(&api_key_path);
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn open_scraper_window(app: tauri::AppHandle, mod_id: String) -> Result<(), String> {
    let url_str = format!("https://www.nexusmods.com/stardewvalley/mods/{}", mod_id);
    let url = url_str.parse::<tauri::Url>().map_err(|e| e.to_string())?;

    let handle = app.clone();

    tauri::async_runtime::spawn(async move {
        use tauri::Emitter;

        let window = match create_nexus_webview(&handle, "nexus-scraper", "Nexus 验证中...", url, false) {
            Ok(w) => w,
            Err(e) => {
                println!("Failed to build scraper window: {:?}", e);
                return;
            }
        };

        let poll_window = window.clone();
        let poll_handle = handle.clone();
        tauri::async_runtime::spawn(async move {
            let timeout = std::time::Instant::now() + std::time::Duration::from_secs(180);
            let mut cf_shown = false;
            let mut last_title = String::new();

            let eval_js = |win: &tauri::WebviewWindow, js: &str| -> Option<String> {
                eval_js_timeout(win, js, 2)
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

                // Check Cloudflare challenge
                let is_challenge = check_cloudflare_challenge(&poll_window);
                if is_challenge && !cf_shown {
                    let _ = poll_handle.emit("respond-nexus-html", serde_json::json!({
                        "status": "challenge"
                    }));
                }
                if !is_challenge && cf_shown && last_title == "Nexus 需要验证" {
                    let _ = poll_handle.emit("respond-nexus-html", serde_json::json!({
                        "status": "loading"
                    }));
                }

                update_window_visibility_for_cf(
                    &poll_window,
                    &poll_handle,
                    is_challenge,
                    &mut cf_shown,
                    false,
                    "Nexus 需要验证",
                    "Nexus 页面加载中...",
                );

                if is_challenge {
                    last_title = "Nexus 需要验证".to_string();
                } else if last_title != "Nexus 页面加载中..." {
                    last_title = "Nexus 页面加载中...".to_string();
                }

                // Check page state directly. This is more reliable than depending on an injected
                // page script because Nexus/consent/challenge navigations can replace the document.
                let snapshot_json = match eval_js(&poll_window, r##"
                    (() => {
                        try {
                            const html = document.documentElement ? document.documentElement.outerHTML : "";
                            const ogTitle = document.querySelector("meta[property='og:title']")?.getAttribute("content") || "";
                            const ogDescription = document.querySelector("meta[property='og:description']")?.getAttribute("content") || "";
                            const hasNexusDetailMarker =
                                !!document.querySelector("#description-content, #section-mod-description, .mod-description, .tab-description, #pagetitle h1, meta[property='og:title'], meta[property='og:description']");
                            const hasNexusPageMarker =
                                location.hostname.endsWith("nexusmods.com") &&
                                hasNexusDetailMarker &&
                                !document.title.toLowerCase().includes("just a moment") &&
                                !document.title.toLowerCase().includes("checking your browser") &&
                                !document.title.toLowerCase().includes("attention required") &&
                                (
                                    ogTitle.toLowerCase().includes("nexus") ||
                                    ogDescription.length > 0 ||
                                    !!document.querySelector("a[href*='/stardewvalley/mods/'], a[href*='/mods/']")
                                );
                            return {
                                readyState: document.readyState,
                                hasDetails: hasNexusPageMarker,
                                html
                            };
                        } catch (error) {
                            return {
                                readyState: "error",
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

                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            }
        });
    });

    Ok(())
}
