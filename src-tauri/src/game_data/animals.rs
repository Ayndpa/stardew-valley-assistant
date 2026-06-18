use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

use super::image_utils::{resolve_object_texture_path, object_texture_key, Texture};
use super::xnb::{load_farm_animals_xnb, load_objects_xnb, load_string_dictionary_best_effort};

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AnimalProduceInfo {
    pub item_id: String,
    pub name: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AnimalEncyclopediaEntry {
    pub id: String,
    pub name: String,
    pub house: String,
    pub house_display: String,
    pub purchase_price: i32,
    pub sell_price: i32,
    pub days_to_mature: i32,
    pub days_to_produce: i32,
    pub can_get_pregnant: bool,
    pub harvest_type: String,
    pub harvest_tool: String,
    pub produce_items: Vec<AnimalProduceInfo>,
    pub deluxe_produce_items: Vec<AnimalProduceInfo>,
    pub deluxe_produce_min_friendship: i32,
    pub can_swim: bool,
    pub can_eat_golden_crackers: bool,
    pub icon: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AnimalGameData {
    pub encyclopedia: Vec<AnimalEncyclopediaEntry>,
    pub houses: Vec<String>,
}

fn harvest_type_name(harvest_type: i32, is_zh: bool) -> String {
    match harvest_type {
        0 => {
            if is_zh {
                "夜间掉落".to_string()
            } else {
                "Drop Overnight".to_string()
            }
        }
        1 => {
            if is_zh {
                "工具采集".to_string()
            } else {
                "Harvest With Tool".to_string()
            }
        }
        2 => {
            if is_zh {
                "挖掘".to_string()
            } else {
                "Dig Up".to_string()
            }
        }
        _ => {
            if is_zh {
                "未知".to_string()
            } else {
                "Unknown".to_string()
            }
        }
    }
}

fn house_display_name(house: &str, is_zh: bool) -> String {
    match house {
        "Coop" => {
            if is_zh {
                "鸡舍".to_string()
            } else {
                "Coop".to_string()
            }
        }
        "Barn" => {
            if is_zh {
                "畜棚".to_string()
            } else {
                "Barn".to_string()
            }
        }
        _ => house.to_string(),
    }
}

fn resolve_localized_name(raw: &str, strings: &HashMap<String, String>) -> String {
    // Handle tokenized names like [LocalizedText Strings\FarmAnimals:White Chicken_Name]
    if raw.starts_with("[LocalizedText") && raw.ends_with(']') {
        let inner = &raw[14..raw.len() - 1].trim();
        if let Some(colon_pos) = inner.rfind(':') {
            let key = &inner[colon_pos + 1..];
            if let Some(value) = strings.get(key) {
                return value.clone();
            }
        }
    }
    // Direct lookup
    if let Some(value) = strings.get(raw) {
        return value.clone();
    }
    raw.to_string()
}

fn render_animal_icon(
    content_dir: &Path,
    texture_key: &str,
    sprite_index: i32,
    sprite_width: i32,
    sprite_height: i32,
    texture_cache: &mut HashMap<String, Texture>,
) -> Result<String, String> {
    if !texture_cache.contains_key(texture_key) {
        let path = resolve_object_texture_path(content_dir, texture_key)?;
        let texture = super::xnb::load_xnb_texture(&path)?;
        texture_cache.insert(texture_key.to_string(), texture);
    }

    let texture = texture_cache
        .get(texture_key)
        .ok_or_else(|| format!("Animal texture '{}' was not cached", texture_key))?;

    let sw = sprite_width.max(1) as usize;
    let sh = sprite_height.max(1) as usize;
    let index = sprite_index.max(0) as usize;
    let cols = if sw > 0 { texture.width / sw } else { 1 };
    let col = index % cols;
    let row = index / cols;
    let x = col * sw;
    let y = row * sh;

    let rect = super::image_utils::Rect {
        x,
        y,
        width: sw.min(texture.width.saturating_sub(x)),
        height: sh.min(texture.height.saturating_sub(y)),
    };
    texture.crop_to_png_data_url(rect)
}

#[tauri::command]
pub fn get_animal_game_data(
    game_dir: Option<String>,
    lang: Option<String>,
) -> Result<AnimalGameData, String> {
    let content_dir = super::locate_content_dir(game_dir.as_deref())?;
    let animals = load_farm_animals_xnb(&content_dir.join("Data").join("FarmAnimals.xnb"))?;
    let objects = load_objects_xnb(&content_dir.join("Data").join("Objects.xnb"))?;

    let lang_str = lang.as_deref().unwrap_or("zh");
    let is_zh = lang_str.to_lowercase().starts_with("zh");

    let suffix = match lang_str.to_lowercase().as_str() {
        "zh" | "zh-cn" => ".zh-CN",
        "ja" | "ja-jp" => ".ja-JP",
        "ru" | "ru-ru" => ".ru-RU",
        "de" | "de-de" => ".de-DE",
        "es" | "es-es" => ".es-ES",
        "fr" | "fr-fr" => ".fr-FR",
        "it" | "it-it" => ".it-IT",
        "ko" | "ko-kr" => ".ko-KR",
        "pt" | "pt-br" => ".pt-BR",
        "tr" | "tr-tr" => ".tr-TR",
        "hu" | "hu-hu" => ".hu-HU",
        _ => "",
    };

    let mut string_paths = Vec::new();
    if !suffix.is_empty() {
        string_paths.push(
            content_dir
                .join("Strings")
                .join(format!("FarmAnimals{}.xnb", suffix)),
        );
    }
    string_paths.push(content_dir.join("Strings").join("FarmAnimals.xnb"));

    let mut object_strings_paths = Vec::new();
    if !suffix.is_empty() {
        object_strings_paths.push(
            content_dir
                .join("Strings")
                .join(format!("Objects{}.xnb", suffix)),
        );
    }
    object_strings_paths.push(content_dir.join("Strings").join("Objects.xnb"));

    let animal_strings = load_string_dictionary_best_effort(&string_paths);
    let object_strings = load_string_dictionary_best_effort(&object_strings_paths);

    let mut encyclopedia = Vec::new();
    let mut houses_set = std::collections::HashSet::new();
    let mut texture_cache = HashMap::new();

    for (id, animal) in &animals {
        // Skip baby-only entries or entries with negative purchase price that aren't useful
        if animal.house.is_empty() {
            continue;
        }

        let name = resolve_localized_name(&animal.display_name, &animal_strings);
        let house_display = house_display_name(&animal.house, is_zh);
        houses_set.insert(animal.house.clone());

        let produce_items: Vec<AnimalProduceInfo> = animal
            .produce_items
            .iter()
            .map(|p| {
                let item_name = objects
                    .get(&p.item_id)
                    .map(|obj| {
                        resolve_localized_name(&obj.display_name, &object_strings)
                    })
                    .unwrap_or_else(|| format!("Item #{}", p.item_id));
                AnimalProduceInfo {
                    item_id: p.item_id.clone(),
                    name: item_name,
                }
            })
            .collect();

        let deluxe_produce_items: Vec<AnimalProduceInfo> = animal
            .deluxe_produce_items
            .iter()
            .map(|p| {
                let item_name = objects
                    .get(&p.item_id)
                    .map(|obj| {
                        resolve_localized_name(&obj.display_name, &object_strings)
                    })
                    .unwrap_or_else(|| format!("Item #{}", p.item_id));
                AnimalProduceInfo {
                    item_id: p.item_id.clone(),
                    name: item_name,
                }
            })
            .collect();

        let texture_key = if animal.texture.is_empty() {
            format!("Animals/{}", id)
        } else {
            object_texture_key(&animal.texture)
        };

        let icon = render_animal_icon(
            &content_dir,
            &texture_key,
            0,
            animal.sprite_width,
            animal.sprite_height,
            &mut texture_cache,
        )
        .ok();

        let entry = AnimalEncyclopediaEntry {
            id: id.clone(),
            name,
            house: animal.house.clone(),
            house_display,
            purchase_price: if animal.purchase_price >= 0 {
                animal.purchase_price * 2
            } else {
                -1
            },
            sell_price: animal.sell_price,
            days_to_mature: animal.days_to_mature,
            days_to_produce: animal.days_to_produce,
            can_get_pregnant: animal.can_get_pregnant,
            harvest_type: harvest_type_name(animal.harvest_type, is_zh),
            harvest_tool: animal.harvest_tool.clone(),
            produce_items,
            deluxe_produce_items,
            deluxe_produce_min_friendship: animal.deluxe_produce_min_friendship,
            can_swim: animal.can_swim,
            can_eat_golden_crackers: animal.can_eat_golden_crackers,
            icon,
        };

        encyclopedia.push(entry);
    }

    // Sort by house type, then by name
    encyclopedia.sort_by(|a, b| a.house.cmp(&b.house).then(a.name.cmp(&b.name)));

    let mut houses: Vec<String> = houses_set.into_iter().collect();
    houses.sort();

    Ok(AnimalGameData {
        encyclopedia,
        houses,
    })
}
