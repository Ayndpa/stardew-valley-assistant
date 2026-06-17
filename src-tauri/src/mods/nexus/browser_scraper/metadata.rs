use serde_json::Value;
use std::sync::atomic::Ordering;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Manager;

use super::super::browser::{
    check_cloudflare_challenge, create_nexus_webview, eval_js_timeout,
    update_window_visibility_for_cf,
};
use super::super::download::NexusDownloadMetadata;
use super::DOWNLOAD_COUNTER;

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
        .get_or_init(|| std::sync::atomic::AtomicU64::new(1))
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
