pub mod bundles;
pub mod calendar;
pub mod crops;
pub mod fishing;
pub mod image_utils;
pub mod items;
pub mod map_names;
pub mod npc;
pub mod secret_notes;
pub mod tbin;
pub mod xnb;

use crate::game::find_stardew_valley;
use std::fs;
use std::path::{Path, PathBuf};

pub use bundles::get_bundle_game_data;
pub use calendar::get_calendar_game_data;
pub use crops::get_crop_game_data;
pub use fishing::{get_fishing_map_data, get_fishing_map_detail};
pub use items::{get_item_game_data, get_item_game_data_overview, query_item_game_data};
pub use npc::get_npc_game_data;
pub use secret_notes::get_secret_notes_game_data;

pub fn locate_content_dir(game_dir: Option<&str>) -> Result<PathBuf, String> {
    let mut candidates = Vec::new();

    if let Some(game_dir) = game_dir.map(str::trim).filter(|value| !value.is_empty()) {
        push_content_candidates(Path::new(game_dir), &mut candidates);
    }

    if let Some(game_dir) = find_stardew_valley() {
        push_content_candidates(Path::new(&game_dir), &mut candidates);
    }

    if let Ok(current_dir) = std::env::current_dir() {
        for ancestor in current_dir.ancestors() {
            push_content_candidates(ancestor, &mut candidates);
            if let Some(parent) = ancestor.parent() {
                push_content_candidates(
                    &parent
                        .join("stardew-valley-source")
                        .join("StardewValleyGame"),
                    &mut candidates,
                );
            }
        }
    }

    candidates
        .into_iter()
        .find(|path| path.join("Data").join("Crops.xnb").exists())
        .ok_or_else(|| {
            "无法定位星露谷 Content/Data/Crops.xnb，请先在设置中配置游戏安装目录。".to_string()
        })
}

fn push_content_candidates(root: &Path, candidates: &mut Vec<PathBuf>) {
    candidates.push(root.join("Content"));
    candidates.push(root.join("StardewValleyGame").join("Content"));
    candidates.push(root.to_path_buf());
}

pub fn collect_xnb_files(root: &Path) -> Result<Vec<PathBuf>, String> {
    let mut files = Vec::new();
    collect_xnb_files_inner(root, &mut files)?;
    files.sort();
    Ok(files)
}

