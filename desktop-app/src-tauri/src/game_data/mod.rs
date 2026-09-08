pub mod animals;
pub mod bundles;
pub mod calendar;
pub mod cheats;
pub mod crops;
pub mod fishing;
pub mod item_prices;
pub mod items;
pub mod live_state;
pub mod mod_data;
pub mod npc;
pub mod pipe_server;
pub mod secret_notes;

// 平台无关的解析实现全部住在共享 crate 里，桌面端只做转发，手机端引用同一份代码。
pub use sdv_game_data::{collect_xnb_files, image_utils, map_names, tbin, xnb};

use crate::game::find_stardew_valley;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};

pub use animals::get_animal_game_data;
pub use bundles::get_bundle_game_data;
pub use calendar::get_calendar_game_data;
pub use cheats::{
    cheat_add_item, cheat_add_money, cheat_grow_crops, cheat_kill_monsters, cheat_max_friendship,
    cheat_refill_energy, cheat_refill_health, cheat_set_weather, cheat_teleport,
    cheat_toggle_freeze_time, cheat_toggle_speed, cheat_water_crops, get_cheat_states,
};
pub use crops::get_crop_game_data;
pub use fishing::{get_fishing_map_data, get_fishing_map_detail};
pub use items::{get_item_game_data, get_item_game_data_overview, query_item_game_data};
pub use mod_data::{get_mod_export_data, export_mod_data_to_file};
pub use npc::get_npc_game_data;
pub use secret_notes::get_secret_notes_game_data;

/// 游戏数据快照缓存的通用取用逻辑。
///
/// 解析 XNB 需要读盘 + LZX 解压，单次 30–40ms；而游戏内容目录在应用运行期间
/// 基本不会变化，因此按「内容目录 + 语言 + 导出文件指纹」缓存整份结果。
pub(crate) fn cached_snapshot<T, F>(
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

/// 构造快照缓存键：内容目录 + 语言 + 运行时导出文件的指纹。
pub(crate) fn snapshot_cache_key(content_dir: &Path, lang: &str) -> String {
    format!(
        "{}|{}|{}",
        content_dir.to_string_lossy(),
        lang,
        item_prices::export_fingerprint()
    )
}

static CONTENT_DIR_CACHE: LazyLock<Mutex<HashMap<String, PathBuf>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn is_content_dir(path: &Path) -> bool {
    path.join("Data").join("Crops.xnb").exists()
}

/// 定位游戏 Content 目录。
///
/// 每个游戏数据命令都会先调用它，因此这里必须便宜：
/// 结果按传入的 game_dir 缓存，且候选路径是逐个求值的——调用方给了有效目录时
/// 就不会再去读注册表、解析 Steam 库、遍历当前目录的所有祖先。
pub fn locate_content_dir(game_dir: Option<&str>) -> Result<PathBuf, String> {
    let explicit = game_dir.map(str::trim).filter(|value| !value.is_empty());
    let cache_key = explicit.unwrap_or("").to_string();

    if let Ok(cache) = CONTENT_DIR_CACHE.lock() {
        if let Some(hit) = cache.get(&cache_key) {
            // 一次 stat，保证游戏被移动/卸载后不会一直返回失效路径
            if is_content_dir(hit) {
                return Ok(hit.clone());
            }
        }
    }

    let resolved = resolve_content_dir(explicit).ok_or_else(|| {
        "无法定位星露谷 Content/Data/Crops.xnb，请先在设置中配置游戏安装目录。".to_string()
    })?;

    if let Ok(mut cache) = CONTENT_DIR_CACHE.lock() {
        cache.insert(cache_key, resolved.clone());
    }
    Ok(resolved)
}

fn resolve_content_dir(explicit: Option<&str>) -> Option<PathBuf> {
    // 1. 调用方显式指定的目录——绝大多数情况在这里就命中了
    if let Some(game_dir) = explicit {
        if let Some(hit) = first_content_candidate(Path::new(game_dir)) {
            return Some(hit);
        }
    }

    // 2. 自动探测（读注册表 / Steam 库配置，开销较大）
    if let Some(game_dir) = find_stardew_valley() {
        if let Some(hit) = first_content_candidate(Path::new(&game_dir)) {
            return Some(hit);
        }
    }

    // 3. 开发环境：从当前目录往上找源码树
    let current_dir = std::env::current_dir().ok()?;
    for ancestor in current_dir.ancestors() {
        if let Some(hit) = first_content_candidate(ancestor) {
            return Some(hit);
        }
        if let Some(parent) = ancestor.parent() {
            let source_tree = parent
                .join("stardew-valley-source")
                .join("StardewValleyGame");
            if let Some(hit) = first_content_candidate(&source_tree) {
                return Some(hit);
            }
        }
    }

    None
}

fn first_content_candidate(root: &Path) -> Option<PathBuf> {
    let candidates = [
        root.join("Content"),
        root.join("StardewValleyGame").join("Content"),
        root.to_path_buf(),
    ];
    candidates.into_iter().find(|path| is_content_dir(path))
}
