use log::{debug, error, info, warn};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Manager;

struct LoginStatusCache {
    result: serde_json::Value,
    timestamp: std::time::Instant,
}

static LOGIN_STATUS_CACHE: std::sync::OnceLock<std::sync::Mutex<Option<LoginStatusCache>>> =
    std::sync::OnceLock::new();
static LOGIN_IN_PROGRESS: std::sync::OnceLock<tokio::sync::Mutex<()>> = std::sync::OnceLock::new();
static API_KEY_IN_PROGRESS: std::sync::OnceLock<tokio::sync::Mutex<()>> =
    std::sync::OnceLock::new();
static RANKING_COUNTER: std::sync::OnceLock<std::sync::atomic::AtomicU64> =
    std::sync::OnceLock::new();
static DOWNLOAD_COUNTER: std::sync::OnceLock<std::sync::atomic::AtomicU64> =
    std::sync::OnceLock::new();

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NexusDownloadMetadata {
    mod_name: String,
    author: String,
}

fn create_nexus_webview(
    app: &tauri::AppHandle,
    label: &str,
    title: &str,
    url: tauri::Url,
    always_visible: bool,
) -> Result<tauri::WebviewWindow, String> {
    use tauri::Manager;

    // Destroy old window with same label if it exists, then wait briefly
    // so the label is fully released before we rebuild.
    if let Some(old_window) = app.get_webview_window(label) {
        let _ = old_window.destroy();
        std::thread::sleep(std::time::Duration::from_millis(150));
    }
    // Double-check: if a stale handle still lingers, try once more.
    if let Some(old_window) = app.get_webview_window(label) {
        let _ = old_window.destroy();
        std::thread::sleep(std::time::Duration::from_millis(150));
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

    let mut builder =
        tauri::WebviewWindowBuilder::new(app, label, tauri::WebviewUrl::External(url))
            .title(title)
            .inner_size(960.0, 720.0)
            .min_inner_size(760.0, 560.0)
            .visible(initially_visible);

    if let Some(dir) = data_dir {
        builder = builder.data_directory(dir);
    }

    let window = builder
        .build()
        .map_err(|e| format!("Failed to build WebView window ({}): {:?}", label, e))?;

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
    if let Err(e) = win.eval_with_callback(js, move |result| {
        let _ = tx.send(result);
    }) {
        warn!(
            "[eval_js_timeout] ({}) eval_with_callback error: {:?}",
            win.label(),
            e
        );
        return None;
    }
    match rx.recv_timeout(std::time::Duration::from_secs(timeout_secs)) {
        Ok(res) => Some(res),
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
            warn!(
                "[eval_js_timeout] ({}) JS evaluation timed out after {} seconds",
                win.label(),
                timeout_secs
            );
            None
        }
        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
            // Channel disconnected, usually because the window was closed/destroyed.
            // No need to spam error logs for this normal shutdown scenario.
            None
        }
    }
}

