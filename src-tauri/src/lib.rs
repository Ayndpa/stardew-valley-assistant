mod download_control;
mod farmer_avatar;
mod game;
mod game_data;
mod log_persist;
mod mods;
mod saves;
mod smapi;
mod updater;
mod utils;

use std::{
    fs,
    sync::{atomic::{AtomicBool, Ordering}, Mutex},
    thread,
    time::Duration,
};

use crate::download_control::{pause_download_task, resume_download_task, DownloadControlState};
use crate::farmer_avatar::get_npc_portraits;
use crate::game::{auto_detect_game_dir, check_game_process_running, force_kill_game, get_game_version, launch_game};
use crate::game_data::{
    cheat_add_item, cheat_add_money, cheat_grow_crops, cheat_kill_monsters, cheat_max_friendship,
    cheat_refill_energy, cheat_refill_health, cheat_set_weather, cheat_teleport,
    cheat_toggle_freeze_time, cheat_toggle_speed, cheat_water_crops,
    export_mod_data_to_file, get_animal_game_data, get_bundle_game_data, get_calendar_game_data,
    get_cheat_states, get_crop_game_data, get_fishing_map_data, get_fishing_map_detail,
    get_item_game_data, get_item_game_data_overview, get_mod_export_data,
    get_npc_game_data, get_secret_notes_game_data, live_state::LiveGameState,
    pipe_server::{self, PipeWriterHandle}, query_item_game_data,
};
use crate::mods::{
    apply_profile, auto_upgrade_bundled_mod, check_mod_updates, check_nexus_login_status,
    close_scraper_window, delete_mod, delete_profile, export_profile, export_profile_to_file,
    fetch_nexus_api_key, fetch_nexus_download_metadata, fetch_smapi_compatibility_mods,
    import_profile, import_profile_from_file, install_bundled_assistant_mod, install_mod_from_zip,
    install_nexus_mod, list_installed_mods, list_profiles, load_cached_mod_updates, logout_nexus,
    open_nexus_login_window, open_nexus_ranking_scraper, open_scraper_window, save_mod_config,
    save_profile, toggle_mod,
};
use crate::saves::{
    create_save_backup, delete_save_backup, get_children_data, get_npc_locations, get_npc_schedule,
    check_game_running, check_pipe_status, get_planted_crops, get_save_animals, get_save_detail,
    get_save_editor_data, list_save_backups, list_save_files, restore_save_backup,
    update_child, update_save_editor_data,
};
use crate::log_persist::{clear_log_files, get_log_dir_path, read_log_files, write_log_entries};
use crate::smapi::{check_smapi_status, install_smapi, uninstall_smapi};
use crate::updater::check_for_updates;
use crate::utils::{open_in_file_manager, path_exists};

/// Returns true if this is a beta/test build (set at compile time via tauri.conf.json "beta" field)
#[tauri::command]
fn get_app_beta() -> bool {
    option_env!("APP_BETA").map(|v| v == "true").unwrap_or(false)
}
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Monitor, PhysicalPosition, PhysicalSize, Size, State};
use tauri_plugin_deep_link::DeepLinkExt;
#[cfg(windows)]
use window_vibrancy::{apply_acrylic, apply_mica, apply_tabbed, clear_acrylic, clear_blur, clear_mica, clear_tabbed};

// FFI for ntdll::RtlGetVersion — more reliable than GetVersionEx on Win10+
#[cfg(windows)]
#[repr(C)]
struct RTL_OSVERSIONINFOW {
    dw_os_version_info_size: u32,
    dw_major_version: u32,
    dw_minor_version: u32,
    dw_build_number: u32,
    dw_platform_id: u32,
    sz_csd_version: [u16; 128],
}

#[cfg(windows)]
extern "system" {
    fn RtlGetVersion(lp_version_information: *mut RTL_OSVERSIONINFOW) -> i32;
}

#[cfg(windows)]
fn is_windows_11_or_later() -> bool {
    unsafe {
        let mut info = RTL_OSVERSIONINFOW {
            dw_os_version_info_size: std::mem::size_of::<RTL_OSVERSIONINFOW>() as u32,
            dw_major_version: 0,
            dw_minor_version: 0,
            dw_build_number: 0,
            dw_platform_id: 0,
            sz_csd_version: [0; 128],
        };
        if RtlGetVersion(&mut info) == 0 {
            // Windows 11 = build 22000+
            info.dw_major_version > 10
                || (info.dw_major_version == 10 && info.dw_build_number >= 22000)
        } else {
            // Assume Win10 if detection fails
            false
        }
    }
}

