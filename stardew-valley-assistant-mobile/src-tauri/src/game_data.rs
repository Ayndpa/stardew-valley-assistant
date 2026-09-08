//! 游戏数据查询命令。
//!
//! 解析逻辑全部来自共享 crate `sdv_game_data`，与桌面端是同一份实现，因此两端
//! 的数据、分类、排序和本地化完全一致。这里只负责三件桌面端也要各自做的事：
//! 定位 Content 目录、缓存快照、把结果包成 Tauri 命令。
//!
//! 与桌面端的唯一实质差别是数据来源：桌面端会优先读游戏内运行时导出的价格文件，
//! 手机端没有那条链路（游戏跑在另一个应用的进程里），所以 `dataSource` 恒为
//! `"xnb"`。前端那套「数据来源提示条」的分支因此仍然成立，不需要改。

use crate::paths;
use sdv_game_data::items::{
    build_item_entry, build_item_snapshot_from_xnb, matches_item, ItemGameData,
    ItemGameDataOverview, ItemGameDataQueryResult, ItemSnapshot,
};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, LazyLock, Mutex};
use tauri::AppHandle;

/// 手机端没有运行时导出文件，数据一律来自 xnb 解包。
const DATA_SOURCE: &str = "xnb";

/// 定位已导入的 Content 目录。
///
/// 判定标准和桌面端一致（`Data/Crops.xnb` 存在），这样"目录在但内容不完整"的
/// 情况也能被挡下来，而不是等到某个具体命令解析失败才报错。
fn content_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = paths::content_dir(app)?;
    if dir.join("Data").join("Crops.xnb").exists() {
        return Ok(dir);
    }
    Err("还没有导入游戏资源，请先在首页选择星露谷物语的安装包完成导入。".to_string())
}

fn lang_of(lang: &Option<String>) -> String {
    lang.as_deref().unwrap_or("zh").to_lowercase()
}

fn is_zh(lang: &str) -> bool {
    lang.starts_with("zh")
}

/// 快照缓存的通用取用逻辑。
///
/// 解析一次 xnb 要读盘加 LZX 解压，手机上比桌面慢得多，而导入之后 Content
/// 目录就不会再变，所以整份结果按「目录 + 语言」缓存。
fn cached<T, F>(
    cache: &Mutex<HashMap<String, Arc<T>>>,
    key: String,
    build: F,
) -> Result<Arc<T>, String>
where
    F: FnOnce() -> Result<T, String>,
{
    if let Ok(guard) = cache.lock() {
        if let Some(hit) = guard.get(&key) {
            return Ok(hit.clone());
        }
    }
    let value = Arc::new(build()?);
    if let Ok(mut guard) = cache.lock() {
        guard.insert(key, value.clone());
    }
    Ok(value)
}

fn cache_key(dir: &std::path::Path, lang: &str) -> String {
    format!("{}|{}", dir.to_string_lossy(), lang)
}

macro_rules! snapshot_cache {
    ($name:ident, $ty:ty) => {
        static $name: LazyLock<Mutex<HashMap<String, Arc<$ty>>>> =
            LazyLock::new(|| Mutex::new(HashMap::new()));
    };
}

snapshot_cache!(CROP_CACHE, sdv_game_data::crops::CropGameData);
snapshot_cache!(ANIMAL_CACHE, sdv_game_data::animals::AnimalGameData);
snapshot_cache!(NPC_CACHE, sdv_game_data::npc::NpcGameData);
snapshot_cache!(CALENDAR_CACHE, sdv_game_data::calendar::CalendarGameData);
snapshot_cache!(BUNDLE_CACHE, sdv_game_data::bundles::BundleGameData);
snapshot_cache!(
    SECRET_NOTES_CACHE,
    Vec<sdv_game_data::secret_notes::SecretNoteEntry>
);
snapshot_cache!(ITEM_SNAPSHOT_CACHE, ItemSnapshot);

