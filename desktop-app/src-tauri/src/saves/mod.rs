use std::path::PathBuf;

pub mod animals;
pub mod backups;
pub mod children;
pub mod crops;
pub mod editor;
pub mod npc_locations;
pub mod parser;
pub mod xml_utils;

// Re-export structures and Tauri commands for external modules (e.g. lib.rs)
pub use animals::get_save_animals;
pub use backups::{create_save_backup, delete_save_backup, list_save_backups, restore_save_backup};
pub use children::{get_children_data, update_child};
pub use crops::get_planted_crops;
pub use editor::{get_save_editor_data, update_save_editor_data};
pub use npc_locations::{get_npc_locations, get_npc_schedule, check_game_running, check_pipe_status};
pub use parser::{get_save_detail, list_save_files};

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
