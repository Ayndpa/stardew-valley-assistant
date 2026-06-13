mod utils;
mod game;
mod smapi;
mod mods;
mod saves;

use crate::game::{auto_detect_game_dir, get_game_version};
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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
