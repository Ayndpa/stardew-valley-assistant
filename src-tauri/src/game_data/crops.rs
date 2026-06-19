use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use super::calendar::resolve_display_name;
use super::image_utils::render_object_icon;
use super::xnb::{load_crops_xnb, load_objects_xnb, load_string_dictionary_best_effort};

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CropLookup {
    pub name: String,
    pub sell_price: i32,
    pub price_source: String,
    pub regrows: bool,
    pub regrow_days: Option<i32>,
    pub icon: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CropEncyclopediaEntry {
    pub seed_id: String,
    pub harvest_id: String,
    pub internal_name: String,
    pub name: String,
    pub icon: Option<String>,
    pub season: String,
    pub seasons: Vec<String>,
    pub grow_days: i32,
    pub sell_price: i32,
    pub price_source: String,
    pub category_key: String,
    pub regrows: bool,
    pub regrow_days: Option<i32>,
    pub needs_watering: bool,
    pub water_needs: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CropGameData {
    pub encyclopedia: Vec<CropEncyclopediaEntry>,
    pub lookup: HashMap<String, CropLookup>,
    pub seasons: Vec<String>,
}

#[tauri::command]
pub fn get_crop_game_data(
    game_dir: Option<String>,
    lang: Option<String>,
) -> Result<CropGameData, String> {
    let content_dir = super::locate_content_dir(game_dir.as_deref())?;
    let crops = load_crops_xnb(&content_dir.join("Data").join("Crops.xnb"))?;
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

    let mut object_strings_paths = Vec::new();
    if !suffix.is_empty() {
        object_strings_paths.push(
            content_dir
                .join("Strings")
                .join(format!("Objects{}.xnb", suffix)),
        );
    }
    object_strings_paths.push(content_dir.join("Strings").join("Objects.xnb"));

    let object_strings = load_string_dictionary_best_effort(&object_strings_paths);

    let mut encyclopedia = Vec::new();
    let mut lookup = HashMap::new();
    let mut texture_cache = HashMap::new();

    // Try to load prices from game data export file
    let mod_prices = super::item_prices::read_item_prices_from_export();

    for (seed_id, crop) in crops {
        let Some(obj) = objects.get(&crop.harvest_item_id) else {
            continue;
        };

        let name = resolve_display_name(&obj.display_name, &object_strings)
            .unwrap_or_else(|| obj.name.clone());
        let seasons = crop
            .seasons
            .iter()
            .map(|season| season_name_localized(*season, is_zh).to_string())
            .collect::<Vec<_>>();
        let season = compact_season_label_localized(&crop.seasons, is_zh);
        let grow_days = crop.days_in_phase.iter().sum();
        let regrows = crop.regrow_days >= 0;
        let regrow_days = regrows.then_some(crop.regrow_days);
        let water_needs = if crop.needs_watering {
            if is_zh {
                "每天".to_string()
            } else {
                "Daily".to_string()
            }
        } else {
            if is_zh {
                "无需".to_string()
            } else {
                "No".to_string()
            }
        };
        let icon = render_object_icon(&content_dir, obj, &mut texture_cache).ok();

        // Use export price if available, otherwise fall back to XNB price
        let harvest_id = &crop.harvest_item_id;
        let (sell_price, price_source) = mod_prices
            .as_ref()
            .and_then(|mp| mp.get(harvest_id).map(|&p| (p, "export")))
            .unwrap_or((obj.price, "xnb"));

        let entry = CropEncyclopediaEntry {
            seed_id: seed_id.clone(),
            harvest_id: crop.harvest_item_id.clone(),
            internal_name: obj.name.clone(),
            name: name.clone(),
            icon: icon.clone(),
            season,
            seasons,
            grow_days,
            sell_price,
            price_source: price_source.to_string(),
            category_key: classify_crop_category_key(obj.category),
            regrows,
            regrow_days,
            needs_watering: crop.needs_watering,
            water_needs,
        };

        let lookup_entry = CropLookup {
            name,
            sell_price,
            price_source: price_source.to_string(),
            regrows,
            regrow_days,
            icon,
        };
        lookup.insert(seed_id, lookup_entry.clone());
        lookup.insert(crop.harvest_item_id, lookup_entry);
        encyclopedia.push(entry);
    }

    encyclopedia.sort_by(|a, b| {
        season_sort_key_localized(&a.seasons, is_zh)
            .cmp(&season_sort_key_localized(&b.seasons, is_zh))
            .then(a.grow_days.cmp(&b.grow_days))
            .then(a.name.cmp(&b.name))
    });

    Ok(CropGameData {
        encyclopedia,
        lookup,
        seasons: derive_season_filters_localized(is_zh),
    })
}

pub fn season_name_localized(season: i32, is_zh: bool) -> &'static str {
    match season {
        0 => {
            if is_zh {
                "春季"
            } else {
                "Spring"
            }
        }
        1 => {
            if is_zh {
                "夏季"
            } else {
                "Summer"
            }
        }
        2 => {
            if is_zh {
                "秋季"
            } else {
                "Fall"
            }
        }
        3 => {
            if is_zh {
                "冬季"
            } else {
                "Winter"
            }
        }
        _ => {
            if is_zh {
                "未知"
            } else {
                "Unknown"
            }
        }
    }
}

pub fn compact_season_label_localized(seasons: &[i32], is_zh: bool) -> String {
    let mut sorted = seasons.to_vec();
    sorted.sort_unstable();
    sorted.dedup();
    match sorted.as_slice() {
        [0] => {
            if is_zh {
                "春季".to_string()
            } else {
                "Spring".to_string()
            }
        }
        [1] => {
            if is_zh {
                "夏季".to_string()
            } else {
                "Summer".to_string()
            }
        }
        [2] => {
            if is_zh {
                "秋季".to_string()
            } else {
                "Fall".to_string()
            }
        }
        [3] => {
            if is_zh {
                "冬季".to_string()
            } else {
                "Winter".to_string()
            }
        }
        [0, 1, 2] => {
            if is_zh {
                "春夏秋".to_string()
            } else {
                "Spring/Summer/Fall".to_string()
            }
        }
        [0, 1, 2, 3] => {
            if is_zh {
                "全季".to_string()
            } else {
                "All Seasons".to_string()
            }
        }
        _ => sorted
            .iter()
            .map(|season| season_name_localized(*season, is_zh))
            .collect::<Vec<_>>()
            .join(if is_zh { "" } else { "/" }),
    }
}

pub fn season_sort_key_localized(seasons: &[String], is_zh: bool) -> Vec<i32> {
    seasons
        .iter()
        .map(|season| {
            if is_zh {
                match season.as_str() {
                    "春季" => 0,
                    "夏季" => 1,
                    "秋季" => 2,
                    "冬季" => 3,
                    _ => 9,
                }
            } else {
                match season.as_str() {
                    "Spring" => 0,
                    "Summer" => 1,
                    "Fall" => 2,
                    "Winter" => 3,
                    _ => 9,
                }
            }
        })
        .collect()
}

pub fn derive_season_filters_localized(is_zh: bool) -> Vec<String> {
    if is_zh {
        vec![
            "全部".to_string(),
            "春季".to_string(),
            "夏季".to_string(),
            "秋季".to_string(),
            "冬季".to_string(),
            "春夏秋".to_string(),
            "全季".to_string(),
        ]
    } else {
        vec![
            "All".to_string(),
            "Spring".to_string(),
            "Summer".to_string(),
            "Fall".to_string(),
            "Winter".to_string(),
            "Spring/Summer/Fall".to_string(),
            "All Seasons".to_string(),
        ]
    }
}

fn classify_crop_category_key(category: i32) -> String {
    match category {
        -75 => "vegetable".to_string(),
        -76 => "flower".to_string(),
        -77 => "forage".to_string(),
        -78 => "fruit".to_string(),
        _ => "other".to_string(),
    }
}
