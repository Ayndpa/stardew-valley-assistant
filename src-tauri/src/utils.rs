use std::fs;
use std::io::Read;
use std::path::Path;

#[tauri::command]
pub fn open_in_file_manager(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err("Path does not exist".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(p)
            .spawn()
            .map_err(|e| format!("Failed to open explorer: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(p)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(p)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    Ok(())
}

pub fn download_file_with_headers(url: &str, dest: &Path, headers: &[(&str, &str)]) -> Result<(), String> {
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(std::time::Duration::from_secs(15))
        .timeout_read(std::time::Duration::from_secs(60))
        .build();

    let max_retries = 3;
    let mut last_err = String::new();

    for attempt in 1..=max_retries {
        let mut req = agent.get(url);
        for (key, value) in headers {
            req = req.set(key, value);
        }
        match req.call() {
            Ok(response) => {
                let mut bytes = Vec::new();
                response
                    .into_reader()
                    .read_to_end(&mut bytes)
                    .map_err(|e| format!("Failed to read response body: {}", e))?;

                if let Some(parent) = dest.parent() {
                    fs::create_dir_all(parent)
                        .map_err(|e| format!("Failed to create parent directory: {}", e))?;
                }

                fs::write(dest, &bytes)
                    .map_err(|e| format!("Failed to write file to {}: {}", dest.display(), e))?;

                return Ok(());
            }
            Err(e) => {
                last_err = format!("HTTP request failed (attempt {}/{}): {}", attempt, max_retries, e);
                if attempt < max_retries {
                    std::thread::sleep(std::time::Duration::from_secs(2));
                }
            }
        }
    }

    Err(last_err)
}

pub fn download_file(url: &str, dest: &Path) -> Result<(), String> {
    download_file_with_headers(url, dest, &[])
}

pub fn extract_zip(zip_path: &Path, dest_dir: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let output = std::process::Command::new("powershell")
            .args(&[
                "-NoProfile",
                "-Command",
                &format!(
                    "Expand-Archive -Path '{}' -DestinationPath '{}' -Force",
                    zip_path.to_string_lossy(),
                    dest_dir.to_string_lossy()
                )
            ])
            .output()
            .map_err(|e| format!("Failed to run PowerShell Expand-Archive: {}", e))?;
        
        if output.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).to_string())
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let output = std::process::Command::new("unzip")
            .args(&[
                "-o",
                &zip_path.to_string_lossy(),
                "-d",
                &dest_dir.to_string_lossy()
            ])
            .output()
            .map_err(|e| format!("Failed to run unzip: {}", e))?;
        
        if output.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).to_string())
        }
    }
}

pub fn copy_dir_all(src: impl AsRef<Path>, dst: impl AsRef<Path>) -> std::io::Result<()> {
    fs::create_dir_all(&dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        if ty.is_dir() {
            copy_dir_all(entry.path(), dst.as_ref().join(entry.file_name()))?;
        } else {
            fs::copy(entry.path(), dst.as_ref().join(entry.file_name()))?;
        }
    }
    Ok(())
}
