mod download_control;
mod farmer_avatar;
mod game;
mod game_data;
mod mods;
mod saves;
mod smapi;
mod utils;

use std::{fs, sync::Mutex, thread, time::Duration};

use crate::download_control::{pause_download_task, resume_download_task, DownloadControlState};
use crate::farmer_avatar::get_npc_portraits;
use crate::game::{auto_detect_game_dir, get_game_version, launch_game};
use crate::game_data::{
    get_calendar_game_data, get_crop_game_data, get_fishing_map_data, get_fishing_map_detail,
    get_item_game_data, get_item_game_data_overview, get_npc_game_data, query_item_game_data,
};
use crate::mods::{
    apply_profile, check_mod_updates, check_nexus_login_status, close_scraper_window, delete_mod,
    delete_profile, export_profile, export_profile_to_file, fetch_nexus_api_key,
    fetch_nexus_download_metadata, fetch_smapi_compatibility_mods, import_profile,
    import_profile_from_file, install_bundled_npc_locations_mod, install_mod_from_zip,
    install_nexus_mod, list_installed_mods, list_profiles, load_cached_mod_updates, logout_nexus,
    open_nexus_login_window, open_nexus_ranking_scraper, open_scraper_window, save_mod_config,
    save_profile, toggle_mod,
};
use crate::saves::{
    create_save_backup, delete_save_backup, get_npc_locations, get_npc_schedule, check_game_running, get_planted_crops, get_save_detail,
    get_save_editor_data, list_save_backups, list_save_files, restore_save_backup,
    update_save_editor_data,
};
use crate::smapi::{check_smapi_status, install_smapi, uninstall_smapi};
use crate::utils::{open_in_file_manager, path_exists};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Monitor, PhysicalPosition, PhysicalSize, Size, State};
use tauri_plugin_deep_link::DeepLinkExt;
#[cfg(windows)]
use window_vibrancy::{apply_acrylic, apply_mica};

const MAIN_WINDOW_MIN_WIDTH: f64 = 800.0;
const MAIN_WINDOW_MIN_HEIGHT: f64 = 600.0;

#[derive(Debug, Deserialize, Serialize)]
struct MainWindowState {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Default)]
struct PendingNxmUrls(Mutex<Vec<String>>);

fn is_nxm_url(url: &str) -> bool {
    url.trim_start().to_ascii_lowercase().starts_with("nxm://")
}

fn queue_nxm_url(app: &AppHandle, url: String) {
    if !is_nxm_url(&url) {
        return;
    }

    if let Ok(mut pending) = app.state::<PendingNxmUrls>().0.lock() {
        pending.push(url.clone());
    }

    let _ = app.emit("nxm-download-url", url);
}

fn queue_nxm_urls<I>(app: &AppHandle, urls: I)
where
    I: IntoIterator<Item = String>,
{
    for url in urls {
        queue_nxm_url(app, url);
    }
}

#[tauri::command]
fn take_pending_nxm_urls(state: State<'_, PendingNxmUrls>) -> Vec<String> {
    match state.0.lock() {
        Ok(mut pending) => std::mem::take(&mut *pending),
        Err(_) => Vec::new(),
    }
}

fn get_window_state_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    let mut path = app.path().app_data_dir().ok()?;
    fs::create_dir_all(&path).ok()?;
    path.push("window-state.json");
    Some(path)
}

fn load_main_window_state(app: &AppHandle) -> Option<MainWindowState> {
    let path = get_window_state_path(app)?;
    let contents = fs::read_to_string(path).ok()?;
    serde_json::from_str::<MainWindowState>(&contents).ok()
}

fn main_window_min_physical(window: &tauri::WebviewWindow) -> tauri::PhysicalSize<u32> {
    let scale_factor = window.scale_factor().unwrap_or(1.0).max(1.0);

    tauri::PhysicalSize::new(
        (MAIN_WINDOW_MIN_WIDTH * scale_factor).ceil() as u32,
        (MAIN_WINDOW_MIN_HEIGHT * scale_factor).ceil() as u32,
    )
}

