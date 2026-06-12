use std::fs;
use tauri::Manager;

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
    if let Err(e) = win.eval_with_callback(js, move |result| { let _ = tx.send(result); }) {
        println!("[eval_js_timeout] ({}) eval_with_callback error: {:?}", win.label(), e);
        return None;
    }
    match rx.recv_timeout(std::time::Duration::from_secs(timeout_secs)) {
        Ok(res) => Some(res),
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
            println!("[eval_js_timeout] ({}) JS evaluation timed out after {} seconds", win.label(), timeout_secs);
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
pub async fn open_nexus_ranking_scraper(
    app: tauri::AppHandle,
    offset: i32,
    sort_field: String,
    sort_direction: String,
    search_query: String,
) -> Result<(), String> {
    // Lightweight page just to pass Cloudflare and obtain session cookies
    let url_str = "https://www.nexusmods.com/robots.txt".to_string();
    let url = url_str.parse::<tauri::Url>().map_err(|e| e.to_string())?;

    let handle = app.clone();

    tauri::async_runtime::spawn(async move {
        use tauri::Emitter;

        let window = match create_nexus_webview(&handle, "nexus-ranking-scraper", "Nexus 模组加载中...", url, false) {
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

            let emit_event = |payload: serde_json::Value| {
                let mut full_payload = payload;
                if let Some(obj) = full_payload.as_object_mut() {
                    obj.insert("offset".to_string(), serde_json::json!(offset));
                    obj.insert("sort_field".to_string(), serde_json::json!(sort_field));
                    obj.insert("sort_direction".to_string(), serde_json::json!(sort_direction));
                    obj.insert("search_query".to_string(), serde_json::json!(search_query));
                }
                let _ = poll_handle.emit("respond-nexus-ranking-html", full_payload);
            };

            let eval_js = |win: &tauri::WebviewWindow, js: &str| -> Option<String> {
                eval_js_timeout(win, js, 10)
            };

            let escaped_search = search_query.replace('\\', "\\\\").replace('"', "\\\"");
            let name_filter = if escaped_search.is_empty() {
                "[]".to_string()
            } else {
                format!(r#"[{{ op: "CONTAINS", value: "{}" }}]"#, escaped_search)
            };

            let variables_json = format!(
                r#"{{
                                    count: 20,
                                    facets: {{ categoryName: [], languageName: [], tag: [] }},
                                    filter: {{ adultContent: [{{ op: "EQUALS", value: false }}], filter: [], gameDomainName: [{{ op: "EQUALS", value: "stardewvalley" }}], name: {} }},
                                    offset: {},
                                    postFilter: {{}},
                                    sort: [{{ {}: {{ direction: "{}" }} }}]
                                }}"#,
                name_filter, offset, sort_field, sort_direction
            );

            // JS #1: fire the GraphQL fetch, store result in window variable
            let mut graphql_fire_js = format!(r##"
                (() => {{
                    try {{
                        if (window.__nexusGraphQLDone || window.__nexusGraphQLFetching) return 'skip';
                        window.__nexusGraphQLFetching = true;
                        fetch('https://api-router.nexusmods.com/graphql', {{
                            method: 'POST',
                            headers: {{ 'Content-Type': 'application/json', 'X-GraphQL-OperationName': 'ModsListing' }},
                            body: JSON.stringify({{
                                query: `
                                    query ModsListing($count: Int = 0, $facets: ModsFacet, $filter: ModsFilter, $offset: Int, $postFilter: ModsFilter, $sort: [ModsSort!]) {{
                                      mods(count: $count, facets: $facets, filter: $filter, offset: $offset, postFilter: $postFilter, sort: $sort, viewUserBlockedContent: false) {{
                                        facetsData
                                        nodes {{ ...ModTileFragment }}
                                        totalCount
                                      }}
                                    }}
                                    fragment ModTileFragment on Mod {{
                                      adultContent createdAt downloads endorsements fileSize
                                      game {{ domainName id name }}
                                      modCategory {{ categoryId name }}
                                      modId name status summary
                                      thumbnailUrl thumbnailBlurredUrl uid updatedAt
                                      uploader {{ avatar memberId name }}
                                      viewerDownloaded viewerEndorsed viewerTracked viewerUpdateAvailable viewerIsBlocked
                                    }}
                                `,
                                variables: {},
                                operationName: 'ModsListing'
                            }}),
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
            "##, variables_json);

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
                // Check if window still exists
                if poll_handle.get_webview_window("nexus-ranking-scraper").is_none() {
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
                                            emit_event(serde_json::json!({ "mods": data }));
                                        } else {
                                            emit_event(serde_json::json!({ "error": "GraphQL 数据解析失败" }));
                                        }
                                    } else {
                                        emit_event(serde_json::json!({ "error": "无法从 WebView 获取数据" }));
                                    }
                                    let _ = poll_window.destroy();
                                    return;
                                }
                                "error" => {
                                    let err = status.get("e").and_then(|v| v.as_str()).unwrap_or("unknown");
                                    println!("[RankingScraper] GraphQL error: {}", err);
                                    emit_event(serde_json::json!({ "error": format!("GraphQL 请求失败: {}", err) }));
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
                // Check if window still exists
                if poll_handle.get_webview_window("nexus-login").is_none() {
                    println!("[NexusLogin] Window was destroyed, exiting loop");
                    break;
                }

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

    println!("[NexusLoginCheck] check_nexus_login_status command called");

    let data_dir = app
        .path()
        .app_data_dir()
        .ok()
        .map(|p| p.join("webview_data"));

    println!("[NexusLoginCheck] data_dir resolved: {:?}", data_dir);

    // If no webview_data dir exists, we're definitely not logged in
    if let Some(ref dir) = data_dir {
        if !dir.exists() {
            println!("[NexusLoginCheck] webview_data directory does not exist, returning not logged in.");
            return Ok(serde_json::json!({ "loggedIn": false, "username": "" }));
        }
    } else {
        println!("[NexusLoginCheck] app_data_dir returned None, returning not logged in.");
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
                // Check if window still exists
                if poll_handle.get_webview_window("nexus-scraper").is_none() {
                    println!("[Scraper] Window was destroyed, exiting loop");
                    break;
                }

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
