use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateInfo {
    pub has_update: bool,
    pub current_version: String,
    pub latest_version: String,
    pub release_url: String,
    pub release_notes: String,
    pub published_at: String,
}

#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    html_url: String,
    body: Option<String>,
    published_at: String,
}

/// Parse version string like "v0.1.1" or "0.1.1" into a comparable tuple
fn parse_version(version: &str) -> Option<(u32, u32, u32)> {
    let v = version.trim_start_matches('v');
    let parts: Vec<&str> = v.split('.').collect();
    if parts.len() >= 3 {
        let major = parts[0].parse().ok()?;
        let minor = parts[1].parse().ok()?;
        let patch = parts[2].parse().ok()?;
        Some((major, minor, patch))
    } else {
        None
    }
}

/// Check for updates from GitHub releases
#[tauri::command]
pub fn check_for_updates(current_version: String) -> Result<UpdateInfo, String> {
    let url = "https://api.github.com/repos/Ayndpa/stardew-valley-assistant/releases/latest";

    let agent = ureq::AgentBuilder::new()
        .timeout_connect(std::time::Duration::from_secs(10))
        .timeout_read(std::time::Duration::from_secs(10))
        .build();

    let response = agent
        .get(url)
        .set("User-Agent", "stardew-valley-assistant")
        .set("Accept", "application/vnd.github.v3+json")
        .call()
        .map_err(|e| format!("Failed to fetch update info: {}", e))?;

    let body = response
        .into_string()
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    let release: GitHubRelease = serde_json::from_str(&body)
        .map_err(|e| format!("Failed to parse update info: {}", e))?;

    let current = parse_version(&current_version)
        .ok_or_else(|| format!("Invalid current version: {}", current_version))?;

    let latest = parse_version(&release.tag_name)
        .ok_or_else(|| format!("Invalid latest version: {}", release.tag_name))?;

    let has_update = latest > current;

    Ok(UpdateInfo {
        has_update,
        current_version,
        latest_version: release.tag_name,
        release_url: release.html_url,
        release_notes: release.body.unwrap_or_default(),
        published_at: release.published_at,
    })
}
