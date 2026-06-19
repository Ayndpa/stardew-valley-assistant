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
    /// 数据来源："export" = 游戏导出文件, "xnb" = 游戏数据解包
    pub data_source: String,
    /// 导出文件的生成时间（ISO 8601），仅 data_source="export" 时有值
    pub generated_at: Option<String>,
}

#[tauri::command]
pub fn get_crop_game_data(
    game_dir: Option<String>,
    lang: Option<String>,
) -> Result<CropGameData, String> {
    let lang_str = lang.as_deref().unwrap_or("zh");
    let is_zh = lang_str.to_lowercase().starts_with("zh");
    let content_dir = super::locate_content_dir(game_dir.as_deref())?;

    // 优先使用导出文件（图标缺失时回退 XNB）
    if let Some(export) = super::item_prices::read_game_data_export() {
        return Ok(build_crop_data_from_export(export, &content_dir, is_zh));
    }

    // 回退到 XNB 解析
    build_crop_data_from_xnb(&content_dir, lang_str, is_zh)
}

/// 从 game-data.json 导出文件构建作物数据（图标缺失时回退 XNB）
fn build_crop_data_from_export(
    export: &super::item_prices::GameDataExport,
    content_dir: &std::path::Path,
    is_zh: bool,
) -> CropGameData {
    let item_map = super::item_prices::build_item_map_from_export()
        .unwrap_or_default();

    // 预加载 XNB 对象数据，用于图标回退
    let objects_xnb = load_objects_xnb(&content_dir.join("Data").join("Objects.xnb"))
        .unwrap_or_default();
    let mut texture_cache = HashMap::new();

    let mut encyclopedia = Vec::new();
    let mut lookup = HashMap::new();

    for crop in &export.crops {
        let harvest_item = item_map.get(&crop.harvest_item_id);
        let name = harvest_item
            .map(|i| i.name.clone())
            .unwrap_or_else(|| crop.harvest_item_id.clone());
        let internal_name = harvest_item
            .map(|i| i.internal_name.clone())
            .unwrap_or_default();
        let sell_price = harvest_item.map(|i| i.price).unwrap_or(0);
        let category = harvest_item.map(|i| i.category).unwrap_or(0);

        // 图标：优先从 icons/ 目录加载，缺失时回退 XNB 解包
        let icon = super::item_prices::read_icon_from_export("", &crop.harvest_item_id)
            .or_else(|| {
                objects_xnb
                    .get(&crop.harvest_item_id)
                    .and_then(|obj| render_object_icon(content_dir, obj, &mut texture_cache).ok())
            });

        let seasons: Vec<String> = crop
            .seasons
            .iter()
            .map(|s| season_name_from_str(s, is_zh).to_string())
            .collect();
        let season = compact_season_label_from_strings(&seasons, is_zh);
        let grow_days: i32 = crop.phases.iter().sum();
        let regrows = crop.regrow_days >= 0;
        let regrow_days = regrows.then_some(crop.regrow_days);
        let water_needs = if crop.needs_watering {
            if is_zh { "每天" } else { "Daily" }.to_string()
        } else {
            if is_zh { "无需" } else { "No" }.to_string()
        };

        let entry = CropEncyclopediaEntry {
            seed_id: crop.id.clone(),
            harvest_id: crop.harvest_item_id.clone(),
            internal_name,
            name: name.clone(),
            icon: icon.clone(),
            season,
            seasons,
            grow_days,
            sell_price,
            price_source: "export".to_string(),
            category_key: classify_crop_category_key(category),
            regrows,
            regrow_days,
            needs_watering: crop.needs_watering,
            water_needs,
        };

        let lookup_entry = CropLookup {
            name,
            sell_price,
            price_source: "export".to_string(),
            regrows,
            regrow_days,
            icon: icon.clone(),
        };
        lookup.insert(crop.id.clone(), lookup_entry.clone());
        lookup.insert(crop.harvest_item_id.clone(), lookup_entry);
        encyclopedia.push(entry);
    }

    encyclopedia.sort_by(|a, b| {
        season_sort_key_localized(&a.seasons, is_zh)
            .cmp(&season_sort_key_localized(&b.seasons, is_zh))
            .then(a.grow_days.cmp(&b.grow_days))
            .then(a.name.cmp(&b.name))
    });

    CropGameData {
        encyclopedia,
        lookup,
        seasons: derive_season_filters_localized(is_zh),
        data_source: "export".to_string(),
        generated_at: export.generated_at.clone(),
    }
}

/// 从 XNB 文件解析作物数据（含图标）
fn build_crop_data_from_xnb(
    content_dir: &std::path::Path,
    lang_str: &str,
    is_zh: bool,
) -> Result<CropGameData, String> {
    let crops = load_crops_xnb(&content_dir.join("Data").join("Crops.xnb"))?;
    let objects = load_objects_xnb(&content_dir.join("Data").join("Objects.xnb"))?;

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
            if is_zh { "每天" } else { "Daily" }.to_string()
        } else {
            if is_zh { "无需" } else { "No" }.to_string()
        };
        let icon = render_object_icon(&content_dir, obj, &mut texture_cache).ok();

        let entry = CropEncyclopediaEntry {
            seed_id: seed_id.clone(),
            harvest_id: crop.harvest_item_id.clone(),
            internal_name: obj.name.clone(),
            name: name.clone(),
            icon: icon.clone(),
            season,
            seasons,
            grow_days,
            sell_price: obj.price,
            price_source: "xnb".to_string(),
            category_key: classify_crop_category_key(obj.category),
            regrows,
            regrow_days,
            needs_watering: crop.needs_watering,
            water_needs,
        };

        let lookup_entry = CropLookup {
            name,
            sell_price: obj.price,
            price_source: "xnb".to_string(),
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
        data_source: "xnb".to_string(),
        generated_at: None,
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

/// 将英文季节名转换为本地化名称（用于导出数据）
pub fn season_name_from_str(season: &str, is_zh: bool) -> &'static str {
    match season {
        "Spring" => season_name_localized(0, is_zh),
        "Summer" => season_name_localized(1, is_zh),
        "Fall" | "Autumn" => season_name_localized(2, is_zh),
        "Winter" => season_name_localized(3, is_zh),
        _ => season_name_localized(-1, is_zh),
    }
}

/// 从已本地化的季节字符串列表生成紧凑标签（用于导出数据路径）
pub fn compact_season_label_from_strings(seasons: &[String], is_zh: bool) -> String {
    let mut sorted = seasons.to_vec();
    sorted.sort_unstable();
    sorted.dedup();
    match sorted.len() {
        1 => sorted[0].clone(),
        3 if sorted.iter().all(|s| {
            let lower = s.to_lowercase();
            lower.contains("spring") || lower.contains("春")
                || lower.contains("summer") || lower.contains("夏")
                || lower.contains("fall") || lower.contains("autumn") || lower.contains("秋")
        }) =>
        {
            if is_zh { "春夏秋".to_string() } else { "Spring/Summer/Fall".to_string() }
        }
        4 if sorted.iter().all(|s| {
            let lower = s.to_lowercase();
            lower.contains("spring") || lower.contains("春")
                || lower.contains("summer") || lower.contains("夏")
                || lower.contains("fall") || lower.contains("autumn") || lower.contains("秋")
                || lower.contains("winter") || lower.contains("冬")
        }) =>
        {
            if is_zh { "全季".to_string() } else { "All Seasons".to_string() }
        }
        _ => sorted.join(if is_zh { "" } else { "/" }),
    }
}