fn collect_xnb_files_inner(root: &Path, files: &mut Vec<PathBuf>) -> Result<(), String> {
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(err) if !root.exists() => {
            return Err(format!("无法定位地图目录 {}: {}", root.display(), err));
        }
        Err(err) => {
            return Err(format!("无法读取地图目录 {}: {}", root.display(), err));
        }
    };

    for entry in entries {
        let entry = entry.map_err(|err| format!("读取地图目录失败: {}", err))?;
        let path = entry.path();
        if path.is_dir() {
            collect_xnb_files_inner(&path, files)?;
        } else if path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("xnb"))
        {
            files.push(path);
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn dev_content_dir() -> Option<PathBuf> {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .and_then(|path| path.parent())
            .map(|path| {
                path.join("stardew-valley-source")
                    .join("StardewValleyGame")
                    .join("Content")
            })
            .filter(|path| path.exists())
    }

    #[test]
    fn reads_crop_game_data_from_dev_source() {
        let Some(content) = dev_content_dir() else {
            return;
        };
        let crops = xnb::load_crops_xnb(&content.join("Data").join("Crops.xnb")).unwrap();
        let objects = xnb::load_objects_xnb(&content.join("Data").join("Objects.xnb")).unwrap();
        assert!(crops.contains_key("472"));
        assert_eq!(crops["472"].harvest_item_id, "24");
        assert_eq!(objects["24"].price, 35);
        let mut texture_cache = HashMap::new();
        let icon =
            image_utils::render_object_icon(&content, &objects["24"], &mut texture_cache).unwrap();
        assert!(icon.starts_with("data:image/png;base64,"));
    }

    #[test]
    fn reads_object_game_data_fields_from_dev_source() {
        let Some(content) = dev_content_dir() else {
            return;
        };
        let objects = xnb::load_objects_xnb(&content.join("Data").join("Objects.xnb")).unwrap();
        let parsnip = objects.get("24").unwrap();

        assert!(!parsnip.name.is_empty());
        assert!(parsnip.price >= 0);
        assert!(parsnip.category <= 0);
        assert!(parsnip.can_be_trashed);
    }

    #[test]
    fn debug_crop_xnb_shape() {
        let Some(content) = dev_content_dir() else {
            return;
        };
        let payload = xnb::load_xnb_payload(&content.join("Data").join("Crops.xnb")).unwrap();
        let mut reader = xnb::XnbPayloadReader::new(&payload);
        let type_readers = reader.read_type_readers().unwrap();
        eprintln!("reader count {}", type_readers.len());
        for (idx, name) in type_readers.iter().enumerate() {
            eprintln!("{}: {}", idx + 1, name);
        }
        let root = reader.read_7bit_usize().unwrap();
        let count = reader.read_i32().unwrap();
        eprintln!("root {} count {} pos {}", root, count, reader.pos);
        let key = reader.read_string().unwrap();
        eprintln!("first key {:?} pos {}", key, reader.pos);
        eprintln!("next bytes {:?}", &reader.data[reader.pos..reader.pos + 64]);
    }

    #[test]
    fn reads_fishing_tiles_from_dev_maps() {
        let Some(content) = dev_content_dir() else {
            return;
        };
        let beach = fishing::parse_fishing_map(&content, &content.join("Maps").join("Beach.xnb"))
            .unwrap()
            .unwrap();
        assert_eq!(beach.id, "Beach");
        assert!(beach.width > 0);
        assert!(beach.height > 0);
        assert!(beach.fishable_tiles > 0);
        assert!(beach.max_depth > 0);
    }

    #[test]
    fn reads_location_fishing_data_from_dev_source() {
        let Some(content) = dev_content_dir() else {
            return;
        };
        let locations =
            xnb::load_location_fishing_xnb(&content.join("Data").join("Locations.xnb")).unwrap();
        let beach = locations.get("Beach").unwrap();
        assert!(!beach.fish.is_empty());
        assert!(!beach.fish_areas.is_empty());
    }

    #[test]
    fn reads_calendar_game_data_from_dev_source() {
        let Some(content) = dev_content_dir() else {
            return;
        };
        let localized_tables = xnb::load_localized_string_tables(
            &content,
            &["Characters", "NPCNames", "UI", "1_6_Strings"],
        );
        let festivals = calendar::load_calendar_festivals(
            &content,
            &localized_tables,
            true,
            xnb::get_lang_suffix(Some("zh")),
        )
        .unwrap();
        let birthdays =
            calendar::load_calendar_birthdays(&content, &localized_tables, true).unwrap();

        assert!(festivals.iter().any(|entry| entry.name.contains("复活节")));
        assert!(festivals.iter().any(|entry| entry.name.contains("夜市")));
        assert!(birthdays
            .iter()
            .any(|entry| entry.name.contains("阿比盖尔")));
        assert!(birthdays.iter().any(|entry| entry.name.contains("刘易斯")));
    }

    #[test]
    fn reads_npc_profiles_from_dev_source() {
        let Some(content) = dev_content_dir() else {
            return;
        };
        let localized_tables = xnb::load_localized_string_tables(
            &content,
            &[
                "Characters",
                "NPCNames",
                "UI",
                "1_6_Strings",
                "StringsFromCSFiles",
                "Objects",
            ],
        );
        let npcs = npc::load_npc_profiles(&content, &localized_tables, true).unwrap();

        assert!(npcs.iter().any(|entry| entry.id == "Abigail"));
        assert!(npcs.iter().any(|entry| entry.id == "Lewis"));
        let abigail = npcs.iter().find(|entry| entry.id == "Abigail").unwrap();
        assert!(!abigail.loved_items.is_empty());
        assert!(!abigail.hated_items.is_empty());
        assert!(abigail
            .loved_items
            .iter()
            .all(|item| !item.contains("[LocalizedText")));
    }

    #[test]
    fn reads_cooking_recipe_sources_from_dev_source() {
        let Some(content) = dev_content_dir() else {
            return;
        };
        let localized_tables = xnb::load_localized_string_tables(
            &content,
            &["Objects", "1_6_Strings", "StringsFromCSFiles", "NPCNames"],
        );
        let recipe_sources =
            items::load_cooking_recipe_sources_localized(&content, &localized_tables, true);

        // Should have recipe sources for some items
        assert!(!recipe_sources.is_empty());

        // Check that TV recipes are identified with detailed schedule
        let has_tv_recipe = recipe_sources
            .values()
            .any(|sources| sources.iter().any(|s| s.contains("酱料女皇电视节目（第")));
        assert!(
            has_tv_recipe,
            "Should have at least one TV recipe source with schedule"
        );

        // Check that skill-based recipes are identified
        let has_skill_recipe = recipe_sources
            .values()
            .any(|sources| sources.iter().any(|s| s.contains("等级")));
        assert!(
            has_skill_recipe,
            "Should have at least one skill-based recipe source"
        );

        // Check that friendship-based recipes are identified
        let has_friendship_recipe = recipe_sources
            .values()
            .any(|sources| sources.iter().any(|s| s.contains("好感")));
        assert!(
            has_friendship_recipe,
            "Should have at least one friendship-based recipe source"
        );

        // Print some sample sources for debugging
        let mut samples: Vec<_> = recipe_sources.iter().take(10).collect();
        samples.sort_by_key(|(id, _)| id.clone());
        for (item_id, sources) in &samples {
            eprintln!("Item {}: {:?}", item_id, sources);
        }

        // Check for recipes with multiple sources
        let multi_source_count = recipe_sources
            .values()
            .filter(|sources| sources.len() > 1)
            .count();
        eprintln!("\nRecipes with multiple sources: {}", multi_source_count);
    }
}
