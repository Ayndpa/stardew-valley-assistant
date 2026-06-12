mod utils;
mod game;
mod smapi;
mod mods;
mod saves;

use crate::game::{auto_detect_game_dir, get_game_version};
use crate::smapi::{check_smapi_status, install_smapi, uninstall_smapi};
use crate::mods::{list_installed_mods, toggle_mod, save_mod_config};
use crate::saves::{list_save_files, get_save_detail};
use crate::utils::open_in_file_manager;

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
            open_in_file_manager,
            get_game_version,
            install_smapi,
            uninstall_smapi,
            list_save_files,
            get_save_detail
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
