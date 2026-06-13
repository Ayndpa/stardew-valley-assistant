use log::{debug, error, info, warn};
use serde_json::Value;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Manager;

use super::browser::{
    check_cloudflare_challenge, create_nexus_webview, eval_js_timeout,
    update_window_visibility_for_cf,
};
use super::download::NexusDownloadMetadata;
use super::url_utils::{
    extract_game_domain, extract_nexus_download_params, extract_nexus_mod_id, game_id_from_domain,
};

static DOWNLOAD_COUNTER: OnceLock<AtomicU64> = OnceLock::new();

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

                let error_page_type = snapshot
                    .get("errorPageType")
                    .and_then(|v| v.as_str());

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

pub async fn fetch_nexus_download_metadata_via_browser(
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
        .get_or_init(|| AtomicU64::new(1))
        .fetch_add(1, Ordering::Relaxed);
    let window_label = format!("nexus-download-metadata-{}-{}", request_id, sequence);

    let window = create_nexus_webview(
        &handle,
        &window_label,
        "Nexus 模组信息获取中...",
        parse_url,
        false,
        true,
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
                true,
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

pub async fn resolve_nexus_download_params_from_files_tab_widget(
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
        .get_or_init(|| AtomicU64::new(1))
        .fetch_add(1, Ordering::Relaxed);
    let window_label = format!("nexus-files-tab-{}-{}-{}", mod_id, request_id, sequence);

    let window = create_nexus_webview(
        &handle,
        &window_label,
        "Nexus 文件列表获取中...",
        parse_url,
        false,
        true,
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
                                if (/../i.test(attr.name) && /^\d{3,}$/.test(value) && (attr.name.toLowerCase().includes('id') || attr.name.toLowerCase().includes('fid'))) {
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
                true,
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

pub async fn fetch_nexus_download_url_via_browser(
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
        .get_or_init(|| AtomicU64::new(1))
        .fetch_add(1, Ordering::Relaxed);
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
        true,
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
                true,
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

                    // We will call the parser from our parent module or directly from here. Since parse_download_url_from_body is defined in download.rs, we will import it or duplicate it.
                    // Wait, parse_download_url_from_body is a simple parser, let's look at it. It only calls parse_download_url_from_payload, which is also in download.rs.
                    // Let's import it from super::download or duplicate the parse logic here. Wait, parse_download_url_from_body is also called in download.rs. Let's make it pub in download.rs and import here.
                    let url = super::download::parse_download_url_from_body(payload)
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
