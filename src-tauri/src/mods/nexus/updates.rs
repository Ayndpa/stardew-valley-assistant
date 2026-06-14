use std::collections::HashMap;
use std::fs;
use std::time::Duration;

use log::{info, warn};
use serde::{Deserialize, Serialize};
use tauri::Manager;

const NEXUS_API_BASE: &str = "https://api.nexusmods.com/v1/games/stardewvalley/mods";
const REQUEST_DELAY_MS: u64 = 500;
const CACHE_FILE_NAME: &str = "mod_updates_cache.json";
const CACHE_MAX_AGE_SECS: u64 = 7 * 24 * 60 * 60; // 7 days

#[derive(Serialize, Deserialize, Debug, Clone)]
struct UpdateCacheEntry {
    version: String,
    checked_at: String, // ISO 8601 timestamp
}

/// Query the NexusMods REST API v1 for the latest version of a single mod.
///
/// Returns `Some(version_string)` on success, `None` on failure.
fn fetch_mod_latest_version(api_key: &str, mod_id: u64) -> Option<String> {
    let url = format!("{}/{}.json", NEXUS_API_BASE, mod_id);

    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(15))
        .timeout_read(Duration::from_secs(30))
        .build();

    match agent
        .get(&url)
        .set("apikey", api_key)
        .set("Accept", "application/json")
        .call()
    {
        Ok(response) => match response.into_string() {
            Ok(body) => match serde_json::from_str::<serde_json::Value>(&body) {
                Ok(json) => {
                    if let Some(version) = json.get("version").and_then(|v| v.as_str()) {
                        let v = version.trim().to_string();
                        if !v.is_empty() {
                            info!("[ModUpdateCheck] Mod {} latest version: {}", mod_id, v);
                            return Some(v);
                        }
                    }
                    warn!(
                        "[ModUpdateCheck] Mod {} response missing 'version' field or empty",
                        mod_id
                    );
                    None
                }
                Err(e) => {
                    warn!(
                        "[ModUpdateCheck] Failed to parse JSON for mod {}: {}",
                        mod_id, e
                    );
                    None
                }
            },
            Err(e) => {
                warn!(
                    "[ModUpdateCheck] Failed to read response body for mod {}: {}",
                    mod_id, e
                );
                None
            }
        },
        Err(ureq::Error::Status(403, _)) => {
            warn!(
                "[ModUpdateCheck] Mod {} returned 403 Forbidden (API key may be invalid)",
                mod_id
            );
            None
        }
        Err(ureq::Error::Status(404, _)) => {
            warn!("[ModUpdateCheck] Mod {} not found (404)", mod_id);
            None
        }
        Err(ureq::Error::Status(429, _)) => {
            warn!("[ModUpdateCheck] Rate limited (429) on mod {}", mod_id);
            None
        }
        Err(e) => {
            warn!("[ModUpdateCheck] HTTP error for mod {}: {}", mod_id, e);
            None
        }
    }
}

/// Get the cache file path in the app data directory.
fn get_cache_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let cache_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {}", e))?;
    let _ = fs::create_dir_all(&cache_dir);
    Ok(cache_dir.join(CACHE_FILE_NAME))
}

/// Read the update cache from disk.
fn read_cache(app: &tauri::AppHandle) -> HashMap<u64, UpdateCacheEntry> {
    let Ok(path) = get_cache_path(app) else {
        return HashMap::new();
    };
    if !path.exists() {
        return HashMap::new();
    }
    let Ok(content) = fs::read_to_string(&path) else {
        return HashMap::new();
    };
    serde_json::from_str(&content).unwrap_or_default()
}

/// Write the update cache to disk.
fn write_cache(app: &tauri::AppHandle, cache: &HashMap<u64, UpdateCacheEntry>) {
    let Ok(path) = get_cache_path(app) else {
        return;
    };
    if let Ok(json) = serde_json::to_string_pretty(cache) {
        let _ = fs::write(&path, json);
    }
}

/// Check if a cache entry is still valid (within 7 days).
fn is_cache_valid(entry: &UpdateCacheEntry) -> bool {
    if let Ok(checked_time) = chrono::DateTime::parse_from_rfc3339(&entry.checked_at) {
        let elapsed = chrono::Utc::now().signed_duration_since(checked_time);
        return elapsed.num_seconds() < CACHE_MAX_AGE_SECS as i64;
    }
    false
}