fn preferred_monitor_for_window(
    window: &tauri::WebviewWindow,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Option<Monitor> {
    let center_x = x as f64 + width as f64 / 2.0;
    let center_y = y as f64 + height as f64 / 2.0;

    window
        .monitor_from_point(center_x, center_y)
        .ok()
        .flatten()
        .or_else(|| window.current_monitor().ok().flatten())
        .or_else(|| window.primary_monitor().ok().flatten())
        .or_else(|| {
            window
                .available_monitors()
                .ok()
                .and_then(|monitors| monitors.into_iter().next())
        })
}

fn clamp_window_position_to_monitor(
    monitor: &Monitor,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> PhysicalPosition<i32> {
    let work_area = monitor.work_area();
    let min_x = work_area.position.x;
    let min_y = work_area.position.y;
    let max_x = min_x + work_area.size.width.saturating_sub(width) as i32;
    let max_y = min_y + work_area.size.height.saturating_sub(height) as i32;

    PhysicalPosition::new(x.clamp(min_x, max_x), y.clamp(min_y, max_y))
}

fn visible_window_bounds(
    window: &tauri::WebviewWindow,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> (PhysicalPosition<i32>, PhysicalSize<u32>) {
    let Some(monitor) = preferred_monitor_for_window(window, x, y, width, height) else {
        return (
            PhysicalPosition::new(x, y),
            PhysicalSize::new(width, height),
        );
    };

    let work_area = monitor.work_area();
    let min_size = main_window_min_physical(window);
    let max_width = work_area.size.width.max(1);
    let max_height = work_area.size.height.max(1);
    let min_width = min_size.width.min(max_width);
    let min_height = min_size.height.min(max_height);
    let size = PhysicalSize::new(
        width.min(max_width).max(min_width),
        height.min(max_height).max(min_height),
    );
    let position = clamp_window_position_to_monitor(&monitor, x, y, size.width, size.height);

    (position, size)
}

fn save_main_window_state(app: &AppHandle, window: &tauri::WebviewWindow) {
    if window.is_minimized().unwrap_or(false) || !window.is_visible().unwrap_or(true) {
        return;
    }

    let path = match get_window_state_path(app) {
        Some(path) => path,
        None => return,
    };

    let pos = match window.outer_position() {
        Ok(pos) => pos,
        Err(_) => return,
    };
    let size = match window.outer_size() {
        Ok(size) => size,
        Err(_) => return,
    };
    let min_size = main_window_min_physical(window);
    let width = size.width.max(min_size.width);
    let height = size.height.max(min_size.height);
    let (pos, size) = visible_window_bounds(window, pos.x, pos.y, width, height);

    let state = MainWindowState {
        x: pos.x,
        y: pos.y,
        width: size.width,
        height: size.height,
    };

    if let Ok(serialized) = serde_json::to_vec_pretty(&state) {
        let _ = fs::write(path, serialized);
    }
}

fn restore_main_window_state(app: &AppHandle, window: &tauri::WebviewWindow) {
    let Some(state) = load_main_window_state(app) else {
        return;
    };
    let min_size = main_window_min_physical(window);
    let width = state.width.max(min_size.width);
    let height = state.height.max(min_size.height);
    let (pos, size) = visible_window_bounds(window, state.x, state.y, width, height);

    let _ = window.set_size(Size::Physical(size));
    let _ = window.set_position(pos);
}

fn show_main_window_in_front(window: &tauri::WebviewWindow) {
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_always_on_top(true);
    let _ = window.set_focus();

    let window = window.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(250));
        let _ = window.set_always_on_top(false);
        let _ = window.set_focus();
    });
}

#[cfg(windows)]
fn apply_windows_backdrop(window: &tauri::WebviewWindow) {
    if apply_mica(window, None).is_err() {
        let _ = apply_acrylic(window, Some((24, 28, 32, 160)));
    }
}

#[cfg(not(windows))]
fn apply_windows_backdrop(_window: &tauri::WebviewWindow) {}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(DownloadControlState::default())
        .manage(PendingNxmUrls::default())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = app.get_webview_window("main").map(|window| {
                show_main_window_in_front(&window);
            });
        }))
        .plugin(tauri_plugin_log::Builder::default().build())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            take_pending_nxm_urls,
            auto_detect_game_dir,
            check_smapi_status,
            list_installed_mods,
            toggle_mod,
            save_mod_config,
            fetch_smapi_compatibility_mods,
            open_scraper_window,
            close_scraper_window,
            open_nexus_ranking_scraper,
            open_in_file_manager,
            path_exists,
            get_game_version,
            get_calendar_game_data,
            get_crop_game_data,
            get_item_game_data,
            get_item_game_data_overview,
            query_item_game_data,
            get_fishing_map_data,
            get_fishing_map_detail,
            get_npc_game_data,
            launch_game,
            install_smapi,
            uninstall_smapi,
            list_save_files,
            list_save_backups,
            create_save_backup,
            restore_save_backup,
            delete_save_backup,
            get_save_detail,
            get_npc_locations,
            get_npc_schedule,
            check_game_running,
            get_save_editor_data,
            update_save_editor_data,
            get_planted_crops,
            list_profiles,
            save_profile,
            delete_profile,
            delete_mod,
            apply_profile,
            export_profile,
            import_profile,
            export_profile_to_file,
            import_profile_from_file,
            open_nexus_login_window,
            check_nexus_login_status,
            logout_nexus,
            fetch_nexus_api_key,
            fetch_nexus_download_metadata,
            install_nexus_mod,
            check_mod_updates,
            load_cached_mod_updates,
            pause_download_task,
            resume_download_task,
            install_mod_from_zip,
            install_bundled_npc_locations_mod,
            get_npc_portraits
        ])
        .setup(|app| {
            let app_handle = app.handle();
            #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
            {
                let _ = app.deep_link().register_all();
                if let Ok(Some(urls)) = app.deep_link().get_current() {
                    queue_nxm_urls(app_handle, urls.into_iter().map(|url| url.to_string()));
                }

                let deep_link_handle = app_handle.clone();
                app.deep_link().on_open_url(move |event| {
                    queue_nxm_urls(
                        &deep_link_handle,
                        event
                            .urls()
                            .iter()
                            .map(|url| url.to_string())
                            .collect::<Vec<_>>(),
                    );
                });
            }

            if let Some(window) = app_handle.get_webview_window("main") {
                let _ = window.set_min_size(Some(Size::Logical(tauri::LogicalSize::new(
                    MAIN_WINDOW_MIN_WIDTH,
                    MAIN_WINDOW_MIN_HEIGHT,
                ))));
                apply_windows_backdrop(&window);
                restore_main_window_state(app_handle, &window);
                show_main_window_in_front(&window);

                let app_handle = app.handle().clone();
                window.on_window_event(move |_| {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        save_main_window_state(&app_handle, &window);
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
