use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, LazyLock, Mutex},
};

use serde::{Deserialize, Serialize};

use super::calendar::resolve_localized_text;
use super::image_utils::render_object_icon;
use super::xnb::{
    load_localized_string_tables, load_objects_xnb, load_string_dictionary_best_effort,
    load_string_dictionary_xnb, RawObjectData,
};

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ItemEncyclopediaEntry {
    pub id: String,
    pub name: String,
    pub internal_name: String,
    pub description: String,
    pub item_type: String,
    pub item_type_key: String,
    pub category: String,
    pub category_key: String,
    pub icon: Option<String>,
    pub sell_price: i32,
    pub edibility: Option<i32>,
    pub can_be_given_as_gift: bool,
    pub can_be_trashed: bool,
    pub recipe_sources: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ItemGameData {
    pub encyclopedia: Vec<ItemEncyclopediaEntry>,
    pub categories: Vec<String>,
    pub item_types: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ItemGameDataOverview {
    pub categories: Vec<String>,
    pub item_types: Vec<String>,
    pub total_count: usize,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ItemGameDataQueryResult {
    pub items: Vec<ItemEncyclopediaEntry>,
    pub total_count: usize,
    pub page: usize,
    pub page_size: usize,
}

#[derive(Debug, Clone)]
struct IndexedItemEntry {
    id: String,
    name: String,
    internal_name: String,
    description: String,
    item_type: String,
    item_type_key: String,
    category: String,
    category_key: String,
    sell_price: i32,
    edibility: Option<i32>,
    can_be_given_as_gift: bool,
    can_be_trashed: bool,
    recipe_sources: Vec<String>,
    raw_object: RawObjectData,
}

#[derive(Debug, Clone)]
struct ItemSnapshot {
    content_dir: PathBuf,
    encyclopedia: Vec<IndexedItemEntry>,
    categories: Vec<String>,
    item_types: Vec<String>,
}

static ITEM_SNAPSHOT_CACHE: LazyLock<Mutex<HashMap<String, Arc<ItemSnapshot>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[tauri::command]
pub fn get_item_game_data(game_dir: Option<String>) -> Result<ItemGameData, String> {
    let snapshot = load_item_snapshot(game_dir)?;
    let mut texture_cache = HashMap::new();
    let encyclopedia = snapshot
        .encyclopedia
        .iter()
        .map(|entry| build_item_entry(&snapshot.content_dir, entry, &mut texture_cache))
        .collect::<Vec<_>>();

    Ok(ItemGameData {
        encyclopedia,
        categories: snapshot.categories.clone(),
        item_types: snapshot.item_types.clone(),
    })
}

#[tauri::command]
pub fn get_item_game_data_overview(
    game_dir: Option<String>,
) -> Result<ItemGameDataOverview, String> {
    let snapshot = load_item_snapshot(game_dir)?;
    Ok(ItemGameDataOverview {
        categories: snapshot.categories.clone(),
        item_types: snapshot.item_types.clone(),
        total_count: snapshot.encyclopedia.len(),
    })
}

#[tauri::command]
pub fn query_item_game_data(
    game_dir: Option<String>,
    search_term: Option<String>,
    active_category: Option<String>,
    active_type: Option<String>,
    page: Option<usize>,
    page_size: Option<usize>,
) -> Result<ItemGameDataQueryResult, String> {
    let snapshot = load_item_snapshot(game_dir)?;
    let keyword = search_term.unwrap_or_default().trim().to_lowercase();
    let category = active_category.unwrap_or_else(|| "全部".to_string());
    let item_type = active_type.unwrap_or_else(|| "全部".to_string());
    let page = page.unwrap_or(1).max(1);
    let page_size = page_size.unwrap_or(24).clamp(1, 96);

    let filtered_indexes = snapshot
        .encyclopedia
        .iter()
        .enumerate()
        .filter(|(_, item)| matches_item(item, &keyword, &category, &item_type))
        .map(|(index, _)| index)
        .collect::<Vec<_>>();

    let total_count = filtered_indexes.len();
    let start = page_size.saturating_mul(page.saturating_sub(1));

    if start >= total_count {
        return Ok(ItemGameDataQueryResult {
            items: Vec::new(),
            total_count,
            page,
            page_size,
        });
    }

    let end = (start + page_size).min(total_count);
    let mut texture_cache = HashMap::new();
    let items = filtered_indexes[start..end]
        .iter()
        .map(|index| {
            build_item_entry(
                &snapshot.content_dir,
                &snapshot.encyclopedia[*index],
                &mut texture_cache,
            )
        })
        .collect::<Vec<_>>();

    Ok(ItemGameDataQueryResult {
        items,
        total_count,
        page,
        page_size,
    })
}

fn load_item_snapshot(game_dir: Option<String>) -> Result<Arc<ItemSnapshot>, String> {
    let content_dir = super::locate_content_dir(game_dir.as_deref())?;
    let cache_key = content_dir.to_string_lossy().to_string();

    if let Some(snapshot) = ITEM_SNAPSHOT_CACHE
        .lock()
        .map_err(|_| "物品百科缓存锁定失败".to_string())?
        .get(&cache_key)
        .cloned()
    {
        return Ok(snapshot);
    }

    let snapshot = Arc::new(build_item_snapshot(content_dir.clone())?);
    ITEM_SNAPSHOT_CACHE
        .lock()
        .map_err(|_| "物品百科缓存锁定失败".to_string())?
        .insert(cache_key, snapshot.clone());

    Ok(snapshot)
}

fn build_item_snapshot(content_dir: PathBuf) -> Result<ItemSnapshot, String> {
    let objects = load_objects_xnb(&content_dir.join("Data").join("Objects.xnb"))?;
    let localized_tables = load_localized_string_tables(
        &content_dir,
        &["Objects", "1_6_Strings", "StringsFromCSFiles", "NPCNames"],
    );
    let recipe_sources = load_cooking_recipe_sources(&content_dir, &localized_tables);

    let mut encyclopedia = Vec::with_capacity(objects.len());

    for (id, object) in objects {
        let name = resolve_localized_text(&object.display_name, &localized_tables);
        let description = resolve_localized_text(&object.description, &localized_tables);
        let (item_type_key, item_type) = classify_item_type(&object.object_type, object.category);
        let (category_key, category) = classify_category(object.category, &object.object_type);
        let edibility = (object.edibility > -300).then_some(object.edibility);
        let item_recipe_sources = recipe_sources.get(&id).cloned().unwrap_or_default();

        encyclopedia.push(IndexedItemEntry {
            id,
            name: if name.trim().is_empty() {
                object.name.clone()
            } else {
                name
            },
            internal_name: object.name.clone(),
            description: if description.trim().is_empty() {
                "游戏内容未提供描述。".to_string()
            } else {
                description
            },
            item_type,
            item_type_key,
            category,
            category_key,
            sell_price: object.price,
            edibility,
            can_be_given_as_gift: object.can_be_given_as_gift,
            can_be_trashed: object.can_be_trashed,
            recipe_sources: item_recipe_sources,
            raw_object: object,
        });
    }

    encyclopedia.sort_by(|a, b| {
        item_type_order(&a.item_type_key)
            .cmp(&item_type_order(&b.item_type_key))
            .then(category_order(&a.category_key).cmp(&category_order(&b.category_key)))
            .then(a.name.cmp(&b.name))
    });

    let mut categories = vec!["全部".to_string()];
    let mut item_types = vec!["全部".to_string()];
    for item in &encyclopedia {
        if !item_types.contains(&item.item_type) {
            item_types.push(item.item_type.clone());
        }
        if !categories.contains(&item.category) {
            categories.push(item.category.clone());
        }
    }

    Ok(ItemSnapshot {
        content_dir,
        encyclopedia,
        categories,
        item_types,
    })
}

fn matches_item(item: &IndexedItemEntry, keyword: &str, category: &str, item_type: &str) -> bool {
    let matches_keyword = keyword.is_empty()
        || item.name.to_lowercase().contains(keyword)
        || item.internal_name.to_lowercase().contains(keyword)
        || item.id.to_lowercase().contains(keyword)
        || item.description.to_lowercase().contains(keyword)
        || item
            .recipe_sources
            .iter()
            .any(|source| source.to_lowercase().contains(keyword));
    let matches_category = category == "全部" || item.category == category;
    let matches_type = item_type == "全部" || item.item_type == item_type;
    matches_keyword && matches_category && matches_type
}

fn build_item_entry(
    content_dir: &std::path::Path,
    item: &IndexedItemEntry,
    texture_cache: &mut HashMap<String, super::image_utils::Texture>,
) -> ItemEncyclopediaEntry {
    ItemEncyclopediaEntry {
        id: item.id.clone(),
        name: item.name.clone(),
        internal_name: item.internal_name.clone(),
        description: item.description.clone(),
        item_type: item.item_type.clone(),
        item_type_key: item.item_type_key.clone(),
        category: item.category.clone(),
        category_key: item.category_key.clone(),
        icon: render_object_icon(content_dir, &item.raw_object, texture_cache).ok(),
        sell_price: item.sell_price,
        edibility: item.edibility,
        can_be_given_as_gift: item.can_be_given_as_gift,
        can_be_trashed: item.can_be_trashed,
        recipe_sources: item.recipe_sources.clone(),
    }
}

pub fn load_cooking_recipe_sources(
    content_dir: &std::path::Path,
    localized_tables: &HashMap<String, HashMap<String, String>>,
) -> HashMap<String, Vec<String>> {
    let recipes = load_string_dictionary_xnb(&content_dir.join("Data").join("CookingRecipes.xnb"))
        .unwrap_or_default();
    let tv_recipe_weeks = load_tv_recipe_weeks(content_dir);
    let mut sources_by_item_id: HashMap<String, Vec<String>> = HashMap::new();

    for (_recipe_name, raw_recipe) in &recipes {
        let fields = raw_recipe.split('/').collect::<Vec<_>>();
        let Some(raw_outputs) = fields.get(2).map(|value| value.trim()) else {
            continue;
        };
        let raw_condition = fields.get(3).map(|value| value.trim()).unwrap_or_default();
        let recipe_display_name = fields.get(4).map(|value| value.trim()).unwrap_or_default();
        let sources = describe_cooking_recipe_sources(
            raw_condition,
            _recipe_name,
            recipe_display_name,
            localized_tables,
            &tv_recipe_weeks,
        );
        for item_id in parse_recipe_output_item_ids(raw_outputs) {
            sources_by_item_id
                .entry(item_id)
                .or_default()
                .extend(sources.clone());
        }
    }

    for sources in sources_by_item_id.values_mut() {
        sources.sort();
        sources.dedup();
    }

    sources_by_item_id
}

/// Load TV CookingChannel data and build a reverse lookup: recipe_name -> week_number.
/// The TV data format is: week_number -> recipe_name/description_text
fn load_tv_recipe_weeks(content_dir: &std::path::Path) -> HashMap<String, i32> {
    let tv_dir = content_dir.join("Data").join("TV");
    let tv_data = load_string_dictionary_best_effort(&[
        tv_dir.join("CookingChannel.zh-CN.xnb"),
        tv_dir.join("CookingChannel.xnb"),
    ]);

    let mut recipe_to_week: HashMap<String, i32> = HashMap::new();
    for (week_str, value) in tv_data {
        let Some(recipe_name) = value.split('/').next() else {
            continue;
        };
        let recipe_name = recipe_name.trim().to_string();
        if recipe_name.is_empty() {
            continue;
        }
        if let Ok(week) = week_str.parse::<i32>() {
            recipe_to_week.insert(recipe_name, week);
        }
    }
    recipe_to_week
}

fn parse_recipe_output_item_ids(raw_outputs: &str) -> Vec<String> {
    raw_outputs
        .split_whitespace()
        .step_by(2)
        .filter(|item_id| !item_id.trim().is_empty())
        .map(str::to_string)
        .collect()
}

/// Describe all possible sources for a cooking recipe.
/// Returns a Vec<String> because some recipes can be obtained through multiple channels.
fn describe_cooking_recipe_sources(
    raw_condition: &str,
    recipe_name: &str,
    recipe_display_name: &str,
    localized_tables: &HashMap<String, HashMap<String, String>>,
    tv_recipe_weeks: &HashMap<String, i32>,
) -> Vec<String> {
    let mut sources = Vec::new();

    // Check TV source (Queen of Sauce)
    if let Some(&week) = tv_recipe_weeks.get(recipe_name) {
        sources.push(tv_week_to_schedule(week));
    }

    // Check condition-based source
    let parts = raw_condition.split_whitespace().collect::<Vec<_>>();
    let condition_source = match parts.as_slice() {
        [] => Some("未提供获取条件".to_string()),
        ["default"] => Some("初始已掌握".to_string()),
        ["f", npc, hearts, ..] => {
            let npc_name = localized_tables
                .get("NPCNames")
                .and_then(|table| table.get(*npc))
                .cloned()
                .unwrap_or_else(|| (*npc).to_string());
            Some(format!("{} 好感达到 {} 心后寄信获得", npc_name, hearts))
        }
        ["s", skill, level, ..] => {
            Some(format!("{}等级达到 {} 级解锁", translate_skill_name(skill), level))
        }
        ["l", ..] => describe_learned_source(recipe_name, recipe_display_name),
        _ => Some(format!("特殊条件：{}", raw_condition)),
    };

    if let Some(source) = condition_source {
        // Only add if not duplicate of TV source
        if !sources.contains(&source) {
            sources.push(source);
        }
    }

    sources
}

/// Describe the source for recipes with `l` (learned) conditions.
/// Returns the non-TV source if known, or None if already covered by TV.
fn describe_learned_source(recipe_name: &str, _recipe_display_name: &str) -> Option<String> {
    // Known recipe -> source mappings for non-TV l-condition recipes
    let known_source = match recipe_name {
        // Island Resort (Ginger Island)
        "Banana Pudding" => Some("姜岛度假村获得"),
        "Ginger Ale" => Some("姜岛度假村购买"),
        "Tropical Curry" => Some("姜岛度假村获得"),
        // Saloon purchases (non-TV recipes)
        "Triple Shot Espresso" => Some("星之果实餐吧购买"),
        _ => None,
    };

    if let Some(source) = known_source {
        return Some(source.to_string());
    }

    // For l conditions without known non-TV source, don't add anything
    // (the TV source was already added if applicable)
    None
}

/// Convert TV week number to a human-readable schedule string.
/// The Queen of Sauce airs every Sunday. Week 1 starts on Spring 7, Year 1.
fn tv_week_to_schedule(week: i32) -> String {
    let day_in_cycle = week * 7;
    let year = (day_in_cycle - 1) / 112 + 1;
    let day_in_year = (day_in_cycle - 1) % 112 + 1;
    let season_index = (day_in_year - 1) / 28;
    let day_in_season = (day_in_year - 1) % 28 + 1;

    let season_name = match season_index {
        0 => "春季",
        1 => "夏季",
        2 => "秋季",
        3 => "冬季",
        _ => "未知",
    };

    format!(
        "酱料女皇电视节目（第{}年 {} 第{}天）",
        year, season_name, day_in_season
    )
}

fn translate_skill_name(skill: &str) -> String {
    match skill {
        "Farming" => "耕种".to_string(),
        "Fishing" => "钓鱼".to_string(),
        "Foraging" => "采集".to_string(),
        "Mining" => "采矿".to_string(),
        "Combat" => "战斗".to_string(),
        "Luck" => "运气".to_string(),
        _ => skill.to_string(),
    }
}

fn classify_item_type(object_type: &str, category: i32) -> (String, String) {
    let normalized = object_type.trim();
    if !normalized.is_empty() {
        let key = normalized.to_ascii_lowercase();
        let label = match key.as_str() {
            "basic" => "基础物品",
            "arch" => "古物",
            "fish" => "鱼类",
            "ring" => "戒指",
            "minerals" => "矿物",
            "cooking" => "料理",
            "crafting" => "工艺品",
            "asdf" => "特殊物品",
            _ => normalized,
        };
        return (key, label.to_string());
    }

    let (key, label) = classify_category(category, normalized);
    (key, label)
}

fn classify_category(category: i32, object_type: &str) -> (String, String) {
    match category {
        -2 => ("gem".to_string(), "宝石".to_string()),
        -4 => ("fish".to_string(), "鱼类".to_string()),
        -5 => ("egg".to_string(), "蛋类".to_string()),
        -6 => ("milk".to_string(), "奶制品".to_string()),
        -7 => ("cooking".to_string(), "料理".to_string()),
        -8 => ("crafting".to_string(), "工艺品".to_string()),
        -9 => ("big_craftable".to_string(), "大型工艺品".to_string()),
        -12 => ("mineral".to_string(), "矿物".to_string()),
        -14 => ("meat".to_string(), "肉类".to_string()),
        -15 => ("metal_resource".to_string(), "金属资源".to_string()),
        -16 => ("building_resource".to_string(), "建筑资源".to_string()),
        -17 => ("sell_at_pierre".to_string(), "杂货商品".to_string()),
        -18 => ("animal_product".to_string(), "动物产物".to_string()),
        -19 => ("fertilizer".to_string(), "肥料".to_string()),
        -20 => ("junk".to_string(), "垃圾".to_string()),
        -21 => ("bait".to_string(), "鱼饵".to_string()),
        -22 => ("tackle".to_string(), "渔具".to_string()),
        -24 => ("furniture".to_string(), "家具".to_string()),
        -25 => ("ingredient".to_string(), "食材".to_string()),
        -26 => ("artisan_goods".to_string(), "工匠物品".to_string()),
        -27 => ("syrup".to_string(), "树液制品".to_string()),
        -28 => ("monster_loot".to_string(), "怪物掉落".to_string()),
        -74 => ("seed".to_string(), "种子".to_string()),
        -75 => ("vegetable".to_string(), "蔬菜".to_string()),
        -76 => ("flower".to_string(), "花卉".to_string()),
        -77 => ("forage".to_string(), "采集物".to_string()),
        -78 => ("fruit".to_string(), "水果".to_string()),
        -79 => ("shellfish".to_string(), "贝类".to_string()),
        -80 => ("festival_reward".to_string(), "节日奖励".to_string()),
        -81 => ("fodder".to_string(), "饲料".to_string()),
        -82 => ("clothing".to_string(), "服饰".to_string()),
        -95 => ("hat".to_string(), "帽子".to_string()),
        -96 => ("trinket".to_string(), "饰品".to_string()),
        0 if !object_type.trim().is_empty() => (
            object_type.trim().to_ascii_lowercase(),
            object_type.trim().to_string(),
        ),
        _ => ("other".to_string(), "其他".to_string()),
    }
}

fn item_type_order(key: &str) -> i32 {
    match key {
        "basic" => 0,
        "fish" => 1,
        "cooking" => 2,
        "crafting" => 3,
        "minerals" => 4,
        "arch" => 5,
        "ring" => 6,
        "asdf" => 7,
        _ => 9,
    }
}

fn category_order(key: &str) -> i32 {
    match key {
        "seed" => 0,
        "vegetable" => 1,
        "fruit" => 2,
        "flower" => 3,
        "forage" => 4,
        "fish" => 5,
        "cooking" => 6,
        "ingredient" => 7,
        "artisan_goods" => 8,
        "animal_product" => 9,
        "mineral" | "gem" => 10,
        "metal_resource" => 11,
        "building_resource" => 12,
        "monster_loot" => 13,
        _ => 99,
    }
}
