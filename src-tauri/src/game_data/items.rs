use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, LazyLock, Mutex},
};

use serde::{Deserialize, Serialize};

use super::calendar::resolve_localized_text;
use super::fishing::parse_fish_conditions;
use super::image_utils::render_object_icon;
use super::map_names::{map_display_name, map_display_name_zh};
use super::xnb::{
    load_localized_string_tables_with_lang, load_location_fishing_xnb, load_objects_xnb,
    load_string_dictionary_best_effort, load_string_dictionary_xnb, load_tools_xnb,
    load_weapons_xnb, RawObjectData,
};

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FishConditions {
    pub seasons: Vec<String>,
    pub time_ranges: Vec<(i32, i32)>,
    pub weather: String,
    pub min_level: i32,
    pub is_trap: bool,
    pub locations: Vec<String>,
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
    pub price_source: String,
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
    /// 数据来源："export" = 游戏导出文件, "xnb" = 游戏数据解包
    pub data_source: String,
    /// 导出文件的生成时间（ISO 8601），仅 data_source="export" 时有值
    pub generated_at: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ItemGameDataOverview {
    pub categories: Vec<String>,
    pub item_types: Vec<String>,
    pub total_count: usize,
    /// 数据来源："export" = 游戏导出文件, "xnb" = 游戏数据解包
    pub data_source: String,
    /// 导出文件的生成时间（ISO 8601），仅 data_source="export" 时有值
    pub generated_at: Option<String>,
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
    /// 缓存中的条目，其 `icon` 恒为 None —— 图标在响应阶段按需渲染。
    entry: ItemEncyclopediaEntry,
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

/// 按语言挑选文案。
fn zh_en(zh: &str, en: &str, is_zh: bool) -> String {
    if is_zh { zh } else { en }.to_string()
}

/// 分类 / 类型统一返回 (稳定 key, 本地化标签)。
fn localized_pair(key: &str, zh: &str, en: &str, is_zh: bool) -> (String, String) {
    (key.to_string(), zh_en(zh, en, is_zh))
}

/// 空白文本回退到 `fallback`。
fn text_or(value: String, fallback: &str) -> String {
    if value.trim().is_empty() {
        fallback.to_string()
    } else {
        value
    }
}

/// 价格数据来源：优先游戏内运行时的导出文件，否则为 XNB 解包。
fn resolve_data_source() -> (String, Option<String>) {
    match super::item_prices::read_game_data_export() {
        Some(export) => ("export".to_string(), export.generated_at),
        None => ("xnb".to_string(), None),
    }
}

/// 返回整本物品百科。
///
/// `include_icons` 默认为 true 以兼容既有调用方；只需要 id / 名称 / 分类的页面
/// （首页、收集进度）应显式传 false —— 图标是逐个物品的 base64 PNG，
/// 会把单次 IPC 响应从几十 KB 撑到 500 KB 以上。
#[tauri::command(async)]
pub fn get_item_game_data(
    game_dir: Option<String>,
    lang: Option<String>,
    include_icons: Option<bool>,
) -> Result<ItemGameData, String> {
    let snapshot = load_item_snapshot(game_dir, lang)?;
    let with_icons = include_icons.unwrap_or(true);
    let mut texture_cache = HashMap::new();
    let encyclopedia = snapshot
        .encyclopedia
        .iter()
        .map(|entry| build_item_entry(&snapshot.content_dir, entry, &mut texture_cache, with_icons))
        .collect::<Vec<_>>();

    let (data_source, generated_at) = resolve_data_source();

    Ok(ItemGameData {
        encyclopedia,
        categories: snapshot.categories.clone(),
        item_types: snapshot.item_types.clone(),
        data_source,
        generated_at,
    })
}

#[tauri::command(async)]
pub fn get_item_game_data_overview(
    game_dir: Option<String>,
    lang: Option<String>,
) -> Result<ItemGameDataOverview, String> {
    let snapshot = load_item_snapshot(game_dir, lang)?;
    let (data_source, generated_at) = resolve_data_source();

    Ok(ItemGameDataOverview {
        categories: snapshot.categories.clone(),
        item_types: snapshot.item_types.clone(),
        total_count: snapshot.encyclopedia.len(),
        data_source,
        generated_at,
    })
}

#[tauri::command(async)]
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
                true,
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
    // 快照里含有来自运行时导出文件的价格，导出文件更新后必须重建。
    let cache_key = format!(
        "{}:{}:{}",
        content_dir.to_string_lossy(),
        lang_str,
        super::item_prices::export_fingerprint()
    );

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

/// 武器 / 工具这类没有价格来源与可食用性的条目，字段填充方式一致。
fn simple_entry(
    id: String,
    name: String,
    description: String,
    (item_type_key, item_type): (String, String),
    (category_key, category): (String, String),
    sell_price: i32,
    raw_object: RawObjectData,
) -> IndexedItemEntry {
    IndexedItemEntry {
        entry: ItemEncyclopediaEntry {
            id,
            name,
            internal_name: raw_object.name.clone(),
            description,
            item_type,
            item_type_key,
            category,
            category_key,
            icon: None,
            sell_price,
            price_source: "xnb".to_string(),
            edibility: None,
            can_be_given_as_gift: false,
            can_be_trashed: false,
            recipe_sources: Vec::new(),
            fish_conditions: None,
        },
        raw_object,
    }
}

fn build_item_snapshot(content_dir: PathBuf, lang: Option<&str>) -> Result<ItemSnapshot, String> {
    let lang_str = lang.unwrap_or("zh").to_lowercase();
    let is_zh = lang_str.starts_with("zh");
    let missing_desc = zh_en(
        "游戏内容未提供描述。",
        "No description provided by game content.",
        is_zh,
    );

    let objects = load_objects_xnb(&content_dir.join("Data").join("Objects.xnb"))?;
    let localized_tables = load_localized_string_tables_with_lang(
        &content_dir,
        &[
            "Objects",
            "1_6_Strings",
            "StringsFromCSFiles",
            "NPCNames",
            "Tools",
            "Weapons",
        ],
        Some(&lang_str),
    );
    let recipe_sources =
        load_cooking_recipe_sources_localized(&content_dir, &localized_tables, is_zh);

    // Load fish data (tolerate if file not found)
    let fish_data =
        load_string_dictionary_xnb(&content_dir.join("Data").join("Fish.xnb")).unwrap_or_default();

    // Build reverse index: fish_id -> list of location display names
    let fish_locations_map = build_fish_locations_map(&content_dir, is_zh);

    // Try to load prices from game data export file
    let mod_prices = super::item_prices::read_item_prices_from_export();

    let mut encyclopedia = Vec::with_capacity(objects.len());

    for (id, object) in objects {
        let name = text_or(
            resolve_localized_text(&object.display_name, &localized_tables),
            &object.name,
        );
        let description = text_or(
            resolve_localized_text(&object.description, &localized_tables),
            &missing_desc,
        );
        let (item_type_key, item_type) =
            classify_item_type_localized(&object.object_type, object.category, is_zh);
        let (category_key, category) =
            classify_category_localized(object.category, &object.object_type, is_zh);

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
                locations: fish_locations_map.get(&id).cloned().unwrap_or_default(),
            }
        });

        // Use export price if available, otherwise fall back to XNB price
        let (sell_price, price_source) = mod_prices
            .as_ref()
            .and_then(|mp| mp.get(&id).map(|&p| (p, "export")))
            .unwrap_or((object.price, "xnb"));

        encyclopedia.push(IndexedItemEntry {
            entry: ItemEncyclopediaEntry {
                recipe_sources: recipe_sources.get(&id).cloned().unwrap_or_default(),
                id,
                name,
                internal_name: object.name.clone(),
                description,
                item_type,
                item_type_key,
                category,
                category_key,
                icon: None,
                sell_price,
                price_source: price_source.to_string(),
                edibility: (object.edibility > -300).then_some(object.edibility),
                can_be_given_as_gift: object.can_be_given_as_gift,
                can_be_trashed: object.can_be_trashed,
                fish_conditions,
            },
            raw_object: object,
        });
    }

    // ── Load weapons from Data/Weapons.xnb (tolerate if missing) ──
    let weapons =
        load_weapons_xnb(&content_dir.join("Data").join("Weapons.xnb")).unwrap_or_default();
    for (id, weapon) in weapons {
        let raw_object = RawObjectData {
            name: weapon.name.clone(),
            display_name: weapon.display_name.clone(),
            description: weapon.description.clone(),
            object_type: String::new(),
            category: 0,
            price: 0,
            texture: text_or(weapon.texture.clone(), "TileSheets/weapons"),
            sprite_index: weapon.sprite_index.max(0),
            edibility: -300,
            can_be_given_as_gift: false,
            can_be_trashed: false,
        };
        encyclopedia.push(simple_entry(
            format!("(W){}", id),
            text_or(
                resolve_localized_text(&weapon.display_name, &localized_tables),
                &weapon.name,
            ),
            text_or(
                resolve_localized_text(&weapon.description, &localized_tables),
                &missing_desc,
            ),
            classify_weapon_type_localized(is_zh),
            classify_weapon_category_localized(weapon.weapon_type, is_zh),
            0,
            raw_object,
        ));
    }

    // ── Load tools from Data/Tools.xnb (tolerate if missing) ──
    let tools = load_tools_xnb(&content_dir.join("Data").join("Tools.xnb")).unwrap_or_default();
    for (id, tool) in tools {
        let sale_price = tool.sale_price.max(0);
        let raw_object = RawObjectData {
            name: tool.name.clone(),
            display_name: tool.display_name.clone(),
            description: tool.description.clone(),
            object_type: String::new(),
            category: 0,
            price: sale_price,
            texture: text_or(tool.texture.clone(), "TileSheets/tools"),
            sprite_index: if tool.menu_sprite_index >= 0 {
                tool.menu_sprite_index
            } else {
                tool.sprite_index.max(0)
            },
            edibility: -300,
            can_be_given_as_gift: false,
            can_be_trashed: false,
        };
        encyclopedia.push(simple_entry(
            format!("(T){}", id),
            text_or(
                resolve_localized_text(&tool.display_name, &localized_tables),
                &tool.name,
            ),
            text_or(
                resolve_localized_text(&tool.description, &localized_tables),
                &missing_desc,
            ),
            ("tool".to_string(), zh_en("工具", "Tool", is_zh)),
            classify_tool_category_localized(&tool.class_name, is_zh),
            sale_price,
            raw_object,
        ));
    }

    encyclopedia.sort_by(|a, b| {
        let (a, b) = (&a.entry, &b.entry);
        item_type_order(&a.item_type_key)
            .cmp(&item_type_order(&b.item_type_key))
            .then(category_order(&a.category_key).cmp(&category_order(&b.category_key)))
            .then(a.name.cmp(&b.name))
    });

    let all_label = if is_zh { "全部" } else { "All" };
    let mut categories = vec![all_label.to_string()];
    let mut item_types = vec![all_label.to_string()];
    for item in &encyclopedia {
        if !item_types.contains(&item.entry.item_type) {
            item_types.push(item.entry.item_type.clone());
        }
        if !categories.contains(&item.entry.category) {
            categories.push(item.entry.category.clone());
        }
    }

    Ok(ItemSnapshot {
        content_dir,
        encyclopedia,
        categories,
        item_types,
    })
}

