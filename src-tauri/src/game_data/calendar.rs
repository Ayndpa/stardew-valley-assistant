use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

use super::xnb::{
    get_lang_suffix, load_localized_string_tables_with_lang, load_string_dictionary_best_effort,
    load_xnb_payload, require_reader, XnbPayloadReader,
};

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CalendarFestival {
    pub name: String,
    pub date: String,
    pub day: i32,
    pub season: String,
    pub description: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CalendarBirthday {
    pub name: String,
    pub date: String,
    pub day: i32,
    pub season: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CalendarGameData {
    pub festivals: Vec<CalendarFestival>,
    pub birthdays: Vec<CalendarBirthday>,
}

#[tauri::command]
pub fn get_calendar_game_data(
    game_dir: Option<String>,
    lang: Option<String>,
) -> Result<CalendarGameData, String> {
    let content_dir = super::locate_content_dir(game_dir.as_deref())?;
    let localized_tables = load_localized_string_tables_with_lang(
        &content_dir,
        &["Characters", "NPCNames", "UI", "1_6_Strings"],
        lang.as_deref(),
    );

    let lang_str = lang.as_deref().unwrap_or("zh");
    let is_zh = lang_str.to_lowercase().starts_with("zh");
    let lang_suffix = get_lang_suffix(Some(lang_str));

    let mut festivals =
        load_calendar_festivals(&content_dir, &localized_tables, is_zh, lang_suffix)?;
    festivals.sort_by(|a, b| {
        season_order(&a.season)
            .cmp(&season_order(&b.season))
            .then(a.day.cmp(&b.day))
            .then(a.name.cmp(&b.name))
    });

    let mut birthdays = load_calendar_birthdays(&content_dir, &localized_tables, is_zh)?;
    birthdays.sort_by(|a, b| {
        season_order(&a.season)
            .cmp(&season_order(&b.season))
            .then(a.day.cmp(&b.day))
            .then(a.name.cmp(&b.name))
    });

    Ok(CalendarGameData {
        festivals,
        birthdays,
    })
}

pub fn load_calendar_festivals(
    content_dir: &Path,
    localized_tables: &HashMap<String, HashMap<String, String>>,
    is_zh: bool,
    lang_suffix: &str,
) -> Result<Vec<CalendarFestival>, String> {
    let festivals_dir = content_dir.join("Data").join("Festivals");

    let mut festival_dates_paths = Vec::new();
    if !lang_suffix.is_empty() {
        festival_dates_paths.push(festivals_dir.join(format!("FestivalDates{}.xnb", lang_suffix)));
    }
    festival_dates_paths.push(festivals_dir.join("FestivalDates.xnb"));
    let festival_dates = load_string_dictionary_best_effort(&festival_dates_paths);

    let mut festivals = Vec::new();
    for festival_id in festival_dates.keys() {
        let Some((season, day)) = parse_calendar_day_id(festival_id, is_zh) else {
            continue;
        };
        let mut festival_data_paths = Vec::new();
        if !lang_suffix.is_empty() {
            festival_data_paths
                .push(festivals_dir.join(format!("{}{}.xnb", festival_id, lang_suffix)));
        }
        festival_data_paths.push(festivals_dir.join(format!("{}.xnb", festival_id)));
        let data = load_string_dictionary_best_effort(&festival_data_paths);
        let Some(name) = data
            .get("name")
            .map(|value| resolve_localized_text(value, localized_tables))
            .filter(|value| !value.trim().is_empty())
        else {
            continue;
        };
        let date = if is_zh {
            format!("{} {}日", season, day)
        } else {
            format!("{} {}", season, day)
        };
        festivals.push(CalendarFestival {
            name,
            date,
            day,
            season: season.to_string(),
            description: None,
        });
    }

    festivals.extend(load_passive_calendar_festivals(
        content_dir,
        localized_tables,
        is_zh,
    )?);
    festivals.extend(load_special_calendar_festivals(localized_tables, is_zh));
    Ok(festivals)
}

pub fn load_passive_calendar_festivals(
    content_dir: &Path,
    localized_tables: &HashMap<String, HashMap<String, String>>,
    is_zh: bool,
) -> Result<Vec<CalendarFestival>, String> {
    let path = content_dir.join("Data").join("PassiveFestivals.xnb");
    if !path.exists() {
        return Ok(Vec::new());
    }

    let payload = load_xnb_payload(&path)?;
    let mut reader = XnbPayloadReader::new(&payload);
    let type_readers = reader.read_type_readers()?;
    let root_reader = reader.read_7bit_usize()?;
    if root_reader == 0 {
        return Ok(Vec::new());
    }
    require_reader(&type_readers, root_reader, "DictionaryReader")?;

    let count = reader.read_i32()?.max(0) as usize;
    let mut festivals = Vec::with_capacity(count);
    for _ in 0..count {
        let key = reader.read_object_string(&type_readers)?;
        let value_reader = reader.read_7bit_usize()?;
        if value_reader == 0 {
            continue;
        }
        require_reader(&type_readers, value_reader, "ReflectiveReader")
            .map_err(|e| format!("Failed to parse passive festival '{}': {}", key, e))?;
        if let Some(festival) = reader
            .read_passive_festival_data(localized_tables, is_zh)
            .map_err(|e| format!("Failed to parse passive festival '{}': {}", key, e))?
        {
            festivals.extend(festival);
        }
    }

    Ok(festivals)
}

pub fn load_special_calendar_festivals(
    localized_tables: &HashMap<String, HashMap<String, String>>,
    is_zh: bool,
) -> Vec<CalendarFestival> {
    let mut festivals = Vec::new();
    let trout_derby = resolve_localized_text(
        "[LocalizedText Strings\\1_6_Strings:TroutDerby]",
        localized_tables,
    );
    if !trout_derby.is_empty() {
        let season = if is_zh { "夏季" } else { "Summer" };
        for day in [20, 21] {
            let date = if is_zh {
                format!("{} {}日", season, day)
            } else {
                format!("{} {}", season, day)
            };
            festivals.push(CalendarFestival {
                name: trout_derby.clone(),
                date,
                day,
                season: season.to_string(),
                description: None,
            });
        }
    }

    let squid_fest = resolve_localized_text(
        "[LocalizedText Strings\\1_6_Strings:SquidFest]",
        localized_tables,
    );
    if !squid_fest.is_empty() {
        let season = if is_zh { "冬季" } else { "Winter" };
        for day in [12, 13] {
            let date = if is_zh {
                format!("{} {}日", season, day)
            } else {
                format!("{} {}", season, day)
            };
            festivals.push(CalendarFestival {
                name: squid_fest.clone(),
                date,
                day,
                season: season.to_string(),
                description: None,
            });
        }
    }

    festivals
}

pub fn load_calendar_birthdays(
    content_dir: &Path,
    localized_tables: &HashMap<String, HashMap<String, String>>,
    is_zh: bool,
) -> Result<Vec<CalendarBirthday>, String> {
    let path = content_dir.join("Data").join("Characters.xnb");
    let payload = load_xnb_payload(&path)?;
    let mut reader = XnbPayloadReader::new(&payload);
    let type_readers = reader.read_type_readers()?;
    let root_reader = reader.read_7bit_usize()?;
    if root_reader == 0 {
        return Ok(Vec::new());
    }
    require_reader(&type_readers, root_reader, "DictionaryReader")?;

    let count = reader.read_i32()?.max(0) as usize;
    let mut birthdays = Vec::new();
    for _ in 0..count {
        let key = reader.read_object_string(&type_readers)?;
        let value_reader = reader.read_7bit_usize()?;
        if value_reader == 0 {
            continue;
        }
        require_reader(&type_readers, value_reader, "ReflectiveReader")
            .map_err(|e| format!("Failed to parse character '{}': {}", key, e))?;
        if let Some(birthday) = reader
            .read_calendar_birthday(localized_tables, is_zh)
            .map_err(|e| format!("Failed to parse character '{}': {}", key, e))?
        {
            birthdays.push(birthday);
        }
    }

    Ok(birthdays)
}

pub fn parse_calendar_day_id(value: &str, is_zh: bool) -> Option<(&'static str, i32)> {
    let lower = value.to_ascii_lowercase();
    let (season, digits) = if let Some(rest) = lower.strip_prefix("spring") {
        (if is_zh { "春季" } else { "Spring" }, rest)
    } else if let Some(rest) = lower.strip_prefix("summer") {
        (if is_zh { "夏季" } else { "Summer" }, rest)
    } else if let Some(rest) = lower.strip_prefix("fall") {
        (if is_zh { "秋季" } else { "Fall" }, rest)
    } else if let Some(rest) = lower.strip_prefix("winter") {
        (if is_zh { "冬季" } else { "Winter" }, rest)
    } else {
        return None;
    };
    let day = digits.parse::<i32>().ok()?;
    Some((season, day))
}

pub fn resolve_localized_text(
    token: &str,
    localized_tables: &HashMap<String, HashMap<String, String>>,
) -> String {
    if let Some(inner) = token
        .strip_prefix("[LocalizedText Strings\\")
        .and_then(|value| value.strip_suffix(']'))
    {
        if let Some((table, key)) = inner.split_once(':') {
            if let Some(values) = localized_tables.get(table) {
                if let Some(text) = values.get(key) {
                    return text.clone();
                }
            }
        }
    }
    token.to_string()
}

pub fn season_order(season: &str) -> i32 {
    match season {
        "春季" | "Spring" => 0,
        "夏季" | "Summer" => 1,
        "秋季" | "Fall" => 2,
        "冬季" | "Winter" => 3,
        _ => 9,
    }
}

#[allow(dead_code)]
pub fn season_name(season: i32) -> &'static str {
    match season {
        0 => "春季",
        1 => "夏季",
        2 => "秋季",
        3 => "冬季",
        _ => "未知",
    }
}

pub fn season_name_localized(season: i32, is_zh: bool) -> &'static str {
    match season {
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
    }
}

pub fn resolve_display_name(
    token: &str,
    object_strings: &HashMap<String, String>,
) -> Option<String> {
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
