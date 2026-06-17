use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, LazyLock, Mutex},
};

use serde::{Deserialize, Serialize};

use super::calendar::resolve_localized_text;
use super::fishing::parse_fish_conditions;
use super::image_utils::render_object_icon;
use super::xnb::{
    load_localized_string_tables_with_lang, load_objects_xnb, load_string_dictionary_best_effort,
    load_string_dictionary_xnb, RawObjectData,
};

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FishConditions {
    pub seasons: Vec<String>,
    pub time_ranges: Vec<(i32, i32)>,
    pub weather: String,
    pub min_level: i32,
    pub is_trap: bool,
}

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
    pub fish_conditions: Option<FishConditions>,
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
    fish_conditions: Option<FishConditions>,
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
pub fn get_item_game_data(
    game_dir: Option<String>,
    lang: Option<String>,
) -> Result<ItemGameData, String> {
    let snapshot = load_item_snapshot(game_dir, lang)?;
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
    lang: Option<String>,
) -> Result<ItemGameDataOverview, String> {
    let snapshot = load_item_snapshot(game_dir, lang)?;
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
    lang: Option<String>,
) -> Result<ItemGameDataQueryResult, String> {
    let snapshot = load_item_snapshot(game_dir, lang.clone())?;
    let keyword = search_term.unwrap_or_default().trim().to_lowercase();
    let lang_str = lang.as_deref().unwrap_or("zh");
    let all_label = if lang_str.to_lowercase().starts_with("zh") {
        "全部"
    } else {
        "All"
    };

    let category = active_category.unwrap_or_else(|| all_label.to_string());
    let item_type = active_type.unwrap_or_else(|| all_label.to_string());
    let page = page.unwrap_or(1).max(1);
    let page_size = page_size.unwrap_or(24).clamp(1, 96);

    let filtered_indexes = snapshot
        .encyclopedia
        .iter()
        .enumerate()
        .filter(|(_, item)| matches_item(item, &keyword, &category, &item_type, all_label))
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

fn load_item_snapshot(
    game_dir: Option<String>,
    lang: Option<String>,
) -> Result<Arc<ItemSnapshot>, String> {
    let content_dir = super::locate_content_dir(game_dir.as_deref())?;
    let lang_str = lang.as_deref().unwrap_or("zh").to_lowercase();
    let cache_key = format!("{}:{}", content_dir.to_string_lossy(), lang_str);

    if let Some(snapshot) = ITEM_SNAPSHOT_CACHE
        .lock()
        .map_err(|_| "物品百科缓存锁定失败".to_string())?
        .get(&cache_key)
        .cloned()
    {
        return Ok(snapshot);
    }

    let snapshot = Arc::new(build_item_snapshot(content_dir.clone(), Some(&lang_str))?);
    ITEM_SNAPSHOT_CACHE
        .lock()
        .map_err(|_| "物品百科缓存锁定失败".to_string())?
        .insert(cache_key, snapshot.clone());

    Ok(snapshot)
}

fn build_item_snapshot(content_dir: PathBuf, lang: Option<&str>) -> Result<ItemSnapshot, String> {
    let lang_str = lang.unwrap_or("zh").to_lowercase();
    let is_zh = lang_str.starts_with("zh");

    let objects = load_objects_xnb(&content_dir.join("Data").join("Objects.xnb"))?;
    let localized_tables = load_localized_string_tables_with_lang(
        &content_dir,
        &["Objects", "1_6_Strings", "StringsFromCSFiles", "NPCNames"],
        Some(&lang_str),
    );
    let recipe_sources =
        load_cooking_recipe_sources_localized(&content_dir, &localized_tables, is_zh);

    // Load fish data (tolerate if file not found)
    let fish_data = load_string_dictionary_xnb(&content_dir.join("Data").join("Fish.xnb"))
        .unwrap_or_default();

    let mut encyclopedia = Vec::with_capacity(objects.len());

    for (id, object) in objects {
        let name = resolve_localized_text(&object.display_name, &localized_tables);
        let description = resolve_localized_text(&object.description, &localized_tables);
        let (item_type_key, item_type) =
            classify_item_type_localized(&object.object_type, object.category, is_zh);
        let (category_key, category) =
            classify_category_localized(object.category, &object.object_type, is_zh);
        let edibility = (object.edibility > -300).then_some(object.edibility);
        let item_recipe_sources = recipe_sources.get(&id).cloned().unwrap_or_default();

        // Build fish conditions if this object has a Fish.xnb entry
        let fish_conditions = fish_data.get(&id).map(|raw_str| {
            let (seasons, time_ranges, weather, min_level, is_trap) =
                parse_fish_conditions(raw_str);
            FishConditions {
                seasons,
                time_ranges,
                weather,
                min_level,
                is_trap,
            }
        });

        encyclopedia.push(IndexedItemEntry {
            id,
            name: if name.trim().is_empty() {
                object.name.clone()
            } else {
                name
            },
            internal_name: object.name.clone(),
            description: if description.trim().is_empty() {
                if is_zh {
                    "游戏内容未提供描述。".to_string()
                } else {
                    "No description provided by game content.".to_string()
                }
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
            fish_conditions,
        });
    }

    encyclopedia.sort_by(|a, b| {
        item_type_order(&a.item_type_key)
            .cmp(&item_type_order(&b.item_type_key))
            .then(category_order(&a.category_key).cmp(&category_order(&b.category_key)))
            .then(a.name.cmp(&b.name))
    });

    let all_label = if is_zh { "全部" } else { "All" };
    let mut categories = vec![all_label.to_string()];
    let mut item_types = vec![all_label.to_string()];
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

fn matches_item(
    item: &IndexedItemEntry,
    keyword: &str,
    category: &str,
    item_type: &str,
    all_label: &str,
) -> bool {
    let matches_keyword = keyword.is_empty()
        || item.name.to_lowercase().contains(keyword)
        || item.internal_name.to_lowercase().contains(keyword)
        || item.id.to_lowercase().contains(keyword)
        || item.description.to_lowercase().contains(keyword)
        || item
            .recipe_sources
            .iter()
            .any(|source| source.to_lowercase().contains(keyword));
    let matches_category = category == all_label || item.category == category;
    let matches_type = item_type == all_label || item.item_type == item_type;
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
        fish_conditions: item.fish_conditions.clone(),
    }
}

pub fn load_cooking_recipe_sources_localized(
    content_dir: &std::path::Path,
    localized_tables: &HashMap<String, HashMap<String, String>>,
    is_zh: bool,
) -> HashMap<String, Vec<String>> {
    let recipes = load_string_dictionary_xnb(&content_dir.join("Data").join("CookingRecipes.xnb"))
        .unwrap_or_default();
    let tv_recipe_weeks = load_tv_recipe_weeks_localized(content_dir, is_zh);
    let mut sources_by_item_id: HashMap<String, Vec<String>> = HashMap::new();

    for (_recipe_name, raw_recipe) in &recipes {
        let fields = raw_recipe.split('/').collect::<Vec<_>>();
        let Some(raw_outputs) = fields.get(2).map(|value| value.trim()) else {
            continue;
        };
        let raw_condition = fields.get(3).map(|value| value.trim()).unwrap_or_default();
        let recipe_display_name = fields.get(4).map(|value| value.trim()).unwrap_or_default();
        let sources = describe_cooking_recipe_sources_localized(
            raw_condition,
            _recipe_name,
            recipe_display_name,
            localized_tables,
            &tv_recipe_weeks,
            is_zh,
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

fn load_tv_recipe_weeks_localized(
    content_dir: &std::path::Path,
    is_zh: bool,
) -> HashMap<String, i32> {
    let tv_dir = content_dir.join("Data").join("TV");
    let tv_data = if is_zh {
        load_string_dictionary_best_effort(&[
            tv_dir.join("CookingChannel.zh-CN.xnb"),
            tv_dir.join("CookingChannel.xnb"),
        ])
    } else {
        load_string_dictionary_best_effort(&[tv_dir.join("CookingChannel.xnb")])
    };

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

fn describe_cooking_recipe_sources_localized(
    raw_condition: &str,
    recipe_name: &str,
    recipe_display_name: &str,
    localized_tables: &HashMap<String, HashMap<String, String>>,
    tv_recipe_weeks: &HashMap<String, i32>,
    is_zh: bool,
) -> Vec<String> {
    let mut sources = Vec::new();

    // Check TV source (Queen of Sauce)
    if let Some(&week) = tv_recipe_weeks.get(recipe_name) {
        sources.push(tv_week_to_schedule_localized(week, is_zh));
    }

    // Check condition-based source
    let parts = raw_condition.split_whitespace().collect::<Vec<_>>();
    let condition_source = match parts.as_slice() {
        [] => Some(if is_zh {
            "未提供获取条件".to_string()
        } else {
            "No acquisition conditions provided".to_string()
        }),
        ["default"] => Some(if is_zh {
            "初始已掌握".to_string()
        } else {
            "Learned by default".to_string()
        }),
        ["f", npc, hearts, ..] => {
            let npc_name = localized_tables
                .get("NPCNames")
                .and_then(|table| table.get(*npc))
                .cloned()
                .unwrap_or_else(|| (*npc).to_string());
            Some(if is_zh {
                format!("{} 好感达到 {} 心后寄信获得", npc_name, hearts)
            } else {
                format!("Mail from {} at {} hearts", npc_name, hearts)
            })
        }
        ["s", skill, level, ..] => Some(if is_zh {
            format!(
                "{}等级达到 {} 级解锁",
                translate_skill_name_localized(skill, is_zh),
                level
            )
        } else {
            format!(
                "Reach {} Level {} to unlock",
                translate_skill_name_localized(skill, is_zh),
                level
            )
        }),
        ["l", ..] => describe_learned_source_localized(recipe_name, recipe_display_name, is_zh),
        _ => Some(if is_zh {
            format!("特殊条件：{}", raw_condition)
        } else {
            format!("Special condition: {}", raw_condition)
        }),
    };

    if let Some(source) = condition_source {
        if !sources.contains(&source) {
            sources.push(source);
        }
    }

    sources
}

fn describe_learned_source_localized(
    recipe_name: &str,
    _recipe_display_name: &str,
    is_zh: bool,
) -> Option<String> {
    let known_source = match recipe_name {
        "Banana Pudding" => Some(if is_zh {
            "姜岛度假村获得"
        } else {
            "Obtained from Ginger Island Resort"
        }),
        "Ginger Ale" => Some(if is_zh {
            "姜岛度假村购买"
        } else {
            "Purchased from Ginger Island Resort"
        }),
        "Tropical Curry" => Some(if is_zh {
            "姜岛度假村获得"
        } else {
            "Obtained from Ginger Island Resort"
        }),
        "Triple Shot Espresso" => Some(if is_zh {
            "星之果实餐吧购买"
        } else {
            "Purchased from the Stardrop Saloon"
        }),
        _ => None,
    };

    known_source.map(|s| s.to_string())
}

fn tv_week_to_schedule_localized(week: i32, is_zh: bool) -> String {
    let day_in_cycle = week * 7;
    let year = (day_in_cycle - 1) / 112 + 1;
    let day_in_year = (day_in_cycle - 1) % 112 + 1;
    let season_index = (day_in_year - 1) / 28;
    let day_in_season = (day_in_year - 1) % 28 + 1;

    let season_name = match season_index {
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
    };

    if is_zh {
        format!(
            "酱料女皇电视节目（第{}年 {} 第{}天）",
            year, season_name, day_in_season
        )
    } else {
        format!(
            "The Queen of Sauce TV show (Year {}, {}, Day {})",
            year, season_name, day_in_season
        )
    }
}

fn translate_skill_name_localized(skill: &str, is_zh: bool) -> String {
    if is_zh {
        match skill {
            "Farming" => "耕种".to_string(),
            "Fishing" => "钓鱼".to_string(),
            "Foraging" => "采集".to_string(),
            "Mining" => "采矿".to_string(),
            "Combat" => "战斗".to_string(),
            "Luck" => "运气".to_string(),
            _ => skill.to_string(),
        }
    } else {
        skill.to_string()
    }
}

fn translate_object_type_label(key: &str, is_zh: bool) -> String {
    match key {
        "basic" => if is_zh { "基础物品" } else { "Basic Item" }.to_string(),
        "arch" => if is_zh { "古物" } else { "Artifact" }.to_string(),
        "fish" => if is_zh { "鱼类" } else { "Fish" }.to_string(),
        "ring" => if is_zh { "戒指" } else { "Ring" }.to_string(),
        "minerals" => if is_zh { "矿物" } else { "Mineral" }.to_string(),
        "cooking" => if is_zh { "料理" } else { "Cooking" }.to_string(),
        "crafting" => if is_zh { "工艺品" } else { "Crafting" }.to_string(),
        "seeds" => if is_zh { "种子" } else { "Seeds" }.to_string(),
        "litter" => if is_zh { "杂物" } else { "Litter" }.to_string(),
        "interactive" => if is_zh { "互动物品" } else { "Interactive" }.to_string(),
        "quest" => if is_zh { "任务物品" } else { "Quest Item" }.to_string(),
        "asdf" => if is_zh {
            "特殊物品"
        } else {
            "Special Item"
        }
        .to_string(),
        _ => key.to_string(),
    }
}

fn classify_item_type_localized(object_type: &str, category: i32, is_zh: bool) -> (String, String) {
    let normalized = object_type.trim();
    if !normalized.is_empty() {
        let key = normalized.to_ascii_lowercase();
        let label = translate_object_type_label(&key, is_zh);
        return (key, label);
    }

    classify_category_localized(category, normalized, is_zh)
}

fn classify_category_localized(category: i32, object_type: &str, is_zh: bool) -> (String, String) {
    match category {
        -2 => (
            "gem".to_string(),
            if is_zh { "宝石" } else { "Gem" }.to_string(),
        ),
        -4 => (
            "fish".to_string(),
            if is_zh { "鱼类" } else { "Fish" }.to_string(),
        ),
        -5 => (
            "egg".to_string(),
            if is_zh { "蛋类" } else { "Egg" }.to_string(),
        ),
        -6 => (
            "milk".to_string(),
            if is_zh { "奶制品" } else { "Milk Product" }.to_string(),
        ),
        -7 => (
            "cooking".to_string(),
            if is_zh { "料理" } else { "Cooking" }.to_string(),
        ),
        -8 => (
            "crafting".to_string(),
            if is_zh { "工艺品" } else { "Crafting" }.to_string(),
        ),
        -9 => (
            "big_craftable".to_string(),
            if is_zh {
                "大型工艺品"
            } else {
                "Big Craftable"
            }
            .to_string(),
        ),
        -12 => (
            "mineral".to_string(),
            if is_zh { "矿物" } else { "Mineral" }.to_string(),
        ),
        -14 => (
            "meat".to_string(),
            if is_zh { "肉类" } else { "Meat" }.to_string(),
        ),
        -15 => (
            "metal_resource".to_string(),
            if is_zh {
                "金属资源"
            } else {
                "Metal Resource"
            }
            .to_string(),
        ),
        -16 => (
            "building_resource".to_string(),
            if is_zh {
                "建筑资源"
            } else {
                "Building Resource"
            }
            .to_string(),
        ),
        -17 => (
            "sell_at_pierre".to_string(),
            if is_zh {
                "杂货商品"
            } else {
                "General Merchandise"
            }
            .to_string(),
        ),
        -18 => (
            "animal_product".to_string(),
            if is_zh {
                "动物产物"
            } else {
                "Animal Product"
            }
            .to_string(),
        ),
        -19 => (
            "fertilizer".to_string(),
            if is_zh { "肥料" } else { "Fertilizer" }.to_string(),
        ),
        -20 => (
            "junk".to_string(),
            if is_zh { "垃圾" } else { "Trash" }.to_string(),
        ),
        -21 => (
            "bait".to_string(),
            if is_zh { "鱼饵" } else { "Bait" }.to_string(),
        ),
        -22 => (
            "tackle".to_string(),
            if is_zh { "渔具" } else { "Tackle" }.to_string(),
        ),
        -24 => (
            "furniture".to_string(),
            if is_zh { "家具" } else { "Furniture" }.to_string(),
        ),
        -25 => (
            "ingredient".to_string(),
            if is_zh { "食材" } else { "Ingredient" }.to_string(),
        ),
        -26 => (
            "artisan_goods".to_string(),
            if is_zh {
                "工匠物品"
            } else {
                "Artisan Good"
            }
            .to_string(),
        ),
        -27 => (
            "syrup".to_string(),
            if is_zh { "树液制品" } else { "Syrup" }.to_string(),
        ),
        -28 => (
            "monster_loot".to_string(),
            if is_zh {
                "怪物掉落"
            } else {
                "Monster Loot"
            }
            .to_string(),
        ),
        -74 => (
            "seed".to_string(),
            if is_zh { "种子" } else { "Seed" }.to_string(),
        ),
        -75 => (
            "vegetable".to_string(),
            if is_zh { "蔬菜" } else { "Vegetable" }.to_string(),
        ),
        -76 => (
            "flower".to_string(),
            if is_zh { "花卉" } else { "Flower" }.to_string(),
        ),
        -77 => (
            "forage".to_string(),
            if is_zh { "采集物" } else { "Forage" }.to_string(),
        ),
        -78 => (
            "fruit".to_string(),
            if is_zh { "水果" } else { "Fruit" }.to_string(),
        ),
        -79 => (
            "shellfish".to_string(),
            if is_zh { "贝类" } else { "Shellfish" }.to_string(),
        ),
        -80 => (
            "festival_reward".to_string(),
            if is_zh {
                "节日奖励"
            } else {
                "Festival Reward"
            }
            .to_string(),
        ),
        -81 => (
            "fodder".to_string(),
            if is_zh { "饲料" } else { "Fodder" }.to_string(),
        ),
        -82 => (
            "clothing".to_string(),
            if is_zh { "服饰" } else { "Clothing" }.to_string(),
        ),
        -95 => (
            "hat".to_string(),
            if is_zh { "帽子" } else { "Hat" }.to_string(),
        ),
        -96 => (
            "trinket".to_string(),
            if is_zh { "饰品" } else { "Trinket" }.to_string(),
        ),
        0 if !object_type.trim().is_empty() => {
            let key = object_type.trim().to_ascii_lowercase();
            (key.clone(), translate_object_type_label(&key, is_zh))
        }
        _ => (
            "other".to_string(),
            if is_zh { "其他" } else { "Other" }.to_string(),
        ),
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
        "seeds" => 7,
        "litter" => 8,
        "interactive" => 9,
        "quest" => 10,
        "asdf" => 11,
        _ => 99,
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
