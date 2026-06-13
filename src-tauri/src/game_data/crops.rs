use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use super::calendar::{resolve_display_name, season_name};
use super::image_utils::render_object_icon;
use super::xnb::{load_crops_xnb, load_objects_xnb, load_string_dictionary_best_effort};

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CropLookup {
    pub name: String,
    pub sell_price: i32,
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
pub fn get_crop_game_data(game_dir: Option<String>) -> Result<CropGameData, String> {
    let content_dir = super::locate_content_dir(game_dir.as_deref())?;
    let crops = load_crops_xnb(&content_dir.join("Data").join("Crops.xnb"))?;
    let objects = load_objects_xnb(&content_dir.join("Data").join("Objects.xnb"))?;
    let object_strings = load_string_dictionary_best_effort(&[
        content_dir.join("Strings").join("Objects.zh-CN.xnb"),
        content_dir.join("Strings").join("Objects.xnb"),
    ]);

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
            .map(|season| season_name(*season).to_string())
            .collect::<Vec<_>>();
        let season = compact_season_label(&crop.seasons);
        let grow_days = crop.days_in_phase.iter().sum();
        let regrows = crop.regrow_days >= 0;
        let regrow_days = regrows.then_some(crop.regrow_days);
        let water_needs = if crop.needs_watering {
            "每天".to_string()
        } else {
            "无需".to_string()
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
            category_key: classify_crop_category_key(obj.category),
            regrows,
            regrow_days,
            needs_watering: crop.needs_watering,
            water_needs,
        };

        let lookup_entry = CropLookup {
            name,
            sell_price: obj.price,
            regrows,
            regrow_days,
            icon,
        };
        lookup.insert(seed_id, lookup_entry.clone());
        lookup.insert(crop.harvest_item_id, lookup_entry);
        encyclopedia.push(entry);
    }

    encyclopedia.sort_by(|a, b| {
        season_sort_key(&a.seasons)
            .cmp(&season_sort_key(&b.seasons))
            .then(a.grow_days.cmp(&b.grow_days))
            .then(a.name.cmp(&b.name))
    });

    Ok(CropGameData {
        encyclopedia,
        lookup,
        seasons: derive_season_filters(),
    })
}

pub fn compact_season_label(seasons: &[i32]) -> String {
    let mut sorted = seasons.to_vec();
    sorted.sort_unstable();
    sorted.dedup();
    match sorted.as_slice() {
        [0] => "春季".to_string(),
        [1] => "夏季".to_string(),
        [2] => "秋季".to_string(),
        [3] => "冬季".to_string(),
        [0, 1, 2] => "春夏秋".to_string(),
        [0, 1, 2, 3] => "全季".to_string(),
        _ => sorted
            .iter()
            .map(|season| season_name(*season))
            .collect::<Vec<_>>()
            .join(""),
    }
}

pub fn season_sort_key(seasons: &[String]) -> Vec<i32> {
    seasons
        .iter()
        .map(|season| match season.as_str() {
            "春季" => 0,
            "夏季" => 1,
            "秋季" => 2,
            "冬季" => 3,
            _ => 9,
        })
        .collect()
}

pub fn derive_season_filters() -> Vec<String> {
    vec![
        "全部".to_string(),
        "春季".to_string(),
        "夏季".to_string(),
        "秋季".to_string(),
        "冬季".to_string(),
        "春夏秋".to_string(),
        "全季".to_string(),
    ]
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
