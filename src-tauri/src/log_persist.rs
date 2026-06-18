use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const MAX_LOG_FILES: usize = 3;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LogEntry {
    pub timestamp: u64,
    pub level: String,
    pub message: String,
}

#[derive(Debug, Serialize)]
pub struct LogFileInfo {
    pub name: String,
    pub content: String,
}

fn get_log_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let log_dir = base.join("logs");
    fs::create_dir_all(&log_dir)
        .map_err(|e| format!("Failed to create log directory: {}", e))?;
    Ok(log_dir)
}

fn cleanup_old_logs(log_dir: &PathBuf) -> Result<(), String> {
    let mut entries: Vec<_> = fs::read_dir(log_dir)
        .map_err(|e| format!("Failed to read log directory: {}", e))?
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path()
                .extension()
                .map(|ext| ext == "log")
                .unwrap_or(false)
        })
        .collect();

    // Sort by name (timestamp-based name ensures chronological order)
    entries.sort_by(|a, b| b.file_name().cmp(&a.file_name()));

    // Remove files beyond MAX_LOG_FILES
    for entry in entries.iter().skip(MAX_LOG_FILES) {
        let _ = fs::remove_file(entry.path());
    }

    Ok(())
}

fn get_current_log_path(app: &AppHandle) -> Result<PathBuf, String> {
    let log_dir = get_log_dir(app)?;

    // Find today's log file or create a new one
    let now = chrono::Local::now();
    let date_prefix = now.format("%Y-%m-%d").to_string();

    // Look for existing log file for today
    if let Ok(entries) = fs::read_dir(&log_dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with(&date_prefix) && name.ends_with(".log") {
                return Ok(entry.path());
            }
        }
    }

    // Create new log file with timestamp
    let filename = format!("{}.log", now.format("%Y-%m-%d_%H-%M-%S"));
    let path = log_dir.join(filename);

    // Write header
    let header = format!(
        "=== Stardew Valley Assistant Log ===\nStarted: {}\n\n",
        now.format("%Y-%m-%d %H:%M:%S")
    );
    fs::write(&path, header).map_err(|e| format!("Failed to create log file: {}", e))?;

    // Cleanup old files
    cleanup_old_logs(&log_dir)?;

    Ok(path)
}

#[tauri::command]
pub fn write_log_entries(app: AppHandle, entries: Vec<LogEntry>) -> Result<(), String> {
    let path = get_current_log_path(&app)?;

    let mut lines = String::new();
    for entry in &entries {
        let dt = chrono::DateTime::from_timestamp_millis(entry.timestamp as i64)
            .map(|t| t.with_timezone(&chrono::Local).format("%H:%M:%S%.3f").to_string())
            .unwrap_or_else(|| "??:??:??".to_string());

        let level_str = match entry.level.as_str() {
            "error" => "ERROR",
            "warn" => "WARN ",
            _ => "INFO ",
        };

        lines.push_str(&format!("[{}] [{}] {}\n", dt, level_str, entry.message));
    }

    use std::io::Write;
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("Failed to open log file: {}", e))?;

    file.write_all(lines.as_bytes())
        .map_err(|e| format!("Failed to write log entries: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn read_log_files(app: AppHandle) -> Result<Vec<LogFileInfo>, String> {
    let log_dir = get_log_dir(&app)?;

    let mut files: Vec<LogFileInfo> = Vec::new();
    let mut entries: Vec<_> = fs::read_dir(&log_dir)
        .map_err(|e| format!("Failed to read log directory: {}", e))?
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path()
                .extension()
                .map(|ext| ext == "log")
                .unwrap_or(false)
        })
        .collect();

    // Sort by name descending (newest first)
    entries.sort_by(|a, b| b.file_name().cmp(&a.file_name()));

    for entry in entries {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let content = fs::read_to_string(&path)
            .unwrap_or_else(|_| "(无法读取文件内容)".to_string());
        files.push(LogFileInfo { name, content });
    }

    Ok(files)
}

#[tauri::command]
pub fn get_log_dir_path(app: AppHandle) -> Result<String, String> {
    let log_dir = get_log_dir(&app)?;
    Ok(log_dir.to_string_lossy().to_string())
}

#[tauri::command]
pub fn clear_log_files(app: AppHandle) -> Result<(), String> {
    let log_dir = get_log_dir(&app)?;

    let entries: Vec<_> = fs::read_dir(&log_dir)
        .map_err(|e| format!("Failed to read log directory: {}", e))?
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path()
                .extension()
                .map(|ext| ext == "log")
                .unwrap_or(false)
        })
        .collect();

    for entry in entries {
        let _ = fs::remove_file(entry.path());
    }

    Ok(())
}
