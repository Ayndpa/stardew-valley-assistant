use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::UNIX_EPOCH;

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use image::codecs::png::PngEncoder;
use image::{ColorType, ImageEncoder};
use lzxd::{Lzxd, WindowSize};
use serde::{Deserialize, Serialize};
use tokio::task;

use crate::game::find_stardew_valley;

const XNB_FLAG_COMPRESSED_LZX: u8 = 0x80;
const XNB_HEADER_COMPRESSED_LEN: usize = 14;
const XNB_HEADER_UNCOMPRESSED_LEN: usize = 10;
const XNB_CHUNK_SIZE: usize = 0x8000;
const ITEM_ICON_SIZE: usize = 16;
const MAX_MAP_PREVIEW_PIXELS: usize = 16_000_000;
const DEFAULT_OBJECT_TEXTURE: &str = "Maps/springobjects";

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
    pub name: String,
    pub icon: Option<String>,
    pub season: String,
    pub seasons: Vec<String>,
    pub grow_days: i32,
    pub sell_price: i32,
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

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FishingTile {
    pub x: i32,
    pub y: i32,
    pub depth: i32,
    pub hidden: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FishingMapSummary {
    pub id: String,
    pub name: String,
    pub relative_path: String,
    pub width: i32,
    pub height: i32,
    pub water_tiles: i32,
    pub fishable_tiles: i32,
    pub max_depth: i32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FishingMapData {
    pub maps: Vec<FishingMapSummary>,
    pub cached: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FishingMapDetail {
    pub id: String,
    pub name: String,
    pub relative_path: String,
    pub width: i32,
    pub height: i32,
    pub water_tiles: i32,
    pub fishable_tiles: i32,
    pub max_depth: i32,
    pub tiles: Vec<FishingTile>,
    pub map_image_data_url: Option<String>,
    pub map_image_error: Option<String>,
    pub cached: bool,
}

#[derive(Debug, Clone)]
struct RawCropData {
    seasons: Vec<i32>,
    days_in_phase: Vec<i32>,
    regrow_days: i32,
    needs_watering: bool,
    harvest_item_id: String,
}

#[derive(Debug, Clone)]
struct RawObjectData {
    name: String,
    display_name: String,
    price: i32,
    texture: String,
    sprite_index: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct FishingMapCacheFingerprint {
    file_count: u64,
    total_size: u64,
    latest_modified_ms: u128,
}

#[derive(Debug, Clone)]
struct CachedFishingMaps {
    fingerprint: FishingMapCacheFingerprint,
    maps: Vec<FishingMapDetail>,
}

#[derive(Debug, Clone, Default)]
struct CachedFishingMapPreview {
    data_url: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Clone)]
struct CachedFishingMapPreviews {
    fingerprint: FishingMapCacheFingerprint,
    previews: HashMap<String, CachedFishingMapPreview>,
}

static FISHING_MAP_CACHE: OnceLock<Mutex<HashMap<String, Arc<CachedFishingMaps>>>> =
    OnceLock::new();
static FISHING_MAP_PREVIEW_CACHE: OnceLock<Mutex<HashMap<String, CachedFishingMapPreviews>>> =
    OnceLock::new();

#[tauri::command]
pub fn get_crop_game_data(game_dir: Option<String>) -> Result<CropGameData, String> {
    let content_dir = locate_content_dir(game_dir.as_deref())?;
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
            name: name.clone(),
            icon: icon.clone(),
            season,
            seasons,
            grow_days,
            sell_price: obj.price,
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

#[tauri::command]
pub async fn get_fishing_map_data(
    game_dir: Option<String>,
    force_refresh: Option<bool>,
) -> Result<FishingMapData, String> {
    task::spawn_blocking(move || get_fishing_map_data_sync(game_dir, force_refresh))
        .await
        .map_err(|err| format!("钓鱼地图解析任务失败: {}", err))?
}

#[tauri::command]
pub async fn get_fishing_map_detail(
    game_dir: Option<String>,
    map_id: String,
    force_refresh: Option<bool>,
) -> Result<FishingMapDetail, String> {
    task::spawn_blocking(move || get_fishing_map_detail_sync(game_dir, map_id, force_refresh))
        .await
        .map_err(|err| format!("钓鱼地图详情任务失败: {}", err))?
}

fn get_fishing_map_data_sync(
    game_dir: Option<String>,
    force_refresh: Option<bool>,
) -> Result<FishingMapData, String> {
    let content_dir = locate_content_dir(game_dir.as_deref())?;
    let (cache, cached) =
        get_or_build_fishing_map_cache(&content_dir, force_refresh.unwrap_or(false))?;
    let maps = cache
        .maps
        .iter()
        .map(FishingMapDetail::summary)
        .collect::<Vec<_>>();

    Ok(FishingMapData { maps, cached })
}

fn get_fishing_map_detail_sync(
    game_dir: Option<String>,
    map_id: String,
    force_refresh: Option<bool>,
) -> Result<FishingMapDetail, String> {
    let content_dir = locate_content_dir(game_dir.as_deref())?;
    let cache_key = content_cache_key(&content_dir);
    let (cache, cached) =
        get_or_build_fishing_map_cache(&content_dir, force_refresh.unwrap_or(false))?;
    let mut detail = cache
        .maps
        .iter()
        .find(|map| map.id == map_id)
        .cloned()
        .ok_or_else(|| format!("未找到地图 {}", map_id))?;
    let preview = get_or_render_fishing_map_preview(
        &content_dir,
        &cache_key,
        &cache.fingerprint,
        &detail.id,
        &detail.relative_path,
    );
    detail.map_image_data_url = preview.data_url;
    detail.map_image_error = preview.error;
    detail.cached = cached;
    Ok(detail)
}

fn locate_content_dir(game_dir: Option<&str>) -> Result<PathBuf, String> {
    let mut candidates = Vec::new();

    if let Some(game_dir) = game_dir.map(str::trim).filter(|value| !value.is_empty()) {
        push_content_candidates(Path::new(game_dir), &mut candidates);
    }

    if let Some(game_dir) = find_stardew_valley() {
        push_content_candidates(Path::new(&game_dir), &mut candidates);
    }

    if let Ok(current_dir) = std::env::current_dir() {
        for ancestor in current_dir.ancestors() {
            push_content_candidates(ancestor, &mut candidates);
            if let Some(parent) = ancestor.parent() {
                push_content_candidates(
                    &parent
                        .join("stardew-valley-source")
                        .join("StardewValleyGame"),
                    &mut candidates,
                );
            }
        }
    }

    candidates
        .into_iter()
        .find(|path| path.join("Data").join("Crops.xnb").exists())
        .ok_or_else(|| {
            "无法定位星露谷 Content/Data/Crops.xnb，请先在设置中配置游戏安装目录。".to_string()
        })
}

fn push_content_candidates(root: &Path, candidates: &mut Vec<PathBuf>) {
    candidates.push(root.join("Content"));
    candidates.push(root.join("StardewValleyGame").join("Content"));
    candidates.push(root.to_path_buf());
}

fn collect_xnb_files(root: &Path) -> Result<Vec<PathBuf>, String> {
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

impl FishingMapDetail {
    fn summary(&self) -> FishingMapSummary {
        FishingMapSummary {
            id: self.id.clone(),
            name: self.name.clone(),
            relative_path: self.relative_path.clone(),
            width: self.width,
            height: self.height,
            water_tiles: self.water_tiles,
            fishable_tiles: self.fishable_tiles,
            max_depth: self.max_depth,
        }
    }
}

fn get_or_build_fishing_map_cache(
    content_dir: &Path,
    force_refresh: bool,
) -> Result<(Arc<CachedFishingMaps>, bool), String> {
    let maps_dir = content_dir.join("Maps");
    let paths = collect_xnb_files(&maps_dir)?;
    let fingerprint = fingerprint_fishing_map_files(&paths)?;
    let cache_key = content_cache_key(content_dir);
    let cache = FISHING_MAP_CACHE.get_or_init(|| Mutex::new(HashMap::new()));

    if !force_refresh {
        if let Ok(guard) = cache.lock() {
            if let Some(existing) = guard.get(&cache_key) {
                if existing.fingerprint == fingerprint {
                    return Ok((Arc::clone(existing), true));
                }
            }
        }
    }

    let mut maps = Vec::new();
    for path in paths {
        let Some(entry) = parse_fishing_map(content_dir, &path)? else {
            continue;
        };
        if entry.fishable_tiles > 0 {
            maps.push(entry);
        }
    }

    maps.sort_by(|a, b| {
        b.fishable_tiles
            .cmp(&a.fishable_tiles)
            .then_with(|| a.name.cmp(&b.name))
    });

    let built = Arc::new(CachedFishingMaps { fingerprint, maps });
    let mut guard = cache
        .lock()
        .map_err(|_| "钓鱼地图缓存被占用，请稍后重试。".to_string())?;
    guard.insert(cache_key, Arc::clone(&built));
    Ok((built, false))
}

fn content_cache_key(content_dir: &Path) -> String {
    content_dir
        .canonicalize()
        .unwrap_or_else(|_| content_dir.to_path_buf())
        .to_string_lossy()
        .to_string()
}

fn get_or_render_fishing_map_preview(
    content_dir: &Path,
    cache_key: &str,
    fingerprint: &FishingMapCacheFingerprint,
    map_id: &str,
    relative_path: &str,
) -> CachedFishingMapPreview {
    let preview_cache = FISHING_MAP_PREVIEW_CACHE.get_or_init(|| Mutex::new(HashMap::new()));

    if let Ok(guard) = preview_cache.lock() {
        if let Some(entry) = guard.get(cache_key) {
            if entry.fingerprint == *fingerprint {
                if let Some(preview) = entry.previews.get(map_id) {
                    return preview.clone();
                }
            }
        }
    }

    let map_path = content_dir.join(Path::new(relative_path));
    let preview = match render_tbin_map_preview(content_dir, &map_path) {
        Ok(data_url) => CachedFishingMapPreview {
            data_url: Some(data_url),
            error: None,
        },
        Err(err) => CachedFishingMapPreview {
            data_url: None,
            error: Some(err),
        },
    };

    if let Ok(mut guard) = preview_cache.lock() {
        let entry =
            guard
                .entry(cache_key.to_string())
                .or_insert_with(|| CachedFishingMapPreviews {
                    fingerprint: *fingerprint,
                    previews: HashMap::new(),
                });
        if entry.fingerprint != *fingerprint {
            entry.fingerprint = *fingerprint;
            entry.previews.clear();
        }
        entry.previews.insert(map_id.to_string(), preview.clone());
    }

    preview
}

fn fingerprint_fishing_map_files(paths: &[PathBuf]) -> Result<FishingMapCacheFingerprint, String> {
    let mut total_size = 0u64;
    let mut latest_modified_ms = 0u128;

    for path in paths {
        let metadata = fs::metadata(path)
            .map_err(|err| format!("无法读取地图文件信息 {}: {}", path.display(), err))?;
        total_size = total_size.saturating_add(metadata.len());
        if let Ok(modified) = metadata.modified() {
            if let Ok(duration) = modified.duration_since(UNIX_EPOCH) {
                latest_modified_ms = latest_modified_ms.max(duration.as_millis());
            }
        }
    }

    Ok(FishingMapCacheFingerprint {
        file_count: paths.len() as u64,
        total_size,
        latest_modified_ms,
    })
}

fn load_tbin_map_from_xnb(path: &Path) -> Result<Option<TbinMap>, String> {
    let payload = load_xnb_payload(path)?;
    let mut reader = XnbPayloadReader::new(&payload);
    let type_readers = reader.read_type_readers()?;
    let root_reader = reader.read_7bit_usize()?;
    if root_reader == 0 {
        return Ok(None);
    }

    let Some(reader_name) = type_readers.get(root_reader.saturating_sub(1)) else {
        return Ok(None);
    };
    if !reader_name.contains("xTile.Pipeline.TideReader") {
        return Ok(None);
    }

    let map_payload_len = reader.read_i32()?.max(0) as usize;
    let map_payload = reader.read_bytes(map_payload_len)?;
    TbinMapReader::new(map_payload).read_map().map(Some)
}

fn parse_fishing_map(content_dir: &Path, path: &Path) -> Result<Option<FishingMapDetail>, String> {
    let Some(map) = load_tbin_map_from_xnb(path)? else {
        return Ok(None);
    };
    let Some(back_layer) = map.layer("Back") else {
        return Ok(None);
    };

    let buildings_layer = map.layer("Buildings");
    let width = back_layer.width.max(0) as usize;
    let height = back_layer.height.max(0) as usize;
    let tile_count = width
        .checked_mul(height)
        .ok_or_else(|| format!("地图尺寸过大，无法解析: {}", path.display()))?;
    let mut water_mask = vec![false; tile_count];
    let mut fishable_mask = vec![false; tile_count];
    let mut hidden_mask = vec![false; tile_count];
    let mut tiles = Vec::new();
    let mut water_tiles = 0;

    for y in 0..back_layer.height {
        for x in 0..back_layer.width {
            let idx = tile_index(back_layer.width, x, y);
            let Some(water) = map.tile_property(back_layer, x, y, "Water") else {
                continue;
            };

            water_mask[idx] = true;
            water_tiles += 1;
            hidden_mask[idx] = water == "I";
            let has_no_fishing = map.tile_property(back_layer, x, y, "NoFishing").is_some();
            let buildings_water = buildings_layer
                .and_then(|layer| map.tile_property(layer, x, y, "Water"))
                .is_some();
            let has_building_tile = buildings_layer.and_then(|layer| layer.tile(x, y)).is_some();

            if has_no_fishing || (has_building_tile && !buildings_water) {
                continue;
            }
            fishable_mask[idx] = true;
        }
    }

    if water_tiles == 0 {
        return Ok(None);
    }

    let depth_map = compute_water_depths(back_layer.width, back_layer.height, &water_mask);
    let mut max_depth = 0;

    for y in 0..back_layer.height {
        for x in 0..back_layer.width {
            let idx = tile_index(back_layer.width, x, y);
            if !fishable_mask[idx] {
                continue;
            }

            let depth = depth_from_land_distance(depth_map[idx]);
            max_depth = max_depth.max(depth);
            tiles.push(FishingTile {
                x,
                y,
                depth,
                hidden: hidden_mask[idx],
            });
        }
    }

    let relative_path = path
        .strip_prefix(content_dir)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/");
    let id = path
        .strip_prefix(content_dir.join("Maps"))
        .unwrap_or(path)
        .with_extension("")
        .to_string_lossy()
        .replace('\\', "/")
        .trim_start_matches('/')
        .to_string();
    let name = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("Unknown")
        .replace('_', " ");

    Ok(Some(FishingMapDetail {
        id,
        name,
        relative_path,
        width: back_layer.width,
        height: back_layer.height,
        water_tiles,
        fishable_tiles: tiles.len() as i32,
        max_depth,
        tiles,
        map_image_data_url: None,
        map_image_error: None,
        cached: false,
    }))
}

fn tile_index(width: i32, x: i32, y: i32) -> usize {
    (y * width + x) as usize
}

fn depth_from_land_distance(distance: i32) -> i32 {
    if distance >= i32::MAX / 8 {
        5
    } else {
        distance.saturating_sub(1).min(5)
    }
}

fn compute_water_depths(width: i32, height: i32, water_mask: &[bool]) -> Vec<i32> {
    let width = width.max(0) as usize;
    let height = height.max(0) as usize;
    let inf = i32::MAX / 4;
    let mut distances = water_mask
        .iter()
        .map(|is_water| if *is_water { inf } else { 0 })
        .collect::<Vec<_>>();

    for y in 0..height {
        for x in 0..width {
            let idx = y * width + x;
            if distances[idx] == 0 {
                continue;
            }

            let mut best = distances[idx];
            if x > 0 {
                best = best.min(distances[idx - 1].saturating_add(1));
            }
            if y > 0 {
                best = best.min(distances[idx - width].saturating_add(1));
                if x > 0 {
                    best = best.min(distances[idx - width - 1].saturating_add(1));
                }
                if x + 1 < width {
                    best = best.min(distances[idx - width + 1].saturating_add(1));
                }
            }
            distances[idx] = best;
        }
    }

    for y in (0..height).rev() {
        for x in (0..width).rev() {
            let idx = y * width + x;
            if distances[idx] == 0 {
                continue;
            }

            let mut best = distances[idx];
            if x + 1 < width {
                best = best.min(distances[idx + 1].saturating_add(1));
            }
            if y + 1 < height {
                best = best.min(distances[idx + width].saturating_add(1));
                if x > 0 {
                    best = best.min(distances[idx + width - 1].saturating_add(1));
                }
                if x + 1 < width {
                    best = best.min(distances[idx + width + 1].saturating_add(1));
                }
            }
            distances[idx] = best;
        }
    }

    distances
}

fn render_tbin_map_preview(content_dir: &Path, path: &Path) -> Result<String, String> {
    let Some(map) = load_tbin_map_from_xnb(path)? else {
        return Err("所选文件不是可渲染的 tBIN 地图。".to_string());
    };
    let back_layer = map
        .layer("Back")
        .ok_or_else(|| "地图缺少 Back 图层，无法渲染底图。".to_string())?;
    let tile_width = back_layer.tile_width.max(1) as usize;
    let tile_height = back_layer.tile_height.max(1) as usize;
    let width = (back_layer.width.max(0) as usize)
        .checked_mul(tile_width)
        .ok_or_else(|| "地图宽度过大，无法渲染。".to_string())?;
    let height = (back_layer.height.max(0) as usize)
        .checked_mul(tile_height)
        .ok_or_else(|| "地图高度过大，无法渲染。".to_string())?;
    if width == 0 || height == 0 {
        return Err("地图尺寸为空，无法渲染。".to_string());
    }
    if width.saturating_mul(height) > MAX_MAP_PREVIEW_PIXELS {
        return Err(format!(
            "地图预览尺寸 {}x{} 过大，已跳过底图渲染。",
            width, height
        ));
    }

    let mut canvas = Canvas::new(width, height);
    let mut texture_cache = HashMap::new();
    let mut drawn_tiles = 0usize;

    for layer in map.layers.iter().filter(|layer| layer.visible) {
        for y in 0..layer.height {
            for x in 0..layer.width {
                let Some(tile) = layer.tile(x, y) else {
                    continue;
                };
                let Some(tile_sheet) = map.tile_sheets.get(&tile.tile_sheet_id) else {
                    continue;
                };
                let texture_key = object_texture_key(&tile_sheet.image_source);
                if !texture_cache.contains_key(&texture_key) {
                    let texture_path = resolve_object_texture_path(content_dir, &texture_key)?;
                    let texture = load_xnb_texture(&texture_path)?;
                    texture_cache.insert(texture_key.clone(), texture);
                }
                let texture = texture_cache
                    .get(&texture_key)
                    .ok_or_else(|| format!("贴图 '{}' 未缓存。", texture_key))?;
                if draw_tbin_tile(
                    &mut canvas,
                    texture,
                    tile_sheet,
                    layer,
                    x,
                    y,
                    tile.tile_index,
                ) {
                    drawn_tiles += 1;
                }
            }
        }
    }

    if drawn_tiles == 0 {
        return Err("地图没有可绘制的瓦片。".to_string());
    }

    canvas.to_png_data_url()
}

fn draw_tbin_tile(
    canvas: &mut Canvas,
    texture: &Texture,
    tile_sheet: &TbinTileSheet,
    layer: &TbinLayer,
    tile_x: i32,
    tile_y: i32,
    tile_index: i32,
) -> bool {
    if tile_x < 0 || tile_y < 0 || tile_index < 0 {
        return false;
    }

    let source_width = tile_sheet.tile_width.max(1) as usize;
    let source_height = tile_sheet.tile_height.max(1) as usize;
    let columns = if tile_sheet.sheet_width > 0 {
        tile_sheet.sheet_width as usize
    } else {
        texture.width / source_width
    };
    if columns == 0 {
        return false;
    }

    let tile_index = tile_index as usize;
    let margin_x = tile_sheet.margin_x.max(0) as usize;
    let margin_y = tile_sheet.margin_y.max(0) as usize;
    let spacing_x = tile_sheet.spacing_x.max(0) as usize;
    let spacing_y = tile_sheet.spacing_y.max(0) as usize;
    let source_x = margin_x + (tile_index % columns) * (source_width + spacing_x);
    let source_y = margin_y + (tile_index / columns) * (source_height + spacing_y);
    if source_x >= texture.width || source_y >= texture.height {
        return false;
    }

    let dest_x = tile_x as usize * layer.tile_width.max(1) as usize;
    let dest_y = tile_y as usize * layer.tile_height.max(1) as usize;
    let draw_width = source_width
        .min(layer.tile_width.max(1) as usize)
        .min(texture.width.saturating_sub(source_x));
    let draw_height = source_height
        .min(layer.tile_height.max(1) as usize)
        .min(texture.height.saturating_sub(source_y));
    if draw_width == 0 || draw_height == 0 {
        return false;
    }

    for y in 0..draw_height {
        for x in 0..draw_width {
            canvas.blend(
                dest_x + x,
                dest_y + y,
                texture.get(source_x + x, source_y + y),
            );
        }
    }

    true
}

fn load_crops_xnb(path: &Path) -> Result<HashMap<String, RawCropData>, String> {
    let payload = load_xnb_payload(path)?;
    let mut reader = XnbPayloadReader::new(&payload);
    let type_readers = reader.read_type_readers()?;
    let root_reader = reader.read_7bit_usize()?;
    if root_reader == 0 {
        return Ok(HashMap::new());
    }
    require_reader(&type_readers, root_reader, "DictionaryReader")?;

    let count = reader.read_i32()?.max(0) as usize;
    let mut crops = HashMap::with_capacity(count);
    for _ in 0..count {
        let key = reader.read_object_string(&type_readers)?;
        let value_reader = reader.read_7bit_usize()?;
        if value_reader == 0 {
            continue;
        }
        require_reader(&type_readers, value_reader, "ReflectiveReader")?;
        let value = reader
            .read_crop_data()
            .map_err(|e| format!("Failed to parse crop '{}': {}", key, e))?;
        crops.insert(key, value);
    }
    Ok(crops)
}

fn load_objects_xnb(path: &Path) -> Result<HashMap<String, RawObjectData>, String> {
    let payload = load_xnb_payload(path)?;
    let mut reader = XnbPayloadReader::new(&payload);
    let type_readers = reader.read_type_readers()?;
    let root_reader = reader.read_7bit_usize()?;
    if root_reader == 0 {
        return Ok(HashMap::new());
    }
    require_reader(&type_readers, root_reader, "DictionaryReader")?;

    let count = reader.read_i32()?.max(0) as usize;
    let mut objects = HashMap::with_capacity(count);
    for _ in 0..count {
        let key = reader.read_object_string(&type_readers)?;
        let value_reader = reader.read_7bit_usize()?;
        if value_reader == 0 {
            continue;
        }
        require_reader(&type_readers, value_reader, "ReflectiveReader")
            .map_err(|e| format!("Failed to parse object '{}' reader: {}", key, e))?;
        let start_pos = reader.pos;
        let value = reader.read_object_data().map_err(|e| {
            format!(
                "Failed to parse object '{}' at byte {}: {}",
                key, start_pos, e
            )
        })?;
        objects.insert(key, value);
    }
    Ok(objects)
}

fn load_string_dictionary_best_effort(paths: &[PathBuf]) -> HashMap<String, String> {
    for path in paths {
        if !path.exists() {
            continue;
        }
        if let Ok(values) = load_string_dictionary_xnb(path) {
            return values;
        }
    }
    HashMap::new()
}

fn load_string_dictionary_xnb(path: &Path) -> Result<HashMap<String, String>, String> {
    let payload = load_xnb_payload(path)?;
    let mut reader = XnbPayloadReader::new(&payload);
    let type_readers = reader.read_type_readers()?;
    let root_reader = reader.read_7bit_usize()?;
    if root_reader == 0 {
        return Ok(HashMap::new());
    }
    require_reader(&type_readers, root_reader, "DictionaryReader")?;

    let count = reader.read_i32()?.max(0) as usize;
    let mut values = HashMap::with_capacity(count);
    for _ in 0..count {
        let key = reader.read_object_string(&type_readers)?;
        let value = reader.read_object_string(&type_readers)?;
        values.insert(key, value);
    }
    Ok(values)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Pixel {
    r: u8,
    g: u8,
    b: u8,
    a: u8,
}

impl Pixel {
    const TRANSPARENT: Self = Self {
        r: 0,
        g: 0,
        b: 0,
        a: 0,
    };
}

#[derive(Clone, Debug)]
struct Texture {
    width: usize,
    height: usize,
    pixels: Vec<Pixel>,
}

impl Texture {
    fn get(&self, x: usize, y: usize) -> Pixel {
        if x >= self.width || y >= self.height {
            return Pixel::TRANSPARENT;
        }
        self.pixels[y * self.width + x]
    }

    fn crop_to_png_data_url(&self, source: Rect) -> Result<String, String> {
        let width = source.width.min(self.width.saturating_sub(source.x));
        let height = source.height.min(self.height.saturating_sub(source.y));
        if width == 0 || height == 0 {
            return Err("Texture crop is empty".to_string());
        }

        let mut raw = Vec::with_capacity(width * height * 4);
        for y in 0..height {
            for x in 0..width {
                let pixel = self.get(source.x + x, source.y + y);
                raw.extend_from_slice(&[pixel.r, pixel.g, pixel.b, pixel.a]);
            }
        }

        encode_png_data_url(&raw, width, height)
    }
}

struct Canvas {
    width: usize,
    height: usize,
    pixels: Vec<Pixel>,
}

impl Canvas {
    fn new(width: usize, height: usize) -> Self {
        Self {
            width,
            height,
            pixels: vec![Pixel::TRANSPARENT; width * height],
        }
    }

    fn blend(&mut self, x: usize, y: usize, src: Pixel) {
        if src.a == 0 || x >= self.width || y >= self.height {
            return;
        }

        let index = y * self.width + x;
        self.pixels[index] = blend_pixel(self.pixels[index], src);
    }

    fn to_png_data_url(&self) -> Result<String, String> {
        let mut raw = Vec::with_capacity(self.width * self.height * 4);
        for pixel in &self.pixels {
            raw.extend_from_slice(&[pixel.r, pixel.g, pixel.b, pixel.a]);
        }

        encode_png_data_url(&raw, self.width, self.height)
    }
}

fn blend_pixel(dst: Pixel, src: Pixel) -> Pixel {
    if src.a == 255 {
        return src;
    }
    if dst.a == 0 {
        return src;
    }

    let src_a = src.a as u32;
    let inv_a = 255 - src_a;
    let out_a = src_a + (dst.a as u32 * inv_a + 127) / 255;
    if out_a == 0 {
        return Pixel::TRANSPARENT;
    }

    let blend_channel = |src_c: u8, dst_c: u8| -> u8 {
        let value = src_c as u32 * src_a + dst_c as u32 * dst.a as u32 * inv_a / 255;
        ((value + out_a / 2) / out_a).min(255) as u8
    };

    Pixel {
        r: blend_channel(src.r, dst.r),
        g: blend_channel(src.g, dst.g),
        b: blend_channel(src.b, dst.b),
        a: out_a.min(255) as u8,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Rect {
    x: usize,
    y: usize,
    width: usize,
    height: usize,
}

fn render_object_icon(
    content_dir: &Path,
    object: &RawObjectData,
    texture_cache: &mut HashMap<String, Texture>,
) -> Result<String, String> {
    let texture_key = object_texture_key(&object.texture);
    if !texture_cache.contains_key(&texture_key) {
        let texture_path = resolve_object_texture_path(content_dir, &texture_key)?;
        let texture = load_xnb_texture(&texture_path)?;
        texture_cache.insert(texture_key.clone(), texture);
    }

    let texture = texture_cache
        .get(&texture_key)
        .ok_or_else(|| format!("Object texture '{}' was not cached", texture_key))?;
    let rect = item_icon_rect(texture, object.sprite_index)?;
    texture.crop_to_png_data_url(rect)
}

fn object_texture_key(texture: &str) -> String {
    let value = if texture.trim().is_empty() {
        DEFAULT_OBJECT_TEXTURE
    } else {
        texture.trim()
    };
    let mut normalized = value.replace('\\', "/");
    while let Some(stripped) = normalized.strip_prefix("./") {
        normalized = stripped.to_string();
    }
    normalized = normalized.trim_start_matches('/').to_string();
    if normalized.to_ascii_lowercase().ends_with(".xnb") {
        normalized.truncate(normalized.len().saturating_sub(4));
    }
    if normalized.trim().is_empty() {
        DEFAULT_OBJECT_TEXTURE.to_string()
    } else {
        normalized
    }
}

fn resolve_object_texture_path(content_dir: &Path, texture_key: &str) -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    push_texture_path_candidate(&mut candidates, content_dir, texture_key);

    if !texture_key.contains('/') {
        push_texture_path_candidate(
            &mut candidates,
            content_dir,
            &format!("Maps/{}", texture_key),
        );
        push_texture_path_candidate(
            &mut candidates,
            content_dir,
            &format!("TileSheets/{}", texture_key),
        );
    }

    candidates
        .into_iter()
        .find(|path| path.exists())
        .ok_or_else(|| {
            format!(
                "无法定位物品贴图 '{}.xnb'，请确认游戏 Content 目录完整。",
                texture_key
            )
        })
}

fn push_texture_path_candidate(
    candidates: &mut Vec<PathBuf>,
    content_dir: &Path,
    texture_key: &str,
) {
    let Some(path) = texture_path_candidate(content_dir, texture_key) else {
        return;
    };
    if !candidates.iter().any(|candidate| candidate == &path) {
        candidates.push(path);
    }
}

fn texture_path_candidate(content_dir: &Path, texture_key: &str) -> Option<PathBuf> {
    let mut path = content_dir.to_path_buf();
    for segment in texture_key.split('/') {
        let segment = segment.trim();
        if segment.is_empty() || segment == "." || segment == ".." || segment.contains(':') {
            return None;
        }
        path.push(segment);
    }
    path.set_extension("xnb");
    Some(path)
}

fn item_icon_rect(texture: &Texture, sprite_index: i32) -> Result<Rect, String> {
    if sprite_index < 0 {
        return Err(format!("Invalid negative sprite index {}", sprite_index));
    }

    let columns = texture.width / ITEM_ICON_SIZE;
    if columns == 0 || texture.height < ITEM_ICON_SIZE {
        return Err("Object texture is smaller than a single item icon".to_string());
    }

    let sprite_index = sprite_index as usize;
    let x = (sprite_index % columns) * ITEM_ICON_SIZE;
    let y = (sprite_index / columns) * ITEM_ICON_SIZE;
    if x + ITEM_ICON_SIZE > texture.width || y + ITEM_ICON_SIZE > texture.height {
        return Err(format!(
            "Sprite index {} is outside object texture bounds {}x{}",
            sprite_index, texture.width, texture.height
        ));
    }

    Ok(Rect {
        x,
        y,
        width: ITEM_ICON_SIZE,
        height: ITEM_ICON_SIZE,
    })
}

fn load_xnb_texture(path: &Path) -> Result<Texture, String> {
    let payload = load_xnb_payload(path)?;
    parse_texture_payload(&payload)
        .map_err(|e| format!("Failed to parse texture {}: {}", path.display(), e))
}

fn parse_texture_payload(payload: &[u8]) -> Result<Texture, String> {
    let mut reader = XnbPayloadReader::new(payload);
    let _type_readers = reader.read_type_readers()?;
    let type_reader_index = reader.read_7bit_usize()?;
    if type_reader_index == 0 {
        return Err("Texture payload has a null primary object".to_string());
    }

    let surface_format = reader.read_i32()?;
    if surface_format != 0 {
        return Err(format!(
            "Unsupported Texture2D surface format {}",
            surface_format
        ));
    }

    let width = reader.read_i32()?.max(0) as usize;
    let height = reader.read_i32()?.max(0) as usize;
    let mip_count = reader.read_i32()?.max(0) as usize;
    if width == 0 || height == 0 || mip_count == 0 {
        return Err("Texture2D has invalid dimensions".to_string());
    }

    let data_len = reader.read_i32()?.max(0) as usize;
    let raw = reader.read_bytes(data_len)?;
    let expected = width
        .checked_mul(height)
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or_else(|| "Texture2D dimensions overflow".to_string())?;
    if raw.len() < expected {
        return Err(format!(
            "Texture2D data is truncated: got {}, expected {}",
            raw.len(),
            expected
        ));
    }

    let pixels = raw[..expected]
        .chunks_exact(4)
        .map(|px| Pixel {
            r: px[0],
            g: px[1],
            b: px[2],
            a: px[3],
        })
        .collect();

    Ok(Texture {
        width,
        height,
        pixels,
    })
}

fn encode_png_data_url(raw: &[u8], width: usize, height: usize) -> Result<String, String> {
    let mut png = Vec::new();
    let encoder = PngEncoder::new(&mut png);
    encoder
        .write_image(raw, width as u32, height as u32, ColorType::Rgba8.into())
        .map_err(|e| format!("Failed to encode PNG: {}", e))?;

    Ok(format!(
        "data:image/png;base64,{}",
        BASE64_STANDARD.encode(png)
    ))
}

#[derive(Debug, Clone, Default)]
struct TbinMap {
    tile_sheets: HashMap<String, TbinTileSheet>,
    layers: Vec<TbinLayer>,
}

#[derive(Debug, Clone, Default)]
struct TbinTileSheet {
    image_source: String,
    sheet_width: i32,
    tile_width: i32,
    tile_height: i32,
    margin_x: i32,
    margin_y: i32,
    spacing_x: i32,
    spacing_y: i32,
    tile_index_properties: HashMap<i32, HashMap<String, String>>,
}

#[derive(Debug, Clone)]
struct TbinLayer {
    id: String,
    visible: bool,
    width: i32,
    height: i32,
    tile_width: i32,
    tile_height: i32,
    tiles: Vec<Option<TbinTile>>,
}

#[derive(Debug, Clone)]
struct TbinTile {
    tile_sheet_id: String,
    tile_index: i32,
    properties: HashMap<String, String>,
}

impl TbinMap {
    fn layer(&self, id: &str) -> Option<&TbinLayer> {
        self.layers.iter().find(|layer| layer.id == id)
    }

    fn tile_property<'a>(
        &'a self,
        layer: &'a TbinLayer,
        x: i32,
        y: i32,
        property: &str,
    ) -> Option<&'a str> {
        let tile = layer.tile(x, y)?;
        if let Some(value) = tile.properties.get(property) {
            return Some(value);
        }
        self.tile_sheets
            .get(&tile.tile_sheet_id)
            .and_then(|tile_sheet| tile_sheet.tile_index_properties.get(&tile.tile_index))
            .and_then(|properties| properties.get(property))
            .map(String::as_str)
    }
}

impl TbinLayer {
    fn tile(&self, x: i32, y: i32) -> Option<&TbinTile> {
        if x < 0 || y < 0 || x >= self.width || y >= self.height {
            return None;
        }
        self.tiles
            .get((y * self.width + x) as usize)
            .and_then(Option::as_ref)
    }
}

struct TbinMapReader<'a> {
    data: &'a [u8],
    pos: usize,
    map: TbinMap,
}

impl<'a> TbinMapReader<'a> {
    fn new(data: &'a [u8]) -> Self {
        Self {
            data,
            pos: 0,
            map: TbinMap::default(),
        }
    }

    fn read_map(mut self) -> Result<TbinMap, String> {
        self.expect_bytes(b"tBIN10")?;
        let _id = self.read_string()?;
        let _description = self.read_string()?;
        let _properties = self.read_properties()?;
        self.read_tile_sheets()?;
        self.read_layers()?;
        Ok(self.map)
    }

    fn read_tile_sheets(&mut self) -> Result<(), String> {
        let count = self.read_i32()?.max(0);
        for _ in 0..count {
            let id = self.read_string()?;
            let _description = self.read_string()?;
            let image_source = self.read_string()?;
            let (sheet_width, sheet_height) = self.read_size()?;
            let (tile_width, tile_height) = self.read_size()?;
            let (margin_x, margin_y) = self.read_size()?;
            let (spacing_x, spacing_y) = self.read_size()?;
            let properties = self.read_properties()?;
            let tile_sheet = TbinTileSheet {
                image_source,
                sheet_width,
                tile_width,
                tile_height,
                margin_x,
                margin_y,
                spacing_x,
                spacing_y,
                tile_index_properties: parse_tile_index_properties(
                    sheet_width,
                    sheet_height,
                    properties,
                ),
            };
            self.map.tile_sheets.insert(id, tile_sheet);
        }
        Ok(())
    }

    fn read_layers(&mut self) -> Result<(), String> {
        let count = self.read_i32()?.max(0);
        for _ in 0..count {
            self.read_layer()?;
        }
        Ok(())
    }

    fn read_layer(&mut self) -> Result<(), String> {
        let id = self.read_string()?;
        let visible = self.read_bool()?;
        let _description = self.read_string()?;
        let (width, height) = self.read_size()?;
        let (tile_width, tile_height) = self.read_size()?;
        let _properties = self.read_properties()?;
        let mut layer = TbinLayer {
            id,
            visible,
            width,
            height,
            tile_width,
            tile_height,
            tiles: vec![None; (width.max(0) * height.max(0)) as usize],
        };
        let mut y = 0;
        let mut tile_sheet_id = String::new();

        while y < height {
            let mut x = 0;
            while x < width {
                match self.read_u8()? as char {
                    'T' => {
                        tile_sheet_id = self.read_string()?;
                    }
                    'N' => {
                        x += self.read_i32()?.max(0);
                    }
                    'S' => {
                        let tile = self.read_static_tile(tile_sheet_id.clone())?;
                        let index = (y * width + x) as usize;
                        if let Some(slot) = layer.tiles.get_mut(index) {
                            *slot = Some(tile);
                        }
                        x += 1;
                    }
                    'A' => {
                        let tile = self.read_animated_tile(tile_sheet_id.clone())?;
                        let index = (y * width + x) as usize;
                        if let Some(slot) = layer.tiles.get_mut(index) {
                            *slot = Some(tile);
                        }
                        x += 1;
                    }
                    value => {
                        return Err(format!("Unexpected tBIN layer token '{}'", value));
                    }
                }
            }
            y += 1;
        }

        self.map.layers.push(layer);
        Ok(())
    }

    fn read_static_tile(&mut self, tile_sheet_id: String) -> Result<TbinTile, String> {
        let tile_index = self.read_i32()?;
        let _blend_mode = self.read_u8()?;
        let properties = self.read_properties()?;
        Ok(TbinTile {
            tile_sheet_id,
            tile_index,
            properties,
        })
    }

    fn read_animated_tile(&mut self, current_tile_sheet_id: String) -> Result<TbinTile, String> {
        let _frame_interval = self.read_i32()?;
        let frame_count = self.read_i32()?.max(0);
        let mut tile_sheet_id = current_tile_sheet_id;
        let mut first_tile: Option<TbinTile> = None;

        for _ in 0..frame_count {
            loop {
                match self.read_u8()? as char {
                    'T' => {
                        tile_sheet_id = self.read_string()?;
                    }
                    'S' => {
                        let tile = self.read_static_tile(tile_sheet_id.clone())?;
                        if first_tile.is_none() {
                            first_tile = Some(tile);
                        }
                        break;
                    }
                    value => {
                        return Err(format!("Unexpected tBIN animated tile token '{}'", value));
                    }
                }
            }
        }

        let animation_properties = self.read_properties()?;
        let mut tile = first_tile.ok_or_else(|| "Animated tile has no frames".to_string())?;
        tile.properties.extend(animation_properties);
        Ok(tile)
    }

    fn read_properties(&mut self) -> Result<HashMap<String, String>, String> {
        let count = self.read_i32()?.max(0);
        let mut properties = HashMap::with_capacity(count as usize);
        for _ in 0..count {
            let key = self.read_string()?;
            let value_type = self.read_u8()?;
            let value = match value_type {
                0 => self.read_bool()?.to_string(),
                1 => self.read_i32()?.to_string(),
                2 => self.read_f32()?.to_string(),
                3 => self.read_string()?,
                _ => return Err(format!("Unsupported tBIN property type {}", value_type)),
            };
            properties.insert(key, value);
        }
        Ok(properties)
    }

    fn read_size(&mut self) -> Result<(i32, i32), String> {
        Ok((self.read_i32()?, self.read_i32()?))
    }

    fn expect_bytes(&mut self, expected: &[u8]) -> Result<(), String> {
        let actual = self.read_bytes(expected.len())?;
        if actual == expected {
            Ok(())
        } else {
            Err("Invalid tBIN header".to_string())
        }
    }

    fn read_i32(&mut self) -> Result<i32, String> {
        let bytes = self.read_array::<4>()?;
        Ok(i32::from_le_bytes(bytes))
    }

    fn read_f32(&mut self) -> Result<f32, String> {
        let bytes = self.read_array::<4>()?;
        Ok(f32::from_le_bytes(bytes))
    }

    fn read_bool(&mut self) -> Result<bool, String> {
        Ok(self.read_u8()? > 0)
    }

    fn read_string(&mut self) -> Result<String, String> {
        let len = self.read_i32()?.max(0) as usize;
        let bytes = self.read_bytes(len)?;
        String::from_utf8(bytes.to_vec()).map_err(|e| format!("Invalid tBIN UTF-8 string: {}", e))
    }

    fn read_u8(&mut self) -> Result<u8, String> {
        let bytes = self.read_bytes(1)?;
        Ok(bytes[0])
    }

    fn read_array<const N: usize>(&mut self) -> Result<[u8; N], String> {
        let bytes = self.read_bytes(N)?;
        let mut out = [0u8; N];
        out.copy_from_slice(bytes);
        Ok(out)
    }

    fn read_bytes(&mut self, len: usize) -> Result<&'a [u8], String> {
        if self.pos + len > self.data.len() {
            return Err(format!(
                "Unexpected end of tBIN payload at byte {}, wanted {} more bytes",
                self.pos, len
            ));
        }
        let start = self.pos;
        self.pos += len;
        Ok(&self.data[start..self.pos])
    }
}

fn parse_tile_index_properties(
    sheet_width: i32,
    sheet_height: i32,
    properties: HashMap<String, String>,
) -> HashMap<i32, HashMap<String, String>> {
    let mut by_index: HashMap<i32, HashMap<String, String>> = HashMap::new();
    let tile_count = sheet_width.saturating_mul(sheet_height);

    for (key, value) in properties {
        let Some((index, property_name)) = parse_tile_index_property_key(&key, tile_count) else {
            continue;
        };
        by_index
            .entry(index)
            .or_default()
            .insert(property_name, value);
    }

    by_index
}

fn parse_tile_index_property_key(key: &str, tile_count: i32) -> Option<(i32, String)> {
    if let Some(rest) = key.strip_prefix("@TileIndex@") {
        let (index_text, property_name) = rest.split_once('@')?;
        let index = index_text.parse::<i32>().ok()?;
        if index < 0 || index >= tile_count || property_name.is_empty() {
            return None;
        }
        return Some((index, property_name.to_string()));
    }

    let (index_text, property_name) = key
        .split_once('@')
        .or_else(|| key.split_once(':'))
        .or_else(|| key.split_once('|'))?;
    let index = index_text.parse::<i32>().ok()?;
    if index < 0 || index >= tile_count || property_name.is_empty() {
        return None;
    }
    Some((index, property_name.to_string()))
}

fn require_reader(
    type_readers: &[String],
    one_based_index: usize,
    expected: &str,
) -> Result<(), String> {
    let Some(reader_name) = type_readers.get(one_based_index.saturating_sub(1)) else {
        return Err(format!(
            "XNB type reader index {} is out of range",
            one_based_index
        ));
    };
    if !reader_name.contains(expected) {
        return Err(format!(
            "Unexpected root XNB reader '{}', expected {}",
            reader_name, expected
        ));
    }
    Ok(())
}

fn load_xnb_payload(path: &Path) -> Result<Vec<u8>, String> {
    let data = fs::read(path).map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
    if data.len() < XNB_HEADER_UNCOMPRESSED_LEN || &data[0..3] != b"XNB" {
        return Err(format!("{} is not a valid XNB file", path.display()));
    }
    if data[4] != 5 {
        return Err(format!(
            "{} uses unsupported XNB version {}",
            path.display(),
            data[4]
        ));
    }

    let flags = data[5];
    if flags & XNB_FLAG_COMPRESSED_LZX != 0 {
        if data.len() < XNB_HEADER_COMPRESSED_LEN {
            return Err(format!("{} has a truncated XNB header", path.display()));
        }
        let expected_size = read_u32_le(&data, 10)? as usize;
        decompress_xnb_lzx(&data[XNB_HEADER_COMPRESSED_LEN..], expected_size)
            .map_err(|e| format!("Failed to decompress {}: {}", path.display(), e))
    } else {
        Ok(data[XNB_HEADER_UNCOMPRESSED_LEN..].to_vec())
    }
}

fn decompress_xnb_lzx(data: &[u8], expected_size: usize) -> Result<Vec<u8>, String> {
    let mut last_error = None;
    for window_size in [
        WindowSize::KB64,
        WindowSize::KB32,
        WindowSize::KB128,
        WindowSize::KB256,
        WindowSize::KB512,
        WindowSize::MB1,
    ] {
        match decompress_xnb_lzx_with_window(data, expected_size, window_size) {
            Ok(bytes) => return Ok(bytes),
            Err(error) => last_error = Some(error),
        }
    }

    Err(last_error.unwrap_or_else(|| "Unknown LZX decompression error".to_string()))
}

fn decompress_xnb_lzx_with_window(
    data: &[u8],
    expected_size: usize,
    window_size: WindowSize,
) -> Result<Vec<u8>, String> {
    let mut decoder = Lzxd::new(window_size);
    let mut output = Vec::with_capacity(expected_size);
    let mut pos = 0;

    while output.len() < expected_size {
        if pos + 2 > data.len() {
            return Err("Unexpected end of LZX chunk table".to_string());
        }

        let first = data[pos];
        let second = data[pos + 1];
        pos += 2;

        let (frame_size, block_size) = if first == 0xFF {
            if pos + 3 > data.len() {
                return Err("Unexpected end of extended LZX chunk header".to_string());
            }
            let frame_size = ((second as usize) << 8) | data[pos] as usize;
            let block_size = ((data[pos + 1] as usize) << 8) | data[pos + 2] as usize;
            pos += 3;
            (frame_size, block_size)
        } else {
            let block_size = ((first as usize) << 8) | second as usize;
            let frame_size = (expected_size - output.len()).min(XNB_CHUNK_SIZE);
            (frame_size, block_size)
        };

        if block_size == 0 || frame_size == 0 {
            return Err("Invalid zero-length LZX chunk".to_string());
        }
        if pos + block_size > data.len() {
            return Err("LZX chunk points past end of stream".to_string());
        }

        let decoded = decoder
            .decompress_next(&data[pos..pos + block_size], frame_size)
            .map_err(|e| e.to_string())?;
        output.extend_from_slice(decoded);
        pos += block_size;
    }

    output.truncate(expected_size);
    Ok(output)
}

struct XnbPayloadReader<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> XnbPayloadReader<'a> {
    fn new(data: &'a [u8]) -> Self {
        Self { data, pos: 0 }
    }

    fn read_type_readers(&mut self) -> Result<Vec<String>, String> {
        let reader_count = self.read_7bit_usize()?;
        let mut readers = Vec::with_capacity(reader_count);
        for _ in 0..reader_count {
            readers.push(self.read_string()?);
            let _version = self.read_i32()?;
        }
        let _shared_resource_count = self.read_7bit_usize()?;
        Ok(readers)
    }

    fn read_crop_data(&mut self) -> Result<RawCropData, String> {
        let seasons = self.read_object_i32_list()?;
        let days_in_phase = self.read_object_i32_list()?;
        let regrow_days = self.read_i32()?;
        let _is_raised = self.read_bool()?;
        let _is_paddy_crop = self.read_bool()?;
        let needs_watering = self.read_bool()?;
        self.skip_nullable_plantable_rules()?;
        let harvest_item_id = self.read_object_string_any()?;
        let _harvest_min_stack = self.read_i32()?;
        let _harvest_max_stack = self.read_i32()?;
        let _harvest_max_increase_per_farming_level = self.read_f32()?;
        let _extra_harvest_chance = self.read_f64()?;
        let _harvest_method = self.read_i32()?;
        let _harvest_min_quality = self.read_i32()?;
        self.skip_nullable_i32()?;
        self.skip_nullable_string_list()?;
        let _texture = self.read_object_string_any()?;
        let _sprite_index = self.read_i32()?;
        let _count_for_monoculture = self.read_bool()?;
        let _count_for_polyculture = self.read_bool()?;
        self.skip_nullable_string_dictionary()?;

        Ok(RawCropData {
            seasons,
            days_in_phase,
            regrow_days,
            needs_watering,
            harvest_item_id,
        })
    }

    fn read_object_data(&mut self) -> Result<RawObjectData, String> {
        let name = self.read_object_string_any()?;
        let display_name = self.read_object_string_any()?;
        let _description = self.read_object_string_any()?;
        let _object_type = self.read_object_string_any()?;
        let _category = self.read_i32()?;
        let price = self.read_i32()?;
        let texture = self.read_object_string_any()?;
        let sprite_index = self.read_i32()?;
        let _color_overlay_from_next_index = self.read_bool()?;
        let _edibility = self.read_i32()?;
        let _is_drink = self.read_bool()?;
        self.skip_nullable_object_buffs()?;
        let _geode_drops_default_items = self.read_bool()?;
        self.skip_nullable_geode_drops()?;
        self.skip_nullable_artifact_spot_chances()?;
        let _can_be_given_as_gift = self.read_bool()?;
        let _can_be_trashed = self.read_bool()?;
        let _exclude_from_fishing_collection = self.read_bool()?;
        let _exclude_from_shipping_collection = self.read_bool()?;
        let _exclude_from_random_sale = self.read_bool()?;
        self.skip_nullable_string_list()?;
        self.skip_nullable_string_dictionary()?;

        Ok(RawObjectData {
            name,
            display_name,
            price,
            texture,
            sprite_index,
        })
    }

    fn read_object_i32_list(&mut self) -> Result<Vec<i32>, String> {
        if self.read_7bit_usize()? == 0 {
            return Ok(Vec::new());
        }
        self.read_i32_list()
    }

    fn read_i32_list(&mut self) -> Result<Vec<i32>, String> {
        let count = self.read_i32()?.max(0) as usize;
        let mut values = Vec::with_capacity(count);
        for _ in 0..count {
            values.push(self.read_i32()?);
        }
        Ok(values)
    }

    fn skip_string_list(&mut self) -> Result<(), String> {
        let count = self.read_i32()?.max(0) as usize;
        for _ in 0..count {
            let _ = self.read_object_string_any()?;
        }
        Ok(())
    }

    fn skip_nullable_string_list(&mut self) -> Result<(), String> {
        if self.read_7bit_usize()? == 0 {
            return Ok(());
        }
        self.skip_string_list()
    }

    fn skip_nullable_string_dictionary(&mut self) -> Result<(), String> {
        if self.read_7bit_usize()? == 0 {
            return Ok(());
        }
        let count = self.read_i32()?.max(0) as usize;
        for _ in 0..count {
            let _ = self.read_object_string_any()?;
            let _ = self.read_object_string_any()?;
        }
        Ok(())
    }

    fn skip_nullable_i32(&mut self) -> Result<(), String> {
        if self.read_bool()? {
            let _ = self.read_i32()?;
        }
        Ok(())
    }

    fn skip_nullable_plantable_rules(&mut self) -> Result<(), String> {
        if self.read_7bit_usize()? == 0 {
            return Ok(());
        }
        let count = self.read_i32()?.max(0) as usize;
        for _ in 0..count {
            if self.read_7bit_usize()? == 0 {
                continue;
            }
            let _id = self.read_object_string_any()?;
            let _condition = self.read_object_string_any()?;
            let _planted_in = self.read_i32()?;
            let _result = self.read_i32()?;
            let _denied_message = self.read_object_string_any()?;
        }
        Ok(())
    }

    fn skip_nullable_object_buffs(&mut self) -> Result<(), String> {
        if self.read_7bit_usize()? == 0 {
            return Ok(());
        }
        let count = self.read_i32()?.max(0) as usize;
        for _ in 0..count {
            if self.read_7bit_usize()? == 0 {
                continue;
            }
            let _id = self.read_object_string_any()?;
            let _buff_id = self.read_object_string_any()?;
            let _icon_texture = self.read_object_string_any()?;
            let _icon_sprite_index = self.read_i32()?;
            let _duration = self.read_i32()?;
            let _is_debuff = self.read_bool()?;
            let _glow_color = self.read_object_string_any()?;
            self.skip_nullable_buff_attributes()?;
            self.skip_nullable_string_dictionary()?;
        }
        Ok(())
    }

    fn skip_nullable_buff_attributes(&mut self) -> Result<(), String> {
        if self.read_7bit_usize()? == 0 {
            return Ok(());
        }
        for _ in 0..18 {
            let _attribute = self.read_f32()?;
        }
        Ok(())
    }

    fn skip_nullable_quantity_modifier_list(&mut self) -> Result<(), String> {
        if self.read_7bit_usize()? == 0 {
            return Ok(());
        }
        let count = self.read_i32()?.max(0) as usize;
        for _ in 0..count {
            if self.read_7bit_usize()? == 0 {
                continue;
            }
            let _id = self.read_object_string_any()?;
            let _condition = self.read_object_string_any()?;
            let _modification = self.read_i32()?;
            let _amount = self.read_f32()?;
            self.skip_nullable_f32_list()?;
        }
        Ok(())
    }

    fn skip_nullable_f32_list(&mut self) -> Result<(), String> {
        if self.read_7bit_usize()? == 0 {
            return Ok(());
        }
        let count = self.read_i32()?.max(0) as usize;
        for _ in 0..count {
            let _amount = self.read_f32()?;
        }
        Ok(())
    }

    fn skip_generic_spawn_item_data(&mut self) -> Result<(), String> {
        let _id = self.read_object_string_any()?;
        let _item_id = self.read_object_string_any()?;
        self.skip_nullable_string_list()?;
        self.skip_nullable_i32()?;
        let _min_stack = self.read_i32()?;
        let _max_stack = self.read_i32()?;
        let _quality = self.read_i32()?;
        let _object_internal_name = self.read_object_string_any()?;
        let _object_display_name = self.read_object_string_any()?;
        let _object_color = self.read_object_string_any()?;
        let _tool_upgrade_level = self.read_i32()?;
        let _is_recipe = self.read_bool()?;
        self.skip_nullable_quantity_modifier_list()?;
        let _stack_modifier_mode = self.read_i32()?;
        self.skip_nullable_quantity_modifier_list()?;
        let _quality_modifier_mode = self.read_i32()?;
        self.skip_nullable_string_dictionary()?;
        let _per_item_condition = self.read_object_string_any()?;
        Ok(())
    }

    fn skip_nullable_geode_drops(&mut self) -> Result<(), String> {
        if self.read_7bit_usize()? == 0 {
            return Ok(());
        }
        let count = self.read_i32()?.max(0) as usize;
        for _ in 0..count {
            if self.read_7bit_usize()? == 0 {
                continue;
            }
            self.skip_generic_spawn_item_data()?;
            let _condition = self.read_object_string_any()?;
            let _chance = self.read_f64()?;
            let _set_flag_on_pickup = self.read_object_string_any()?;
            let _precedence = self.read_i32()?;
        }
        Ok(())
    }

    fn skip_nullable_artifact_spot_chances(&mut self) -> Result<(), String> {
        if self.read_7bit_usize()? == 0 {
            return Ok(());
        }
        let count = self.read_i32()?.max(0) as usize;
        for _ in 0..count {
            let _location = self.read_object_string_any()?;
            let _chance = self.read_f32()?;
        }
        Ok(())
    }

    fn read_i32(&mut self) -> Result<i32, String> {
        let bytes = self.read_array::<4>()?;
        Ok(i32::from_le_bytes(bytes))
    }

    fn read_f32(&mut self) -> Result<f32, String> {
        let bytes = self.read_array::<4>()?;
        Ok(f32::from_le_bytes(bytes))
    }

    fn read_f64(&mut self) -> Result<f64, String> {
        let bytes = self.read_array::<8>()?;
        Ok(f64::from_le_bytes(bytes))
    }

    fn read_bool(&mut self) -> Result<bool, String> {
        match self.read_u8()? {
            0 => Ok(false),
            1 => Ok(true),
            value => Err(format!("Invalid bool byte {}", value)),
        }
    }

    fn read_7bit_usize(&mut self) -> Result<usize, String> {
        let mut count = 0usize;
        let mut shift = 0;

        loop {
            if shift >= 35 {
                return Err("Invalid 7-bit encoded integer".to_string());
            }
            let byte = self.read_u8()?;
            count |= ((byte & 0x7F) as usize) << shift;
            if byte & 0x80 == 0 {
                return Ok(count);
            }
            shift += 7;
        }
    }

    fn read_string(&mut self) -> Result<String, String> {
        let len = self.read_7bit_usize()?;
        if len == 0 {
            return Ok(String::new());
        }
        let bytes = self.read_bytes(len)?;
        String::from_utf8(bytes.to_vec()).map_err(|e| format!("Invalid UTF-8 string: {}", e))
    }

    fn read_object_string(&mut self, type_readers: &[String]) -> Result<String, String> {
        let reader_index = self.read_7bit_usize()?;
        if reader_index == 0 {
            return Ok(String::new());
        }
        require_reader(type_readers, reader_index, "StringReader")?;
        self.read_string()
    }

    fn read_object_string_any(&mut self) -> Result<String, String> {
        if self.read_7bit_usize()? == 0 {
            return Ok(String::new());
        }
        self.read_string()
    }

    fn read_bytes(&mut self, len: usize) -> Result<&'a [u8], String> {
        if self.pos + len > self.data.len() {
            return Err(format!(
                "Unexpected end of XNB payload at byte {}, wanted {} more bytes",
                self.pos, len
            ));
        }
        let start = self.pos;
        self.pos += len;
        Ok(&self.data[start..self.pos])
    }

    fn read_u8(&mut self) -> Result<u8, String> {
        let bytes = self.read_bytes(1)?;
        Ok(bytes[0])
    }

    fn read_array<const N: usize>(&mut self) -> Result<[u8; N], String> {
        let bytes = self.read_bytes(N)?;
        let mut out = [0u8; N];
        out.copy_from_slice(bytes);
        Ok(out)
    }
}

fn read_u32_le(data: &[u8], offset: usize) -> Result<u32, String> {
    if offset + 4 > data.len() {
        return Err("Unexpected end of XNB header".to_string());
    }
    Ok(u32::from_le_bytes([
        data[offset],
        data[offset + 1],
        data[offset + 2],
        data[offset + 3],
    ]))
}

fn resolve_display_name(token: &str, object_strings: &HashMap<String, String>) -> Option<String> {
    if let Some(key) = token
        .strip_prefix("[LocalizedText Strings\\Objects:")
        .and_then(|value| value.strip_suffix(']'))
    {
        return object_strings.get(key).cloned();
    }
    if token.trim().is_empty() {
        None
    } else {
        Some(token.to_string())
    }
}

fn season_name(season: i32) -> &'static str {
    match season {
        0 => "春季",
        1 => "夏季",
        2 => "秋季",
        3 => "冬季",
        _ => "未知",
    }
}

