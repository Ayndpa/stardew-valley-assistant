use std::fs;
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

pub fn download_file(url: &str, dest: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        // Try Powershell first
        let output = std::process::Command::new("powershell")
            .args(&[
                "-NoProfile",
                "-Command",
                &format!("Invoke-WebRequest -Uri '{}' -OutFile '{}'", url, dest.to_string_lossy())
            ])
            .output();
        
        if let Ok(out) = output {
            if out.status.success() {
                return Ok(());
            }
        }
        
        // Fallback to curl
        let output = std::process::Command::new("curl")
            .args(&["-L", "-o", &dest.to_string_lossy(), url])
            .output()
            .map_err(|e| format!("Failed to run curl: {}", e))?;
        
        if output.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).to_string())
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let output = std::process::Command::new("curl")
            .args(&["-L", "-o", &dest.to_string_lossy(), url])
            .output()
            .map_err(|e| format!("Failed to run curl: {}", e))?;
        
        if output.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).to_string())
        }
    }
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
