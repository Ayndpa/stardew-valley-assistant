pub mod local;
pub mod nexus;
pub mod profiles;

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModStateEntry {
    pub folder_name: String,
    pub is_enabled: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModProfile {
    pub id: String,
    pub name: String,
    pub mod_states: Vec<ModStateEntry>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModConfigField {
    pub key: String,
    pub label: String,
    pub r#type: String, // "boolean" | "number" | "string"
    pub value: serde_json::Value,
    pub description: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Mod {
    pub id: String,
    pub name: String,
    pub english_name: String,
    pub version: String,
    pub latest_version: String,
    pub author: String,
    pub description: String,
    pub category: String,
    pub is_enabled: bool,
    pub nexus_id: Option<u64>,
    pub local_path: String,
    pub folder_name: String,
    /// Relative parent path from Mods/ (e.g. "美化类"), empty for top-level mods
    pub parent_path: String,
    pub dependencies: Vec<String>,
    pub config: Vec<ModConfigField>,
}

// Re-export commands for lib.rs
pub use local::{
    delete_mod, install_bundled_assistant_mod, install_mod_from_zip, list_installed_mods,
    save_mod_config, toggle_mod,
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