/// Load cached mod update results.
///
/// Returns a map of `nexusId -> latestVersion` for all mods with valid (non-expired) cache entries.
#[tauri::command]
pub async fn load_cached_mod_updates(
    app: tauri::AppHandle,
) -> Result<HashMap<u64, String>, String> {
    let cache = read_cache(&app);
    let mut result = HashMap::new();

    for (mod_id, entry) in &cache {
        if is_cache_valid(entry) {
            result.insert(*mod_id, entry.version.clone());
        }
    }

    info!(
        "[ModUpdateCheck] Loaded {} cached version entries ({} total in cache)",
        result.len(),
        cache.len()
    );

    Ok(result)
}

/// Check for updates for multiple mods via the NexusMods REST API v1.
///
/// Behavior:
/// - If `force` is false (default): returns cached results for mods with valid cache,
///   and only queries the API for mods without cache or with expired cache.
/// - If `force` is true: ignores cache and queries all mods from the API.
///
/// Returns a map of `mod_id -> latest_version`.
#[tauri::command]
pub async fn check_mod_updates(
    app: tauri::AppHandle,
    mod_ids: Vec<u64>,
    force: Option<bool>,
) -> Result<HashMap<u64, String>, String> {
    let is_force = force.unwrap_or(false);
    info!(
        "[ModUpdateCheck] Starting update check for {} mods (force={})",
        mod_ids.len(),
        is_force
    );

    // Read the cached API key
    let api_key_path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {}", e))?
        .join("nexus_api_key.txt");

    if !api_key_path.exists() {
        return Err("未找到 NexusMods API Key，请先在设置中登录 NexusMods 账号。".to_string());
    }

    let api_key = fs::read_to_string(&api_key_path)
        .map_err(|e| format!("读取 API Key 失败: {}", e))?
        .trim()
        .to_string();

    if api_key.len() < 10 {
        return Err("NexusMods API Key 无效，请在设置中重新登录。".to_string());
    }

    // Load existing cache
    let mut cache = read_cache(&app);

    // Determine which mods need API fetching
    let ids_to_fetch: Vec<u64> = if is_force {
        mod_ids.clone()
    } else {
        mod_ids
            .iter()
            .filter(|&&id| cache.get(&id).map(|e| !is_cache_valid(e)).unwrap_or(true))
            .copied()
            .collect()
    };

    let cached_count = mod_ids.len() - ids_to_fetch.len();
    if cached_count > 0 {
        info!(
            "[ModUpdateCheck] {} mods have valid cache, {} need API fetch",
            cached_count,
            ids_to_fetch.len()
        );
    }

    // Fetch from API if needed
    if !ids_to_fetch.is_empty() {
        let key = api_key.clone();
        let ids = ids_to_fetch.clone();

        let fetched = tokio::task::spawn_blocking(move || {
            let mut version_map: HashMap<u64, String> = HashMap::new();
            let total = ids.len();

            for (i, &mod_id) in ids.iter().enumerate() {
                if let Some(version) = fetch_mod_latest_version(&key, mod_id) {
                    version_map.insert(mod_id, version);
                }

                // Delay between requests to respect rate limits
                if i < total - 1 {
                    std::thread::sleep(Duration::from_millis(REQUEST_DELAY_MS));
                }
            }

            version_map
        })
        .await
        .map_err(|e| format!("更新检查任务失败: {}", e))?;

        let now = chrono::Utc::now().to_rfc3339();

        // Update cache with fetched results
        for (mod_id, version) in &fetched {
            cache.insert(
                *mod_id,
                UpdateCacheEntry {
                    version: version.clone(),
                    checked_at: now.clone(),
                },
            );
        }

        // Mark fetched mods that returned no version (404, etc.) with current timestamp
        // to avoid re-fetching them every time within the cache window
        for &mod_id in &ids_to_fetch {
            if !fetched.contains_key(&mod_id) {
                cache.insert(
                    mod_id,
                    UpdateCacheEntry {
                        version: String::new(), // empty = no version available
                        checked_at: now.clone(),
                    },
                );
            }
        }

        // Persist updated cache
        write_cache(&app, &cache);

        info!(
            "[ModUpdateCheck] API fetch completed. {} of {} mods returned version info.",
            fetched.len(),
            ids_to_fetch.len()
        );
    }

    // Build final result from cache (all requested mod_ids)
    let mut result: HashMap<u64, String> = HashMap::new();
    for &mod_id in &mod_ids {
        if let Some(entry) = cache.get(&mod_id) {
            if !entry.version.is_empty() {
                result.insert(mod_id, entry.version.clone());
            }
        }
    }

    info!(
        "[ModUpdateCheck] Completed. {}/{} mods have version info.",
        result.len(),
        mod_ids.len()
    );

    Ok(result)
}
