use log::{debug, info, warn};
use serde_json::Value;
use std::sync::atomic::Ordering;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Manager;

use super::super::browser::{
    check_cloudflare_challenge, create_nexus_webview, eval_js_timeout,
    update_window_visibility_for_cf,
};
use super::super::url_utils::{
    extract_game_domain, extract_nexus_download_params, extract_nexus_mod_id, game_id_from_domain,
};
use super::DOWNLOAD_COUNTER;

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
        .get_or_init(|| std::sync::atomic::AtomicU64::new(1))
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
