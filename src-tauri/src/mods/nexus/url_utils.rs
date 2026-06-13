use std::fs;
use std::path::Path;

pub fn parse_query_param(url: &str, key: &str) -> Option<String> {
    let base = if let Some(pos) = url.find('?') {
        &url[pos + 1..]
    } else {
        return None;
    };

    let query = base.split('#').next().unwrap_or(base);
    for pair in query.split('&') {
        let mut parts = pair.splitn(2, '=');
        let pair_key = parts.next()?;
        if pair_key.eq_ignore_ascii_case(key) {
            return Some(parts.next().unwrap_or("").to_string());
        }
    }
    None
}

pub fn extract_game_domain(url: &str) -> Option<String> {
    if let Some(rest) = url.strip_prefix("nxm://") {
        return rest
            .split(['/', '?', '#'])
            .find(|seg| !seg.is_empty())
            .map(|seg| seg.to_string());
    }

    let path = url.split('#').next()?.split('?').next()?;
    let segments: Vec<&str> = path.split('/').filter(|seg| !seg.is_empty()).collect();
    for i in 0..segments.len() {
        if segments[i] == "mods" && i >= 1 {
            return Some(segments[i - 1].to_string());
        }
    }
    None
}

pub fn extract_path_value_after(url: &str, marker: &str) -> Option<String> {
    let path = url.split('#').next()?.split('?').next()?;
    let segments: Vec<&str> = path.split('/').filter(|seg| !seg.is_empty()).collect();
    for i in 0..segments.len() {
        if segments[i].eq_ignore_ascii_case(marker) && i + 1 < segments.len() {
            return Some(segments[i + 1].to_string());
        }
    }
    None
}

pub fn extract_nexus_mod_id(url: &str) -> Option<String> {
    extract_path_value_after(url, "mods")
}

pub fn game_id_from_domain(game_domain: &str) -> Option<String> {
    match game_domain {
        "stardewvalley" => Some("1303".to_string()),
        _ => None,
    }
}

pub fn extract_nexus_download_params(url: &str) -> Option<(String, String, String, String)> {
    let file_id = parse_query_param(url, "file_id")
        .or_else(|| parse_query_param(url, "fid"))
        .or_else(|| extract_path_value_after(url, "files"))?;
    let game_domain = extract_game_domain(url).unwrap_or_else(|| "stardewvalley".to_string());
    let game_id = game_id_from_domain(&game_domain)?;
    let referer_url = if url.trim_start().to_ascii_lowercase().starts_with("nxm://") {
        let mod_id = extract_path_value_after(url, "mods")?;
        format!(
            "https://www.nexusmods.com/{}/mods/{}?tab=files&file_id={}&nmm=1",
            game_domain, mod_id, file_id
        )
    } else {
        url.to_string()
    };
    Some((game_id, file_id, game_domain, referer_url))
}

pub fn looks_like_nexus_files_page(url: &str) -> bool {
    let lower = url.trim().to_ascii_lowercase();
    if !lower.starts_with("http://") && !lower.starts_with("https://") {
        return false;
    }

    if !lower.contains("nexusmods.com") {
        return false;
    }

    let game_domain = match extract_game_domain(&lower) {
        Some(value) => value,
        None => return false,
    };
    if game_id_from_domain(&game_domain).is_none() {
        return false;
    }
    true
}

pub fn looks_like_direct_download_url(url: &str) -> bool {
    let lower = url.trim().to_ascii_lowercase();
    if lower.is_empty() {
        return false;
    }

    if lower.contains("/users/myaccount")
        || lower.contains("tab=download+history")
        || lower.contains("tab=download%20history")
        || lower.contains("/collections")
        || lower.contains("imasdk.googleapis.com")
        || lower.contains("googlesyndication.com")
        || lower.contains("doubleclick.net")
    {
        return false;
    }

    let path = lower
        .split('#')
        .next()
        .unwrap_or(&lower)
        .split('?')
        .next()
        .unwrap_or(&lower);
    path.ends_with(".zip") || path.ends_with(".zip/")
}

pub fn is_zip_file(path: &Path) -> Result<bool, String> {
    let bytes = fs::read(path).map_err(|e| format!("读取下载文件失败: {}", e))?;
    if bytes.len() < 4 {
        return Ok(false);
    }

    Ok(bytes.starts_with(b"PK\x03\x04")
        || bytes.starts_with(b"PK\x05\x06")
        || bytes.starts_with(b"PK\x07\x08"))
}