/// Build a reverse index from fish item ID to a list of location display names
/// where that fish can be caught, derived from Locations.xnb.
fn build_fish_locations_map(
    content_dir: &std::path::Path,
    is_zh: bool,
) -> HashMap<String, Vec<String>> {
    let Ok(location_data) =
        load_location_fishing_xnb(&content_dir.join("Data").join("Locations.xnb"))
    else {
        return HashMap::new();
    };

    let resolve_name = if is_zh {
        map_display_name_zh
    } else {
        map_display_name
    };

    let mut map: HashMap<String, Vec<String>> = HashMap::new();

    for (location_key, location) in &location_data {
        let display_name = resolve_name(location_key)
            .map(str::to_string)
            .unwrap_or_else(|| location_key.clone());

        for fish_entry in &location.fish {
            for item_id in &fish_entry.item_ids {
                if let Some(fish_id) = normalize_fish_item_id(item_id) {
                    let locations = map.entry(fish_id).or_default();
                    if !locations.contains(&display_name) {
                        locations.push(display_name.clone());
                    }
                }
            }
        }
    }

    map
}

/// Normalize an item ID from Locations.xnb fish entries to a plain numeric ID.
fn normalize_fish_item_id(item_id: &str) -> Option<String> {
    let trimmed = item_id.trim();
    if let Some(id) = trimmed.strip_prefix("(O)") {
        return Some(id.to_string());
    }
    if !trimmed.is_empty() && trimmed.chars().all(|ch| ch.is_ascii_digit()) {
        return Some(trimmed.to_string());
    }
    None
}