const MAIN_WINDOW_MIN_WIDTH: f64 = 800.0;
const MAIN_WINDOW_MIN_HEIGHT: f64 = 600.0;

static RESTORING_WINDOW_STATE: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Deserialize, Serialize)]
struct MainWindowState {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    #[serde(default)]
    maximized: bool,
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
    if RESTORING_WINDOW_STATE.load(Ordering::Acquire) {
        return;
    }
    if window.is_minimized().unwrap_or(false) || !window.is_visible().unwrap_or(true) {
        return;
    }

    let path = match get_window_state_path(app) {
        Some(path) => path,
        None => return,
    };

    let is_maximized = window.is_maximized().unwrap_or(false);

    // When maximized, try to keep the previously saved non-maximized bounds
    // so that unmaximizing restores to the correct size/position.
    if is_maximized {
        if let Some(prev) = load_main_window_state(app) {
            let state = MainWindowState {
                x: prev.x,
                y: prev.y,
                width: prev.width,
                height: prev.height,
                maximized: true,
            };
            if let Ok(serialized) = serde_json::to_vec_pretty(&state) {
                let _ = fs::write(path, serialized);
            }
            return;
        }
    }

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
        maximized: false,
    };

    if let Ok(serialized) = serde_json::to_vec_pretty(&state) {
        let _ = fs::write(path, serialized);
    }
}

fn restore_main_window_state(app: &AppHandle, window: &tauri::WebviewWindow) {
    let Some(state) = load_main_window_state(app) else {
        return;
    };

    RESTORING_WINDOW_STATE.store(true, Ordering::Release);

    if state.maximized {
        // Set a reasonable size first so unmaximize has sensible bounds,
        // then maximize to fill the screen.
        let min_size = main_window_min_physical(window);
        let width = state.width.max(min_size.width);
        let height = state.height.max(min_size.height);
        let (pos, size) = visible_window_bounds(window, state.x, state.y, width, height);
        let _ = window.set_size(Size::Physical(size));
        let _ = window.set_position(pos);
        let _ = window.maximize();
    } else {
        let min_size = main_window_min_physical(window);
        let width = state.width.max(min_size.width);
        let height = state.height.max(min_size.height);
        let (pos, size) = visible_window_bounds(window, state.x, state.y, width, height);
        let _ = window.set_size(Size::Physical(size));
        let _ = window.set_position(pos);
    }

    RESTORING_WINDOW_STATE.store(false, Ordering::Release);
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
    // Windows 11 (build >= 22000): use Mica backdrop
    // Windows 10: use opaque Acrylic to avoid black border artifacts
    //              on borderless transparent windows
    if is_windows_11_or_later() {
        let _ = apply_mica(window, None);
    } else {
        // Windows 10: fully opaque Acrylic + solid CSS fallback prevents black edges
        let _ = apply_acrylic(window, Some((24, 28, 32, 255)));
    }
}

#[cfg(not(windows))]
fn apply_windows_backdrop(_window: &tauri::WebviewWindow) {}

// ==================== Backdrop Settings ====================

#[derive(Debug, Deserialize, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum BackdropType {
    Mica,
    Acrylic,
    Tabbed,
    None,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackdropSettings {
    pub backdrop_type: BackdropType,
    pub opacity: u8,  // 0-255, reserved for native backdrop tint alpha
    pub is_dark: bool,
}

#[cfg(windows)]
#[tauri::command]
fn set_window_backdrop(window: tauri::WebviewWindow, settings: BackdropSettings) -> Result<(), String> {
    println!("set_window_backdrop called with: {:?}", settings);

    // Clear all existing effects first
    let _ = clear_mica(&window);
    let _ = clear_acrylic(&window);
    let _ = clear_blur(&window);
    let _ = clear_tabbed(&window);

    match settings.backdrop_type {
        BackdropType::Mica => {
            apply_mica(&window, Some(settings.is_dark)).map_err(|e| e.to_string())?;
        }
        BackdropType::Acrylic => {
            // Use a semi-transparent tint for acrylic effect
            let tint_color = if settings.is_dark {
                (0, 0, 0, 80)  // Very transparent black
            } else {
                (255, 255, 255, 80)  // Very transparent white
            };
            apply_acrylic(&window, Some(tint_color)).map_err(|e| e.to_string())?;
        }
        BackdropType::Tabbed => {
            apply_tabbed(&window, Some(settings.is_dark)).map_err(|e| e.to_string())?;
        }
        BackdropType::None => {
            // Already cleared above, nothing to do
        }
    }

    Ok(())
}

