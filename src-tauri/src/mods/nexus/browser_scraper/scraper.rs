use log::{error, info, warn};
use tauri::Manager;

use super::super::browser::{
    check_cloudflare_challenge, create_nexus_webview, eval_js_timeout,
    update_window_visibility_for_cf,
};

#[tauri::command]
pub async fn open_scraper_window(app: tauri::AppHandle, mod_id: String) -> Result<(), String> {
    info!("[Scraper] Opening Nexus scraper for mod_id={}", mod_id);
    let url_str = format!("https://www.nexusmods.com/stardewvalley/mods/{}", mod_id);
    let url = url_str.parse::<tauri::Url>().map_err(|e| e.to_string())?;

    let handle = app.clone();
    let request_mod_id = mod_id.clone();
    let window_label = format!("nexus-scraper-{}", mod_id);

    tauri::async_runtime::spawn(async move {
        use tauri::Emitter;

        let window =
            match create_nexus_webview(&handle, &window_label, "Nexus 验证中...", url, false, true)
            {
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
        let poll_window_label = window_label.clone();
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
                if poll_handle.get_webview_window(&poll_window_label).is_none() {
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
                    true,
                    "Nexus 需要验证",
                    "Nexus 页面加载中...",
                );

                if is_challenge {
                    last_title = "Nexus 需要验证".to_string();
                } else if last_title != "Nexus 页面加载中..." {
                    last_title = "Nexus 页面加载中...".to_string();
                }

                // Check page state directly
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

                            // Detect Nexus error pages
                            const bodyText = (document.body ? document.body.innerText : "").trim();
                            const pageTitle = (document.querySelector("#pagetitle h1")?.textContent || "").trim();
                            const isNotFoundPage =
                                (pageTitle.toLowerCase() === "not found" && bodyText.includes("couldn't be found")) ||
                                bodyText.includes("The mod you were looking for couldn't be found");
                            const isRemovedPage =
                                bodyText.includes("was removed by its author") ||
                                bodyText.includes("Removed by author");
                            const isHiddenPage =
                                bodyText.includes("has been hidden") && bodyText.includes("author");
                            const errorPageType = isNotFoundPage ? "not_found" : (isRemovedPage ? "removed" : (isHiddenPage ? "hidden" : null));

                            return {
                                readyState: document.readyState,
                                hasDetails: hasNexusPageMarker,
                                hasRichContent,
                                errorPageType,
                                html
                            };
                        } catch (error) {
                            return {
                                readyState: "error",
                                hasDetails: false,
                                hasRichContent: false,
                                errorPageType: null,
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

                let error_page_type = snapshot.get("errorPageType").and_then(|v| v.as_str());

                // Detect Nexus error pages early and notify frontend
                if !is_challenge && ready_state == "complete" && error_page_type.is_some() {
                    let error_msg = match error_page_type.unwrap() {
                        "not_found" => "该模组不存在，可能是 ID 错误或模组已被删除。",
                        "removed" => "该模组已被作者从 NexusMods 移除，无法查看。",
                        "hidden" => "该模组已被作者暂时隐藏，目前无法查看。",
                        _ => "该模组页面无法访问。",
                    };
                    warn!(
                        "[Scraper] Detected error page ({}) for mod_id={}",
                        error_page_type.unwrap(),
                        poll_mod_id
                    );
                    let _ = poll_handle.emit(
                        "respond-nexus-html",
                        serde_json::json!({
                            "modId": poll_mod_id.clone(),
                            "error": error_msg
                        }),
                    );
                    let _ = poll_window.destroy();
                    return;
                }

                if !is_challenge && ready_state == "complete" && has_details {
                    if has_rich_content {
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

#[tauri::command]
pub async fn close_scraper_window(app: tauri::AppHandle, mod_id: String) -> Result<(), String> {
    let window_label = format!("nexus-scraper-{}", mod_id);
    if let Some(window) = app.get_webview_window(&window_label) {
        info!(
            "[Scraper] Closing Nexus scraper window for mod_id={}, label={}",
            mod_id, window_label
        );
        window.destroy().map_err(|e| {
            format!(
                "Failed to destroy WebView window ({}): {:?}",
                window_label, e
            )
        })?;
    }
    Ok(())
}
