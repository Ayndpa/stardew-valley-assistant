//! 动物百科 Tauri 命令。XNB 解析逻辑在 `sdv_game_data::animals`，
//! 这里只保留「运行时导出文件优先、XNB 兜底」的桌面端专属取数策略。

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, LazyLock, Mutex};

use sdv_game_data::image_utils::object_texture_key;
use sdv_game_data::xnb::load_farm_animals_xnb;

pub use sdv_game_data::animals::{
    build_animal_data_from_xnb, harvest_type_name, house_display_name, render_animal_icon,
    resolve_localized_name, AnimalEncyclopediaEntry, AnimalGameData, AnimalProduceInfo,
};

static ANIMAL_GAME_DATA_CACHE: LazyLock<Mutex<HashMap<String, Arc<AnimalGameData>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[tauri::command(async)]
pub fn get_animal_game_data(
    game_dir: Option<String>,
    lang: Option<String>,
) -> Result<AnimalGameData, String> {
    let lang_str = lang.as_deref().unwrap_or("zh").to_string();
    let content_dir = super::locate_content_dir(game_dir.as_deref())?;
    let key = super::snapshot_cache_key(&content_dir, &lang_str);

    let snapshot = super::cached_snapshot(&ANIMAL_GAME_DATA_CACHE, key, || {
        let is_zh = lang_str.to_lowercase().starts_with("zh");

        // 优先使用导出文件（图标缺失时回退 XNB）
        if let Some(export) = super::item_prices::read_game_data_export() {
            return Ok(build_animal_data_from_export(&export, &content_dir, is_zh));
        }

        // 回退到 XNB 解析
        build_animal_data_from_xnb(&content_dir, &lang_str, is_zh)
    })?;

    Ok((*snapshot).clone())
}

/// 从 game-data.json 导出文件构建动物数据（图标缺失时回退 XNB）
fn build_animal_data_from_export(
    export: &super::item_prices::GameDataExport,
    content_dir: &Path,
    is_zh: bool,
) -> AnimalGameData {
    let item_names = super::item_prices::build_item_name_map_from_export().unwrap_or_default();

    // 预加载 XNB 动物数据，用于图标回退
    let animals_xnb = load_farm_animals_xnb(&content_dir.join("Data").join("FarmAnimals.xnb"))
        .unwrap_or_default();
    let mut texture_cache = HashMap::new();

    let mut encyclopedia = Vec::new();
    let mut houses_set = std::collections::HashSet::new();

    for animal in &export.animals {
        if animal.house.is_empty() {
            continue;
        }

        let house_display = house_display_name(&animal.house, is_zh);
        houses_set.insert(animal.house.clone());

        let resolve_produce_name = |item_id: &str| -> String {
            item_names
                .get(item_id)
                .cloned()
                .unwrap_or_else(|| format!("Item #{}", item_id))
        };

        let produce_items: Vec<AnimalProduceInfo> = animal
            .produce_item_ids
            .iter()
            .map(|id| AnimalProduceInfo {
                item_id: id.clone(),
                name: resolve_produce_name(id),
            })
            .collect();

        let deluxe_produce_items: Vec<AnimalProduceInfo> = animal
            .deluxe_produce_item_ids
            .iter()
            .map(|id| AnimalProduceInfo {
                item_id: id.clone(),
                name: resolve_produce_name(id),
            })
            .collect();

        // 图标：优先从 icons/ 目录加载，缺失时回退 XNB 解包
        let icon = super::item_prices::read_icon_from_export("animal_", &animal.id).or_else(|| {
            animals_xnb.get(&animal.id).and_then(|data| {
                let texture_key = if data.texture.is_empty() {
                    format!("Animals/{}", animal.id)
                } else {
                    object_texture_key(&data.texture)
                };
                render_animal_icon(
                    content_dir,
                    &texture_key,
                    0,
                    data.sprite_width,
                    data.sprite_height,
                    &mut texture_cache,
                )
                .ok()
            })
        });

        let entry = AnimalEncyclopediaEntry {
            id: animal.id.clone(),
            name: animal.display_name.clone(),
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

    encyclopedia.sort_by(|a, b| a.house.cmp(&b.house).then(a.name.cmp(&b.name)));

    let mut houses: Vec<String> = houses_set.into_iter().collect();
    houses.sort();

    AnimalGameData {
        encyclopedia,
        houses,
        data_source: "export".to_string(),
        generated_at: export.generated_at.clone(),
    }
}