fn compact_season_label(seasons: &[i32]) -> String {
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

fn season_sort_key(seasons: &[String]) -> Vec<i32> {
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

fn derive_season_filters() -> Vec<String> {
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

#[cfg(test)]
mod tests {
    use super::*;

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
        let crops = load_crops_xnb(&content.join("Data").join("Crops.xnb")).unwrap();
        let objects = load_objects_xnb(&content.join("Data").join("Objects.xnb")).unwrap();
        assert!(crops.contains_key("472"));
        assert_eq!(crops["472"].harvest_item_id, "24");
        assert_eq!(objects["24"].price, 35);
        let mut texture_cache = HashMap::new();
        let icon = render_object_icon(&content, &objects["24"], &mut texture_cache).unwrap();
        assert!(icon.starts_with("data:image/png;base64,"));
    }

    #[test]
    fn debug_crop_xnb_shape() {
        let Some(content) = dev_content_dir() else {
            return;
        };
        let payload = load_xnb_payload(&content.join("Data").join("Crops.xnb")).unwrap();
        let mut reader = XnbPayloadReader::new(&payload);
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
        let beach = parse_fishing_map(&content, &content.join("Maps").join("Beach.xnb"))
            .unwrap()
            .unwrap();
        assert_eq!(beach.id, "Beach");
        assert!(beach.width > 0);
        assert!(beach.height > 0);
        assert!(beach.fishable_tiles > 0);
        assert!(beach.max_depth > 0);
    }
}
