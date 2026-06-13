pub mod local;
pub mod profiles;
pub mod nexus;

use serde::{Serialize, Deserialize};

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
    pub dependencies: Vec<String>,
    pub config: Vec<ModConfigField>,
}

// Re-export commands for lib.rs
pub use local::{delete_mod, list_installed_mods, install_mod_from_zip, save_mod_config, toggle_mod};
pub use profiles::{list_profiles, save_profile, delete_profile, apply_profile, export_profile, import_profile, export_profile_to_file, import_profile_from_file};
pub use nexus::{fetch_smapi_compatibility_mods, open_scraper_window, open_nexus_ranking_scraper, open_nexus_login_window, check_nexus_login_status, logout_nexus, fetch_nexus_api_key, install_nexus_mod};
