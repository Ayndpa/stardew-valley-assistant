use serde_json::Value;
use std::fs;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;
use tauri::Manager;

use super::browser::{
    check_cloudflare_challenge, create_nexus_webview, eval_js_timeout,
    update_window_visibility_for_cf,
};

static RANKING_COUNTER: OnceLock<AtomicU64> = OnceLock::new();

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
    let counter = RANKING_COUNTER.get_or_init(|| AtomicU64::new(0));
    let id = counter.fetch_add(1, Ordering::Relaxed);
    let window_label = format!("nexus-ranking-scraper-{}", id);

    // Lightweight page just to pass Cloudflare and obtain session cookies
    let url_str = "https://www.nexusmods.com/robots.txt".to_string();
    let url = url_str.parse::<tauri::Url>().map_err(|e| e.to_string())?;

    let handle = app.clone();

    tauri::async_runtime::spawn(async move {
        use tauri::Emitter;

        let window = match create_nexus_webview(
            &handle,
            &window_label,
            "Nexus 模组加载中...",
            url,
            false,
            true,
        ) {
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
                    true,
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
pub async fn fetch_smapi_compatibility_mods(app: tauri::AppHandle) -> Result<Vec<Value>, String> {
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
    let fetch_result = (|| -> Result<Vec<Value>, String> {
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

        let parsed_json: Vec<Value> = serde_json::from_str(&json_content)
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
                    if let Ok(mods) = serde_json::from_str::<Vec<Value>>(&cached) {
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
