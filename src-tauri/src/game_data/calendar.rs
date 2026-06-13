use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

use super::xnb::{
    load_localized_string_tables, load_string_dictionary_best_effort, load_xnb_payload,
    require_reader, XnbPayloadReader,
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
pub fn get_calendar_game_data(game_dir: Option<String>) -> Result<CalendarGameData, String> {
    let content_dir = super::locate_content_dir(game_dir.as_deref())?;
    let localized_tables = load_localized_string_tables(
        &content_dir,
        &["Characters", "NPCNames", "UI", "1_6_Strings"],
    );

    let mut festivals = load_calendar_festivals(&content_dir, &localized_tables)?;
    festivals.sort_by(|a, b| {
        season_order(&a.season)
            .cmp(&season_order(&b.season))
            .then(a.day.cmp(&b.day))
            .then(a.name.cmp(&b.name))
    });

    let mut birthdays = load_calendar_birthdays(&content_dir, &localized_tables)?;
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
) -> Result<Vec<CalendarFestival>, String> {
    let festival_dates = load_string_dictionary_best_effort(&[
        content_dir
            .join("Data")
            .join("Festivals")
            .join("FestivalDates.zh-CN.xnb"),
        content_dir
            .join("Data")
            .join("Festivals")
            .join("FestivalDates.xnb"),
    ]);

    let mut festivals = Vec::new();
    for festival_id in festival_dates.keys() {
        let Some((season, day)) = parse_calendar_day_id(festival_id) else {
            continue;
        };
        let data = load_string_dictionary_best_effort(&[
            content_dir
                .join("Data")
                .join("Festivals")
                .join(format!("{}.zh-CN.xnb", festival_id)),
            content_dir
                .join("Data")
                .join("Festivals")
                .join(format!("{}.xnb", festival_id)),
        ]);
        let Some(name) = data
            .get("name")
            .map(|value| resolve_localized_text(value, localized_tables))
            .filter(|value| !value.trim().is_empty())
        else {
            continue;
        };
        festivals.push(CalendarFestival {
            name,
            date: format!("{} {}日", season, day),
            day,
            season: season.to_string(),
            description: None,
        });
    }

    festivals.extend(load_passive_calendar_festivals(
        content_dir,
        localized_tables,
    )?);
    festivals.extend(load_special_calendar_festivals(localized_tables));
    Ok(festivals)
}

pub fn load_passive_calendar_festivals(
    content_dir: &Path,
    localized_tables: &HashMap<String, HashMap<String, String>>,
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
            .read_passive_festival_data(localized_tables)
            .map_err(|e| format!("Failed to parse passive festival '{}': {}", key, e))?
        {
            festivals.extend(festival);
        }
    }

    Ok(festivals)
}

pub fn load_special_calendar_festivals(
    localized_tables: &HashMap<String, HashMap<String, String>>,
) -> Vec<CalendarFestival> {
    let mut festivals = Vec::new();
    let trout_derby = resolve_localized_text(
        "[LocalizedText Strings\\1_6_Strings:TroutDerby]",
        localized_tables,
    );
    if !trout_derby.is_empty() {
        for day in [20, 21] {
            festivals.push(CalendarFestival {
                name: trout_derby.clone(),
                date: format!("夏季 {}日", day),
                day,
                season: "夏季".to_string(),
                description: None,
            });
        }
    }

    let squid_fest = resolve_localized_text(
        "[LocalizedText Strings\\1_6_Strings:SquidFest]",
        localized_tables,
    );
    if !squid_fest.is_empty() {
        for day in [12, 13] {
            festivals.push(CalendarFestival {
                name: squid_fest.clone(),
                date: format!("冬季 {}日", day),
                day,
                season: "冬季".to_string(),
                description: None,
            });
        }
    }

    festivals
}

pub fn load_calendar_birthdays(
    content_dir: &Path,
    localized_tables: &HashMap<String, HashMap<String, String>>,
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
            .read_calendar_birthday(localized_tables)
            .map_err(|e| format!("Failed to parse character '{}': {}", key, e))?
        {
            birthdays.push(birthday);
        }
    }

    Ok(birthdays)
}

pub fn parse_calendar_day_id(value: &str) -> Option<(&'static str, i32)> {
    let lower = value.to_ascii_lowercase();
    let (season, digits) = if let Some(rest) = lower.strip_prefix("spring") {
        ("春季", rest)
    } else if let Some(rest) = lower.strip_prefix("summer") {
        ("夏季", rest)
    } else if let Some(rest) = lower.strip_prefix("fall") {
        ("秋季", rest)
    } else if let Some(rest) = lower.strip_prefix("winter") {
        ("冬季", rest)
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
        "春季" => 0,
        "夏季" => 1,
        "秋季" => 2,
        "冬季" => 3,
        _ => 9,
    }
}

pub fn season_name(season: i32) -> &'static str {
    match season {
        0 => "春季",
        1 => "夏季",
        2 => "秋季",
        3 => "冬季",
        _ => "未知",
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
