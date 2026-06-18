use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::UNIX_EPOCH;
use tokio::task;

use super::calendar::resolve_localized_text;
use super::image_utils::render_object_icon;
use super::map_names::map_display_name;
use super::tbin::{load_tbin_map_from_xnb, render_tbin_map_preview};
use super::xnb::{
    load_localized_string_tables_with_lang, load_location_fishing_xnb, load_objects_xnb,
    load_string_dictionary_xnb, RawLocationFishingData,
};

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
pub struct FishingAreaFish {
    pub id: String,
    pub name: String,
    pub description: String,
    pub icon: Option<String>,
    pub seasons: Vec<String>,
    pub time_ranges: Vec<(i32, i32)>,
    pub weather: String,
    pub min_level: i32,
    pub is_trap: bool,
    pub price: i32,
    pub price_source: String,
    pub min_distance_from_shore: i32,
    pub max_distance_from_shore: i32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FishingArea {
    pub id: String,
    pub name: String,
    pub x: Option<i32>,
    pub y: Option<i32>,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub fish: Vec<FishingAreaFish>,
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
    pub fishing_areas: Vec<FishingArea>,
    pub map_image_data_url: Option<String>,
    pub map_image_error: Option<String>,
    pub cached: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FishingMapCacheFingerprint {
    pub file_count: u64,
    pub total_size: u64,
    pub latest_modified_ms: u128,
}

#[derive(Debug, Clone)]
pub struct CachedFishingMaps {
    pub fingerprint: FishingMapCacheFingerprint,
    pub maps: Vec<FishingMapDetail>,
}

#[derive(Debug, Clone, Default)]
pub struct CachedFishingMapPreview {
    pub data_url: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone)]
pub struct CachedFishingMapPreviews {
    pub fingerprint: FishingMapCacheFingerprint,
    pub previews: HashMap<String, CachedFishingMapPreview>,
}

static FISHING_MAP_CACHE: OnceLock<Mutex<HashMap<String, Arc<CachedFishingMaps>>>> =
    OnceLock::new();
static FISHING_MAP_PREVIEW_CACHE: OnceLock<Mutex<HashMap<String, CachedFishingMapPreviews>>> =
    OnceLock::new();

#[tauri::command]
pub async fn get_fishing_map_data(
    game_dir: Option<String>,
    force_refresh: Option<bool>,
    lang: Option<String>,
) -> Result<FishingMapData, String> {
    task::spawn_blocking(move || get_fishing_map_data_sync(game_dir, force_refresh, lang))
        .await
        .map_err(|err| format!("钓鱼地图解析任务失败: {}", err))?
}

#[tauri::command]
pub async fn get_fishing_map_detail(
    game_dir: Option<String>,
    map_id: String,
    force_refresh: Option<bool>,
    lang: Option<String>,
) -> Result<FishingMapDetail, String> {
    task::spawn_blocking(move || get_fishing_map_detail_sync(game_dir, map_id, force_refresh, lang))
        .await
        .map_err(|err| format!("钓鱼地图详情任务失败: {}", err))?
}

fn get_fishing_map_data_sync(
    game_dir: Option<String>,
    force_refresh: Option<bool>,
    _lang: Option<String>,
) -> Result<FishingMapData, String> {
    let content_dir = super::locate_content_dir(game_dir.as_deref())?;
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
    lang: Option<String>,
) -> Result<FishingMapDetail, String> {
    let content_dir = super::locate_content_dir(game_dir.as_deref())?;
    let cache_key = content_cache_key(&content_dir);
    let (cache, cached) =
        get_or_build_fishing_map_cache(&content_dir, force_refresh.unwrap_or(false))?;
    let mut detail = cache
        .maps
        .iter()
        .find(|map| map.id == map_id)
        .cloned()
        .ok_or_else(|| format!("未找到地图 {}", map_id))?;
    detail.fishing_areas = load_fishing_areas_for_map(&content_dir, &detail.id, lang.as_deref())?;
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

pub fn get_or_build_fishing_map_cache(
    content_dir: &Path,
    force_refresh: bool,
) -> Result<(Arc<CachedFishingMaps>, bool), String> {
    let maps_dir = content_dir.join("Maps");
    let paths = super::collect_xnb_files(&maps_dir)?;
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

pub fn content_cache_key(content_dir: &Path) -> String {
    content_dir
        .canonicalize()
        .unwrap_or_else(|_| content_dir.to_path_buf())
        .to_string_lossy()
        .to_string()
}

pub fn get_or_render_fishing_map_preview(
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

pub fn fingerprint_fishing_map_files(
    paths: &[PathBuf],
) -> Result<FishingMapCacheFingerprint, String> {
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

pub fn parse_fishing_map(
    content_dir: &Path,
    path: &Path,
) -> Result<Option<FishingMapDetail>, String> {
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
    let file_stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("Unknown");
    let name = map_display_name(&id)
        .or_else(|| map_display_name(file_stem))
        .map(str::to_string)
        .unwrap_or_else(|| file_stem.replace('_', " "));

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
        fishing_areas: Vec::new(),
        map_image_data_url: None,
        map_image_error: None,
        cached: false,
    }))
}

pub fn parse_fish_conditions(raw_str: &str) -> (Vec<String>, Vec<(i32, i32)>, String, i32, bool) {
    let parts: Vec<&str> = raw_str.split('/').collect();
    if parts.len() < 5 {
        return (Vec::new(), Vec::new(), "both".to_string(), 0, false);
    }

    let is_trap = parts.get(1).map(|&s| s.trim() == "trap").unwrap_or(false);
    if is_trap {
        return (
            vec![
                "spring".to_string(),
                "summer".to_string(),
                "fall".to_string(),
                "winter".to_string(),
            ],
            vec![(600, 2600)],
            "both".to_string(),
            0,
            true,
        );
    }

    let mut time_ranges = Vec::new();
    if let Some(&raw_times) = parts.get(5) {
        let times: Vec<&str> = raw_times.split_whitespace().collect();
        for chunk in times.chunks_exact(2) {
            if let (Ok(start), Ok(end)) = (chunk[0].parse::<i32>(), chunk[1].parse::<i32>()) {
                time_ranges.push((start, end));
            }
        }
    }
    if time_ranges.is_empty() {
        time_ranges.push((600, 2600));
    }

    let mut seasons = Vec::new();
    if let Some(&raw_seasons) = parts.get(6) {
        for s in raw_seasons.split_whitespace() {
            seasons.push(s.to_string());
        }
    }
    if seasons.is_empty() {
        seasons = vec![
            "spring".to_string(),
            "summer".to_string(),
            "fall".to_string(),
            "winter".to_string(),
        ];
    }

    let weather = parts
        .get(7)
        .map(|&w| w.trim().to_string())
        .unwrap_or_else(|| "both".to_string());

    let min_level = parts
        .get(12)
        .and_then(|s| s.trim().parse::<i32>().ok())
        .unwrap_or(0);

    (seasons, time_ranges, weather, min_level, false)
}

fn load_fishing_areas_for_map(
    content_dir: &Path,
    map_id: &str,
    lang: Option<&str>,
) -> Result<Vec<FishingArea>, String> {
    let location_data = load_location_fishing_xnb(&content_dir.join("Data").join("Locations.xnb"))?;
    let fish_data = load_string_dictionary_xnb(&content_dir.join("Data").join("Fish.xnb"))?;
    let objects = load_objects_xnb(&content_dir.join("Data").join("Objects.xnb"))?;
    let localized_tables = load_localized_string_tables_with_lang(
        content_dir,
        &["Objects", "1_6_Strings", "StringsFromCSFiles"],
        lang,
    );
    let mut texture_cache = HashMap::new();

    // Try to load mod prices (from SMAPI mod runtime snapshot)
    let mod_prices = super::item_prices::read_realtime_item_prices();

    let Some(location_key) = resolve_location_key(map_id, &location_data) else {
        return Ok(Vec::new());
    };
    let Some(location) = location_data.get(location_key.as_str()) else {
        return Ok(Vec::new());
    };

    let mut explicit_areas = location
        .fish_areas
        .iter()
        .map(|(id, area)| {
            let (x, y, width, height) = area
                .position
                .map(|(x, y, width, height)| (Some(x), Some(y), Some(width), Some(height)))
                .unwrap_or((None, None, None, None));
            let resolved_name = resolve_localized_text(&area.display_name, &localized_tables);
            (
                id.clone(),
                FishingArea {
                    id: id.clone(),
                    name: if resolved_name.trim().is_empty() {
                        id.clone()
                    } else {
                        resolved_name
                    },
                    x,
                    y,
                    width,
                    height,
                    fish: Vec::new(),
                },
            )
        })
        .collect::<HashMap<_, _>>();

    let has_global_fish = location
        .fish
        .iter()
        .any(|entry| entry.fish_area_id.trim().is_empty());
    if has_global_fish && explicit_areas.is_empty() {
        explicit_areas.insert(
            "default".to_string(),
            FishingArea {
                id: "default".to_string(),
                name: "Default Area".to_string(),
                x: None,
                y: None,
                width: None,
                height: None,
                fish: Vec::new(),
            },
        );
    }

    for fish_entry in &location.fish {
        let target_ids = if fish_entry.fish_area_id.trim().is_empty() {
            explicit_areas.keys().cloned().collect::<Vec<_>>()
        } else {
            vec![fish_entry.fish_area_id.clone()]
        };
        for target_id in target_ids {
            let Some(area) = explicit_areas.get_mut(&target_id) else {
                continue;
            };
            for item_id in &fish_entry.item_ids {
                let Some(object_id) = normalize_object_item_id(item_id) else {
                    continue;
                };
                if !fish_data.contains_key(&object_id) {
                    continue;
                }
                let Some(object) = objects.get(&object_id) else {
                    continue;
                };
                if area.fish.iter().any(|fish| fish.id == object_id) {
                    continue;
                }
                let name = resolve_localized_text(&object.display_name, &localized_tables);
                let description = resolve_localized_text(&object.description, &localized_tables);
                let (seasons, time_ranges, weather, min_level, is_trap) = fish_data
                    .get(&object_id)
                    .map(|raw_str| parse_fish_conditions(raw_str))
                    .unwrap_or_else(|| {
                        (
                            vec![
                                "spring".to_string(),
                                "summer".to_string(),
                                "fall".to_string(),
                                "winter".to_string(),
                            ],
                            vec![(600, 2600)],
                            "both".to_string(),
                            0,
                            false,
                        )
                    });

                // Use mod price if available, otherwise fall back to XNB price
                let (price, price_source) = mod_prices
                    .as_ref()
                    .and_then(|mp| mp.get(&object_id).map(|&p| (p, "mod")))
                    .unwrap_or((object.price, "xnb"));

                area.fish.push(FishingAreaFish {
                    id: object_id.clone(),
                    name: if name.trim().is_empty() {
                        object.name.clone()
                    } else {
                        name
                    },
                    description: if description.trim().is_empty() {
                        "No description provided.".to_string()
                    } else {
                        description
                    },
                    icon: render_object_icon(content_dir, object, &mut texture_cache).ok(),
                    seasons,
                    time_ranges,
                    weather,
                    min_level,
                    is_trap,
                    price,
                    price_source: price_source.to_string(),
                    min_distance_from_shore: fish_entry.min_distance_from_shore,
                    max_distance_from_shore: fish_entry.max_distance_from_shore,
                });
            }
        }
    }

    let mut areas = explicit_areas.into_values().collect::<Vec<_>>();
    for area in &mut areas {
        area.fish.sort_by(|a, b| a.name.cmp(&b.name));
    }
    areas.sort_by(|a, b| {
        let a_has_pos = a.x.is_some();
        let b_has_pos = b.x.is_some();
        b_has_pos.cmp(&a_has_pos).then_with(|| a.name.cmp(&b.name))
    });
    Ok(areas)
}

fn normalize_object_item_id(item_id: &str) -> Option<String> {
    let trimmed = item_id.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Some(id) = trimmed.strip_prefix("(O)") {
        return Some(id.to_string());
    }
    if trimmed.chars().all(|ch| ch.is_ascii_digit()) {
        return Some(trimmed.to_string());
    }
    None
}

fn resolve_location_key(
    map_id: &str,
    location_data: &HashMap<String, RawLocationFishingData>,
) -> Option<String> {
    let candidates = [
        map_id.to_string(),
        map_id.split('-').next().unwrap_or(map_id).to_string(),
        map_id
            .strip_prefix("Island_SE")
            .map(|_| "IslandSouthEast".to_string())
            .unwrap_or_default(),
        map_id
            .strip_prefix("Island_N")
            .map(|_| "IslandNorth".to_string())
            .unwrap_or_default(),
        map_id
            .strip_prefix("Island_S")
            .map(|_| "IslandSouth".to_string())
            .unwrap_or_default(),
        map_id
            .strip_prefix("Island_W")
            .map(|_| "IslandWest".to_string())
            .unwrap_or_default(),
        map_id
            .strip_prefix("Island_E")
            .map(|_| "IslandEast".to_string())
            .unwrap_or_default(),
        if map_id.starts_with("Farm_") {
            "Farm".to_string()
        } else {
            String::new()
        },
    ];

    candidates
        .into_iter()
        .find(|candidate| !candidate.is_empty() && location_data.contains_key(candidate))
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
