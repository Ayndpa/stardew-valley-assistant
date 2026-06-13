use log::{debug, error, info, warn};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Emitter;
use tauri::Manager;

use crate::download_control::emit_download_progress;
use super::url_utils::{
    extract_nexus_download_params, looks_like_nexus_files_page,
    looks_like_direct_download_url, is_zip_file, extract_nexus_mod_id,
};
use super::browser_scraper::{
    fetch_nexus_download_metadata_via_browser,
    resolve_nexus_download_params_from_files_tab_widget,
};

static DOWNLOAD_COUNTER: OnceLock<AtomicU64> = OnceLock::new();

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NexusDownloadMetadata {
    pub mod_name: String,
    pub author: String,
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

pub fn parse_download_url_from_body(text: &str) -> Option<String> {
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


async fn download_nexus_file_to_path(
    app: tauri::AppHandle,
    task_id: &str,
    game_id: &str,
    file_id: &str,
    referer_url: &str,
    zip_path: &std::path::Path,
) -> Result<(), String> {
    let page_download_url =
        super::browser_scraper::fetch_nexus_download_url_via_browser(app.clone(), game_id, file_id, referer_url)
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

    crate::utils::download_file_with_headers_and_progress(&app, task_id, &target_url, zip_path, &[])
}


#[tauri::command]
pub async fn install_nexus_mod(
    app: tauri::AppHandle,
    game_dir: String,
    download_url: String,
    task_id: Option<String>,
) -> Result<serde_json::Value, String> {
    let task_id = task_id.unwrap_or_else(|| "nexus-install".to_string());
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
            .get_or_init(|| AtomicU64::new(1))
            .fetch_add(1, Ordering::Relaxed)
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
        download_nexus_file_to_path(app.clone(), &task_id, &game_id, &file_id, &referer_url, &zip_path).await
    } else if is_http_url && looks_like_nexus_files_page(&url) {
        let (game_id, file_id, _game_domain, referer_url) =
            resolve_nexus_download_params_from_files_tab_widget(app.clone(), &url)
                .await
                .map_err(|err| format!("从 Nexus 文件页解析下载参数失败: {}", err))?;
        info!(
            "[NexusInstall] Resolved missing file_id from files tab widget: game_id={}, file_id={}, referer={}",
            game_id, file_id, referer_url
        );
        download_nexus_file_to_path(app.clone(), &task_id, &game_id, &file_id, &referer_url, &zip_path).await
    } else if is_http_url && looks_like_direct_download_url(&url) {
        info!(
            "[NexusInstall] Using direct HTTP download URL without browser resolution: {}",
            url
        );
        crate::utils::download_file_with_headers_and_progress(&app, &task_id, &url, &zip_path, &[])
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
    emit_download_progress(&app, &task_id, "extracting", 100.0, 0, None, "正在解压模组压缩包...");
    if let Err(err) = crate::utils::extract_zip(&zip_path, &extract_dir) {
        error!("[NexusInstall] Extract zip failed: {}", err);
        cleanup();
        return Err(format!("解压失败: {}", err));
    }

    let mut installed_any = false;
    emit_download_progress(&app, &task_id, "installing", 100.0, 0, None, "正在安装到 Mods 目录...");
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
    emit_download_progress(&app, &task_id, "finished", 100.0, 0, None, "模组安装完成");
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