fn check_cloudflare_challenge(win: &tauri::WebviewWindow) -> bool {
    let cf_check_js = r##"
        (() => {
            try {
                const t = (document.title||'').toLowerCase();
                const h = location.href.toLowerCase();
                const html = document.documentElement ? document.documentElement.outerHTML : '';
                const x = document.body ? document.body.innerText : '';
                const hasNormalContent = !!document.querySelector("a[href*='/users/login'], a[href*='/auth/sign_in'], [class*='login-btn'], [class*='sign-in'], a[href*='sign_out'], a[href*='logout'], a[href*='sign-out'], #section-mod-description, #pagetitle, .header-user, .logo, .nav-item");
                const cf = t.includes('just a moment') || 
                           t.includes('checking your browser') || 
                           t.includes('attention required') || 
                           h.includes('captcha') || 
                           h.includes('challenge') || 
                           x.includes('checking if the site connection is secure') || 
                           x.includes('verify you are human') ||
                           (!hasNormalContent && (
                               html.includes('cf-turnstile') || 
                               html.includes('challenges.cloudflare.com') || 
                               html.includes('/cdn-cgi/challenge-platform/')
                           ));
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
                        let y =
                            main_pos.y + ((main_size.height as i32 - win_size.height as i32) / 2);
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
pub async fn open_nexus_ranking_scraper(
    app: tauri::AppHandle,
    offset: i32,
    sort_field: String,
    sort_direction: String,
    search_query: String,
    name_filter: Option<String>,
    author_filter: Option<String>,
    uploader_filter: Option<String>,
) -> Result<(), String> {
    // Generate a unique label so multiple ranking scrapers can run concurrently
    let counter = RANKING_COUNTER.get_or_init(|| std::sync::atomic::AtomicU64::new(0));
    let id = counter.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let window_label = format!("nexus-ranking-scraper-{}", id);

    // Lightweight page just to pass Cloudflare and obtain session cookies
    let url_str = "https://www.nexusmods.com/robots.txt".to_string();
    let url = url_str.parse::<tauri::Url>().map_err(|e| e.to_string())?;

    let handle = app.clone();

    tauri::async_runtime::spawn(async move {
        use tauri::Emitter;

        let window =
            match create_nexus_webview(&handle, &window_label, "Nexus 模组加载中...", url, false)
            {
                Ok(w) => w,
                Err(e) => {
                    println!(
                        "[RankingScraper] Failed to build ranking scraper window: {:?}",
                        e
                    );
                    return;
                }
            };

        let poll_window = window.clone();
        let poll_handle = handle.clone();

        tauri::async_runtime::spawn(async move {
            let timeout = std::time::Instant::now() + std::time::Duration::from_secs(180);
            let mut cf_shown = false;
            let mut graphql_requested = false;

            let search_val = name_filter.as_deref().unwrap_or(&search_query);
            let author_val = author_filter.as_deref().unwrap_or("");
            let uploader_val = uploader_filter.as_deref().unwrap_or("");

            let emit_event = |payload: serde_json::Value| {
                let mut full_payload = payload;
                if let Some(obj) = full_payload.as_object_mut() {
                    obj.insert("offset".to_string(), serde_json::json!(offset));
                    obj.insert("sort_field".to_string(), serde_json::json!(sort_field));
                    obj.insert(
                        "sort_direction".to_string(),
                        serde_json::json!(sort_direction),
                    );
                    obj.insert("search_query".to_string(), serde_json::json!(search_val));
                    obj.insert("name_filter".to_string(), serde_json::json!(search_val));
                    obj.insert("author_filter".to_string(), serde_json::json!(author_val));
                    obj.insert(
                        "uploader_filter".to_string(),
                        serde_json::json!(uploader_val),
                    );
                }
                let _ = poll_handle.emit("respond-nexus-ranking-html", full_payload);
            };

            let eval_js = |win: &tauri::WebviewWindow, js: &str| -> Option<String> {
                eval_js_timeout(win, js, 10)
            };

            // Build GraphQL filter based on search parameters
            let mut filter_map = serde_json::Map::new();
            filter_map.insert("filter".to_string(), serde_json::json!([]));
            filter_map.insert(
                "gameDomainName".to_string(),
                serde_json::json!([{"op": "EQUALS", "value": "stardewvalley"}]),
            );
            if !search_val.is_empty() {
                filter_map.insert(
                    "name".to_string(),
                    serde_json::json!([{"op": "WILDCARD", "value": search_val}]),
                );
            }
            if !author_val.is_empty() {
                filter_map.insert(
                    "author".to_string(),
                    serde_json::json!([{"op": "WILDCARD", "value": author_val}]),
                );
            }
            if !uploader_val.is_empty() {
                filter_map.insert(
                    "uploader".to_string(),
                    serde_json::json!([{"op": "WILDCARD", "value": uploader_val}]),
                );
            }

            // Build sort as array (NexusMods API expects [ModsSort!])
            let sort_value = serde_json::json!([{
                sort_field.clone(): {"direction": sort_direction}
            }]);

            // Build complete GraphQL variables
            let graphql_variables = serde_json::json!({
                "count": 20,
                "facets": {"categoryName": [], "languageName": [], "tag": []},
                "filter": filter_map,
                "offset": offset,
                "sort": sort_value
            });

            // Build the full fetch payload using serde_json for safe serialization
            let graphql_payload = serde_json::json!({
                "query": "\n    query ModsListing($count: Int = 0, $facets: ModsFacet, $filter: ModsFilter, $offset: Int, $postFilter: ModsFilter, $sort: [ModsSort!]) {\n  mods(\n    count: $count\n    facets: $facets\n    filter: $filter\n    offset: $offset\n    postFilter: $postFilter\n    sort: $sort\n    viewUserBlockedContent: false\n  ) {\n    facetsData\n    nodes {\n      ...ModTileFragment\n    }\n    totalCount\n  }\n}\n    fragment ModTileFragment on Mod {\n  adultContent\n  createdAt\n  downloads\n  endorsements\n  fileSize\n  game {\n    domainName\n    id\n    name\n  }\n  modCategory {\n    categoryId\n    name\n  }\n  modId\n  name\n  status\n  summary\n  thumbnailUrl\n  thumbnailBlurredUrl\n  uid\n  updatedAt\n  uploader {\n    avatar\n    memberId\n    name\n  }\n  viewerDownloaded\n  viewerEndorsed\n  viewerTracked\n  viewerUpdateAvailable\n  viewerIsBlocked\n}",
                "variables": graphql_variables,
                "operationName": "ModsListing"
            });

            // Serialize and escape for safe embedding in JS string literal
            let payload_str = serde_json::to_string(&graphql_payload).unwrap();
            let js_escaped = payload_str
                .replace('\\', "\\\\")
                .replace('"', "\\\"")
                .replace('\n', "\\n")
                .replace('\r', "\\r")
                .replace('\u{2028}', "\\u2028")
                .replace('\u{2029}', "\\u2029");

            // JS #1: fire the GraphQL fetch, store result in window variable
            let mut graphql_fire_js = format!(
                r##"
                (() => {{
                    try {{
                        if (window.__nexusGraphQLDone || window.__nexusGraphQLFetching) return 'skip';
                        window.__nexusGraphQLFetching = true;
                        fetch('https://api-router.nexusmods.com/graphql', {{
                            method: 'POST',
                            headers: {{ 'Content-Type': 'application/json', 'X-GraphQL-OperationName': 'ModsListing' }},
                            body: "{js_escaped}",
                            credentials: 'include'
                        }}).then(r => r.json()).then(json => {{
                            window.__nexusGraphQLData = JSON.stringify(json);
                            window.__nexusGraphQLDone = true;
                            //PLACEHOLDER_DEV_ALERT
                        }}).catch(e => {{
                            window.__nexusGraphQLError = String(e);
                        }});
                        return 'started';
                    }} catch(e) {{ return 'error:' + String(e); }}
                }})()
            "##
            );

            if cfg!(debug_assertions) {
                graphql_fire_js = graphql_fire_js.replace(
                    "//PLACEHOLDER_DEV_ALERT",
                    "alert('GraphQL Response:\\n' + JSON.stringify(json, null, 2));",
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
                // Check if window still exists
                if poll_handle.get_webview_window(&window_label).is_none() {
                    println!("[RankingScraper] Window was destroyed, exiting loop");
                    break;
                }

                // Timeout check
                if std::time::Instant::now() > timeout {
                    emit_event(serde_json::json!({ "error": "加载超时，请重试" }));
                    let _ = poll_window.destroy();
                    return;
                }

                // If GraphQL was requested, poll for its completion via lightweight status check
                if graphql_requested {
                    let status_res = eval_js(&poll_window, graphql_status_js);
                    if cfg!(debug_assertions) {
                        println!(
                            "[RankingScraper] GraphQL status raw result: {:?}",
                            status_res
                        );
                    }
                    if let Some(status_str) = status_res {
                        if let Ok(status) = serde_json::from_str::<serde_json::Value>(&status_str) {
                            let s = status.get("s").and_then(|v| v.as_str()).unwrap_or_default();
                            match s {
                                "done" => {
                                    // Retrieve the actual data
                                    if let Some(data_str) =
                                        eval_js(&poll_window, graphql_retrieve_js)
                                    {
                                        // Debug: log response structure
                                        if let Ok(ref data) =
                                            serde_json::from_str::<serde_json::Value>(&data_str)
                                        {
                                            let has_errors = data.get("errors").is_some();
                                            let total_count = data.pointer("/data/mods/totalCount");
                                            let nodes_count = data
                                                .pointer("/data/mods/nodes")
                                                .and_then(|n| n.as_array())
                                                .map(|a| a.len());
                                            println!("[RankingScraper] GraphQL response: has_errors={}, totalCount={:?}, nodes_count={:?}", has_errors, total_count, nodes_count);
                                            if has_errors {
                                                println!(
                                                    "[RankingScraper] GraphQL errors: {}",
                                                    serde_json::to_string_pretty(
                                                        data.get("errors").unwrap()
                                                    )
                                                    .unwrap_or_default()
                                                );
                                            }
                                        }
                                        if let Ok(data) =
                                            serde_json::from_str::<serde_json::Value>(&data_str)
                                        {
                                            let _ = poll_window.set_title("Nexus 排行榜已获取");
                                            println!("[RankingScraper] GraphQL data retrieved!");
                                            emit_event(serde_json::json!({ "mods": data }));
                                        } else {
                                            emit_event(
                                                serde_json::json!({ "error": "GraphQL 数据解析失败" }),
                                            );
                                        }
                                    } else {
                                        emit_event(
                                            serde_json::json!({ "error": "无法从 WebView 获取数据" }),
                                        );
                                    }
                                    let _ = poll_window.destroy();
                                    return;
                                }
                                "error" => {
                                    let err = status
                                        .get("e")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("unknown");
                                    println!("[RankingScraper] GraphQL error: {}", err);
                                    emit_event(
                                        serde_json::json!({ "error": format!("GraphQL 请求失败: {}", err) }),
                                    );
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
                    emit_event(serde_json::json!({ "status": "challenge" }));
                }
                if !is_cf && cf_shown {
                    emit_event(serde_json::json!({ "status": "loading" }));
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
                    println!(
                        "[RankingScraper] GraphQL variables: {}",
                        serde_json::to_string(&graphql_variables).unwrap_or_default()
                    );
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
pub async fn fetch_smapi_compatibility_mods(
    app: tauri::AppHandle,
) -> Result<Vec<serde_json::Value>, String> {
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

#[tauri::command]
pub async fn open_nexus_login_window(app: tauri::AppHandle) -> Result<(), String> {
    let url_str = "https://users.nexusmods.com/auth/sign_in".to_string();
    let url = url_str.parse::<tauri::Url>().map_err(|e| e.to_string())?;

    let handle = app.clone();

    tauri::async_runtime::spawn(async move {
        use tauri::Emitter;

        let window = match create_nexus_webview(&handle, "nexus-login", "NexusMods 登录", url, true)
        {
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
                // Check if window still exists
                if poll_handle.get_webview_window("nexus-login").is_none() {
                    println!("[NexusLogin] Window was destroyed, exiting loop");
                    break;
                }

                if std::time::Instant::now() > timeout {
                    println!("[NexusLogin] Timeout reached, destroying window");
                    let _ = poll_handle.emit(
                        "nexus-login-result",
                        serde_json::json!({
                            "status": "timeout"
                        }),
                    );
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

                let snapshot_json = match eval_js(
                    &poll_window,
                    r##"
                    (() => {
                        try {
                            const href = location.href.toLowerCase();
                            const title = (document.title || "").toLowerCase();
                            const html = document.documentElement ? document.documentElement.outerHTML : "";
                            const lowerHtml = html.toLowerCase();
                            const bodyText = document.body ? document.body.innerText : "";
                            const hasAlreadySignedInText = bodyText.toLowerCase().includes("you are already signed in");

                            // Check if still on login page
                            const isLoginPage = href.includes("/auth/sign_in") || href.includes("/users/login") || href.includes("/login");
                            
                            const hasLoginBtn = !!document.querySelector("a[href*='/users/login'], a[href*='/auth/sign_in'], [class*='login-btn'], [class*='sign-in']");
                            const hasSignOutBtn = !!document.querySelector("a[href*='sign_out'], a[href*='logout'], a[href*='sign-out']");
                            const hasUserElements = !!document.querySelector("[class*='user-avatar'], [class*='user-name'], .header-user, [class*='profile'], [data-user-id], #user-avatar, .member-avatar, .member-name");
                            const hasNormalContent = hasAlreadySignedInText || hasLoginBtn || hasSignOutBtn || hasUserElements || !!document.querySelector(".logo, .nav-item");

                            // Check for Cloudflare challenge
                            const isChallenge =
                                title.includes("just a moment") ||
                                title.includes("checking your browser") ||
                                (!hasNormalContent && (
                                    lowerHtml.includes("cf-turnstile") ||
                                    lowerHtml.includes("challenges.cloudflare.com") ||
                                    lowerHtml.includes("/cdn-cgi/challenge-platform/")
                                ));

                            // Check if logged in
                            const isLoggedIn =
                                (hasAlreadySignedInText || !isLoginPage) &&
                                !isChallenge &&
                                (document.readyState === "complete" || document.readyState === "interactive") &&
                                (
                                    hasAlreadySignedInText ||
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
                                const matchSignedIn = bodyText.match(/signed in as\s+([^\n\r!.]+)/i);
                                if (matchSignedIn) {
                                    username = matchSignedIn[1].trim();
                                }
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
                "##,
                ) {
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

                println!("[NexusLoginWindow] snapshot: {:?}", snapshot);

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
                    let _ = poll_handle.emit(
                        "nexus-login-result",
                        serde_json::json!({
                            "status": "success",
                            "username": username
                        }),
                    );
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

    println!("[NexusLoginCheck] check_nexus_login_status command called");

    // 1. Check if we have a very recent successful check in the cache (e.g., within 5 seconds)
    let cache_mutex = LOGIN_STATUS_CACHE.get_or_init(|| std::sync::Mutex::new(None));
    {
        if let Ok(cache_guard) = cache_mutex.lock() {
            if let Some(ref cache) = *cache_guard {
                if cache.timestamp.elapsed() < std::time::Duration::from_secs(5) {
                    println!(
                        "[NexusLoginCheck] Returning cached login status: {:?}",
                        cache.result
                    );
                    return Ok(cache.result.clone());
                }
            }
        }
    }

    // 2. Lock to prevent concurrent checks
    let progress_mutex = LOGIN_IN_PROGRESS.get_or_init(|| tokio::sync::Mutex::new(()));
    let _guard = progress_mutex.lock().await;

    // 3. Re-check cache after acquiring lock (double-checked locking pattern)
    {
        if let Ok(cache_guard) = cache_mutex.lock() {
            if let Some(ref cache) = *cache_guard {
                if cache.timestamp.elapsed() < std::time::Duration::from_secs(5) {
                    println!("[NexusLoginCheck] Returning cached login status after acquiring lock: {:?}", cache.result);
                    return Ok(cache.result.clone());
                }
            }
        }
    }

    let data_dir = app
        .path()
        .app_data_dir()
        .ok()
        .map(|p| p.join("webview_data"));

    println!("[NexusLoginCheck] data_dir resolved: {:?}", data_dir);

    // If no webview_data dir exists, we're definitely not logged in
    if let Some(ref dir) = data_dir {
        if !dir.exists() {
            println!(
                "[NexusLoginCheck] webview_data directory does not exist, returning not logged in."
            );
            let res = serde_json::json!({ "loggedIn": false, "username": "" });
            if let Ok(mut cache_guard) = cache_mutex.lock() {
                *cache_guard = Some(LoginStatusCache {
                    result: res.clone(),
                    timestamp: std::time::Instant::now(),
                });
            }
            return Ok(res);
        }
    } else {
        println!("[NexusLoginCheck] app_data_dir returned None, returning not logged in.");
        let res = serde_json::json!({ "loggedIn": false, "username": "" });
        if let Ok(mut cache_guard) = cache_mutex.lock() {
            *cache_guard = Some(LoginStatusCache {
                result: res.clone(),
                timestamp: std::time::Instant::now(),
            });
        }
        return Ok(res);
    }

    let handle = app.clone();
    let url_str = "https://users.nexusmods.com/account/security".to_string();
    let url = url_str.parse::<tauri::Url>().map_err(|e| e.to_string())?;

    // Create a hidden window using helper
    let window = create_nexus_webview(
        &handle,
        "nexus-login-check",
        "Checking NexusMods login...",
        url,
        false,
    )?;

    let poll_window = window.clone();
    let poll_handle = handle.clone();
    let result = tokio::time::timeout(std::time::Duration::from_secs(30), async move {
        let eval_js = |win: &tauri::WebviewWindow, js: &str| -> Option<String> {
            eval_js_timeout(win, js, 3)
        };

        let mut cf_shown = false;

        loop {
            // Check if window still exists
            if poll_handle.get_webview_window("nexus-login-check").is_none() {
                println!("[NexusLoginCheck] Window was destroyed, exiting loop");
                return serde_json::json!({ "loggedIn": false, "username": "" });
            }

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
                        if (document.readyState !== "complete" && document.readyState !== "interactive") {
                            return { ready: false, isNotInteractive: true, documentReadyState: document.readyState, href: location.href };
                        }
                        const href = location.href.toLowerCase();
                        const html = document.documentElement ? document.documentElement.outerHTML : "";
                        const lowerHtml = html.toLowerCase();
                        
                        const hasSignOutBtn = !!document.querySelector("a[href*='sign_out'], a[href*='logout'], a[href*='sign-out']");
                        const hasUserElements = !!document.querySelector("[class*='user-avatar'], [class*='user-name'], .header-user, [class*='profile'], [data-user-id], #user-avatar, .member-avatar, .member-name");
                        const hasNormalContent = hasSignOutBtn || hasUserElements || !!document.querySelector("a[href*='/users/login'], a[href*='/auth/sign_in'], [class*='login-btn'], [class*='sign-in'], .logo, .nav-item");
                        
                        // Still on challenge page
                        if (!hasNormalContent && (lowerHtml.includes("cf-turnstile") || lowerHtml.includes("challenges.cloudflare.com") || lowerHtml.includes("/cdn-cgi/challenge-platform/"))) {
                            return { ready: false, isChallenge: true, href: location.href };
                        }
                        
                        const bodyText = document.body ? document.body.innerText : "";
                        const hasAlreadySignedIn = bodyText.toLowerCase().includes("you are already signed in");
                        const hasWelcome = bodyText.toLowerCase().includes("welcome back") || hasAlreadySignedIn;
                        const hasLogIn = !hasAlreadySignedIn && (bodyText.toLowerCase().includes("log in to nexus mods") || href.includes("/auth/sign_in") || href.includes("/login"));
                        
                        if (hasWelcome) {
                            let username = "";
                            // Try to match "Welcome back, {username}" or "Welcome back {username}"
                            const match = bodyText.match(/Welcome back[\s,]+([^\n\r!]+)/i);
                            if (match) {
                                username = match[1].trim();
                            }
                            if (!username) {
                                const matchSignedIn = bodyText.match(/signed in as\s+([^\n\r!.]+)/i);
                                if (matchSignedIn) {
                                    username = matchSignedIn[1].trim();
                                }
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
                            // If we are fully loaded but neither welcome nor log in matched, check for sign out button or already signed in
                            if (hasSignOutBtn || hasAlreadySignedIn) {
                                let username = "";
                                const matchSignedIn = bodyText.match(/signed in as\s+([^\n\r!.]+)/i);
                                if (matchSignedIn) {
                                    username = matchSignedIn[1].trim();
                                }
                                if (!username) {
                                    const userEl = document.querySelector("[class*='user-name'], .header-user a, [class*='username'], .member-name");
                                    if (userEl) {
                                        username = userEl.textContent.trim();
                                    }
                                }
                                return { ready: true, loggedIn: true, username };
                            }
                            return { ready: true, loggedIn: false, username: "" };
                        }
                        
                        return {
                            ready: false,
                            href,
                            hasSignOutBtn,
                            hasUserElements,
                            hasNormalContent,
                            hasAlreadySignedIn,
                            hasWelcome,
                            hasLogIn,
                            bodySnippet: bodyText.slice(0, 150),
                            documentReadyState: document.readyState
                        };
                    } catch (e) {
                        return { ready: false, error: e.toString() };
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

            println!("[NexusLoginCheck] snapshot: {:?}", snapshot);

            let ready = snapshot.get("ready").and_then(|v| v.as_bool()).unwrap_or(false);
            if ready {
                let logged_in = snapshot.get("loggedIn").and_then(|v| v.as_bool()).unwrap_or(false);
                let username = snapshot.get("username").and_then(|v| v.as_str()).unwrap_or_default().to_string();
                println!("[NexusLoginCheck] result: ready=true, loggedIn={}, username={}", logged_in, username);
                return serde_json::json!({ "loggedIn": logged_in, "username": username });
            }

            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }
    }).await;

    let _ = window.destroy();

    let final_res = match result {
        Ok(val) => val,
        Err(_) => serde_json::json!({ "loggedIn": false, "username": "" }),
    };

    if let Ok(mut cache_guard) = cache_mutex.lock() {
        *cache_guard = Some(LoginStatusCache {
            result: final_res.clone(),
            timestamp: std::time::Instant::now(),
        });
    }

    Ok(final_res)
}

#[tauri::command]
pub async fn fetch_nexus_api_key(
    app: tauri::AppHandle,
    force: Option<bool>,
) -> Result<serde_json::Value, String> {
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

    let is_force = force.unwrap_or(false);

    if !is_force && api_key_path.exists() {
        if let Ok(cached_key) = fs::read_to_string(&api_key_path) {
            let trimmed = cached_key.trim().to_string();
            if trimmed.len() > 10 {
                println!("[NexusApiKey] Using cached API key");
                return Ok(serde_json::json!({ "apiKey": trimmed }));
            }
        }
    }

    // Acquire lock to serialize concurrent API key fetches
    let progress_mutex = API_KEY_IN_PROGRESS.get_or_init(|| tokio::sync::Mutex::new(()));
    let _guard = progress_mutex.lock().await;

    // Double check cache after acquiring the lock
    if !is_force && api_key_path.exists() {
        if let Ok(cached_key) = fs::read_to_string(&api_key_path) {
            let trimmed = cached_key.trim().to_string();
            if trimmed.len() > 10 {
                println!("[NexusApiKey] Using cached API key after acquiring lock");
                return Ok(serde_json::json!({ "apiKey": trimmed }));
            }
        }
    }

    if is_force {
        if api_key_path.exists() {
            let _ = fs::remove_file(&api_key_path);
        }
    }

    let handle = app.clone();
    let url_str = "https://www.nexusmods.com/robots.txt".to_string();
    let url = url_str.parse::<tauri::Url>().map_err(|e| e.to_string())?;

    // Create a hidden window using helper
    let window = create_nexus_webview(
        &handle,
        "nexus-apikey-fetch",
        "获取 API Key中...",
        url,
        false,
    )?;

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
            // Check if window still exists
            if poll_handle.get_webview_window("nexus-apikey-fetch").is_none() {
                println!("[NexusApiKey] Window was destroyed, exiting loop");
                return serde_json::json!({ "apiKey": "", "error": "窗口已关闭" });
            }

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
            let api_key = val
                .get("apiKey")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
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
    info!("[Scraper] Opening Nexus scraper for mod_id={}", mod_id);
    let url_str = format!("https://www.nexusmods.com/stardewvalley/mods/{}", mod_id);
    let url = url_str.parse::<tauri::Url>().map_err(|e| e.to_string())?;

    let handle = app.clone();
    let request_mod_id = mod_id.clone();

    tauri::async_runtime::spawn(async move {
        use tauri::Emitter;

        let window =
            match create_nexus_webview(&handle, "nexus-scraper", "Nexus 验证中...", url, false) {
                Ok(w) => w,
                Err(e) => {
                    error!(
                        "[Scraper] Failed to build scraper window for mod_id={}: {:?}",
                        request_mod_id, e
                    );
                    return;
                }
            };

        let poll_window = window.clone();
        let poll_handle = handle.clone();
        let poll_mod_id = request_mod_id.clone();
        tauri::async_runtime::spawn(async move {
            let timeout = std::time::Instant::now() + std::time::Duration::from_secs(180);
            let mut cf_shown = false;
            let mut last_title = String::new();
            let mut details_ready_count: u32 = 0;

            let eval_js = |win: &tauri::WebviewWindow, js: &str| -> Option<String> {
                eval_js_timeout(win, js, 2)
            };

            loop {
                // Check if window still exists
                if poll_handle.get_webview_window("nexus-scraper").is_none() {
                    info!(
                        "[Scraper] Window destroyed, exiting loop for mod_id={}",
                        poll_mod_id
                    );
                    break;
                }

                // Timeout: destroy window and notify frontend
                if std::time::Instant::now() > timeout {
                    warn!(
                        "[Scraper] Timeout reached for mod_id={}, destroying window",
                        poll_mod_id
                    );
                    let _ = poll_handle.emit(
                        "respond-nexus-html",
                        serde_json::json!({
                            "modId": poll_mod_id.clone(),
                            "error": "加载超时，请重试"
                        }),
                    );
                    let _ = poll_window.destroy();
                    return;
                }

                // Check Cloudflare challenge
                let is_challenge = check_cloudflare_challenge(&poll_window);
                if is_challenge && !cf_shown {
                    let _ = poll_handle.emit(
                        "respond-nexus-html",
                        serde_json::json!({
                            "modId": poll_mod_id.clone(),
                            "status": "challenge"
                        }),
                    );
                }
                if !is_challenge && cf_shown && last_title == "Nexus 需要验证" {
                    let _ = poll_handle.emit(
                        "respond-nexus-html",
                        serde_json::json!({
                            "modId": poll_mod_id.clone(),
                            "status": "loading"
                        }),
                    );
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
                let snapshot_json = match eval_js(
                    &poll_window,
                    r##"
                    (() => {
                        try {
                            const html = document.documentElement ? document.documentElement.outerHTML : "";
                            const ogTitle = document.querySelector("meta[property='og:title']")?.getAttribute("content") || "";
                            const ogDescription = document.querySelector("meta[property='og:description']")?.getAttribute("content") || "";
                            const hasNexusDetailMarker =
                                !!document.querySelector("#description-content, #section-mod-description, .mod-description, .tab-description, #pagetitle h1, meta[property='og:title'], meta[property='og:description']");
                            const hasRichContent =
                                !!document.querySelector(".statitem, ul.thumbgallery.gallery, .sideitems");
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
                                hasRichContent,
                                html
                            };
                        } catch (error) {
                            return {
                                readyState: "error",
                                hasDetails: false,
                                hasRichContent: false,
                                html: "",
                                error: String(error)
                            };
                        }
                    })()
                "##,
                ) {
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
                let has_rich_content = snapshot
                    .get("hasRichContent")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let html = snapshot
                    .get("html")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();

                if !is_challenge && ready_state == "complete" && has_details {
                    if has_rich_content {
                        // Rich content (stats, images, sidebar) loaded — emit immediately
                        let _ = poll_window.set_title("Nexus 信息已获取");
                        info!(
                            "[Scraper] Got HTML with rich content for mod_id={}, length={}",
                            poll_mod_id,
                            html.len()
                        );
                        let _ = poll_handle.emit(
                            "respond-nexus-html",
                            serde_json::json!({
                                "modId": poll_mod_id.clone(),
                                "html": html
                            }),
                        );
                        let _ = poll_window.destroy();
                        return;
                    }
                    // Basic details present but no rich content yet — wait up to 6s for AJAX
                    details_ready_count += 1;
                    if details_ready_count >= 12 {
                        let _ = poll_window.set_title("Nexus 信息已获取");
                        info!(
                            "[Scraper] Got HTML fallback for mod_id={}, length={}",
                            poll_mod_id,
                            html.len()
                        );
                        let _ = poll_handle.emit(
                            "respond-nexus-html",
                            serde_json::json!({
                                "modId": poll_mod_id.clone(),
                                "html": html
                            }),
                        );
                        let _ = poll_window.destroy();
                        return;
                    }
                }

                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            }
        });
    });

    Ok(())
}

fn parse_query_param(url: &str, key: &str) -> Option<String> {
    let base = if let Some(pos) = url.find('?') {
        &url[pos + 1..]
    } else {
        return None;
    };

    let query = base.split('#').next().unwrap_or(base);
    for pair in query.split('&') {
        let mut parts = pair.splitn(2, '=');
        let pair_key = parts.next()?;
        if pair_key.eq_ignore_ascii_case(key) {
            return Some(parts.next().unwrap_or("").to_string());
        }
    }
    None
}

fn extract_game_domain(url: &str) -> Option<String> {
    if let Some(rest) = url.strip_prefix("nxm://") {
        return rest
            .split(['/', '?', '#'])
            .find(|seg| !seg.is_empty())
            .map(|seg| seg.to_string());
    }

    let path = url.split('#').next()?.split('?').next()?;
    let segments: Vec<&str> = path.split('/').filter(|seg| !seg.is_empty()).collect();
    for i in 0..segments.len() {
        if segments[i] == "mods" && i >= 1 {
            return Some(segments[i - 1].to_string());
        }
    }
    None
}

fn extract_path_value_after(url: &str, marker: &str) -> Option<String> {
    let path = url.split('#').next()?.split('?').next()?;
    let segments: Vec<&str> = path.split('/').filter(|seg| !seg.is_empty()).collect();
    for i in 0..segments.len() {
        if segments[i].eq_ignore_ascii_case(marker) && i + 1 < segments.len() {
            return Some(segments[i + 1].to_string());
        }
    }
    None
}

fn extract_nexus_mod_id(url: &str) -> Option<String> {
    extract_path_value_after(url, "mods")
}

fn game_id_from_domain(game_domain: &str) -> Option<String> {
    match game_domain {
        "stardewvalley" => Some("1303".to_string()),
        _ => None,
    }
}

fn extract_nexus_download_params(url: &str) -> Option<(String, String, String, String)> {
    let file_id = parse_query_param(url, "file_id")
        .or_else(|| parse_query_param(url, "fid"))
        .or_else(|| extract_path_value_after(url, "files"))?;
    let game_domain = extract_game_domain(url).unwrap_or_else(|| "stardewvalley".to_string());
    let game_id = game_id_from_domain(&game_domain)?;
    let referer_url = if url.trim_start().to_ascii_lowercase().starts_with("nxm://") {
        let mod_id = extract_path_value_after(url, "mods")?;
        format!(
            "https://www.nexusmods.com/{}/mods/{}?tab=files&file_id={}&nmm=1",
            game_domain, mod_id, file_id
        )
    } else {
        url.to_string()
    };
    Some((game_id, file_id, game_domain, referer_url))
}

fn looks_like_nexus_files_page(url: &str) -> bool {
    let lower = url.trim().to_ascii_lowercase();
    if !lower.starts_with("http://") && !lower.starts_with("https://") {
        return false;
    }

    if !lower.contains("nexusmods.com") {
        return false;
    }

    let game_domain = match extract_game_domain(&lower) {
        Some(value) => value,
        None => return false,
    };
    if game_id_from_domain(&game_domain).is_none() {
        return false;
    }

    extract_nexus_mod_id(&lower)
        .map(|mod_id| mod_id.chars().all(|ch| ch.is_ascii_digit()))
        .unwrap_or(false)
}

async fn fetch_nexus_download_metadata_via_browser(
    app: tauri::AppHandle,
    referer_url: &str,
) -> Result<NexusDownloadMetadata, String> {
    let parse_url = referer_url
        .parse::<tauri::Url>()
        .map_err(|e| format!("解析页面 URL 失败: {}", e))?;
    let handle = app.clone();
    let request_id = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_secs(0))
        .as_millis();
    let sequence = DOWNLOAD_COUNTER
        .get_or_init(|| std::sync::atomic::AtomicU64::new(1))
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let window_label = format!("nexus-download-metadata-{}-{}", request_id, sequence);

    let window = create_nexus_webview(
        &handle,
        &window_label,
        "Nexus 模组信息获取中...",
        parse_url,
        false,
    )
    .map_err(|e| format!("创建元数据窗口失败: {}", e))?;

    let poll_window = window.clone();
    let poll_handle = handle.clone();
    let result = tokio::time::timeout(Duration::from_secs(45), async move {
        let mut cf_shown = false;
        let mut title_ready_count = 0_u8;

        loop {
            if poll_handle.get_webview_window(&window_label).is_none() {
                return Err("元数据窗口已关闭".to_string());
            }

            let is_cf = check_cloudflare_challenge(&poll_window);
            update_window_visibility_for_cf(
                &poll_window,
                &poll_handle,
                is_cf,
                &mut cf_shown,
                false,
                "Nexus 需要验证",
                "Nexus 模组信息获取中...",
            );
            if is_cf {
                tokio::time::sleep(Duration::from_millis(800)).await;
                continue;
            }

            let snapshot_json = match eval_js_timeout(
                &poll_window,
                r##"
                    (() => {
                        try {
                            let title = document.querySelector("meta[property='og:title']")?.getAttribute("content") || "";
                            if (!title) title = document.querySelector("#pagetitle h1")?.textContent?.trim() || "";
                            if (!title) title = document.querySelector("h1")?.textContent?.trim() || "";
                            title = title.replace(/\s+at Stardew Valley Nexus.*/i, "").trim();

                            let author = "";
                            const sideItems = document.querySelectorAll(".sideitems .sideitem");
                            sideItems.forEach(item => {
                                const h3 = item.querySelector("h3");
                                if (author || !h3) return;
                                const label = (h3.textContent || "").trim().toLowerCase();
                                if (label.includes("created by")) {
                                    const clone = item.cloneNode(true);
                                    clone.querySelector("h3")?.remove();
                                    author = (clone.textContent || "").trim();
                                }
                            });
                            if (!author) author = document.querySelector(".author-name")?.textContent?.trim() || "";
                            if (!author) author = document.querySelector(".member-name a")?.textContent?.trim() || "";
                            author = author.replace(/^created by\s+/i, "").trim();

                            return {
                                readyState: document.readyState,
                                title,
                                author,
                                isNexusHost: location.hostname.endsWith("nexusmods.com")
                            };
                        } catch (error) {
                            return {
                                readyState: "error",
                                title: "",
                                author: "",
                                isNexusHost: false,
                                error: String(error)
                            };
                        }
                    })()
                "##,
                4,
            ) {
                Some(v) => v,
                None => {
                    tokio::time::sleep(Duration::from_millis(400)).await;
                    continue;
                }
            };

            let snapshot: Value = match serde_json::from_str(&snapshot_json) {
                Ok(v) => v,
                Err(_) => {
                    tokio::time::sleep(Duration::from_millis(400)).await;
                    continue;
                }
            };

            if !snapshot
                .get("isNexusHost")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
            {
                tokio::time::sleep(Duration::from_millis(500)).await;
                continue;
            }

            let ready_state = snapshot
                .get("readyState")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            let mod_name = snapshot
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .trim()
                .to_string();
            let author = snapshot
                .get("author")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .trim()
                .to_string();

            if !mod_name.is_empty() {
                if !author.is_empty() {
                    return Ok(NexusDownloadMetadata { mod_name, author });
                }
                if ready_state == "complete" {
                    title_ready_count = title_ready_count.saturating_add(1);
                    if title_ready_count >= 6 {
                        return Ok(NexusDownloadMetadata { mod_name, author });
                    }
                }
            }

            tokio::time::sleep(Duration::from_millis(500)).await;
        }
    })
    .await;

    let _ = window.destroy();

    match result {
        Ok(res) => res,
        Err(_) => Err("获取 Nexus 模组信息超时，请确保已登录并完成 Cloudflare 校验".to_string()),
    }
}

#[tauri::command]
pub async fn fetch_nexus_download_metadata(
    app: tauri::AppHandle,
    download_url: String,
) -> Result<NexusDownloadMetadata, String> {
    let url = download_url.trim().to_string();
    let (_, _, game_domain, mut referer_url) = extract_nexus_download_params(&url)
        .ok_or_else(|| "无法从链接解析 Nexus 模组信息".to_string())?;

    if url.trim_start().to_ascii_lowercase().starts_with("nxm://") {
        let mod_id =
            extract_nexus_mod_id(&url).ok_or_else(|| "无法从 nxm 链接解析 mod_id".to_string())?;
        referer_url = format!("https://www.nexusmods.com/{}/mods/{}", game_domain, mod_id);
    }

    fetch_nexus_download_metadata_via_browser(app, &referer_url).await
}

fn parse_download_url_from_payload(payload: &serde_json::Value) -> Option<String> {
    const KEYS: [&str; 6] = ["url", "download_url", "URI", "uri", "download", "link"];
    for key in KEYS {
        if let Some(url) = payload.get(key).and_then(|v| v.as_str()) {
            return Some(url.to_string());
        }
    }
    for key in [
        "/data/url",
        "/data/download_url",
        "/data/uri",
        "/data/URI",
        "/data/download",
        "/data/link",
        "/result/url",
        "/result/download_url",
        "/result/download",
        "/result/link",
        "/response/url",
    ] {
        if let Some(url) = payload.pointer(key).and_then(|v| v.as_str()) {
            return Some(url.to_string());
        }
    }

    payload
        .get("data")
        .and_then(|node| parse_download_url_from_payload(node))
        .or_else(|| {
            payload
                .get("result")
                .and_then(|node| parse_download_url_from_payload(node))
        })
        .or_else(|| {
            payload
                .get("response")
                .and_then(|node| parse_download_url_from_payload(node))
        })
}

fn parse_download_url_from_text(text: &str) -> Option<String> {
    let text = text.trim();
    for keyword in ["https://", "http://"].iter() {
        if let Some(start) = text.find(keyword) {
            let suffix = &text[start..];
            let mut end = suffix.len();
            for (i, ch) in suffix.char_indices() {
                if ch.is_whitespace()
                    || ch == '"'
                    || ch == '\''
                    || ch == '<'
                    || ch == '>'
                    || ch == '`'
                    || ch == ')'
                    || ch == ']'
                    || ch == '}'
                {
                    end = i;
                    break;
                }
            }
            let candidate = suffix[..end]
                .trim_end_matches(&[';', ',', '.'][..])
                .to_string();
            if !candidate.is_empty() {
                return Some(candidate);
            }
        }
    }
    None
}

fn parse_download_url_from_body(text: &str) -> Option<String> {
    let text = text.trim();
    if text.starts_with("http") {
        return Some(text.to_string());
    }

    let value: serde_json::Value = serde_json::from_str(text).ok()?;
    if let Some(url) = value.as_str() {
        return Some(url.to_string());
    }

    parse_download_url_from_payload(&value).or_else(|| parse_download_url_from_text(text))
}

fn looks_like_direct_download_url(url: &str) -> bool {
    let lower = url.trim().to_ascii_lowercase();
    if lower.is_empty() {
        return false;
    }

    if lower.contains("/users/myaccount")
        || lower.contains("tab=download+history")
        || lower.contains("tab=download%20history")
        || lower.contains("/collections")
        || lower.contains("imasdk.googleapis.com")
        || lower.contains("googlesyndication.com")
        || lower.contains("doubleclick.net")
    {
        return false;
    }

    let path = lower
        .split('#')
        .next()
        .unwrap_or(&lower)
        .split('?')
        .next()
        .unwrap_or(&lower);
    path.ends_with(".zip") || path.ends_with(".zip/")
}

fn is_zip_file(path: &std::path::Path) -> Result<bool, String> {
    let bytes = fs::read(path).map_err(|e| format!("读取下载文件失败: {}", e))?;
    if bytes.len() < 4 {
        return Ok(false);
    }

    Ok(bytes.starts_with(b"PK\x03\x04")
        || bytes.starts_with(b"PK\x05\x06")
        || bytes.starts_with(b"PK\x07\x08"))
}

async fn resolve_nexus_download_params_from_files_tab_widget(
    app: tauri::AppHandle,
    page_url: &str,
) -> Result<(String, String, String, String), String> {
    let mod_id =
        extract_nexus_mod_id(page_url).ok_or_else(|| "无法从文件页链接解析 mod_id".to_string())?;
    let game_domain = extract_game_domain(page_url).unwrap_or_else(|| "stardewvalley".to_string());
    let game_id =
        game_id_from_domain(&game_domain).ok_or_else(|| "无法识别游戏域名".to_string())?;

    info!(
        "[NexusFilesTab] Resolving file_id via ModFilesTab widget: mod_id={}, game_id={}, page_url={}",
        mod_id, game_id, page_url
    );

    let parse_url = page_url
        .parse::<tauri::Url>()
        .map_err(|e| format!("解析文件页 URL 失败: {}", e))?;
    let handle = app.clone();
    let request_id = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_secs(0))
        .as_millis();
    let sequence = DOWNLOAD_COUNTER
        .get_or_init(|| std::sync::atomic::AtomicU64::new(1))
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let window_label = format!("nexus-files-tab-{}-{}-{}", mod_id, request_id, sequence);

    let window = create_nexus_webview(
        &handle,
        &window_label,
        "Nexus 文件列表获取中...",
        parse_url,
        false,
    )
    .map_err(|e| format!("创建文件列表窗口失败: {}", e))?;

    let poll_window = window.clone();
    let poll_handle = handle.clone();
    let fetch_js_template = r##"
        (() => {
            try {
                if (window.__nexusFilesTabStarted) return 'skip';
                window.__nexusFilesTabStarted = true;
                window.__nexusFilesTabDone = false;
                window.__nexusFilesTabError = null;
                window.__nexusFilesTabPayload = null;

                fetch('/Core/Libs/Common/Widgets/ModFilesTab?id={mod_id}&game_id={game_id}', {
                    method: 'GET',
                    headers: {
                        'accept': 'text/html, */*; q=0.01',
                        'x-requested-with': 'XMLHttpRequest'
                    },
                    credentials: 'include',
                    cache: 'no-cache'
                })
                .then(async response => {
                    const text = await response.text();
                    if (!response.ok) {
                        window.__nexusFilesTabDone = true;
                        window.__nexusFilesTabError = `HTTP ${response.status}: ${text}`;
                        return;
                    }
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(text, 'text/html');
                    const modPath = '/{game_domain}/mods/{mod_id}';
                    const modPathLower = modPath.toLowerCase();
                    const blockedPatterns = [
                        '/users/myaccount',
                        'download+history',
                        'download%20history',
                        '/collections',
                        'imasdk.googleapis.com',
                        'googlesyndication.com',
                        'doubleclick.net'
                    ];
                    const candidates = [];
                    const seenFileIds = new Set();
                    const rawSamples = [];

                    const normalizeEntities = (value) => String(value || '')
                        .replace(/&amp;/g, '&')
                        .replace(/&quot;/g, '"')
                        .replace(/&#39;/g, "'")
                        .replace(/&lt;/g, '<')
                        .replace(/&gt;/g, '>');
                    const hasBlockedValue = (value) => {
                        const lower = String(value || '').toLowerCase();
                        return blockedPatterns.some(pattern => lower.includes(pattern));
                    };
                    const pushRawSample = (source, value) => {
                        if (rawSamples.length >= 8) return;
                        const raw = normalizeEntities(value).trim();
                        if (!raw || hasBlockedValue(raw)) return;
                        if (!/(file_id|fid|nmm=1|downloadpopup|modrequirementspopup|generatedownloadurl|\/files\/|download)/i.test(raw)) return;
                        rawSamples.push({ source, value: raw.slice(0, 220) });
                    };
                    const canonicalHref = (fileId) => {
                        return `https://www.nexusmods.com${modPath}?tab=files&file_id=${encodeURIComponent(fileId)}&nmm=1`;
                    };
                    const pushCandidate = (fileId, href, nmm, source, label) => {
                        const normalizedFileId = String(fileId || '').trim();
                        if (!/^\d+$/.test(normalizedFileId)) return;
                        if (normalizedFileId === '{mod_id}' || normalizedFileId === '{game_id}') return;
                        if (seenFileIds.has(normalizedFileId)) return;
                        seenFileIds.add(normalizedFileId);
                        candidates.push({
                            href: href || canonicalHref(normalizedFileId),
                            fileId: normalizedFileId,
                            nmm: Boolean(nmm),
                            source,
                            text: String(label || '').trim().replace(/\s+/g, ' ').slice(0, 100)
                        });
                    };
                    const inspectUrl = (rawValue, source, label) => {
                        const value = normalizeEntities(rawValue).trim();
                        if (!value || hasBlockedValue(value)) return;
                        pushRawSample(source, value);
                        const urlParts = [value, ...Array.from(value.matchAll(/(?:https?:\/\/(?:www\.)?nexusmods\.com\/|\/)(?:Core\/Libs\/Common\/(?:Widgets\/DownloadPopUp|Widgets\/ModRequirementsPopUp|Managers\/Downloads)|{game_domain}\/mods\/{mod_id})[^\s"'<>)]*/gi)).map(match => match[0])];
                        for (const part of urlParts) {
                            try {
                                const absolute = new URL(part, location.origin);
                                if (!absolute.hostname.endsWith('nexusmods.com')) continue;
                                const path = absolute.pathname.toLowerCase();
                                const search = absolute.searchParams;
                                if (path === modPathLower) {
                                    const fileId = search.get('file_id') || search.get('fid');
                                    if (fileId) {
                                        pushCandidate(fileId, canonicalHref(fileId), search.get('nmm') === '1', `${source}:mod-url`, label);
                                    }
                                    continue;
                                }

                                const filePathMatch = path.match(new RegExp(`^${modPathLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/files/(\\d+)`));
                                if (filePathMatch) {
                                    pushCandidate(filePathMatch[1], canonicalHref(filePathMatch[1]), true, `${source}:file-path`, label);
                                    continue;
                                }

                                if (
                                    path.includes('/core/libs/common/widgets/downloadpopup') ||
                                    path.includes('/core/libs/common/widgets/modrequirementspopup') ||
                                    path.includes('/core/libs/common/managers/downloads')
                                ) {
                                    const fileId = search.get('file_id') || search.get('fid') || search.get('id');
                                    if (fileId) {
                                        pushCandidate(fileId, canonicalHref(fileId), search.get('nmm') === '1', `${source}:download-endpoint`, label);
                                    }
                                }
                            } catch (_) {
                                // Ignore non-URL attribute values.
                            }
                        }

                        const contextual = /(?:file_id|fid)\s*[:=]\s*["']?(\d{3,})/ig;
                        let match;
                        while ((match = contextual.exec(value))) {
                            pushCandidate(match[1], canonicalHref(match[1]), /nmm\s*=\s*1/i.test(value), `${source}:inline-file-id`, label);
                        }
                    };

                    const elements = Array.from(doc.querySelectorAll('*'));
                    for (const element of elements) {
                        const label = [
                            element.textContent || '',
                            element.getAttribute('title') || '',
                            element.getAttribute('aria-label') || '',
                            element.getAttribute('class') || '',
                            element.id || ''
                        ].join(' ');
                        for (const attr of Array.from(element.attributes || [])) {
                            inspectUrl(attr.value, `${element.tagName.toLowerCase()}@${attr.name}`, label);
                        }

                        const labelHasDownloadIntent = /(download|manual|mod manager|nmm|file|下载)/i.test(label);
                        if (labelHasDownloadIntent) {
                            for (const attr of Array.from(element.attributes || [])) {
                                const value = normalizeEntities(attr.value).trim();
                                if (/^(data-)?(file-?id|fid|download-?id)$/i.test(attr.name) && /^\d{3,}$/.test(value)) {
                                    pushCandidate(value, canonicalHref(value), /nmm|mod manager/i.test(label), `${element.tagName.toLowerCase()}@${attr.name}:data-id`, label);
                                }
                            }
                        }
                    }

                    if (candidates.length === 0) {
                        inspectUrl(text, 'html-text', '');
                    }

                    const picked = candidates.find(candidate => candidate.nmm) || candidates[0] || null;
                    window.__nexusFilesTabDone = true;
                    window.__nexusFilesTabPayload = {
                        href: picked ? picked.href : '',
                        fileId: picked ? picked.fileId : '',
                        nmm: picked ? picked.nmm : false,
                        source: picked ? picked.source : '',
                        htmlLength: text.length,
                        elementCount: elements.length,
                        candidateCount: candidates.length,
                        samples: candidates.slice(0, 8),
                        rawSamples
                    };
                })
                .catch(error => {
                    window.__nexusFilesTabDone = true;
                    window.__nexusFilesTabError = String(error);
                });
                return 'started';
            } catch (error) {
                return 'error:' + String(error);
            }
        })()
        "##;
    let fetch_js = fetch_js_template
        .replace("{mod_id}", &mod_id)
        .replace("{game_id}", &game_id)
        .replace("{game_domain}", &game_domain);

    let status_js = r##"
        (() => {
            if (window.__nexusFilesTabError) return { s: "error", e: window.__nexusFilesTabError };
            if (window.__nexusFilesTabDone) return { s: "done", p: window.__nexusFilesTabPayload };
            if (window.__nexusFilesTabStarted) return { s: "fetching" };
            return { s: "idle" };
        })()
    "##;

    let result = tokio::time::timeout(Duration::from_secs(60), async move {
        let mut cf_shown = false;
        loop {
            if poll_handle.get_webview_window(&window_label).is_none() {
                return Err("文件列表窗口已关闭".to_string());
            }

            let is_cf = check_cloudflare_challenge(&poll_window);
            update_window_visibility_for_cf(
                &poll_window,
                &poll_handle,
                is_cf,
                &mut cf_shown,
                false,
                "Nexus 需要验证",
                "Nexus 文件列表获取中...",
            );
            if is_cf {
                tokio::time::sleep(Duration::from_millis(800)).await;
                continue;
            }

            let _ = eval_js_timeout(&poll_window, &fetch_js, 5);

            let status_json = match eval_js_timeout(&poll_window, status_js, 5) {
                Some(v) => v,
                None => {
                    tokio::time::sleep(Duration::from_millis(300)).await;
                    continue;
                }
            };

            let status: Value = match serde_json::from_str(&status_json) {
                Ok(s) => s,
                Err(_) => {
                    tokio::time::sleep(Duration::from_millis(300)).await;
                    continue;
                }
            };

            match status.get("s").and_then(|v| v.as_str()) {
                Some("done") => {
                    let payload = status.get("p").cloned().unwrap_or(Value::Null);
                    let html_length = payload
                        .get("htmlLength")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);
                    let candidate_count = payload
                        .get("candidateCount")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);
                    let element_count = payload
                        .get("elementCount")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);
                    let href = payload
                        .get("href")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .trim();
                    let source = payload
                        .get("source")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");

                    debug!(
                        "[NexusFilesTab] Widget parsed for mod_id={}: html_length={}, element_count={}, candidate_count={}, source={}, href={}",
                        mod_id, html_length, element_count, candidate_count, source, href
                    );

                    if href.is_empty() {
                        warn!(
                            "[NexusFilesTab] No usable download link found for mod_id={}: html_length={}, element_count={}, candidate_count={}, samples={}, raw_samples={}",
                            mod_id,
                            html_length,
                            element_count,
                            candidate_count,
                            payload.get("samples").unwrap_or(&Value::Null),
                            payload.get("rawSamples").unwrap_or(&Value::Null)
                        );
                        return Err("ModFilesTab 响应中未找到可用文件下载链接".to_string());
                    }

                    info!(
                        "[NexusFilesTab] Resolved file link for mod_id={}: source={}, {}",
                        mod_id, source, href
                    );
                    return extract_nexus_download_params(href).ok_or_else(|| {
                        format!("无法从 ModFilesTab 响应解析下载参数: {}", href)
                    });
                }
                Some("error") => {
                    let err = status.get("e").and_then(|v| v.as_str()).unwrap_or_default();
                    return Err(format!("网页端获取 ModFilesTab 失败: {}", err));
                }
                _ => {
                    tokio::time::sleep(Duration::from_millis(500)).await;
                    continue;
                }
            }
        }
    })
    .await;

    let _ = window.destroy();

    match result {
        Ok(res) => res,
        Err(_) => Err("获取 Nexus 文件列表超时，请确保已登录并完成 Cloudflare 校验".to_string()),
    }
}

async fn download_nexus_file_to_path(
    app: tauri::AppHandle,
    game_id: &str,
    file_id: &str,
    referer_url: &str,
    zip_path: &std::path::Path,
) -> Result<(), String> {
    let page_download_url =
        fetch_nexus_download_url_via_browser(app.clone(), game_id, file_id, referer_url)
            .await
            .map_err(|err| format!("获取网页下载链接失败: {}", err))?;

    let target_url = if page_download_url.starts_with('/') {
        format!("https://www.nexusmods.com{}", page_download_url)
    } else {
        page_download_url
    };

    info!(
        "[NexusInstall] Final resolved download target for file_id={}: {}",
        file_id, target_url
    );
    if target_url.contains("/users/myaccount")
        || target_url.contains("download+history")
        || target_url.contains("download%20history")
    {
        warn!(
            "[NexusInstall] Resolved target URL is an account/history page: {}",
            target_url
        );
    }

    crate::utils::download_file(&target_url, zip_path)
}

async fn fetch_nexus_download_url_via_browser(
    app: tauri::AppHandle,
    game_id: &str,
    file_id: &str,
    referer_url: &str,
) -> Result<String, String> {
    info!(
        "[NexusDownload] Resolving download URL via browser: game_id={}, file_id={}, referer={}",
        game_id, file_id, referer_url
    );
    let parse_url = referer_url
        .parse::<tauri::Url>()
        .map_err(|e| format!("解析页面 URL 失败: {}", e))?;
    let handle = app.clone();
    let request_id = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_secs(0))
        .as_millis();
    let sequence = DOWNLOAD_COUNTER
        .get_or_init(|| std::sync::atomic::AtomicU64::new(1))
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let window_label = format!(
        "nexus-generate-download-url-{}-{}-{}",
        file_id, request_id, sequence
    );

    let window = create_nexus_webview(
        &handle,
        &window_label,
        "Nexus 下载链接获取中...",
        parse_url,
        false,
    )
    .map_err(|e| format!("创建下载器窗口失败: {}", e))?;

    let poll_window = window.clone();
    let poll_handle = handle.clone();
    let fetch_js_template = r##"
        (() => {
            try {
                if (window.__nexusDownloadUrlStarted) return 'skip';
                window.__nexusDownloadUrlStarted = true;
                window.__nexusDownloadUrlDone = false;
                window.__nexusDownloadUrlError = null;
                window.__nexusDownloadUrlPayload = null;

                const body = new URLSearchParams();
                body.append('game_id', '{game_id}');
                body.append('fid', '{file_id}');
                body.append('collection_id', '0');

                fetch('/Core/Libs/Common/Managers/Downloads?GenerateDownloadUrl', {
                    method: 'POST',
                    headers: {
                        'accept': '*/*',
                        'accept-language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
                        'content-type': 'application/x-www-form-urlencoded'
                    },
                    mode: 'same-origin',
                    cache: 'no-cache',
                    body: body.toString(),
                    credentials: 'include'
                })
                .then(async response => {
                    const text = await response.text();
                    if (!response.ok) {
                        window.__nexusDownloadUrlDone = true;
                        window.__nexusDownloadUrlError = `HTTP ${response.status}: ${text}`;
                        return;
                    }
                    window.__nexusDownloadUrlDone = true;
                    window.__nexusDownloadUrlPayload = text;
                })
                .catch(error => {
                    window.__nexusDownloadUrlDone = true;
                    window.__nexusDownloadUrlError = String(error);
                });
                return 'started';
            } catch (error) {
                return 'error:' + String(error);
            }
        })()
    "##;
    let fetch_js = fetch_js_template
        .replace("{game_id}", game_id)
        .replace("{file_id}", file_id);

    let status_js = r##"
        (() => {
            if (window.__nexusDownloadUrlError) return { s: "error", e: window.__nexusDownloadUrlError };
            if (window.__nexusDownloadUrlDone) return { s: "done", p: window.__nexusDownloadUrlPayload };
            if (window.__nexusDownloadUrlStarted) return { s: "fetching" };
            return { s: "idle" };
        })()
    "##;

    let result = tokio::time::timeout(Duration::from_secs(90), async move {
        let mut cf_shown = false;
        loop {
            if poll_handle.get_webview_window(&window_label).is_none() {
                return Err("下载链接窗口已关闭".to_string());
            }

            let is_cf = check_cloudflare_challenge(&poll_window);
            update_window_visibility_for_cf(
                &poll_window,
                &poll_handle,
                is_cf,
                &mut cf_shown,
                false,
                "Nexus 需要验证",
                "Nexus 下载链接获取中...",
            );
            if is_cf {
                tokio::time::sleep(Duration::from_millis(800)).await;
                continue;
            }

            let _ = eval_js_timeout(&poll_window, &fetch_js, 5);

            let status_json = match eval_js_timeout(&poll_window, status_js, 5) {
                Some(v) => v,
                None => {
                    tokio::time::sleep(Duration::from_millis(300)).await;
                    continue;
                }
            };

            let status: Value = match serde_json::from_str(&status_json) {
                Ok(s) => s,
                Err(_) => {
                    tokio::time::sleep(Duration::from_millis(300)).await;
                    continue;
                }
            };

            match status.get("s").and_then(|v| v.as_str()) {
                Some("done") => {
                    let payload = status.get("p").and_then(|v| v.as_str()).unwrap_or("");
                    if payload.is_empty() {
                        warn!(
                            "[NexusDownload] GenerateDownloadUrl returned empty payload for file_id={}",
                            file_id
                        );
                        return Err("GenerateDownloadUrl 未返回内容".to_string());
                    }

                     debug!(
                        "[NexusDownload] GenerateDownloadUrl raw payload for file_id={}: {}",
                        file_id, payload
                    );

                    let url = parse_download_url_from_body(payload)
                        .ok_or_else(|| format!("生成下载链接失败，响应: {}", payload))?;

                    info!(
                        "[NexusDownload] Parsed browser download URL for file_id={}: {}",
                        file_id, url
                    );
                    if url.contains("/users/myaccount")
                        || url.contains("download+history")
                        || url.contains("download%20history")
                    {
                        warn!(
                            "[NexusDownload] Parsed URL looks like account/history page instead of file URL: {}",
                            url
                        );
                    }

                    return Ok(url);
                }
                Some("error") => {
                    let err = status.get("e").and_then(|v| v.as_str()).unwrap_or_default();
                    error!(
                        "[NexusDownload] Browser-side GenerateDownloadUrl failed for file_id={}: {}",
                        file_id, err
                    );
                    return Err(format!("网页端生成下载链接失败: {}", err));
                }
                _ => {}
            }

            tokio::time::sleep(Duration::from_millis(500)).await;
        }
    })
    .await;

    let _ = window.destroy();

    match result {
        Ok(res) => res,
        Err(_) => {
            error!(
                "[NexusDownload] Timed out resolving browser download URL for file_id={}",
                file_id
            );
            Err("获取下载链接超时，请确保已登录 Nexus 并完成 Cloudflare 校验".to_string())
        }
    }
}

#[tauri::command]
pub async fn install_nexus_mod(
    app: tauri::AppHandle,
    game_dir: String,
    download_url: String,
) -> Result<serde_json::Value, String> {
    info!(
        "[NexusInstall] Starting install_nexus_mod: game_dir={}, input_url={}",
        game_dir, download_url
    );
    let game_path = PathBuf::from(&game_dir);
    if !game_path.exists() {
        error!(
            "[NexusInstall] Game directory does not exist: {}",
            game_path.display()
        );
        return Err("游戏目录不存在".to_string());
    }

    let mods_path = game_path.join("Mods");
    fs::create_dir_all(&mods_path).map_err(|e| format!("创建 Mods 目录失败: {}", e))?;

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_secs(0))
        .as_millis();
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {}", e))?;
    let working_dir = data_dir.join(format!(
        "nexus_mod_install_{}_{}",
        timestamp,
        DOWNLOAD_COUNTER
            .get_or_init(|| std::sync::atomic::AtomicU64::new(1))
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    fs::create_dir_all(&working_dir).map_err(|e| format!("创建临时目录失败: {}", e))?;

    let zip_path = working_dir.join("mod.zip");
    let extract_dir = working_dir.join("extract");

    let cleanup = || {
        let _ = fs::remove_dir_all(&working_dir);
    };

    let url = download_url.trim().to_string();
    let is_http_url = url.starts_with("http://") || url.starts_with("https://");
    let is_nxm_url = url.to_ascii_lowercase().starts_with("nxm://");
    info!(
        "[NexusInstall] Input classification: is_http_url={}, is_nxm_url={}, url={}",
        is_http_url, is_nxm_url, url
    );
    if !is_http_url && !is_nxm_url {
        cleanup();
        return Err("下载链接不合法".to_string());
    }

    let download_result = if let Some((game_id, file_id, _game_domain, referer_url)) =
        extract_nexus_download_params(&url)
    {
        info!(
            "[NexusInstall] Parsed download params: game_id={}, file_id={}, referer={}",
            game_id, file_id, referer_url
        );
        download_nexus_file_to_path(app.clone(), &game_id, &file_id, &referer_url, &zip_path).await
    } else if is_http_url && looks_like_nexus_files_page(&url) {
        let (game_id, file_id, _game_domain, referer_url) =
            resolve_nexus_download_params_from_files_tab_widget(app.clone(), &url)
                .await
                .map_err(|err| format!("从 Nexus 文件页解析下载参数失败: {}", err))?;
        info!(
            "[NexusInstall] Resolved missing file_id from files tab widget: game_id={}, file_id={}, referer={}",
            game_id, file_id, referer_url
        );
        download_nexus_file_to_path(app.clone(), &game_id, &file_id, &referer_url, &zip_path).await
    } else if is_http_url && looks_like_direct_download_url(&url) {
        info!(
            "[NexusInstall] Using direct HTTP download URL without browser resolution: {}",
            url
        );
        crate::utils::download_file(&url, &zip_path)
    } else {
        warn!(
            "[NexusInstall] Could not parse Nexus download params and URL is not a direct download: {}",
            url
        );
        Err("无法解析 Nexus 下载参数（file_id 或游戏域名），且当前链接不是直接下载链接".to_string())
    };
    if let Err(err) = download_result {
        error!("[NexusInstall] Download failed: {}", err);
        cleanup();
        return Err(format!("下载失败: {}", err));
    }
    match is_zip_file(&zip_path) {
        Ok(true) => {}
        Ok(false) => {
            error!(
                "[NexusInstall] Downloaded file is not a valid ZIP archive: {}",
                zip_path.display()
            );
            cleanup();
            return Err("下载结果不是有效的 ZIP 文件".to_string());
        }
        Err(err) => {
            error!("[NexusInstall] Failed to validate downloaded ZIP: {}", err);
            cleanup();
            return Err(err);
        }
    }

    fs::create_dir_all(&extract_dir).map_err(|e| {
        cleanup();
        format!("创建解压目录失败: {}", e)
    })?;
    if let Err(err) = crate::utils::extract_zip(&zip_path, &extract_dir) {
        error!("[NexusInstall] Extract zip failed: {}", err);
        cleanup();
        return Err(format!("解压失败: {}", err));
    }

    let mut installed_any = false;
    let entries = fs::read_dir(&extract_dir).map_err(|e| format!("读取解压目录失败: {}", e))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("读取解压项失败: {}", e))?;
        let source = entry.path();
        let target = mods_path.join(entry.file_name());

        if target.exists() {
            if target.is_dir() {
                fs::remove_dir_all(&target).map_err(|e| format!("清理旧目录失败: {}", e))?;
            } else {
                fs::remove_file(&target).map_err(|e| format!("清理旧文件失败: {}", e))?;
            }
        }

        if source.is_dir() {
            if let Err(err) = crate::utils::copy_dir_all(&source, &target) {
                cleanup();
                return Err(format!("复制目录失败: {}", err));
            }
        } else {
            fs::copy(&source, &target).map_err(|e| format!("复制文件失败: {}", e))?;
        }
        installed_any = true;
    }

    if !installed_any {
        warn!(
            "[NexusInstall] Extracted archive was empty: {}",
            zip_path.display()
        );
        cleanup();
        return Err("安装文件为空，未写入任何内容".to_string());
    }

    info!(
        "[NexusInstall] Install completed successfully into {}",
        mods_path.display()
    );
    cleanup();
    Ok(serde_json::json!({
        "success": true,
        "message": "mod installed"
    }))
}

#[cfg(test)]
mod tests {
    use super::{
        extract_nexus_download_params, looks_like_direct_download_url, looks_like_nexus_files_page,
    };

    #[test]
    fn parses_nxm_download_url() {
        let url = "nxm://stardewvalley/mods/47260/files/170963?key=2_o9UGKxBxzz4iq2e0G_GA&expires=1781499811&user_id=163085308";

        let (game_id, file_id, game_domain, referer_url) =
            extract_nexus_download_params(url).expect("nxm params");

        assert_eq!(game_id, "1303");
        assert_eq!(file_id, "170963");
        assert_eq!(game_domain, "stardewvalley");
        assert_eq!(
            referer_url,
            "https://www.nexusmods.com/stardewvalley/mods/47260?tab=files&file_id=170963&nmm=1"
        );
    }

    #[test]
    fn parses_nexus_http_file_id_url() {
        let url =
            "https://www.nexusmods.com/stardewvalley/mods/47260?tab=files&file_id=170963&nmm=1";

        let (game_id, file_id, game_domain, referer_url) =
            extract_nexus_download_params(url).expect("http params");

        assert_eq!(game_id, "1303");
        assert_eq!(file_id, "170963");
        assert_eq!(game_domain, "stardewvalley");
        assert_eq!(referer_url, url);
    }

    #[test]
    fn accepts_nexus_mod_page_as_files_tab_fallback_candidate() {
        assert!(looks_like_nexus_files_page(
            "https://www.nexusmods.com/stardewvalley/mods/47260"
        ));
        assert!(looks_like_nexus_files_page(
            "https://www.nexusmods.com/stardewvalley/mods/47260?tab=files"
        ));
        assert!(!looks_like_nexus_files_page(
            "https://www.nexusmods.com/stardewvalley/users/myaccount?tab=download+history"
        ));
        assert!(!looks_like_nexus_files_page(
            "https://imasdk.googleapis.com/js/core/bridge3.html?fid=170963"
        ));
    }

    #[test]
    fn rejects_non_zip_download_like_urls_as_direct_downloads() {
        assert!(looks_like_direct_download_url(
            "https://example.com/files/choose-your-catch.zip"
        ));
        assert!(!looks_like_direct_download_url(
            "https://www.nexusmods.com/stardewvalley/users/myaccount?tab=download+history"
        ));
        assert!(!looks_like_direct_download_url(
            "https://imasdk.googleapis.com/js/core/bridge3.html?fid=170963"
        ));
        assert!(!looks_like_direct_download_url(
            "https://www.nexusmods.com/stardewvalley/mods/47260?tab=files"
        ));
    }
}