// ---------------------------------------------------------------------------
// 作物 / 动物 / 村民 / 日历 / 收集包 / 秘密纸条
// ---------------------------------------------------------------------------

#[tauri::command(async)]
pub fn get_crop_game_data(
    app: AppHandle,
    lang: Option<String>,
) -> Result<sdv_game_data::crops::CropGameData, String> {
    let dir = content_dir(&app)?;
    let lang = lang_of(&lang);
    let snapshot = cached(&CROP_CACHE, cache_key(&dir, &lang), || {
        sdv_game_data::crops::build_crop_data_from_xnb(&dir, &lang, is_zh(&lang))
    })?;
    Ok((*snapshot).clone())
}

#[tauri::command(async)]
pub fn get_animal_game_data(
    app: AppHandle,
    lang: Option<String>,
) -> Result<sdv_game_data::animals::AnimalGameData, String> {
    let dir = content_dir(&app)?;
    let lang = lang_of(&lang);
    let snapshot = cached(&ANIMAL_CACHE, cache_key(&dir, &lang), || {
        sdv_game_data::animals::build_animal_data_from_xnb(&dir, &lang, is_zh(&lang))
    })?;
    Ok((*snapshot).clone())
}

#[tauri::command(async)]
pub fn get_npc_game_data(
    app: AppHandle,
    lang: Option<String>,
) -> Result<sdv_game_data::npc::NpcGameData, String> {
    let dir = content_dir(&app)?;
    let lang = lang_of(&lang);
    let snapshot = cached(&NPC_CACHE, cache_key(&dir, &lang), || {
        sdv_game_data::npc::build_npc_game_data_from_xnb(&dir, &lang)
    })?;
    Ok((*snapshot).clone())
}

#[tauri::command(async)]
pub fn get_calendar_game_data(
    app: AppHandle,
    lang: Option<String>,
) -> Result<sdv_game_data::calendar::CalendarGameData, String> {
    let dir = content_dir(&app)?;
    let lang = lang_of(&lang);
    let snapshot = cached(&CALENDAR_CACHE, cache_key(&dir, &lang), || {
        sdv_game_data::calendar::build_calendar_game_data_from_xnb(&dir, &lang)
    })?;
    Ok((*snapshot).clone())
}

#[tauri::command(async)]
pub fn get_bundle_game_data(
    app: AppHandle,
    lang: Option<String>,
) -> Result<sdv_game_data::bundles::BundleGameData, String> {
    let dir = content_dir(&app)?;
    let lang = lang_of(&lang);
    let snapshot = cached(&BUNDLE_CACHE, cache_key(&dir, &lang), || {
        sdv_game_data::bundles::build_bundle_game_data_from_xnb(&dir, Some(&lang))
    })?;
    Ok((*snapshot).clone())
}

#[tauri::command(async)]
pub fn get_secret_notes_game_data(
    app: AppHandle,
    lang: Option<String>,
) -> Result<Vec<sdv_game_data::secret_notes::SecretNoteEntry>, String> {
    let dir = content_dir(&app)?;
    let lang = lang_of(&lang);
    let snapshot = cached(&SECRET_NOTES_CACHE, cache_key(&dir, &lang), || {
        sdv_game_data::secret_notes::build_secret_notes_from_xnb(&dir, Some(&lang))
    })?;
    Ok((*snapshot).clone())
}

// ---------------------------------------------------------------------------
// 物品百科
// ---------------------------------------------------------------------------

fn item_snapshot(app: &AppHandle, lang: &str) -> Result<Arc<ItemSnapshot>, String> {
    let dir = content_dir(app)?;
    cached(&ITEM_SNAPSHOT_CACHE, cache_key(&dir, lang), || {
        // 第三个参数是运行时导出的价格覆盖，手机端没有这条链路。
        build_item_snapshot_from_xnb(dir.clone(), Some(lang), None)
    })
}

