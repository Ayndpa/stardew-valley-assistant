use serde::Serialize;
use std::collections::HashSet;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

const DOWNLOAD_EVENT: &str = "download-progress";

#[derive(Default)]
pub struct DownloadControlState {
    paused: Mutex<HashSet<String>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgressPayload {
    pub task_id: String,
    pub phase: String,
    pub progress: f64,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub message: String,
}

pub fn emit_download_progress(
    app: &AppHandle,
    task_id: &str,
    phase: &str,
    progress: f64,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    message: &str,
) {
    let payload = DownloadProgressPayload {
        task_id: task_id.to_string(),
        phase: phase.to_string(),
        progress: progress.clamp(0.0, 100.0),
        downloaded_bytes,
        total_bytes,
        message: message.to_string(),
    };
    let _ = app.emit(DOWNLOAD_EVENT, payload);
}

pub fn is_paused(app: &AppHandle, task_id: &str) -> bool {
    app.state::<DownloadControlState>()
        .paused
        .lock()
        .map(|paused| paused.contains(task_id))
        .unwrap_or(false)
}

pub fn wait_if_paused(app: &AppHandle, task_id: &str, progress: f64, downloaded: u64, total: Option<u64>) {
    let mut announced = false;
    while is_paused(app, task_id) {
        if !announced {
            emit_download_progress(
                app,
                task_id,
                "paused",
                progress,
                downloaded,
                total,
                "下载已暂停",
            );
            announced = true;
        }
        std::thread::sleep(Duration::from_millis(200));
    }

    if announced {
        emit_download_progress(
            app,
            task_id,
            "downloading",
            progress,
            downloaded,
            total,
            "继续下载中...",
        );
    }
}

#[tauri::command]
pub fn pause_download_task(task_id: String, state: State<'_, DownloadControlState>) -> Result<(), String> {
    let mut paused = state
        .paused
        .lock()
        .map_err(|_| "无法锁定下载暂停状态".to_string())?;
    paused.insert(task_id);
    Ok(())
}

#[tauri::command]
pub fn resume_download_task(task_id: String, state: State<'_, DownloadControlState>) -> Result<(), String> {
    let mut paused = state
        .paused
        .lock()
        .map_err(|_| "无法锁定下载暂停状态".to_string())?;
    paused.remove(&task_id);
    Ok(())
}
