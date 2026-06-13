use std::path::PathBuf;

pub mod xml_utils;
pub mod backups;
pub mod parser;
pub mod editor;
pub mod crops;

// Re-export structures and Tauri commands for external modules (e.g. lib.rs)
pub use backups::{
    list_save_backups, create_save_backup, restore_save_backup, delete_save_backup,
    SaveBackupCatalog, SaveBackupEntry,
};
pub use parser::{
    list_save_files, get_save_detail, SaveSummary, FriendshipInfo, SaveDetail,
};
pub use editor::{
    get_save_editor_data, update_save_editor_data, SaveEditorData, SaveEditorUpdate, EditableFriendship,
};
pub use crops::{
    get_planted_crops, PlantedCrop,
};

pub fn get_saves_dir() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var("APPDATA").ok()?;
        Some(PathBuf::from(appdata).join("StardewValley").join("Saves"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        let home = std::env::var("HOME").ok()?;
        Some(
            PathBuf::from(home)
                .join(".config")
                .join("StardewValley")
                .join("Saves"),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_list() {
        match parser::list_save_files_sync(None) {
            Ok(list) => {
                println!("SUCCESS: Listed {} saves", list.len());
                for s in list {
                    println!("  - {} ({})", s.player_name, s.farm_name);
                }
            }
            Err(e) => {
                println!("ERROR listing saves: {}", e);
                panic!("Failed: {}", e);
            }
        }
    }
}
