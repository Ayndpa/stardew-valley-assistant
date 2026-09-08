//! 星露谷物语助手·移动端的 Rust 侧。
//!
//! 移动端和桌面端最大的差别在于「游戏从哪来」：桌面端能直接扫描游戏安装目录，
//! 移动端只能让玩家挑一个安装包，由应用把资源解进自己的私有目录。所以这里的
//! 模块划分是围绕这条链路展开的：
//!
//! - [`apk`] —— 识别安装包、导入游戏资源
//! - [`paths`] —— 私有目录布局，其余模块都从这里取路径
//! - [`utils`] —— 压缩包与文件的公共操作

#[cfg(target_os = "android")]
pub mod android;
pub mod apk;
pub mod game_data;
pub mod launcher;
pub mod mods;
pub mod paths;
pub mod smapi;
pub mod utils;
pub mod vlan;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(apk::ImportTasks::default())
        .manage(vlan::VlanState::default())
        .invoke_handler(tauri::generate_handler![
            apk::inspect_game_package,
            apk::install_game_package,
            apk::cancel_game_import,
            apk::get_game_install_status,
            apk::uninstall_game_package,
            game_data::get_crop_game_data,
            game_data::get_animal_game_data,
            game_data::get_npc_game_data,
            game_data::get_calendar_game_data,
            game_data::get_bundle_game_data,
            game_data::get_secret_notes_game_data,
            game_data::get_item_game_data,
            game_data::get_item_game_data_overview,
            game_data::query_item_game_data,
            game_data::get_fishing_map_data,
            game_data::get_fishing_map_detail,
            mods::list_installed_mods,
            mods::toggle_mod,
            mods::delete_mod,
            mods::save_mod_config,
            mods::rename_local_mod,
            mods::install_mod_from_zip,
            smapi::get_smapi_status,
            smapi::import_smapi_package,
            smapi::remove_smapi_package,
            launcher::get_modded_game_status,
            launcher::build_modded_game,
            launcher::install_modded_game,
            launcher::launch_modded_game,
            launcher::remove_modded_package,
            vlan::vlan_start,
            vlan::vlan_update_members,
            vlan::vlan_signal_in,
            vlan::vlan_stop,
            vlan::vlan_status,
            vlan::vlan_helper_status,
            vlan::vlan_prepare,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
