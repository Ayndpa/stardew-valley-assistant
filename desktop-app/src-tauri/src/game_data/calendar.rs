//! 日历（节日 + 生日）Tauri 命令。解析逻辑在 `sdv_game_data::calendar`。

use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Mutex};

pub use sdv_game_data::calendar::{
    build_calendar_game_data_from_xnb, load_calendar_birthdays, load_calendar_festivals,
    load_passive_calendar_festivals, load_special_calendar_festivals, parse_calendar_day_id,
    resolve_display_name, resolve_localized_text, season_name_localized, season_order,
    CalendarBirthday, CalendarFestival, CalendarGameData,
};

static CALENDAR_GAME_DATA_CACHE: LazyLock<Mutex<HashMap<String, Arc<CalendarGameData>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[tauri::command(async)]
pub fn get_calendar_game_data(
    game_dir: Option<String>,
    lang: Option<String>,
) -> Result<CalendarGameData, String> {
    let content_dir = super::locate_content_dir(game_dir.as_deref())?;
    let lang_str = lang.as_deref().unwrap_or("zh").to_string();
    let key = super::snapshot_cache_key(&content_dir, &lang_str);

    let snapshot = super::cached_snapshot(&CALENDAR_GAME_DATA_CACHE, key, || {
        build_calendar_game_data_from_xnb(&content_dir, &lang_str)
    })?;
    Ok((*snapshot).clone())
}
