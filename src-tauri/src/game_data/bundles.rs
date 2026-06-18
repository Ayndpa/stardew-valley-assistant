use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use super::calendar::resolve_localized_text;
use super::image_utils::render_object_icon;
use super::xnb::{
    get_lang_suffix, load_localized_string_tables_with_lang, load_objects_xnb,
    load_string_dictionary_best_effort,
};

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BundleIngredient {
    pub item_id: String,
    pub name: String,
    pub icon: Option<String>,
    pub stack: i32,
    pub quality: i32,
    pub is_category: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RewardItem {
    pub item_id: String,
    pub name: String,
    pub icon: Option<String>,
    pub stack: i32,
    pub is_gold: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BundleEntry {
    pub key: String,
    pub room: String,
    pub room_display_name: String,
    pub name: String,
    pub display_name: String,
    pub color: String,
    pub pick: i32,
    pub reward: String,
    pub reward_item: Option<RewardItem>,
    pub ingredients: Vec<BundleIngredient>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BundleGameData {
    pub bundles: Vec<BundleEntry>,
}

/// Map color index to color name.
fn color_name(color_index: i32) -> &'static str {
    match color_index {
        0 => "Green",
        1 => "Purple",
        2 => "Orange",
        3 => "Yellow",
        4 => "Red",
        5 => "Blue",
        6 => "Teal",
        _ => "Green",
    }
}

/// Map area name to localized display name.
fn room_display_name(area: &str, is_zh: bool) -> String {
    if is_zh {
        match area {
            "Pantry" => "储藏室",
            "Crafts Room" => "工艺室",
            "Fish Tank" => "鱼缸",
            "Boiler Room" => "锅炉房",
            "Vault" => "金库",
            "Bulletin Board" => "告示牌",
            "Abandoned Joja Mart" => "废弃乔家超市",
            _ => area,
        }
    } else {
        match area {
            "Pantry" => "Pantry",
            "Crafts Room" => "Crafts Room",
            "Fish Tank" => "Fish Tank",
            "Boiler Room" => "Boiler Room",
            "Vault" => "Vault",
            "Bulletin Board" => "Bulletin Board",
            "Abandoned Joja Mart" => "Abandoned Joja Mart",
            _ => area,
        }
    }
    .to_string()
}

/// Quality level display name.
#[allow(dead_code)]
fn quality_name(quality: i32, is_zh: bool) -> &'static str {
    match quality {
        0 => "",
        1 => {
            if is_zh {
                "银星"
            } else {
                "Silver"
            }
        }
        2 => {
            if is_zh {
                "金星"
            } else {
                "Gold"
            }
        }
        3 => {
            if is_zh {
                "铱星"
            } else {
                "Iridium"
            }
        }
        _ => "",
    }
}

/// Parse reward string like "O 465 20" or "BO 13 1" or "R 518 1" or "-1 2500 2500".
/// Returns (type_prefix, item_id, quantity).
fn parse_reward(raw: &str) -> Option<(&str, &str, i32)> {
    let parts: Vec<&str> = raw.split_whitespace().collect();
    if parts.len() < 3 {
        return None;
    }
    let qty = parts[2].parse::<i32>().ok()?;
    Some((parts[0], parts[1], qty))
}

/// Parse the ingredients field: space-separated triplets "itemId stack quality".
fn parse_ingredients(raw: &str) -> Vec<(String, i32, i32)> {
    let tokens: Vec<&str> = raw.split_whitespace().collect();
    let mut ingredients = Vec::new();
    let mut i = 0;
    while i + 2 < tokens.len() {
        let item_id = tokens[i].to_string();
        let stack = tokens[i + 1].parse::<i32>().unwrap_or(1);
        let quality = tokens[i + 2].parse::<i32>().unwrap_or(0);
        ingredients.push((item_id, stack, quality));
        i += 3;
    }
    ingredients
}

/// Build a display name for a category-based ingredient.
fn category_display_name(category_id: i32, is_zh: bool) -> String {
    if is_zh {
        match category_id {
            -2 => "宝石类".to_string(),
            -4 => "鱼类".to_string(),
            -5 => "蛋类".to_string(),
            -6 => "奶类".to_string(),
            -7 => "料理".to_string(),
            -8 => "手工制品".to_string(),
            -12 => "矿物类".to_string(),
            -15 => "金属资源".to_string(),
            -16 => "建材类".to_string(),
            -26 => "工匠物品".to_string(),
            -27 => "糖浆类".to_string(),
            -28 => "怪物战利品".to_string(),
            -75 => "蔬菜".to_string(),
            -79 => "水果".to_string(),
            -80 => "花朵".to_string(),
            -81 => "野菜/觅食物品".to_string(),
            _ => format!("分类 {}", category_id),
        }
    } else {
        match category_id {
            -2 => "Gem".to_string(),
            -4 => "Fish".to_string(),
            -5 => "Egg".to_string(),
            -6 => "Milk".to_string(),
            -7 => "Cooking".to_string(),
            -8 => "Crafting".to_string(),
            -12 => "Mineral".to_string(),
            -15 => "Metal Resource".to_string(),
            -16 => "Building Resource".to_string(),
            -26 => "Artisan Good".to_string(),
            -27 => "Syrup".to_string(),
            -28 => "Monster Loot".to_string(),
            -75 => "Vegetable".to_string(),
            -79 => "Fruit".to_string(),
            -80 => "Flower".to_string(),
            -81 => "Forage".to_string(),
            _ => format!("Category {}", category_id),
        }
    }
}

fn load_bundles_sync(
    game_dir: Option<String>,
    lang: Option<String>,
) -> Result<BundleGameData, String> {
    let content_dir = super::locate_content_dir(game_dir.as_deref())?;
    let lang_suffix = get_lang_suffix(lang.as_deref());
    let is_zh = lang
        .as_deref()
        .is_some_and(|l| l.to_lowercase().starts_with("zh"));

    // Load bundles data with localization fallback
    let mut bundle_paths = Vec::new();
    if !lang_suffix.is_empty() {
        bundle_paths.push(
            content_dir
                .join("Data")
                .join(format!("Bundles{}.xnb", lang_suffix)),
        );
    }
    bundle_paths.push(content_dir.join("Data").join("Bundles.xnb"));
    let raw_bundles = load_string_dictionary_best_effort(&bundle_paths);

    if raw_bundles.is_empty() {
        return Err("无法加载收集包数据".to_string());
    }

    // Load BundleNames string table for display names
    let bundle_names_tables =
        load_localized_string_tables_with_lang(&content_dir, &["BundleNames"], lang.as_deref());

    // Load objects data for item names and icons
    let objects = load_objects_xnb(&content_dir.join("Data").join("Objects.xnb"))
        .unwrap_or_default();

    // Load localized string tables for resolving [LocalizedText ...] tokens
    let localized_tables = load_localized_string_tables_with_lang(
        &content_dir,
        &["Objects", "StringsFromCSFiles", "1_6_Strings", "NPCNames", "UI"],
        lang.as_deref(),
    );

    let mut texture_cache = HashMap::new();
    let mut bundles = Vec::new();

    for (key, value) in &raw_bundles {
        // Key format: "AreaName/BundleIndex" e.g. "Pantry/0"
        let Some((area, _index_str)) = key.split_once('/') else {
            continue;
        };

        // Normalize area names
        let area_normalized = match area {
            "FishTank" => "Fish Tank",
            "CraftsRoom" => "Crafts Room",
            "BoilerRoom" => "Boiler Room",
            "BulletinBoard" => "Bulletin Board",
            other => other,
        };

        // Value format: 7 slash-delimited fields
        // [0]=name, [1]=reward, [2]=ingredients, [3]=color, [4]=slots, [5]=sprite, [6]=displayName
        let fields: Vec<&str> = value.split('/').collect();
        if fields.len() < 4 {
            continue;
        }

        let name = fields[0].to_string();
        let reward = fields.get(1).unwrap_or(&"").to_string();
        let ingredients_raw = fields.get(2).unwrap_or(&"");
        let color_index = fields.get(3).and_then(|s| s.parse::<i32>().ok()).unwrap_or(0);
        let pick = fields.get(4).and_then(|s| s.parse::<i32>().ok()).unwrap_or(-1);

        // Resolve display name: try BundleNames table, then field[6], then name
        let display_name = bundle_names_tables
            .get("BundleNames")
            .and_then(|table| table.get(&name))
            .cloned()
            .or_else(|| fields.get(6).map(|s| s.to_string()))
            .unwrap_or_else(|| name.clone());

        // Parse ingredients
        let raw_ingredients = parse_ingredients(ingredients_raw);
        let mut ingredients = Vec::new();

        for (item_id, stack, quality) in raw_ingredients {
            if item_id.starts_with('-') {
                // Category-based ingredient
                let category_id = item_id.parse::<i32>().unwrap_or(0);
                let cat_name = category_display_name(category_id, is_zh);
                ingredients.push(BundleIngredient {
                    item_id: item_id.clone(),
                    name: cat_name,
                    icon: None,
                    stack,
                    quality,
                    is_category: true,
                });
            } else {
                // Specific item
                let (item_name, icon) = if let Some(obj) = objects.get(&item_id) {
                    let icon = render_object_icon(&content_dir, obj, &mut texture_cache).ok();
                    let name = resolve_localized_text(&obj.display_name, &localized_tables);
                    (name, icon)
                } else {
                    (item_id.clone(), None)
                };
                ingredients.push(BundleIngredient {
                    item_id: item_id.clone(),
                    name: item_name,
                    icon,
                    stack,
                    quality,
                    is_category: false,
                });
            }
        }

        // Parse reward
        let reward_item = parse_reward(&reward).and_then(|(type_prefix, item_id, qty)| {
            if type_prefix == "-1" {
                // Gold reward
                Some(RewardItem {
                    item_id: "-1".to_string(),
                    name: if is_zh {
                        format!("{}金", qty)
                    } else {
                        format!("{}g", qty)
                    },
                    icon: None,
                    stack: qty,
                    is_gold: true,
                })
            } else {
                // Item reward
                let (item_name, icon) = if let Some(obj) = objects.get(item_id) {
                    let icon = render_object_icon(&content_dir, obj, &mut texture_cache).ok();
                    let name = resolve_localized_text(&obj.display_name, &localized_tables);
                    (name, icon)
                } else {
                    (item_id.to_string(), None)
                };
                Some(RewardItem {
                    item_id: item_id.to_string(),
                    name: item_name,
                    icon,
                    stack: qty,
                    is_gold: false,
                })
            }
        });

        bundles.push(BundleEntry {
            key: key.clone(),
            room: area_normalized.to_string(),
            room_display_name: room_display_name(area_normalized, is_zh),
            name: name.clone(),
            display_name,
            color: color_name(color_index).to_string(),
            pick,
            reward,
            reward_item,
            ingredients,
        });
    }

    // Sort by room order, then by bundle index
    let room_order = |room: &str| -> i32 {
        match room {
            "Crafts Room" => 0,
            "Pantry" => 1,
            "Fish Tank" => 2,
            "Boiler Room" => 3,
            "Vault" => 4,
            "Bulletin Board" => 5,
            "Abandoned Joja Mart" => 6,
            _ => 99,
        }
    };
    bundles.sort_by(|a, b| {
        room_order(&a.room)
            .cmp(&room_order(&b.room))
            .then(a.key.cmp(&b.key))
    });

    Ok(BundleGameData { bundles })
}

#[tauri::command]
pub async fn get_bundle_game_data(
    game_dir: Option<String>,
    lang: Option<String>,
) -> Result<BundleGameData, String> {
    tokio::task::spawn_blocking(move || load_bundles_sync(game_dir, lang))
        .await
        .map_err(|e| format!("读取收集包数据任务失败: {}", e))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dev_content_dir() -> Option<std::path::PathBuf> {
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
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
    fn bundles_xnb_is_string_dictionary() {
        let Some(content) = dev_content_dir() else {
            eprintln!("stardew-valley-source not found, skipping test");
            return;
        };
        let path = content.join("Data").join("Bundles.xnb");
        let raw = super::super::xnb::load_string_dictionary_xnb(&path)
            .expect("Failed to parse Bundles.xnb");
        assert!(!raw.is_empty(), "Bundles.xnb should contain data");

        // Print all bundle keys and first 80 chars of values
        let mut keys: Vec<_> = raw.keys().collect();
        keys.sort();
        for key in &keys {
            let value = &raw[*key];
            let preview = if value.len() > 80 {
                format!("{}...", &value[..80])
            } else {
                value.clone()
            };
            eprintln!("{}: {}", key, preview);
        }
    }

    #[test]
    fn parses_bundle_entries_correctly() {
        let Some(content) = dev_content_dir() else {
            eprintln!("stardew-valley-source not found, skipping test");
            return;
        };
        let path = content.join("Data").join("Bundles.xnb");
        let raw = super::super::xnb::load_string_dictionary_xnb(&path)
            .expect("Failed to parse Bundles.xnb");

        let mut parsed_count = 0;
        for (key, value) in &raw {
            let Some((_area, _index)) = key.split_once('/') else {
                panic!("Bundle key '{}' does not contain '/'", key);
            };
            let fields: Vec<&str> = value.split('/').collect();
            assert!(
                fields.len() >= 4,
                "Bundle '{}' has only {} fields, expected >= 4",
                key,
                fields.len()
            );
            let name = fields[0];
            let ingredients_raw = fields[2];
            let ingredients = parse_ingredients(ingredients_raw);
            assert!(
                !name.is_empty(),
                "Bundle '{}' has empty name",
                key
            );
            // At least some bundles should have ingredients
            if key.starts_with("Pantry/") || key.starts_with("Crafts Room/") {
                assert!(
                    !ingredients.is_empty(),
                    "Bundle '{}' ({}) should have ingredients",
                    key,
                    name
                );
            }
            parsed_count += 1;
        }
        eprintln!("Successfully parsed {} bundle entries", parsed_count);
        assert!(parsed_count >= 30, "Expected at least 30 bundles, got {}", parsed_count);
    }

    #[test]
    fn reward_is_parsed() {
        let Some(content) = dev_content_dir() else {
            eprintln!("stardew-valley-source not found, skipping test");
            return;
        };
        let game_dir = content
            .parent()
            .and_then(|p| p.parent())
            .map(|p| p.to_string_lossy().to_string());

        let data = load_bundles_sync(game_dir, Some("zh".to_string())).unwrap();

        // Check Spring Foraging reward: O 495 30
        let spring_foraging = data.bundles.iter().find(|b| b.name == "Spring Foraging").unwrap();
        let reward = spring_foraging.reward_item.as_ref().expect("Spring Foraging should have reward");
        assert_eq!(reward.item_id, "495");
        assert_eq!(reward.stack, 30);
        assert!(!reward.is_gold);
        assert!(!reward.name.is_empty(), "Reward name should be resolved");
        eprintln!("Spring Foraging reward: {} x{}", reward.name, reward.stack);

        // Check Vault 2500g reward: O 220 3
        let vault_2500 = data.bundles.iter().find(|b| b.name == "2,500g").unwrap();
        let reward = vault_2500.reward_item.as_ref().expect("2500g vault should have reward");
        assert_eq!(reward.item_id, "220");
        assert_eq!(reward.stack, 3);
        eprintln!("Vault 2500g reward: {} x{}", reward.name, reward.stack);

        // Check Construction reward: BO 114 1
        let construction = data.bundles.iter().find(|b| b.name == "Construction").unwrap();
        let reward = construction.reward_item.as_ref().expect("Construction should have reward");
        assert_eq!(reward.item_id, "114");
        assert_eq!(reward.stack, 1);
        eprintln!("Construction reward: {} x{}", reward.name, reward.stack);
    }

    #[test]
    fn loads_bundle_game_data() {
        let Some(content) = dev_content_dir() else {
            eprintln!("stardew-valley-source not found, skipping test");
            return;
        };
        let game_dir = content
            .parent()
            .and_then(|p| p.parent())
            .map(|p| p.to_string_lossy().to_string());

        let result = load_bundles_sync(game_dir, Some("zh".to_string()));
        match result {
            Ok(data) => {
                assert!(!data.bundles.is_empty(), "Should have bundles");
                // Check that we have bundles from multiple rooms
                let rooms: std::collections::HashSet<_> =
                    data.bundles.iter().map(|b| b.room.as_str()).collect();
                assert!(rooms.contains("Pantry"), "Should have Pantry room");
                assert!(rooms.contains("Crafts Room"), "Should have Crafts Room");
                assert!(rooms.contains("Fish Tank"), "Should have Fish Tank");
                assert!(rooms.contains("Vault"), "Should have Vault");

                // Print summary
                for room in &["Crafts Room", "Pantry", "Fish Tank", "Boiler Room", "Vault", "Bulletin Board"] {
                    let count = data.bundles.iter().filter(|b| b.room == *room).count();
                    eprintln!("{}: {} bundles", room, count);
                }

                // Check a specific bundle
                let spring_crops = data.bundles.iter().find(|b| b.name == "Spring Crops");
                if let Some(bundle) = spring_crops {
                    eprintln!("Spring Crops: {} ingredients", bundle.ingredients.len());
                    for ing in &bundle.ingredients {
                        eprintln!("  - {} x{} (quality {})", ing.name, ing.stack, ing.quality);
                    }
                }
            }
            Err(e) => {
                panic!("Failed to load bundle game data: {}", e);
            }
        }
    }
}
