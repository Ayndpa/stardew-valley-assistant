use std::fs;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;
use serde_json::Value;
use tauri::Emitter;
use tauri::Manager;

use super::browser::{
    check_cloudflare_challenge, create_nexus_webview, eval_js_timeout,
    update_window_visibility_for_cf,
};

struct LoginStatusCache {
    result: Value,
    timestamp: Instant,
}

static LOGIN_STATUS_CACHE: OnceLock<Mutex<Option<LoginStatusCache>>> = OnceLock::new();
static LOGIN_IN_PROGRESS: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
static API_KEY_IN_PROGRESS: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();

#[tauri::command]
pub async fn open_nexus_login_window(app: tauri::AppHandle) -> Result<(), String> {
    let url_str = "https://users.nexusmods.com/auth/sign_in".to_string();
    let url = url_str.parse::<tauri::Url>().map_err(|e| e.to_string())?;

    let handle = app.clone();

    tauri::async_runtime::spawn(async move {
        use tauri::Emitter;

        let window = match create_nexus_webview(
            &handle,
            "nexus-login",
            "NexusMods 登录",
            url,
            true,
            true,
        ) {
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

                let snapshot: Value = match serde_json::from_str(&snapshot_json) {
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
pub async fn check_nexus_login_status(app: tauri::AppHandle) -> Result<Value, String> {
    println!("[NexusLoginCheck] check_nexus_login_status command called");

    // 1. Check if we have a very recent successful check in the cache (e.g., within 5 seconds)
    let cache_mutex = LOGIN_STATUS_CACHE.get_or_init(|| Mutex::new(None));
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
                    timestamp: Instant::now(),
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
                timestamp: Instant::now(),
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
                true,
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

            let snapshot: Value = match serde_json::from_str(&snapshot_json) {
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
            timestamp: Instant::now(),
        });
    }

    Ok(final_res)
}

#[tauri::command]
pub async fn fetch_nexus_api_key(
    app: tauri::AppHandle,
    force: Option<bool>,
) -> Result<Value, String> {
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
        true,
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
                    if let Ok(status) = serde_json::from_str::<Value>(&status_res) {
                        let s = status.get("s").and_then(|v| v.as_str()).unwrap_or_default();
                        match s {
                            "done" => {
                                if let Some(data_str) = eval_js(&poll_window, graphql_retrieve_js) {
                                    if let Ok(data) = serde_json::from_str::<Value>(&data_str) {
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
                true,
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