/// 返回整本物品百科。
///
/// `include_icons` 默认为 true。只需要 id / 名称 / 分类的页面应显式传 false——
/// 图标是逐个物品的 base64 PNG，会把单次响应从几十 KB 撑到 500 KB 以上，
/// 在手机上尤其明显。
#[tauri::command(async)]
pub fn get_item_game_data(
    app: AppHandle,
    lang: Option<String>,
    include_icons: Option<bool>,
) -> Result<ItemGameData, String> {
    let lang = lang_of(&lang);
    let snapshot = item_snapshot(&app, &lang)?;
    let with_icons = include_icons.unwrap_or(true);
    let mut texture_cache = HashMap::new();
    let encyclopedia = snapshot
        .encyclopedia
        .iter()
        .map(|entry| build_item_entry(&snapshot.content_dir, entry, &mut texture_cache, with_icons))
        .collect::<Vec<_>>();

    Ok(ItemGameData {
        encyclopedia,
        categories: snapshot.categories.clone(),
        item_types: snapshot.item_types.clone(),
        data_source: DATA_SOURCE.to_string(),
        generated_at: None,
    })
}

#[tauri::command(async)]
pub fn get_item_game_data_overview(
    app: AppHandle,
    lang: Option<String>,
) -> Result<ItemGameDataOverview, String> {
    let lang = lang_of(&lang);
    let snapshot = item_snapshot(&app, &lang)?;
    Ok(ItemGameDataOverview {
        categories: snapshot.categories.clone(),
        item_types: snapshot.item_types.clone(),
        total_count: snapshot.encyclopedia.len(),
        data_source: DATA_SOURCE.to_string(),
        generated_at: None,
    })
}

/// 分页查询物品。
///
/// 手机端屏幕小、内存紧，整本百科带图标有好几 MB，所以和桌面端一样在后端分页，
/// 只渲染当前页的图标。
#[tauri::command(async)]
pub fn query_item_game_data(
    app: AppHandle,
    search_term: Option<String>,
    active_category: Option<String>,
    active_type: Option<String>,
    page: Option<usize>,
    page_size: Option<usize>,
    lang: Option<String>,
) -> Result<ItemGameDataQueryResult, String> {
    let lang = lang_of(&lang);
    let snapshot = item_snapshot(&app, &lang)?;
    let keyword = search_term.unwrap_or_default().trim().to_lowercase();
    let all_label = if is_zh(&lang) { "全部" } else { "All" };

    let category = active_category.unwrap_or_else(|| all_label.to_string());
    let item_type = active_type.unwrap_or_else(|| all_label.to_string());
    let page = page.unwrap_or(1).max(1);
    let page_size = page_size.unwrap_or(24).clamp(1, 96);

    let filtered = snapshot
        .encyclopedia
        .iter()
        .enumerate()
        .filter(|(_, item)| matches_item(item, &keyword, &category, &item_type, all_label))
        .map(|(index, _)| index)
        .collect::<Vec<_>>();

    let total_count = filtered.len();
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
    let items = filtered[start..end]
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

// ---------------------------------------------------------------------------
// 钓鱼地图
// ---------------------------------------------------------------------------

#[tauri::command(async)]
pub fn get_fishing_map_data(
    app: AppHandle,
    force_refresh: Option<bool>,
) -> Result<sdv_game_data::fishing::FishingMapData, String> {
    let dir = content_dir(&app)?;
    let cache = paths::cache_dir(&app)?;
    sdv_game_data::fishing::build_fishing_map_data(&cache, &dir, force_refresh.unwrap_or(false))
}

#[tauri::command(async)]
pub fn get_fishing_map_detail(
    app: AppHandle,
    map_id: String,
    force_refresh: Option<bool>,
    lang: Option<String>,
) -> Result<sdv_game_data::fishing::FishingMapDetail, String> {
    let dir = content_dir(&app)?;
    let cache = paths::cache_dir(&app)?;
    let lang = lang_of(&lang);
    sdv_game_data::fishing::build_fishing_map_detail(
        &cache,
        &dir,
        &map_id,
        force_refresh.unwrap_or(false),
        Some(&lang),
        None,
    )
}
