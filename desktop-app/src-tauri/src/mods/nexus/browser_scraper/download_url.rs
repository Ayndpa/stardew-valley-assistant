use log::{debug, error, info, warn};
use serde_json::Value;
use std::sync::atomic::Ordering;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Manager;

use super::super::browser::{
    check_cloudflare_challenge, create_nexus_webview, eval_js_timeout,
    update_window_visibility_for_cf,
};
use super::DOWNLOAD_COUNTER;

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
        .get_or_init(|| std::sync::atomic::AtomicU64::new(1))
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

                    let url = super::super::download::parse_download_url_from_body(payload)
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
