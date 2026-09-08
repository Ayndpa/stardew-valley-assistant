pub mod local;
pub mod nexus;
pub mod profiles;

// 数据模型与本地模组解析逻辑住在共享 crate 里，手机端引用同一份定义，
// 保证两端的 JSON 结构与 manifest 语义完全一致。
pub use sdv_mods::{Mod, ModConfigField, ModProfile, ModStateEntry};

// Re-export commands for lib.rs
pub use local::{
    delete_mod, install_mod_from_zip, list_installed_mods, rename_local_mod, save_mod_config,
    toggle_mod, write_mod_translation,
};
pub use nexus::{
    check_mod_updates, check_nexus_login_status, close_scraper_window, fetch_nexus_api_key,
    fetch_nexus_download_metadata, fetch_smapi_compatibility_mods, install_nexus_mod,
    load_cached_mod_updates, logout_nexus, open_nexus_login_window, open_nexus_ranking_scraper,
    open_scraper_window,
};
pub use profiles::{
    apply_profile, delete_profile, export_profile, export_profile_to_file, import_profile,
    import_profile_from_file, list_profiles, save_profile,
};
