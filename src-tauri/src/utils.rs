use crate::download_control::{emit_download_progress, wait_if_paused};
use std::fs;
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::Path;

use log::{error, info, warn};
use tauri::AppHandle;
use zip::read::ZipArchive;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[cfg(target_os = "windows")]
pub fn run_without_window(command: &mut std::process::Command) -> &mut std::process::Command {
    command.creation_flags(CREATE_NO_WINDOW)
}

#[cfg(not(target_os = "windows"))]
pub fn run_without_window(command: &mut std::process::Command) -> &mut std::process::Command {
    command
}

#[tauri::command]
pub fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[tauri::command]
pub fn open_in_file_manager(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err("Path does not exist".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let mut command = std::process::Command::new("explorer");
        run_without_window(command.arg(p))
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

pub fn download_file_with_headers(
    url: &str,
    dest: &Path,
    headers: &[(&str, &str)],
) -> Result<(), String> {
    info!(
        "[HTTPDownload] Starting download: url={}, dest={}, headers={}",
        url,
        dest.display(),
        headers.len()
    );
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

                info!(
                    "[HTTPDownload] Download succeeded: url={}, bytes={}, dest={}",
                    url,
                    bytes.len(),
                    dest.display()
                );
                return Ok(());
            }
            Err(e) => {
                last_err = format!(
                    "HTTP request failed (attempt {}/{}): {}",
                    attempt, max_retries, e
                );
                warn!("[HTTPDownload] {}", last_err);
                if attempt < max_retries {
                    std::thread::sleep(std::time::Duration::from_secs(2));
                }
            }
        }
    }

    error!(
        "[HTTPDownload] Download failed after retries: url={}, error={}",
        url, last_err
    );
    Err(last_err)
}

pub fn download_file(url: &str, dest: &Path) -> Result<(), String> {
    download_file_with_headers(url, dest, &[])
}

pub fn download_file_with_headers_and_progress(
    app: &AppHandle,
    task_id: &str,
    url: &str,
    dest: &Path,
    headers: &[(&str, &str)],
) -> Result<(), String> {
    info!(
        "[HTTPDownload] Starting tracked download: task_id={}, url={}, dest={}, headers={}",
        task_id,
        url,
        dest.display(),
        headers.len()
    );
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
                if let Some(parent) = dest.parent() {
                    fs::create_dir_all(parent)
                        .map_err(|e| format!("Failed to create parent directory: {}", e))?;
                }

                let total_bytes = response
                    .header("Content-Length")
                    .and_then(|value| value.parse::<u64>().ok());
                let mut reader = response.into_reader();
                let mut file = fs::File::create(dest)
                    .map_err(|e| format!("Failed to create file {}: {}", dest.display(), e))?;
                let mut buffer = vec![0u8; 64 * 1024];
                let mut downloaded_bytes = 0u64;

                emit_download_progress(
                    app,
                    task_id,
                    "downloading",
                    0.0,
                    0,
                    total_bytes,
                    "开始下载...",
                );

                loop {
                    let progress = total_bytes
                        .map(|total| {
                            if total == 0 {
                                0.0
                            } else {
                                downloaded_bytes as f64 * 100.0 / total as f64
                            }
                        })
                        .unwrap_or(0.0);
                    wait_if_paused(app, task_id, progress, downloaded_bytes, total_bytes);

                    let read = reader
                        .read(&mut buffer)
                        .map_err(|e| format!("Failed to read response body: {}", e))?;
                    if read == 0 {
                        break;
                    }

                    file.write_all(&buffer[..read])
                        .map_err(|e| format!("Failed to write file to {}: {}", dest.display(), e))?;
                    downloaded_bytes += read as u64;

                    let progress = total_bytes
                        .map(|total| {
                            if total == 0 {
                                0.0
                            } else {
                                downloaded_bytes as f64 * 100.0 / total as f64
                            }
                        })
                        .unwrap_or(0.0);
                    let message = if let Some(total) = total_bytes {
                        format!("正在下载... {}/{}", downloaded_bytes, total)
                    } else {
                        format!("正在下载... {}", downloaded_bytes)
                    };

                    emit_download_progress(
                        app,
                        task_id,
                        "downloading",
                        progress,
                        downloaded_bytes,
                        total_bytes,
                        &message,
                    );
                }

                emit_download_progress(
                    app,
                    task_id,
                    "downloading",
                    100.0,
                    downloaded_bytes,
                    total_bytes,
                    "下载完成",
                );

                info!(
                    "[HTTPDownload] Tracked download succeeded: task_id={}, url={}, bytes={}, dest={}",
                    task_id,
                    url,
                    downloaded_bytes,
                    dest.display()
                );
                return Ok(());
            }
            Err(e) => {
                last_err = format!(
                    "HTTP request failed (attempt {}/{}): {}",
                    attempt, max_retries, e
                );
                warn!("[HTTPDownload] {}", last_err);
                if attempt < max_retries {
                    std::thread::sleep(std::time::Duration::from_secs(2));
                }
            }
        }
    }

    error!(
        "[HTTPDownload] Tracked download failed after retries: task_id={}, url={}, error={}",
        task_id, url, last_err
    );
    Err(last_err)
}

pub fn extract_zip(zip_path: &Path, dest_dir: &Path) -> Result<(), String> {
    let mut file = fs::File::open(zip_path)
        .map_err(|e| format!("Failed to open zip file {}: {}", zip_path.display(), e))?;

    let mut signature = [0u8; 4];
    let signature_len = file
        .read(&mut signature)
        .map_err(|e| format!("Failed to read file signature {}: {}", zip_path.display(), e))?;
    file.seek(SeekFrom::Start(0))
        .map_err(|e| format!("Failed to rewind file {}: {}", zip_path.display(), e))?;

    let is_zip = signature_len >= 4
        && matches!(
            signature,
            [0x50, 0x4B, 0x03, 0x04]
                | [0x50, 0x4B, 0x05, 0x06]
                | [0x50, 0x4B, 0x07, 0x08]
        );
    if !is_zip {
        return Err(format!(
            "File is not a ZIP archive by content: {}. The download may be an HTML error page or an unexpected installer format.",
            zip_path.display()
        ));
    }

    let mut archive = ZipArchive::new(file)
        .map_err(|e| format!("Failed to read zip archive {}: {}", zip_path.display(), e))?;

    fs::create_dir_all(dest_dir)
        .map_err(|e| format!("Failed to create destination {}: {}", dest_dir.display(), e))?;

    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|e| format!("Failed to read zip entry {}: {}", index, e))?;
        let enclosed_path = entry
            .enclosed_name()
            .ok_or_else(|| format!("Zip entry contains invalid path: {}", entry.name()))?;
        let out_path = dest_dir.join(enclosed_path);

        if entry.is_dir() {
            fs::create_dir_all(&out_path)
                .map_err(|e| format!("Failed to create directory {}: {}", out_path.display(), e))?;
            continue;
        }

        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent).map_err(|e| {
                format!(
                    "Failed to create parent directory {}: {}",
                    parent.display(),
                    e
                )
            })?;
        }

        let mut outfile = fs::File::create(&out_path)
            .map_err(|e| format!("Failed to create file {}: {}", out_path.display(), e))?;
        io::copy(&mut entry, &mut outfile)
            .map_err(|e| format!("Failed to extract file {}: {}", out_path.display(), e))?;
    }

    Ok(())
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
