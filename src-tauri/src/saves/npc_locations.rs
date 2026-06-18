use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tokio::task;

use super::parser::{parse_weather, SaveSummary};
use super::xml_utils::extract_tag_i32;
use crate::game_data::live_state::LiveGameState;
use crate::game_data::map_names::map_display_name;
use crate::game_data::xnb::load_string_dictionary_xnb;

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NpcLocationInfo {
    pub npc_name: String,
    pub location: String,
    pub location_display_name: String,
    pub tile_x: Option<i32>,
    pub tile_y: Option<i32>,
    pub direction: Option<i32>,
    pub schedule_key: Option<String>,
    pub schedule_time: Option<i32>,
    pub source: String,
    pub confidence: String,
    pub updated_at: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NpcSchedulePoint {
    pub time: i32,
    pub location: String,
    pub location_display_name: String,
    pub tile_x: i32,
    pub tile_y: i32,
    pub direction: i32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NpcLocationsResult {
    pub source: String,
    pub save_id: Option<String>,
    pub game_time: Option<i32>,
    pub locations: Vec<NpcLocationInfo>,
    pub error: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RealtimeSnapshot {
    save_id: Option<String>,
    game_time: Option<i32>,
    generated_at: Option<String>,
    npcs: Vec<RealtimeNpcLocation>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RealtimeNpcLocation {
    npc_name: String,
    location: String,
    tile_x: i32,
    tile_y: i32,
    direction: i32,
}

#[tauri::command]
pub async fn get_npc_locations(
    live_state: tauri::State<'_, LiveGameState>,
    save_id: Option<String>,
    game_dir: Option<String>,
    source: Option<String>,
    season: Option<i32>,
    day: Option<i32>,
    time: Option<i32>,
) -> Result<NpcLocationsResult, String> {
    // Try live state first (from HTTP server)
    if let Some(payload) = live_state.get_npc_locations().await {
        let locations = payload
            .npcs
            .into_iter()
            .map(|npc| NpcLocationInfo {
                npc_name: npc.npc_name,
                location_display_name: map_display_name(&npc.location)
                    .map(str::to_string)
                    .unwrap_or_else(|| npc.location.clone()),
                location: npc.location,
                tile_x: Some(npc.tile_x),
                tile_y: Some(npc.tile_y),
                direction: Some(npc.direction),
                schedule_key: None,
                schedule_time: payload.game_time,
                source: "mod".to_string(),
                confidence: "realtime".to_string(),
                updated_at: payload.generated_at.clone(),
            })
            .collect();

        return Ok(NpcLocationsResult {
            source: "mod".to_string(),
            save_id: payload.save_id.or(save_id),
            game_time: payload.game_time,
            locations,
            error: None,
        });
    }

    // Fall back to file-based or estimate
    task::spawn_blocking(move || {
        get_npc_locations_sync(save_id, game_dir, source, season, day, time)
    })
    .await
    .map_err(|e| format!("读取 NPC 位置任务失败: {}", e))?
}

#[tauri::command]
pub async fn get_npc_schedule(
    save_id: Option<String>,
    game_dir: Option<String>,
    npc_name: String,
    season: Option<i32>,
    day: Option<i32>,
) -> Result<Vec<NpcSchedulePoint>, String> {
    task::spawn_blocking(move || {
        get_npc_schedule_sync(save_id, game_dir, npc_name, season, day)
    })
    .await
    .map_err(|e| format!("读取 NPC 日程任务失败: {}", e))?
}

#[tauri::command]
pub async fn check_game_running(live_state: tauri::State<'_, LiveGameState>) -> Result<bool, String> {
    // Check live state first
    if live_state.is_game_running().await {
        return Ok(true);
    }

    // Fall back to file check
    if let Some(path) = realtime_snapshot_path() {
        if let Ok(metadata) = fs::metadata(&path) {
            if let Ok(modified) = metadata.modified() {
                if let Ok(elapsed) = std::time::SystemTime::now().duration_since(modified) {
                    return Ok(elapsed.as_secs() < 30);
                }
            }
        }
    }
    Ok(false)
}

fn get_npc_schedule_sync(
    save_id: Option<String>,
    game_dir: Option<String>,
    npc_name: String,
    season_override: Option<i32>,
    day_override: Option<i32>,
) -> Result<Vec<NpcSchedulePoint>, String> {
    let save_id = match save_id {
        Some(value) if !value.trim().is_empty() => value,
        _ => return Err("请先选择存档。".to_string()),
    };

    let save_folder = super::get_saves_dir()
        .ok_or_else(|| "无法定位星露谷用户数据目录".to_string())?
        .join(&save_id);
    let info_xml = fs::read_to_string(save_folder.join("SaveGameInfo"))
        .map_err(|e| format!("无法读取 SaveGameInfo: {}", e))?;
    let main_xml = fs::read_to_string(save_folder.join(&save_id))
        .map_err(|e| format!("无法读取主存档文件: {}", e))?;

    let mut summary = SaveSummary {
        id: save_id.clone(),
        player_name: String::new(),
        farm_name: String::new(),
        money: 0,
        total_money_earned: 0,
        day_of_month: extract_tag_i32(&info_xml, "dayOfMonthForSaveGame"),
        season: extract_tag_i32(&info_xml, "seasonForSaveGame"),
        year: extract_tag_i32(&info_xml, "yearForSaveGame"),
        farming_level: 0,
        mining_level: 0,
        combat_level: 0,
        foraging_level: 0,
        fishing_level: 0,
        deepest_mine_level: 0,
        milliseconds_played: 0,
        last_save_time: 0,
        farmer_avatar: None,
        farmer_avatar_error: None,
    };

    if let Some(season) = season_override.filter(|value| (0..=3).contains(value)) {
        summary.season = season;
    }
    if let Some(day) = day_override.filter(|value| (1..=28).contains(value)) {
        summary.day_of_month = day;
    }
    let (weather_today, _) = parse_weather(&main_xml);

    let content_dir = crate::game_data::locate_content_dir(game_dir.as_deref())?;
    let schedule_file = content_dir
        .join("Characters")
        .join("schedules")
        .join(format!("{}.xnb", npc_name));

    if !schedule_file.exists() {
        return Ok(Vec::new());
    }

    let schedule = load_string_dictionary_xnb(&schedule_file)
        .map_err(|e| format!("加载 NPC 日程失败: {}", e))?;

    let Some((_key, line)) = choose_schedule_line(&schedule, &summary, &weather_today) else {
        return Ok(Vec::new());
    };

    let mut resolved = line.trim().to_string();
    for _ in 0..4 {
        let mut parts = resolved.split_whitespace();
        if parts
            .next()
            .is_some_and(|value| value.eq_ignore_ascii_case("GOTO"))
        {
            let key = parts.next().ok_or_else(|| "GOTO 指令缺少参数".to_string())?;
            resolved = get_schedule_value(&schedule, key)
                .ok_or_else(|| format!("未找到指定的 schedule key: {}", key))?
                .to_string();
        } else {
            break;
        }
    }

    let mut points = Vec::new();
    for segment in resolved.split('/') {
        let tokens: Vec<&str> = segment.split_whitespace().collect();
        if tokens.len() < 5 {
            continue;
        }
        let Ok(time) = tokens[0].parse::<i32>() else {
            continue;
        };
        let Ok(x) = tokens[2].parse::<i32>() else {
            continue;
        };
        let Ok(y) = tokens[3].parse::<i32>() else {
            continue;
        };
        let direction = tokens[4].parse::<i32>().unwrap_or(2);
        let location = tokens[1].to_string();

        let location_display_name = map_display_name(&location)
            .map(str::to_string)
            .unwrap_or_else(|| location.clone());

        points.push(NpcSchedulePoint {
            time,
            location,
            location_display_name,
            tile_x: x,
            tile_y: y,
            direction,
        });
    }

    Ok(points)
}

fn get_npc_locations_sync(
    save_id: Option<String>,
    game_dir: Option<String>,
    source: Option<String>,
    season: Option<i32>,
    day: Option<i32>,
    time: Option<i32>,
) -> Result<NpcLocationsResult, String> {
    if source
        .as_deref()
        .is_some_and(|value| value.eq_ignore_ascii_case("mod"))
    {
        return read_realtime_locations(save_id, game_dir);
    }

    estimate_locations_from_schedule(save_id, game_dir, season, day, time)
}

fn read_realtime_locations(
    save_id: Option<String>,
    _game_dir: Option<String>,
) -> Result<NpcLocationsResult, String> {
    let path = realtime_snapshot_path()
        .ok_or_else(|| "无法定位星露谷用户数据目录，不能读取实时 NPC 位置。".to_string())?;

    if !path.exists() {
        return Err("游戏未启动，实时位置不可用。".to_string());
    }

    let metadata = fs::metadata(&path)
        .map_err(|e| format!("无法读取实时位置快照元数据: {}", e))?;
    let modified = metadata.modified()
        .map_err(|e| format!("无法获取实时位置快照修改时间: {}", e))?;
    let elapsed = std::time::SystemTime::now()
        .duration_since(modified)
        .unwrap_or_else(|_| std::time::Duration::from_secs(0));

    if elapsed.as_secs() > 30 {
        return Err("游戏未启动，实时位置不可用。".to_string());
    }

    let raw = fs::read_to_string(&path)
        .map_err(|e| format!("无法读取实时 NPC 位置快照 {}: {}", path.display(), e))?;
    let snapshot: RealtimeSnapshot =
        serde_json::from_str(&raw).map_err(|e| format!("实时 NPC 位置快照格式无效: {}", e))?;

    let game_time = snapshot.game_time;
    let generated_at = snapshot.generated_at.clone();
    let snapshot_save_id = snapshot.save_id.clone();
    let locations = snapshot
        .npcs
        .into_iter()
        .map(|npc| NpcLocationInfo {
            npc_name: npc.npc_name,
            location_display_name: map_display_name(&npc.location)
                .map(str::to_string)
                .unwrap_or_else(|| npc.location.clone()),
            location: npc.location,
            tile_x: Some(npc.tile_x),
            tile_y: Some(npc.tile_y),
            direction: Some(npc.direction),
            schedule_key: None,
            schedule_time: game_time,
            source: "mod".to_string(),
            confidence: "realtime".to_string(),
            updated_at: generated_at.clone(),
        })
        .collect();

    Ok(NpcLocationsResult {
        source: "mod".to_string(),
        save_id: snapshot_save_id.or(save_id),
        game_time,
        locations,
        error: None,
    })
}

fn estimate_locations_from_schedule(
    save_id: Option<String>,
    game_dir: Option<String>,
    season_override: Option<i32>,
    day_override: Option<i32>,
    time_override: Option<i32>,
) -> Result<NpcLocationsResult, String> {
    let save_id = match save_id {
        Some(value) if !value.trim().is_empty() => value,
        _ => {
            return Ok(NpcLocationsResult {
                source: "estimate".to_string(),
                save_id: None,
                game_time: None,
                locations: Vec::new(),
                error: Some("选择存档后才能根据日期和天气估算 NPC 位置。".to_string()),
            });
        }
    };

    let save_folder = super::get_saves_dir()
        .ok_or_else(|| "Could not locate APPDATA or HOME directory".to_string())?
        .join(&save_id);
    let info_xml = fs::read_to_string(save_folder.join("SaveGameInfo"))
        .map_err(|e| format!("Failed to read SaveGameInfo for {}: {}", save_id, e))?;
    let main_xml = fs::read_to_string(save_folder.join(&save_id))
        .map_err(|e| format!("Failed to read main save file {}: {}", save_id, e))?;

    let mut summary = SaveSummary {
        id: save_id.clone(),
        player_name: String::new(),
        farm_name: String::new(),
        money: 0,
        total_money_earned: 0,
        day_of_month: extract_tag_i32(&info_xml, "dayOfMonthForSaveGame"),
        season: extract_tag_i32(&info_xml, "seasonForSaveGame"),
        year: extract_tag_i32(&info_xml, "yearForSaveGame"),
        farming_level: 0,
        mining_level: 0,
        combat_level: 0,
        foraging_level: 0,
        fishing_level: 0,
        deepest_mine_level: 0,
        milliseconds_played: 0,
        last_save_time: 0,
        farmer_avatar: None,
        farmer_avatar_error: None,
    };
    if let Some(season) = season_override.filter(|value| (0..=3).contains(value)) {
        summary.season = season;
    }
    if let Some(day) = day_override.filter(|value| (1..=28).contains(value)) {
        summary.day_of_month = day;
    }
    let current_time =
        normalize_time(time_override.unwrap_or_else(|| extract_tag_i32(&main_xml, "timeOfDay")));
    let (weather_today, _) = parse_weather(&main_xml);

    let content_dir = crate::game_data::locate_content_dir(game_dir.as_deref())?;
    let schedules_dir = content_dir.join("Characters").join("schedules");
    let mut locations = Vec::new();

    for entry in fs::read_dir(&schedules_dir)
        .map_err(|e| format!("无法读取 NPC 日程目录 {}: {}", schedules_dir.display(), e))?
    {
        let entry = match entry {
            Ok(value) => value,
            Err(_) => continue,
        };
        let path = entry.path();
        if !is_xnb_file(&path) {
            continue;
        }
        let Some(npc_name) = path.file_stem().and_then(|value| value.to_str()) else {
            continue;
        };
        let schedule = match load_string_dictionary_xnb(&path) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if let Some(location) =
            estimate_npc_location(npc_name, &schedule, &summary, &weather_today, current_time)
        {
            locations.push(location);
        }
    }

    locations.sort_by(|a, b| a.npc_name.cmp(&b.npc_name));

    Ok(NpcLocationsResult {
        source: "estimate".to_string(),
        save_id: Some(save_id),
        game_time: Some(current_time),
        locations,
        error: None,
    })
}

fn estimate_npc_location(
    npc_name: &str,
    schedule: &HashMap<String, String>,
    summary: &SaveSummary,
    weather: &str,
    current_time: i32,
) -> Option<NpcLocationInfo> {
    let (key, line) = choose_schedule_line(schedule, summary, weather)?;
    let (time, location, x, y, direction) =
        parse_schedule_destination(schedule, &line, current_time)?;

    let location_display_name = map_display_name(&location)
        .map(str::to_string)
        .unwrap_or_else(|| location.clone());

    Some(NpcLocationInfo {
        npc_name: npc_name.to_string(),
        location,
        location_display_name,
        tile_x: Some(x),
        tile_y: Some(y),
        direction: Some(direction),
        schedule_key: Some(key),
        schedule_time: Some(time),
        source: "estimate".to_string(),
        confidence: "estimate".to_string(),
        updated_at: None,
    })
}

fn normalize_time(time: i32) -> i32 {
    let clamped = time.clamp(600, 2600);
    let hour = clamped / 100;
    let minute = clamped % 100;
    let minute = if minute >= 50 {
        50
    } else if minute >= 40 {
        40
    } else if minute >= 30 {
        30
    } else if minute >= 20 {
        20
    } else if minute >= 10 {
        10
    } else {
        0
    };
    hour * 100 + minute
}

fn choose_schedule_line(
    schedule: &HashMap<String, String>,
    summary: &SaveSummary,
    weather: &str,
) -> Option<(String, String)> {
    let season = season_key(summary.season);
    let day = summary.day_of_month;
    let weekday = weekday_key(day);
    let is_rain = matches!(
        weather.to_ascii_lowercase().as_str(),
        "rain" | "storm" | "greenrain"
    );

    let mut candidates = vec![
        format!("{}_{}", season, day),
        day.to_string(),
        weekday.to_string(),
    ];
    if is_rain {
        candidates.splice(0..0, [format!("rain_{}", day), "rain".to_string()]);
    }
    candidates.extend([season.to_string(), "default".to_string()]);

    for key in candidates {
        if let Some(value) = get_schedule_value(schedule, &key) {
            return Some((key, value.to_string()));
        }
    }

    schedule
        .iter()
        .find(|(_, value)| value.split('/').any(segment_starts_with_time))
        .map(|(key, value)| (key.clone(), value.clone()))
}

fn parse_schedule_destination(
    schedule: &HashMap<String, String>,
    line: &str,
    current_time: i32,
) -> Option<(i32, String, i32, i32, i32)> {
    let mut resolved = line.trim().to_string();
    for _ in 0..4 {
        let mut parts = resolved.split_whitespace();
        if parts
            .next()
            .is_some_and(|value| value.eq_ignore_ascii_case("GOTO"))
        {
            let key = parts.next()?;
            resolved = get_schedule_value(schedule, key)?.to_string();
        } else {
            break;
        }
    }

    let mut best: Option<(i32, String, i32, i32, i32)> = None;
    for segment in resolved.split('/') {
        let tokens: Vec<&str> = segment.split_whitespace().collect();
        if tokens.len() < 5 {
            continue;
        }
        let Ok(time) = tokens[0].parse::<i32>() else {
            continue;
        };
        let Ok(x) = tokens[2].parse::<i32>() else {
            continue;
        };
        let Ok(y) = tokens[3].parse::<i32>() else {
            continue;
        };
        let direction = tokens[4].parse::<i32>().unwrap_or(2);
        let candidate = (time, tokens[1].to_string(), x, y, direction);

        if time <= current_time {
            best = Some(candidate);
        } else if best.is_none() {
            best = Some(candidate);
            break;
        }
    }

    best
}

fn get_schedule_value<'a>(schedule: &'a HashMap<String, String>, key: &str) -> Option<&'a str> {
    schedule
        .get(key)
        .or_else(|| {
            schedule
                .iter()
                .find(|(k, _)| k.eq_ignore_ascii_case(key))
                .map(|(_, v)| v)
        })
        .map(String::as_str)
}

fn segment_starts_with_time(segment: &str) -> bool {
    segment
        .split_whitespace()
        .next()
        .is_some_and(|token| token.parse::<i32>().is_ok())
}

fn season_key(season: i32) -> &'static str {
    match season {
        1 => "summer",
        2 => "fall",
        3 => "winter",
        _ => "spring",
    }
}

fn weekday_key(day: i32) -> &'static str {
    match (day - 1).rem_euclid(7) {
        0 => "Mon",
        1 => "Tue",
        2 => "Wed",
        3 => "Thu",
        4 => "Fri",
        5 => "Sat",
        _ => "Sun",
    }
}

fn is_xnb_file(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("xnb"))
}

fn realtime_snapshot_path() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var("APPDATA").ok()?;
        Some(
            PathBuf::from(appdata)
                .join("StardewValley")
                .join("StardewValleyAssistant")
                .join("npc-locations.json"),
        )
    }
    #[cfg(not(target_os = "windows"))]
    {
        let home = std::env::var("HOME").ok()?;
        Some(
            PathBuf::from(home)
                .join(".config")
                .join("StardewValley")
                .join("StardewValleyAssistant")
                .join("npc-locations.json"),
        )
    }
}
