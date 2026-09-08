//! 作物百科 Tauri 命令。XNB 解析逻辑在 `sdv_game_data::crops`，
//! 这里只保留「运行时导出文件优先、XNB 兜底」的桌面端专属取数策略。

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, LazyLock, Mutex};

use sdv_game_data::image_utils::render_object_icon;
use sdv_game_data::xnb::load_objects_xnb;

pub use sdv_game_data::crops::{
    build_crop_data_from_xnb, classify_crop_category_key, compact_season_label_from_strings,
    compact_season_label_localized, derive_season_filters_localized, season_name_from_str,
    season_name_localized, season_sort_key_localized, CropEncyclopediaEntry, CropGameData,
    CropLookup,
};

static CROP_GAME_DATA_CACHE: LazyLock<Mutex<HashMap<String, Arc<CropGameData>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[tauri::command(async)]
pub fn get_crop_game_data(
    game_dir: Option<String>,
    lang: Option<String>,
) -> Result<CropGameData, String> {
    let lang_str = lang.as_deref().unwrap_or("zh").to_string();
    let content_dir = super::locate_content_dir(game_dir.as_deref())?;
    let key = super::snapshot_cache_key(&content_dir, &lang_str);

    let snapshot = super::cached_snapshot(&CROP_GAME_DATA_CACHE, key, || {
        let is_zh = lang_str.to_lowercase().starts_with("zh");

        // 优先使用导出文件（图标缺失时回退 XNB）
        if let Some(export) = super::item_prices::read_game_data_export() {
            return Ok(build_crop_data_from_export(&export, &content_dir, is_zh));
        }

        // 回退到 XNB 解析
        build_crop_data_from_xnb(&content_dir, &lang_str, is_zh)
    })?;

    Ok((*snapshot).clone())
}

/// 从 game-data.json 导出文件构建作物数据（图标缺失时回退 XNB）
fn build_crop_data_from_export(
    export: &super::item_prices::GameDataExport,
    content_dir: &Path,
    is_zh: bool,
) -> CropGameData {
    let item_map = super::item_prices::build_item_map_from_export().unwrap_or_default();

    // 预加载 XNB 对象数据，用于图标回退
    let objects_xnb =
        load_objects_xnb(&content_dir.join("Data").join("Objects.xnb")).unwrap_or_default();
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
        let icon = super::item_prices::read_icon_from_export("", &crop.harvest_item_id).or_else(
            || {
                objects_xnb
                    .get(&crop.harvest_item_id)
                    .and_then(|obj| render_object_icon(content_dir, obj, &mut texture_cache).ok())
            },
        );

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
