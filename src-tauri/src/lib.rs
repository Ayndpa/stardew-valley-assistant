mod utils;
mod game;
mod smapi;
mod mods;
mod saves;

use std::fs;

use crate::game::{auto_detect_game_dir, get_game_version, launch_game};
use crate::smapi::{check_smapi_status, install_smapi, uninstall_smapi};
use crate::mods::{
    apply_profile,
    check_nexus_login_status,
    delete_profile,
    delete_mod,
    export_profile_to_file,
    export_profile,
    fetch_nexus_api_key,
    fetch_smapi_compatibility_mods,
    install_mod_from_zip,
    install_nexus_mod,
    list_installed_mods,
    import_profile,
    import_profile_from_file,
    list_profiles,
    logout_nexus,
    open_nexus_login_window,
    open_nexus_ranking_scraper,
    open_scraper_window,
    save_mod_config,
    save_profile,
    toggle_mod,
};
use crate::saves::{list_save_files, get_save_detail, get_planted_crops};
use crate::utils::open_in_file_manager;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Size};

#[derive(Debug, Deserialize, Serialize)]
struct MainWindowState {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
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

fn save_main_window_state(app: &AppHandle, window: &tauri::WebviewWindow) {
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
    if state.width == 0 || state.height == 0 {
        return;
    }

    let _ = window.set_position(tauri::PhysicalPosition::new(state.x, state.y));
    let _ = window.set_size(Size::Physical(tauri::PhysicalSize::new(
        state.width,
        state.height,
    )));
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            auto_detect_game_dir,
            check_smapi_status,
            list_installed_mods,
            toggle_mod,
            save_mod_config,
            fetch_smapi_compatibility_mods,
            open_scraper_window,
            open_nexus_ranking_scraper,
            open_in_file_manager,
            get_game_version,
            launch_game,
            install_smapi,
            uninstall_smapi,
            list_save_files,
            get_save_detail,
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
            install_nexus_mod,
            install_mod_from_zip
        ])
        .setup(|app| {
            let app_handle = app.handle();
            if let Some(window) = app_handle.get_webview_window("main") {
                restore_main_window_state(app_handle, &window);

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