#[cfg(not(windows))]
#[tauri::command]
fn set_window_backdrop(_window: tauri::WebviewWindow, _settings: BackdropSettings) -> Result<(), String> {
    // Non-Windows platforms don't support backdrop effects
    Ok(())
}

// ==================== Background Image ====================

#[tauri::command]
fn set_background_image(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let source_path = std::path::Path::new(&path);
    if !source_path.exists() {
        return Err("File does not exist".to_string());
    }

    // Validate it's an image file
    let ext = source_path.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if !["png", "jpg", "jpeg", "gif", "webp", "bmp"].contains(&ext.as_str()) {
        return Err("Unsupported image format".to_string());
    }

    // Get app data directory
    let app_data_dir = app.path().app_data_dir()
        .map_err(|e| e.to_string())?;
    let backgrounds_dir = app_data_dir.join("backgrounds");
    fs::create_dir_all(&backgrounds_dir).map_err(|e| e.to_string())?;

    // Generate a safe filename
    let filename = format!("background.{}", ext);
    let dest_path = backgrounds_dir.join(&filename);

    // Copy the file
    fs::copy(source_path, &dest_path).map_err(|e| e.to_string())?;

    // Return the path as a string for the frontend to use
    Ok(dest_path.to_string_lossy().to_string())
}

#[tauri::command]
fn clear_background_image(app: tauri::AppHandle) -> Result<(), String> {
    let app_data_dir = app.path().app_data_dir()
        .map_err(|e| e.to_string())?;
    let backgrounds_dir = app_data_dir.join("backgrounds");

    if backgrounds_dir.exists() {
        // Remove all files in backgrounds directory
        for entry in fs::read_dir(&backgrounds_dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if path.is_file() {
                let _ = fs::remove_file(path);
            }
        }
    }

    Ok(())
}

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
        .manage(LiveGameState::new())
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
            get_animal_game_data,
            get_bundle_game_data,
            get_calendar_game_data,
            get_crop_game_data,
            get_item_game_data,
            get_item_game_data_overview,
            query_item_game_data,
            get_fishing_map_data,
            get_fishing_map_detail,
            get_npc_game_data,
            get_secret_notes_game_data,
            launch_game,
            check_game_process_running,
            force_kill_game,
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
            check_pipe_status,
            get_save_editor_data,
            update_save_editor_data,
            get_children_data,
            update_child,
            get_planted_crops,
            get_save_animals,
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
            install_bundled_assistant_mod,
            auto_upgrade_bundled_mod,
            get_npc_portraits,
            check_for_updates,
            write_log_entries,
            read_log_files,
            get_log_dir_path,
            clear_log_files,
            set_window_backdrop,
            set_background_image,
            clear_background_image,
            cheat_refill_energy,
            cheat_refill_health,
            cheat_toggle_speed,
            cheat_toggle_freeze_time,
            cheat_water_crops,
            cheat_grow_crops,
            cheat_teleport,
            cheat_add_item,
            cheat_add_money,
            cheat_max_friendship,
            cheat_kill_monsters,
            cheat_set_weather,
            get_cheat_states,
            get_mod_export_data,
            export_mod_data_to_file,
            get_app_beta
        ])
        .setup(|app| {
            let app_handle = app.handle();

            // Start the named pipe server for bidirectional communication with the mod
            let live_state = app.state::<LiveGameState>().inner().clone();
            let writer_handle = PipeWriterHandle::new();
            app.manage(writer_handle.clone());
            tauri::async_runtime::spawn(async move {
                pipe_server::start_pipe_server(live_state, writer_handle).await;
            });

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
                show_main_window_in_front(&window);
                restore_main_window_state(app_handle, &window);

                let app_handle = app.handle().clone();
                window.on_window_event(move |event| {
                    match event {
                        tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
                            if let Some(window) = app_handle.get_webview_window("main") {
                                save_main_window_state(&app_handle, &window);
                            }
                        }
                        tauri::WindowEvent::CloseRequested { .. } => {
                            if let Some(window) = app_handle.get_webview_window("main") {
                                save_main_window_state(&app_handle, &window);
                            }
                        }
                        _ => {}
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
