//! 物品百科 Tauri 命令。分类、排序、搜索匹配与 XNB 解析都在 `sdv_game_data::items`，
//! 桌面端只保留快照缓存和「运行时导出文件优先」的数据来源判定。

use std::{
    collections::HashMap,
    sync::{Arc, LazyLock, Mutex},
};

pub use sdv_game_data::items::{
    build_item_entry, build_item_snapshot_from_xnb, category_order,
    classify_category_localized, classify_item_type_localized, classify_tool_category_localized,
    classify_weapon_category_localized, classify_weapon_type_localized, item_type_order,
    load_cooking_recipe_sources_localized, localized_pair, matches_item, normalize_fish_item_id,
    text_or, translate_object_type_label, zh_en, FishConditions, IndexedItemEntry,
    ItemEncyclopediaEntry, ItemGameData, ItemGameDataOverview, ItemGameDataQueryResult,
    ItemSnapshot, CATEGORY_LABELS, CATEGORY_ORDER, ITEM_TYPE_ORDER, LEARNED_RECIPE_SOURCES,
    OBJECT_TYPE_LABELS, TOOL_CATEGORY_LABELS, WEAPON_CATEGORY_LABELS,
};

static ITEM_SNAPSHOT_CACHE: LazyLock<Mutex<HashMap<String, Arc<ItemSnapshot>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

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

    let mod_prices = super::item_prices::read_item_prices_from_export();
    let snapshot = Arc::new(build_item_snapshot_from_xnb(
        content_dir.clone(),
        Some(&lang_str),
        mod_prices.as_ref(),
    )?);
    ITEM_SNAPSHOT_CACHE
        .lock()
        .map_err(|_| "物品百科缓存锁定失败".to_string())?
        .insert(cache_key, snapshot.clone());

    Ok(snapshot)
}