fn matches_item(
    item: &IndexedItemEntry,
    keyword: &str,
    category: &str,
    item_type: &str,
    all_label: &str,
) -> bool {
    let item = &item.entry;
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
    include_icon: bool,
) -> ItemEncyclopediaEntry {
    ItemEncyclopediaEntry {
        icon: include_icon
            .then(|| render_object_icon(content_dir, &item.raw_object, texture_cache).ok())
            .flatten(),
        ..item.entry.clone()
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

    for (recipe_name, raw_recipe) in &recipes {
        let fields = raw_recipe.split('/').collect::<Vec<_>>();
        let Some(raw_outputs) = fields.get(2).map(|value| value.trim()) else {
            continue;
        };
        let sources = describe_cooking_recipe_sources_localized(
            fields.get(3).map(|value| value.trim()).unwrap_or_default(),
            recipe_name,
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

    tv_data
        .into_iter()
        .filter_map(|(week_str, value)| {
            let recipe_name = value.split('/').next()?.trim().to_string();
            if recipe_name.is_empty() {
                return None;
            }
            Some((recipe_name, week_str.parse::<i32>().ok()?))
        })
        .collect()
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
        [] => Some(zh_en(
            "未提供获取条件",
            "No acquisition conditions provided",
            is_zh,
        )),
        ["default"] => Some(zh_en("初始已掌握", "Learned by default", is_zh)),
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
        ["s", skill, level, ..] => {
            let skill_name = translate_skill_name_localized(skill, is_zh);
            Some(if is_zh {
                format!("{}等级达到 {} 级解锁", skill_name, level)
            } else {
                format!("Reach {} Level {} to unlock", skill_name, level)
            })
        }
        ["l", ..] => describe_learned_source_localized(recipe_name, is_zh),
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

/// 条件为 "l"（需自行学习）时已知的具体获取途径。
const LEARNED_RECIPE_SOURCES: &[(&str, &str, &str)] = &[
    ("Banana Pudding", "姜岛度假村获得", "Obtained from Ginger Island Resort"),
    ("Ginger Ale", "姜岛度假村购买", "Purchased from Ginger Island Resort"),
    ("Tropical Curry", "姜岛度假村获得", "Obtained from Ginger Island Resort"),
    ("Triple Shot Espresso", "星之果实餐吧购买", "Purchased from the Stardrop Saloon"),
];

fn describe_learned_source_localized(recipe_name: &str, is_zh: bool) -> Option<String> {
    LEARNED_RECIPE_SOURCES
        .iter()
        .find(|(name, ..)| *name == recipe_name)
        .map(|&(_, zh, en)| zh_en(zh, en, is_zh))
}

fn tv_week_to_schedule_localized(week: i32, is_zh: bool) -> String {
    const SEASONS: [(&str, &str); 4] = [
        ("春季", "Spring"),
        ("夏季", "Summer"),
        ("秋季", "Fall"),
        ("冬季", "Winter"),
    ];

    let day_in_cycle = week * 7;
    let year = (day_in_cycle - 1) / 112 + 1;
    let day_in_year = (day_in_cycle - 1) % 112 + 1;
    let season_index = (day_in_year - 1) / 28;
    let day_in_season = (day_in_year - 1) % 28 + 1;

    let (zh, en) = SEASONS
        .get(season_index as usize)
        .copied()
        .unwrap_or(("未知", "Unknown"));
    let season_name = if is_zh { zh } else { en };

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
    if !is_zh {
        return skill.to_string();
    }
    match skill {
        "Farming" => "耕种",
        "Fishing" => "钓鱼",
        "Foraging" => "采集",
        "Mining" => "采矿",
        "Combat" => "战斗",
        "Luck" => "运气",
        _ => skill,
    }
    .to_string()
}

/// Objects.xnb 的 type 字段 -> (稳定 key, 中文, 英文)
const OBJECT_TYPE_LABELS: &[(&str, &str, &str)] = &[
    ("basic", "基础物品", "Basic Item"),
    ("arch", "古物", "Artifact"),
    ("fish", "鱼类", "Fish"),
    ("ring", "戒指", "Ring"),
    ("minerals", "矿物", "Mineral"),
    ("cooking", "料理", "Cooking"),
    ("crafting", "工艺品", "Crafting"),
    ("seeds", "种子", "Seeds"),
    ("litter", "杂物", "Litter"),
    ("interactive", "互动物品", "Interactive"),
    ("quest", "任务物品", "Quest Item"),
    ("asdf", "特殊物品", "Special Item"),
    ("weapon", "武器", "Weapon"),
    ("tool", "工具", "Tool"),
];

/// Objects.xnb 的 category 数值 -> (稳定 key, 中文, 英文)
const CATEGORY_LABELS: &[(i32, &str, &str, &str)] = &[
    (-2, "gem", "宝石", "Gem"),
    (-4, "fish", "鱼类", "Fish"),
    (-5, "egg", "蛋类", "Egg"),
    (-6, "milk", "奶制品", "Milk Product"),
    (-7, "cooking", "料理", "Cooking"),
    (-8, "crafting", "工艺品", "Crafting"),
    (-9, "big_craftable", "大型工艺品", "Big Craftable"),
    (-12, "mineral", "矿物", "Mineral"),
    (-14, "meat", "肉类", "Meat"),
    (-15, "metal_resource", "金属资源", "Metal Resource"),
    (-16, "building_resource", "建筑资源", "Building Resource"),
    (-17, "sell_at_pierre", "杂货商品", "General Merchandise"),
    (-18, "animal_product", "动物产物", "Animal Product"),
    (-19, "fertilizer", "肥料", "Fertilizer"),
    (-20, "junk", "垃圾", "Trash"),
    (-21, "bait", "鱼饵", "Bait"),
    (-22, "tackle", "渔具", "Tackle"),
    (-24, "furniture", "家具", "Furniture"),
    (-25, "ingredient", "食材", "Ingredient"),
    (-26, "artisan_goods", "工匠物品", "Artisan Good"),
    (-27, "syrup", "树液制品", "Syrup"),
    (-28, "monster_loot", "怪物掉落", "Monster Loot"),
    (-74, "seed", "种子", "Seed"),
    (-75, "vegetable", "蔬菜", "Vegetable"),
    (-76, "flower", "花卉", "Flower"),
    (-77, "forage", "采集物", "Forage"),
    (-78, "fruit", "水果", "Fruit"),
    (-79, "shellfish", "贝类", "Shellfish"),
    (-80, "festival_reward", "节日奖励", "Festival Reward"),
    (-81, "fodder", "饲料", "Fodder"),
    (-82, "clothing", "服饰", "Clothing"),
    (-95, "hat", "帽子", "Hat"),
    (-96, "trinket", "饰品", "Trinket"),
];

/// Weapons.xnb 的 type 数值 -> (稳定 key, 中文, 英文)
const WEAPON_CATEGORY_LABELS: &[(i32, &str, &str, &str)] = &[
    (0, "sword", "剑", "Sword"),
    (1, "dagger", "匕首", "Dagger"),
    (2, "club", "锤", "Club"),
    (3, "defense_sword", "防御剑", "Defense Sword"),
];

/// Tools.xnb 的 ClassName（小写） -> (稳定 key, 中文, 英文)
const TOOL_CATEGORY_LABELS: &[(&str, &str, &str, &str)] = &[
    ("axe", "axe", "斧", "Axe"),
    ("pickaxe", "pickaxe", "镐", "Pickaxe"),
    ("hoe", "hoe", "锄头", "Hoe"),
    ("wateringcan", "watering_can", "洒水壶", "Watering Can"),
    ("fishingrod", "fishing_rod", "鱼竿", "Fishing Rod"),
    ("milkpail", "milk_pail", "挤奶桶", "Milk Pail"),
    ("shears", "shears", "剪刀", "Shears"),
    ("pan", "pan", "淘盘", "Pan"),
    ("wand", "wand", "回程魔杖", "Return Scepter"),
    ("slingshot", "slingshot", "弹弓", "Slingshot"),
];

fn translate_object_type_label(key: &str, is_zh: bool) -> String {
    OBJECT_TYPE_LABELS
        .iter()
        .find(|(k, ..)| *k == key)
        .map(|&(_, zh, en)| zh_en(zh, en, is_zh))
        .unwrap_or_else(|| key.to_string())
}

fn classify_weapon_type_localized(is_zh: bool) -> (String, String) {
    localized_pair("weapon", "武器", "Weapon", is_zh)
}

fn classify_weapon_category_localized(weapon_type: i32, is_zh: bool) -> (String, String) {
    WEAPON_CATEGORY_LABELS
        .iter()
        .find(|(t, ..)| *t == weapon_type)
        .map(|&(_, key, zh, en)| localized_pair(key, zh, en, is_zh))
        .unwrap_or_else(|| localized_pair("weapon_other", "其他武器", "Other Weapon", is_zh))
}

fn classify_tool_category_localized(class_name: &str, is_zh: bool) -> (String, String) {
    let normalized = class_name.trim().to_ascii_lowercase();
    TOOL_CATEGORY_LABELS
        .iter()
        .find(|(name, ..)| *name == normalized)
        .map(|&(_, key, zh, en)| localized_pair(key, zh, en, is_zh))
        .unwrap_or_else(|| localized_pair("tool_other", "其他工具", "Other Tool", is_zh))
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
    if let Some(&(_, key, zh, en)) = CATEGORY_LABELS.iter().find(|(c, ..)| *c == category) {
        return localized_pair(key, zh, en, is_zh);
    }
    if category == 0 && !object_type.trim().is_empty() {
        let key = object_type.trim().to_ascii_lowercase();
        let label = translate_object_type_label(&key, is_zh);
        return (key, label);
    }
    localized_pair("other", "其他", "Other", is_zh)
}

/// 排序权重：表内顺序即展示顺序，未列出的排到最后。
const ITEM_TYPE_ORDER: &[&str] = &[
    "basic",
    "fish",
    "cooking",
    "crafting",
    "minerals",
    "arch",
    "ring",
    "seeds",
    "litter",
    "interactive",
    "quest",
    "asdf",
    "weapon",
    "tool",
];

/// 同一组内的分类共享一个权重。
const CATEGORY_ORDER: &[&[&str]] = &[
    &["seed"],
    &["vegetable"],
    &["fruit"],
    &["flower"],
    &["forage"],
    &["fish"],
    &["cooking"],
    &["ingredient"],
    &["artisan_goods"],
    &["animal_product"],
    &["mineral", "gem"],
    &["metal_resource"],
    &["building_resource"],
    &["monster_loot"],
    &["sword", "dagger", "club", "defense_sword", "weapon_other"],
    &[
        "axe",
        "pickaxe",
        "hoe",
        "watering_can",
        "fishing_rod",
        "milk_pail",
        "shears",
        "pan",
        "wand",
        "slingshot",
        "tool_other",
    ],
];

fn item_type_order(key: &str) -> i32 {
    ITEM_TYPE_ORDER
        .iter()
        .position(|k| *k == key)
        .map_or(99, |index| index as i32)
}

fn category_order(key: &str) -> i32 {
    CATEGORY_ORDER
        .iter()
        .position(|group| group.contains(&key))
        .map_or(99, |index| index as i32)
}
