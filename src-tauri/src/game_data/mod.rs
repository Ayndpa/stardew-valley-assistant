pub mod animals;
pub mod bundles;
pub mod calendar;
pub mod cheats;
pub mod crops;
pub mod fishing;
pub mod image_utils;
pub mod item_prices;
pub mod items;
pub mod live_state;
pub mod map_names;
pub mod mod_data;
pub mod npc;
pub mod pipe_server;
pub mod secret_notes;
pub mod tbin;
pub mod xnb;

use crate::game::find_stardew_valley;
use std::collections::HashMap;
use std::fs;
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

/// 构造快照缓存键：内容目录 + 语言 + 伴侣模组导出文件的指纹。
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

pub fn collect_xnb_files(root: &Path) -> Result<Vec<PathBuf>, String> {
    let mut files = Vec::new();
    collect_xnb_files_inner(root, &mut files)?;
    files.sort();
    Ok(files)
}

fn collect_xnb_files_inner(root: &Path, files: &mut Vec<PathBuf>) -> Result<(), String> {
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(err) if !root.exists() => {
            return Err(format!("无法定位地图目录 {}: {}", root.display(), err));
        }
        Err(err) => {
            return Err(format!("无法读取地图目录 {}: {}", root.display(), err));
        }
    };

    for entry in entries {
        let entry = entry.map_err(|err| format!("读取地图目录失败: {}", err))?;
        let path = entry.path();
        if path.is_dir() {
            collect_xnb_files_inner(&path, files)?;
        } else if path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("xnb"))
        {
            files.push(path);
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn dev_content_dir() -> Option<PathBuf> {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .and_then(|path| path.parent())
            .map(|path| {
                path.join("stardew-valley-source")
                    .join("StardewValleyGame")
                    .join("Content")
            })
            .filter(|path| path.exists())
    }

    #[test]
    fn reads_crop_game_data_from_dev_source() {
        let Some(content) = dev_content_dir() else {
            return;
        };
        let crops = xnb::load_crops_xnb(&content.join("Data").join("Crops.xnb")).unwrap();
        let objects = xnb::load_objects_xnb(&content.join("Data").join("Objects.xnb")).unwrap();
        assert!(crops.contains_key("472"));
        assert_eq!(crops["472"].harvest_item_id, "24");
        assert_eq!(objects["24"].price, 35);
        let mut texture_cache = HashMap::new();
        let icon =
            image_utils::render_object_icon(&content, &objects["24"], &mut texture_cache).unwrap();
        assert!(icon.starts_with("data:image/png;base64,"));
    }

    #[test]
    fn reads_object_game_data_fields_from_dev_source() {
        let Some(content) = dev_content_dir() else {
            return;
        };
        let objects = xnb::load_objects_xnb(&content.join("Data").join("Objects.xnb")).unwrap();
        let parsnip = objects.get("24").unwrap();

        assert!(!parsnip.name.is_empty());
        assert!(parsnip.price >= 0);
        assert!(parsnip.category <= 0);
        assert!(parsnip.can_be_trashed);
    }

    #[test]
    fn debug_crop_xnb_shape() {
        let Some(content) = dev_content_dir() else {
            return;
        };
        let payload = xnb::load_xnb_payload(&content.join("Data").join("Crops.xnb")).unwrap();
        let mut reader = xnb::XnbPayloadReader::new(&payload);
        let type_readers = reader.read_type_readers().unwrap();
        eprintln!("reader count {}", type_readers.len());
        for (idx, name) in type_readers.iter().enumerate() {
            eprintln!("{}: {}", idx + 1, name);
        }
        let root = reader.read_7bit_usize().unwrap();
        let count = reader.read_i32().unwrap();
        eprintln!("root {} count {} pos {}", root, count, reader.pos);
        let key = reader.read_string().unwrap();
        eprintln!("first key {:?} pos {}", key, reader.pos);
        eprintln!("next bytes {:?}", &reader.data[reader.pos..reader.pos + 64]);
    }

    #[test]
    fn reads_fishing_tiles_from_dev_maps() {
        let Some(content) = dev_content_dir() else {
            return;
        };
        let beach = fishing::parse_fishing_map(&content, &content.join("Maps").join("Beach.xnb"))
            .unwrap()
            .unwrap();
        assert_eq!(beach.id, "Beach");
        assert!(beach.width > 0);
        assert!(beach.height > 0);
        assert!(beach.fishable_tiles > 0);
        assert!(beach.max_depth > 0);
    }

    #[test]
    fn reads_location_fishing_data_from_dev_source() {
        let Some(content) = dev_content_dir() else {
            return;
        };
        let locations =
            xnb::load_location_fishing_xnb(&content.join("Data").join("Locations.xnb")).unwrap();
        let beach = locations.get("Beach").unwrap();
        assert!(!beach.fish.is_empty());
        assert!(!beach.fish_areas.is_empty());
    }

    #[test]
    fn reads_calendar_game_data_from_dev_source() {
        let Some(content) = dev_content_dir() else {
            return;
        };
        let localized_tables = xnb::load_localized_string_tables(
            &content,
            &["Characters", "NPCNames", "UI", "1_6_Strings"],
        );
        let festivals = calendar::load_calendar_festivals(
            &content,
            &localized_tables,
            true,
            xnb::get_lang_suffix(Some("zh")),
        )
        .unwrap();
        let birthdays =
            calendar::load_calendar_birthdays(&content, &localized_tables, true).unwrap();

        assert!(festivals.iter().any(|entry| entry.name.contains("复活节")));
        assert!(festivals.iter().any(|entry| entry.name.contains("夜市")));
        assert!(birthdays
            .iter()
            .any(|entry| entry.name.contains("阿比盖尔")));
        assert!(birthdays.iter().any(|entry| entry.name.contains("刘易斯")));
    }

    #[test]
    fn reads_npc_profiles_from_dev_source() {
        let Some(content) = dev_content_dir() else {
            return;
        };
        let localized_tables = xnb::load_localized_string_tables(
            &content,
            &[
                "Characters",
                "NPCNames",
                "UI",
                "1_6_Strings",
                "StringsFromCSFiles",
                "Objects",
            ],
        );
        let npcs = npc::load_npc_profiles(&content, &localized_tables, true).unwrap();

        assert!(npcs.iter().any(|entry| entry.id == "Abigail"));
        assert!(npcs.iter().any(|entry| entry.id == "Lewis"));
        let abigail = npcs.iter().find(|entry| entry.id == "Abigail").unwrap();
        assert!(!abigail.loved_items.is_empty());
        assert!(!abigail.hated_items.is_empty());
        assert!(abigail
            .loved_items
            .iter()
            .all(|item| !item.contains("[LocalizedText")));
    }

    #[test]
    fn reads_farm_animals_from_dev_source() {
        let Some(content) = dev_content_dir() else {
            return;
        };
        let animals =
            xnb::load_farm_animals_xnb(&content.join("Data").join("FarmAnimals.xnb")).unwrap();
        assert!(animals.len() >= 10, "Expected at least 10 animal types, got {}", animals.len());
        eprintln!("Loaded {} animal types", animals.len());

        let wc = animals.get("White Chicken").expect("White Chicken should exist");
        assert_eq!(wc.house, "Coop");
        assert_eq!(wc.purchase_price, 400);
        assert_eq!(wc.sell_price, 800);
        assert_eq!(wc.days_to_mature, 3);
        assert_eq!(wc.days_to_produce, 1);
        assert!(!wc.produce_items.is_empty());
        assert_eq!(wc.produce_items[0].item_id, "176");
        eprintln!("White Chicken: house={} price={} produce={:?}", wc.house, wc.purchase_price, wc.produce_items);

        let goat = animals.get("Goat").expect("Goat should exist");
        assert_eq!(goat.house, "Barn");
        eprintln!("Goat: house={} price={}", goat.house, goat.purchase_price);

        let pig = animals.get("Pig").expect("Pig should exist");
        assert_eq!(pig.house, "Barn");
        assert_eq!(pig.harvest_type, 2); // DigUp
        eprintln!("Pig: house={} harvest_type={}", pig.house, pig.harvest_type);

        // List all animal types
        let mut names: Vec<_> = animals.keys().collect();
        names.sort();
        for name in &names {
            let a = &animals[*name];
            eprintln!("  {}: house={} price={} produce_items={} deluxe={}", name, a.house, a.purchase_price, a.produce_items.len(), a.deluxe_produce_items.len());
        }
    }

    #[test]
    fn debug_white_cow() {
        let Some(content) = dev_content_dir() else {
            return;
        };
        let payload =
            xnb::load_xnb_payload(&content.join("Data").join("FarmAnimals.xnb")).unwrap();
        let mut reader = xnb::XnbPayloadReader::new(&payload);
        let type_readers = reader.read_type_readers().unwrap();
        let _root = reader.read_7bit_usize().unwrap();
        let count = reader.read_i32().unwrap();

        // Parse all animals until we find White Cow
        for _ in 0..count {
            let key = reader.read_object_string(&type_readers).unwrap();
            let vr = reader.read_7bit_usize().unwrap();
            let start = reader.pos;

            if key == "White Cow" {
                eprintln!("=== White Cow starts at {} ===", start);

                // Read all fields up to Skins using the corrected reader
                // But skip with manual reads to track position

                // Strings
                for field in &["DisplayName", "House"] {
                    let v = reader.read_object_string_any().unwrap();
                    eprintln!("  {}: {:?} pos={}", field, v, reader.pos);
                }
                // i32s
                for field in &["Gender", "PurchasePrice", "SellPrice"] {
                    let v = reader.read_i32().unwrap();
                    eprintln!("  {}: {} pos={}", field, v, reader.pos);
                }
                // ShopTexture
                let st = reader.read_object_string_any().unwrap();
                eprintln!("  ShopTexture: {:?} pos={}", st, reader.pos);
                // Rectangle
                for field in &["SrcX", "SrcY", "SrcW", "SrcH"] {
                    let v = reader.read_i32().unwrap();
                    eprintln!("  {}: {} pos={}", field, v, reader.pos);
                }
                // More strings
                for field in &["ShopDisplayName", "ShopDescription", "ShopMissingBuildingDesc", "RequiredBuilding", "UnlockCondition"] {
                    let v = reader.read_object_string_any().unwrap();
                    eprintln!("  {}: {:?} pos={}", field, if v.len() > 40 { format!("{}...", &v[..40]) } else { v.clone() }, reader.pos);
                }
                // AlternatePurchaseTypes
                let alt_r = reader.read_7bit_usize().unwrap();
                eprintln!("  AltPurchase reader={} pos={}", alt_r, reader.pos);
                if alt_r != 0 {
                    let ac = reader.read_i32().unwrap();
                    eprintln!("  AltPurchase count={} pos={}", ac, reader.pos);
                    for j in 0..ac {
                        let er = reader.read_7bit_usize().unwrap();
                        if er == 0 { continue; }
                        let id = reader.read_object_string_any().unwrap();
                        let cond = reader.read_object_string_any().unwrap();
                        eprintln!("    alt[{}] Id={:?} Cond={:?} pos={}", j, id, cond, reader.pos);
                        let air = reader.read_7bit_usize().unwrap();
                        if air != 0 {
                            let aic = reader.read_i32().unwrap();
                            for k in 0..aic {
                                let aid = reader.read_object_string_any().unwrap();
                                eprintln!("      AnimalId[{}]={:?}", k, aid);
                            }
                        }
                        eprintln!("    alt[{}] done pos={}", j, reader.pos);
                    }
                }
                // EggItemIds
                let egg_r = reader.read_7bit_usize().unwrap();
                eprintln!("  EggItemIds reader={} pos={}", egg_r, reader.pos);
                if egg_r != 0 {
                    let ec = reader.read_i32().unwrap();
                    for j in 0..ec { let _ = reader.read_object_string_any().unwrap(); }
                    eprintln!("  EggItemIds done pos={}", reader.pos);
                }
                // More fields
                let it = reader.read_i32().unwrap();
                eprintln!("  IncubationTime: {} pos={}", it, reader.pos);
                let ipso = reader.read_i32().unwrap();
                eprintln!("  IncubatorParentSheetOffset: {} pos={}", ipso, reader.pos);
                let bt = reader.read_object_string_any().unwrap();
                eprintln!("  BirthText: {:?} pos={}", bt, reader.pos);
                let dtm = reader.read_i32().unwrap();
                eprintln!("  DaysToMature: {} pos={}", dtm, reader.pos);
                let cgp = reader.read_bool().unwrap();
                eprintln!("  CanGetPregnant: {} pos={}", cgp, reader.pos);
                let dtp = reader.read_i32().unwrap();
                eprintln!("  DaysToProduce: {} pos={}", dtp, reader.pos);
                let ht = reader.read_i32().unwrap();
                eprintln!("  HarvestType: {} pos={}", ht, reader.pos);
                let htool = reader.read_object_string_any().unwrap();
                eprintln!("  HarvestTool: {:?} pos={}", htool, reader.pos);

                // ProduceItemIds
                let pi_r = reader.read_7bit_usize().unwrap();
                eprintln!("  ProduceItemIds reader={} pos={}", pi_r, reader.pos);
                if pi_r != 0 {
                    let pc = reader.read_i32().unwrap();
                    for j in 0..pc {
                        let er = reader.read_7bit_usize().unwrap();
                        if er == 0 { continue; }
                        let _ = reader.read_object_string_any().unwrap();
                        let _ = reader.read_object_string_any().unwrap();
                        let _ = reader.read_i32().unwrap();
                        let _ = reader.read_object_string_any().unwrap();
                    }
                    eprintln!("  ProduceItemIds done pos={}", reader.pos);
                }
                // DeluxeProduceItemIds
                let dp_r = reader.read_7bit_usize().unwrap();
                eprintln!("  DeluxeProduceItemIds reader={} pos={}", dp_r, reader.pos);
                if dp_r != 0 {
                    let dc = reader.read_i32().unwrap();
                    for j in 0..dc {
                        let er = reader.read_7bit_usize().unwrap();
                        if er == 0 { continue; }
                        let _ = reader.read_object_string_any().unwrap();
                        let _ = reader.read_object_string_any().unwrap();
                        let _ = reader.read_i32().unwrap();
                        let _ = reader.read_object_string_any().unwrap();
                    }
                    eprintln!("  DeluxeProduceItemIds done pos={}", reader.pos);
                }

                let pom = reader.read_bool().unwrap();
                eprintln!("  ProduceOnMature: {} pos={}", pom, reader.pos);
                let fffp = reader.read_i32().unwrap();
                eprintln!("  FriendshipForFasterProduce: {} pos={}", fffp, reader.pos);
                let dpmf = reader.read_i32().unwrap();
                eprintln!("  DeluxeProduceMinFriendship: {} pos={}", dpmf, reader.pos);
                let dpd = reader.read_f32().unwrap();
                eprintln!("  DeluxeProduceCareDivisor: {} pos={}", dpd, reader.pos);
                let dplm = reader.read_f32().unwrap();
                eprintln!("  DeluxeProduceLuckMultiplier: {} pos={}", dplm, reader.pos);
                let cegc = reader.read_bool().unwrap();
                eprintln!("  CanEatGoldenCrackers: {} pos={}", cegc, reader.pos);
                let phb = reader.read_i32().unwrap();
                eprintln!("  ProfessionForHappinessBoost: {} pos={}", phb, reader.pos);
                let pqb = reader.read_i32().unwrap();
                eprintln!("  ProfessionForQualityBoost: {} pos={}", pqb, reader.pos);
                let pfp = reader.read_i32().unwrap();
                eprintln!("  ProfessionForFasterProduce: {} pos={}", pfp, reader.pos);
                let snd = reader.read_object_string_any().unwrap();
                eprintln!("  Sound: {:?} pos={}", snd, reader.pos);
                let bsnd = reader.read_object_string_any().unwrap();
                eprintln!("  BabySound: {:?} pos={}", bsnd, reader.pos);
                let tex = reader.read_object_string_any().unwrap();
                eprintln!("  Texture: {:?} pos={}", tex, reader.pos);
                let htex = reader.read_object_string_any().unwrap();
                eprintln!("  HarvestedTexture: {:?} pos={}", htex, reader.pos);
                let btex = reader.read_object_string_any().unwrap();
                eprintln!("  BabyTexture: {:?} pos={}", btex, reader.pos);
                let ufrfl = reader.read_bool().unwrap();
                eprintln!("  UseFlippedRightForLeft: {} pos={}", ufrfl, reader.pos);
                let sw = reader.read_i32().unwrap();
                eprintln!("  SpriteWidth: {} pos={}", sw, reader.pos);
                let sh = reader.read_i32().unwrap();
                eprintln!("  SpriteHeight: {} pos={}", sh, reader.pos);
                let uda = reader.read_bool().unwrap();
                eprintln!("  UseDoubleUniqueAnimFrames: {} pos={}", uda, reader.pos);
                let sf = reader.read_i32().unwrap();
                eprintln!("  SleepFrame: {} pos={}", sf, reader.pos);
                let ex = reader.read_i32().unwrap();
                let ey = reader.read_i32().unwrap();
                eprintln!("  EmoteOffset: ({},{}) pos={}", ex, ey, reader.pos);
                let sx = reader.read_i32().unwrap();
                let sy = reader.read_i32().unwrap();
                eprintln!("  SwimOffset: ({},{}) pos={}", sx, sy, reader.pos);

                // Skins - try reading as reader_idx (7-bit) + count (i32)
                // If reader_idx is 0, it's null. If non-zero, read count.
                let skin_r = reader.read_7bit_usize().unwrap();
                eprintln!("  Skins reader={} pos={}", skin_r, reader.pos);
                if skin_r != 0 {
                    let sc = reader.read_i32().unwrap();
                    eprintln!("  Skins count={} pos={}", sc, reader.pos);
                    for j in 0..sc {
                        let er = reader.read_7bit_usize().unwrap();
                        if er == 0 { continue; }
                        let _ = reader.read_object_string_any().unwrap();
                        let _ = reader.read_f32().unwrap();
                        let _ = reader.read_object_string_any().unwrap();
                        let _ = reader.read_object_string_any().unwrap();
                        let _ = reader.read_object_string_any().unwrap();
                    }
                }
                eprintln!("  After Skins pos={}", reader.pos);

                // Dump bytes at current position
                eprintln!("  Bytes at pos {}:", reader.pos);
                for i in 0..20 {
                    let p = reader.pos + i;
                    if p < reader.data.len() {
                        eprintln!("    [{}+{}]: 0x{:02x} ({})", p, i, reader.data[p], reader.data[p]);
                    }
                }

                // Find White Cow Texture and BabyTexture fields
                let cow_texture = b"Animals\\White Cow";
                let baby_cow_texture = b"Animals\\BabyWhite Cow";
                for i in 0..reader.data.len() - cow_texture.len() {
                    if &reader.data[i..i + cow_texture.len()] == cow_texture {
                        eprintln!("\n  'Animals\\White Cow' at byte {} (len={})", i, cow_texture.len());
                        // The string data starts at i, the reader_idx byte is at i-2, the 7-bit len byte is at i-1
                        eprintln!("  reader_idx byte at {}: 0x{:02x}", i-2, reader.data[i-2]);
                        eprintln!("  len byte at {}: 0x{:02x} = {}", i-1, reader.data[i-1], reader.data[i-1]);
                        break;
                    }
                }
                for i in 0..reader.data.len() - baby_cow_texture.len() {
                    if &reader.data[i..i + baby_cow_texture.len()] == baby_cow_texture {
                        eprintln!("  'Animals\\BabyWhite Cow' at byte {} (len={})", i, baby_cow_texture.len());
                        eprintln!("  reader_idx byte at {}: 0x{:02x}", i-2, reader.data[i-2]);
                        eprintln!("  len byte at {}: 0x{:02x} = {}", i-1, reader.data[i-1], reader.data[i-1]);
                        // After BabyTexture, the fields are:
                        // UseFlippedRightForLeft (bool), SpriteWidth (i32), SpriteHeight (i32)
                        // UseDoubleUniqueAnimationFrames (bool), SleepFrame (i32)
                        // EmoteOffset (Point=i32+i32), SwimOffset (Point=i32+i32)
                        // Skins (List), ShadowWhenBabySwims, ShadowWhenBaby, ShadowWhenAdultSwims, ShadowWhenAdult, Shadow
                        // Let me read each field manually and verify
                        let after_baby = i + baby_cow_texture.len();
                        let mut p = after_baby;
                        // UseFlippedRightForLeft: bool
                        eprintln!("  UseFlippedRightForLeft: byte[{}]=0x{:02x} ({})", p, reader.data[p], reader.data[p]);
                        p += 1;
                        // SpriteWidth: i32
                        let sw = i32::from_le_bytes([reader.data[p], reader.data[p+1], reader.data[p+2], reader.data[p+3]]);
                        eprintln!("  SpriteWidth: bytes[{}..{}]=0x{:02x}{:02x}{:02x}{:02x} = {}", p, p+3, reader.data[p], reader.data[p+1], reader.data[p+2], reader.data[p+3], sw);
                        p += 4;
                        // SpriteHeight: i32
                        let sh = i32::from_le_bytes([reader.data[p], reader.data[p+1], reader.data[p+2], reader.data[p+3]]);
                        eprintln!("  SpriteHeight: bytes[{}..{}]=0x{:02x}{:02x}{:02x}{:02x} = {}", p, p+3, reader.data[p], reader.data[p+1], reader.data[p+2], reader.data[p+3], sh);
                        p += 4;
                        // UseDoubleUniqueAnimationFrames: bool
                        eprintln!("  UseDoubleUniqueAnimFrames: byte[{}]=0x{:02x} ({})", p, reader.data[p], reader.data[p]);
                        p += 1;
                        // SleepFrame: i32
                        let sf = i32::from_le_bytes([reader.data[p], reader.data[p+1], reader.data[p+2], reader.data[p+3]]);
                        eprintln!("  SleepFrame: bytes[{}..{}]=0x{:02x}{:02x}{:02x}{:02x} = {}", p, p+3, reader.data[p], reader.data[p+1], reader.data[p+2], reader.data[p+3], sf);
                        p += 4;
                        // EmoteOffset: i32+i32
                        let ex = i32::from_le_bytes([reader.data[p], reader.data[p+1], reader.data[p+2], reader.data[p+3]]);
                        let ey = i32::from_le_bytes([reader.data[p+4], reader.data[p+5], reader.data[p+6], reader.data[p+7]]);
                        eprintln!("  EmoteOffset: ({},{}) at {}", ex, ey, p);
                        p += 8;
                        // SwimOffset: i32+i32
                        let sx = i32::from_le_bytes([reader.data[p], reader.data[p+1], reader.data[p+2], reader.data[p+3]]);
                        let sy = i32::from_le_bytes([reader.data[p+4], reader.data[p+5], reader.data[p+6], reader.data[p+7]]);
                        eprintln!("  SwimOffset: ({},{}) at {}", sx, sy, p);
                        p += 8;
                        // Dump bytes BEFORE the Skins area to check alignment
                        eprintln!("  Bytes before Skins area ({} to {}):", p-5, p+5);
                        for j in -5..5i32 {
                            let bp = (p as i32 + j) as usize;
                            if bp < reader.data.len() {
                                let b = reader.data[bp];
                                let ch = if b >= 32 && b < 127 { b as char } else { '.' };
                                eprintln!("    [{:4}] 0x{:02x} {:3} '{}'", bp, b, b, ch);
                            }
                        }

                        // Search for the White Cow entry in the XNB dictionary
                        // The key "White Cow" should be right before the value data
                        let cow_key = b"White Cow";
                        for i in 0..reader.data.len() - cow_key.len() {
                            if &reader.data[i..i + cow_key.len()] == cow_key {
                                eprintln!("\n  'White Cow' key found at byte {}", i);
                                // The key is a string: reader_idx (7-bit) + len (7-bit) + data
                                // reader_idx is at i-2, len at i-1
                                eprintln!("  key reader_idx byte at {}: 0x{:02x}", i-2, reader.data[i-2]);
                                eprintln!("  key len byte at {}: 0x{:02x} = {}", i-1, reader.data[i-1], reader.data[i-1]);
                                // After the key comes the value reader index
                                let after_key = i + cow_key.len();
                                eprintln!("  value reader_idx at {}: 0x{:02x}", after_key, reader.data[after_key]);
                                // Then the FarmAnimalData fields start
                                let data_start = after_key + 1;
                                eprintln!("  FarmAnimalData starts at {}", data_start);
                                break;
                            }
                        }

                        // Find the NEXT animal key after White Cow to determine boundary
                        // Look for "Brown Cow" key
                        let brown_cow = b"Brown Cow";
                        for i in 0..reader.data.len() - brown_cow.len() {
                            if &reader.data[i..i + brown_cow.len()] == brown_cow {
                                // Check if this is a key (reader_idx byte before it should be 0x02)
                                if i >= 2 && reader.data[i-2] == 0x02 {
                                    eprintln!("  'Brown Cow' key found at byte {}", i);
                                    eprintln!("  Brown Cow data should start at {}", i + brown_cow.len() + 1);
                                    // The White Cow data ends just before the Brown Cow key
                                    // The key is: reader_idx(0x02) + len + "Brown Cow"
                                    let cow_data_end = i - 2; // reader_idx byte
                                    eprintln!("  White Cow data ends before byte {} (key reader_idx)", cow_data_end);
                                    // Dump bytes from Skins area to the end
                                    eprintln!("  Bytes from Skins to Brown Cow key:");
                                    for j in 8930..cow_data_end + 5 {
                                        let b = reader.data[j];
                                        let ch = if b >= 32 && b < 127 { b as char } else { '.' };
                                        eprintln!("    [{:4}] 0x{:02x} {:3} '{}'", j, b, b, ch);
                                    }
                                    break;
                                }
                            }
                        }
                        break;
                    }
                }

                eprintln!("=== DONE ===");
                break;
            } else {
                // Skip this animal
                let _ = reader.read_farm_animal_data();
            }
        }
    }

    #[test]
    fn debug_farm_animals_xnb_shape() {
        let Some(content) = dev_content_dir() else {
            return;
        };
        let payload =
            xnb::load_xnb_payload(&content.join("Data").join("FarmAnimals.xnb")).unwrap();
        let mut reader = xnb::XnbPayloadReader::new(&payload);
        let type_readers = reader.read_type_readers().unwrap();
        eprintln!("=== FarmAnimals.xnb type readers ===");
        for (idx, name) in type_readers.iter().enumerate() {
            eprintln!("  {}: {}", idx + 1, name);
        }
        let root = reader.read_7bit_usize().unwrap();
        let count = reader.read_i32().unwrap();
        eprintln!("root {} count {} pos {}", root, count, reader.pos);

        let key = reader.read_object_string(&type_readers).unwrap();
        eprintln!("key {:?} pos {}", key, reader.pos);

        let value_reader = reader.read_7bit_usize().unwrap();
        eprintln!("value_reader {} pos {}", value_reader, reader.pos);

        // Now read field by field with explicit position tracking
        let mut p = reader.pos;
        macro_rules! s {
            () => {{
                let v = reader.read_object_string_any().unwrap();
                eprintln!("  [{}] str = {:?}", p, v);
                p = reader.pos;
                v
            }};
        }
        macro_rules! i {
            () => {{
                let v = reader.read_i32().unwrap();
                eprintln!("  [{}] i32 = {}", p, v);
                p = reader.pos;
                v
            }};
        }
        macro_rules! f {
            () => {{
                let v = reader.read_f32().unwrap();
                eprintln!("  [{}] f32 = {}", p, v);
                p = reader.pos;
                v
            }};
        }
        macro_rules! b {
            () => {{
                let v = reader.read_bool().unwrap();
                eprintln!("  [{}] bool = {}", p, v);
                p = reader.pos;
                v
            }};
        }

        // FarmAnimalData fields in declaration order
        eprintln!("--- FarmAnimalData ---");
        eprintln!("DisplayName:"); s!();
        eprintln!("House:"); s!();
        eprintln!("Gender:"); i!();
        eprintln!("PurchasePrice:"); i!();
        eprintln!("SellPrice:"); i!();
        eprintln!("ShopTexture:"); s!();
        eprintln!("ShopSourceRect (Rectangle):"); i!(); i!(); i!(); i!();
        eprintln!("ShopDisplayName:"); s!();
        eprintln!("ShopDescription:"); s!();
        eprintln!("ShopMissingBuildingDescription:"); s!();
        eprintln!("RequiredBuilding:"); s!();
        eprintln!("UnlockCondition:"); s!();

        // AlternatePurchaseTypes
        eprintln!("AlternatePurchaseTypes count:");
        let alt_count = i!();
        for idx in 0..alt_count {
            eprintln!("  alt[{}]:", idx);
            eprintln!("    Id:"); s!();
            eprintln!("    Condition:"); s!();
            eprintln!("    AnimalIds count:");
            let aid_count = i!();
            for j in 0..aid_count {
                eprintln!("    AnimalIds[{}]:", j); s!();
            }
        }

        // EggItemIds
        eprintln!("EggItemIds count:");
        let egg_count = i!();
        for idx in 0..egg_count {
            eprintln!("  egg[{}]:", idx); s!();
        }

        eprintln!("IncubationTime:"); i!();
        eprintln!("IncubatorParentSheetOffset:"); i!();
        eprintln!("BirthText:"); s!();
        eprintln!("DaysToMature:"); i!();
        eprintln!("CanGetPregnant:"); b!();
        eprintln!("DaysToProduce:"); i!();
        eprintln!("HarvestType:"); i!();
        eprintln!("HarvestTool:"); s!();

        // ProduceItemIds
        eprintln!("ProduceItemIds count:");
        let pi_count = i!();
        for idx in 0..pi_count {
            eprintln!("  produce[{}]:", idx);
            eprintln!("    Id:"); s!();
            eprintln!("    Condition:"); s!();
            eprintln!("    MinimumFriendship:"); i!();
            eprintln!("    ItemId:"); s!();
        }

        // DeluxeProduceItemIds
        eprintln!("DeluxeProduceItemIds count:");
        let dp_count = i!();
        for idx in 0..dp_count {
            eprintln!("  deluxe[{}]:", idx);
            eprintln!("    Id:"); s!();
            eprintln!("    Condition:"); s!();
            eprintln!("    MinimumFriendship:"); i!();
            eprintln!("    ItemId:"); s!();
        }

        eprintln!("ProduceOnMature:"); b!();
        eprintln!("FriendshipForFasterProduce:"); i!();
        eprintln!("DeluxeProduceMinimumFriendship:"); i!();
        eprintln!("DeluxeProduceCareDivisor:"); f!();
        eprintln!("DeluxeProduceLuckMultiplier:"); f!();
        eprintln!("CanEatGoldenCrackers:"); b!();
        eprintln!("ProfessionForHappinessBoost:"); i!();
        eprintln!("ProfessionForQualityBoost:"); i!();
        eprintln!("ProfessionForFasterProduce:"); i!();
        eprintln!("Sound:"); s!();
        eprintln!("BabySound:"); s!();
        eprintln!("Texture:"); s!();
        eprintln!("HarvestedTexture:"); s!();
        eprintln!("BabyTexture:"); s!();
        eprintln!("UseFlippedRightForLeft:"); b!();
        eprintln!("SpriteWidth:"); i!();
        eprintln!("SpriteHeight:"); i!();
        eprintln!("UseDoubleUniqueAnimationFrames:"); b!();
        eprintln!("SleepFrame:"); i!();
        eprintln!("EmoteOffset (Point):"); i!(); i!();
        eprintln!("SwimOffset (Point):"); i!(); i!();

        // Skins
        eprintln!("Skins count:");
        let skin_count = i!();
        for idx in 0..skin_count {
            eprintln!("  skin[{}]:", idx);
            eprintln!("    Id:"); s!();
            eprintln!("    Weight:"); f!();
            eprintln!("    Texture:"); s!();
            eprintln!("    HarvestedTexture:"); s!();
            eprintln!("    BabyTexture:"); s!();
        }

        // Shadows
        for name in &["ShadowWhenBabySwims", "ShadowWhenBaby", "ShadowWhenAdultSwims", "ShadowWhenAdult", "Shadow"] {
            eprintln!("{}:", name);
            let present = b!();
            if present {
                eprintln!("  Visible:"); b!();
                let has_offset = b!();
                if has_offset { eprintln!("  Offset:"); i!(); i!(); }
                let has_scale = b!();
                if has_scale { eprintln!("  Scale:"); f!(); }
            }
        }

        eprintln!("CanSwim:"); b!();
        eprintln!("BabiesFollowAdults:"); b!();
        eprintln!("GrassEatAmount:"); i!();
        eprintln!("HappinessDrain:"); i!();
        eprintln!("UpDownPetHitboxTileSize:"); f!(); f!();
        eprintln!("LeftRightPetHitboxTileSize:"); f!(); f!();
        eprintln!("BabyUpDownPetHitboxTileSize:"); f!(); f!();
        eprintln!("BabyLeftRightPetHitboxTileSize:"); f!(); f!();

        // StatToIncrementOnProduce
        eprintln!("StatToIncrementOnProduce count:");
        let stat_count = i!();
        for idx in 0..stat_count {
            eprintln!("  stat[{}]:", idx);
            eprintln!("    Id:"); s!();
            eprintln!("    RequiredItemId:"); s!();
            eprintln!("    RequiredTags count:");
            let tag_count = i!();
            for j in 0..tag_count { eprintln!("    tag[{}]:", j); s!(); }
            eprintln!("    StatName:"); s!();
        }

        eprintln!("ShowInSummitCredits:"); b!();
        eprintln!("CustomFields count:");
        let cf_count = i!();
        for idx in 0..cf_count {
            eprintln!("  cf[{}] key:", idx); s!();
            eprintln!("  cf[{}] value:", idx); s!();
        }

        eprintln!("=== DONE at pos {} ===", reader.pos);
    }

    #[test]
    fn reads_cooking_recipe_sources_from_dev_source() {
        let Some(content) = dev_content_dir() else {
            return;
        };
        let localized_tables = xnb::load_localized_string_tables(
            &content,
            &["Objects", "1_6_Strings", "StringsFromCSFiles", "NPCNames"],
        );
        let recipe_sources =
            items::load_cooking_recipe_sources_localized(&content, &localized_tables, true);

        // Should have recipe sources for some items
        assert!(!recipe_sources.is_empty());

        // Check that TV recipes are identified with detailed schedule
        let has_tv_recipe = recipe_sources
            .values()
            .any(|sources| sources.iter().any(|s| s.contains("酱料女皇电视节目（第")));
        assert!(
            has_tv_recipe,
            "Should have at least one TV recipe source with schedule"
        );

        // Check that skill-based recipes are identified
        let has_skill_recipe = recipe_sources
            .values()
            .any(|sources| sources.iter().any(|s| s.contains("等级")));
        assert!(
            has_skill_recipe,
            "Should have at least one skill-based recipe source"
        );

        // Check that friendship-based recipes are identified
        let has_friendship_recipe = recipe_sources
            .values()
            .any(|sources| sources.iter().any(|s| s.contains("好感")));
        assert!(
            has_friendship_recipe,
            "Should have at least one friendship-based recipe source"
        );

        // Print some sample sources for debugging
        let mut samples: Vec<_> = recipe_sources.iter().take(10).collect();
        samples.sort_by_key(|(id, _)| id.clone());
        for (item_id, sources) in &samples {
            eprintln!("Item {}: {:?}", item_id, sources);
        }

        // Check for recipes with multiple sources
        let multi_source_count = recipe_sources
            .values()
            .filter(|sources| sources.len() > 1)
            .count();
        eprintln!("\nRecipes with multiple sources: {}", multi_source_count);
    }
}
