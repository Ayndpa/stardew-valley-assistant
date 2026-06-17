use std::collections::HashMap;

use super::super::calendar::{
    resolve_localized_text, season_name_localized, CalendarBirthday, CalendarFestival,
};
use super::super::npc::NpcProfile;
use super::primitives::XnbPayloadReader;
use super::{RawCropData, RawLocationFishingData, RawObjectData};

impl<'a> XnbPayloadReader<'a> {
    pub fn read_crop_data(&mut self) -> Result<RawCropData, String> {
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

    pub fn read_object_data(&mut self) -> Result<RawObjectData, String> {
        let name = self.read_object_string_any()?;
        let display_name = self.read_object_string_any()?;
        let description = self.read_object_string_any()?;
        let object_type = self.read_object_string_any()?;
        let category = self.read_i32()?;
        let price = self.read_i32()?;
        let texture = self.read_object_string_any()?;
        let sprite_index = self.read_i32()?;
        let _color_overlay_from_next_index = self.read_bool()?;
        let edibility = self.read_i32()?;
        let _is_drink = self.read_bool()?;
        self.skip_nullable_object_buffs()?;
        let _geode_drops_default_items = self.read_bool()?;
        self.skip_nullable_geode_drops()?;
        self.skip_nullable_artifact_spot_chances()?;
        let can_be_given_as_gift = self.read_bool()?;
        let can_be_trashed = self.read_bool()?;
        let _exclude_from_fishing_collection = self.read_bool()?;
        let _exclude_from_shipping_collection = self.read_bool()?;
        let _exclude_from_random_sale = self.read_bool()?;
        self.skip_nullable_string_list()?;
        self.skip_nullable_string_dictionary()?;

        Ok(RawObjectData {
            name,
            display_name,
            description,
            object_type,
            category,
            price,
            texture,
            sprite_index,
            edibility,
            can_be_given_as_gift,
            can_be_trashed,
        })
    }

    pub fn read_passive_festival_data(
        &mut self,
        localized_tables: &HashMap<String, HashMap<String, String>>,
        is_zh: bool,
    ) -> Result<Option<Vec<CalendarFestival>>, String> {
        let display_name =
            resolve_localized_text(&self.read_object_string_any()?, localized_tables);
        let _condition = self.read_object_string_any()?;
        let show_on_calendar = self.read_bool()?;
        let season = season_name_localized(self.read_i32()?, is_zh);
        let start_day = self.read_i32()?;
        let end_day = self.read_i32()?;
        let _start_time = self.read_i32()?;
        let _start_message = self.read_object_string_any()?;
        let _only_show_message_on_first_day = self.read_bool()?;
        self.skip_nullable_string_dictionary()?;
        let _daily_setup_method = self.read_object_string_any()?;
        let _cleanup_method = self.read_object_string_any()?;
        self.skip_nullable_string_dictionary()?;

        if !show_on_calendar || display_name.trim().is_empty() || start_day <= 0 || end_day <= 0 {
            return Ok(None);
        }

        let mut festivals = Vec::new();
        for day in start_day..=end_day {
            festivals.push(CalendarFestival {
                name: display_name.clone(),
                date: if is_zh {
                    if start_day == end_day {
                        format!("{} {}日", season, day)
                    } else {
                        format!("{} {}-{}日", season, start_day, end_day)
                    }
                } else {
                    if start_day == end_day {
                        format!("{} {}", season, day)
                    } else {
                        format!("{} {}-{}", season, start_day, end_day)
                    }
                },
                day,
                season: season.to_string(),
                description: None,
            });
        }
        Ok(Some(festivals))
    }

    pub fn read_calendar_birthday(
        &mut self,
        localized_tables: &HashMap<String, HashMap<String, String>>,
        is_zh: bool,
    ) -> Result<Option<CalendarBirthday>, String> {
        let name = resolve_localized_text(&self.read_object_string_any()?, localized_tables);
        let birth_season = self.read_nullable_i32()?;
        let birth_day = self.read_i32()?;

        self.skip_character_data_tail()?;

        let Some(birth_season) = birth_season else {
            return Ok(None);
        };
        if birth_day <= 0 {
            return Ok(None);
        }

        let season = match birth_season {
            0 => if is_zh { "春季" } else { "Spring" },
            1 => if is_zh { "夏季" } else { "Summer" },
            2 => if is_zh { "秋季" } else { "Fall" },
            3 => if is_zh { "冬季" } else { "Winter" },
            _ => if is_zh { "未知" } else { "Unknown" },
        };
        if season == "未知" || season == "Unknown" || name.trim().is_empty() {
            return Ok(None);
        }

        let date = if is_zh {
            format!("{} {}日", season, birth_day)
        } else {
            format!("{} {}", season, birth_day)
        };

        Ok(Some(CalendarBirthday {
            name,
            date,
            day: birth_day,
            season: season.to_string(),
        }))
    }

    pub fn read_npc_profile(
        &mut self,
        id: &str,
        localized_tables: &HashMap<String, HashMap<String, String>>,
        is_zh: bool,
    ) -> Result<Option<NpcProfile>, String> {
        let name = resolve_localized_text(&self.read_object_string_any()?, localized_tables);
        let birth_season = self.read_nullable_i32()?;
        let birth_day = self.read_i32()?;

        let _home_region = self.read_object_string_any()?;
        let _language = self.read_i32()?;
        let gender = self.read_i32()?;
        let _age = self.read_i32()?;
        let _manner = self.read_i32()?;
        let _social_anxiety = self.read_i32()?;
        let _optimism = self.read_i32()?;
        let _is_dark_skinned = self.read_bool()?;
        let can_be_romanced = self.read_bool()?;
        let _love_interest = self.read_object_string_any()?;
        let _calendar = self.read_i32()?;
        let social_tab = self.read_i32()?;

        self.skip_character_data_tail_after_social_tab()?;

        if name.trim().is_empty() {
            return Ok(None);
        }

        let birthday = birth_season.and_then(|season| {
            if birth_day <= 0 {
                return None;
            }
            let season_name = match season {
                0 => if is_zh { "春季" } else { "Spring" },
                1 => if is_zh { "夏季" } else { "Summer" },
                2 => if is_zh { "秋季" } else { "Fall" },
                3 => if is_zh { "冬季" } else { "Winter" },
                _ => if is_zh { "未知" } else { "Unknown" },
            };
            if season_name != "未知" && season_name != "Unknown" {
                if is_zh {
                    Some(format!("{} {}日", season_name, birth_day))
                } else {
                    Some(format!("{} {}", season_name, birth_day))
                }
            } else {
                None
            }
        });

        let include = social_tab >= 0 || can_be_romanced || birthday.is_some();
        if !include {
            return Ok(None);
        }

        let gender = if can_be_romanced {
            match gender {
                0 => "marriageable_male",
                1 => "marriageable_female",
                _ => "other",
            }
        } else {
            "other"
        }
        .to_string();

        Ok(Some(NpcProfile {
            id: id.to_string(),
            name,
            birthday,
            gender,
            marriage_candidate: can_be_romanced,
            loved_items: Vec::new(),
            hated_items: Vec::new(),
        }))
    }

    pub fn read_location_fishing_data(&mut self) -> Result<RawLocationFishingData, String> {
        let _display_name = self.read_object_string_any()?;
        self.skip_nullable_point()?;
        let _exclude_from_npc_pathfinding = self.read_bool()?;
        self.skip_nullable_create_location_data()?;
        self.skip_nullable_string_list()?;
        self.skip_nullable_bool()?;
        let _can_have_green_rain_spawns = self.read_bool()?;
        self.skip_nullable_artifact_spot_drop_list()?;
        let fish_areas = self.read_nullable_fish_area_dictionary()?;
        let fish = self.read_nullable_spawn_fish_list()?;
        self.skip_nullable_spawn_forage_list()?;
        let _min_daily_weeds = self.read_i32()?;
        let _max_daily_weeds = self.read_i32()?;
        let _first_day_weed_multiplier = self.read_i32()?;
        let _min_daily_forage_spawn = self.read_i32()?;
        let _max_daily_forage_spawn = self.read_i32()?;
        let _max_spawned_forage_at_once = self.read_i32()?;
        let _chance_for_clay = self.read_f64()?;
        self.skip_nullable_location_music_list()?;
        let _music_default = self.read_object_string_any()?;
        let _music_context = self.read_i32()?;
        let _music_ignored_in_rain = self.read_bool()?;
        let _music_ignored_in_spring = self.read_bool()?;
        let _music_ignored_in_summer = self.read_bool()?;
        let _music_ignored_in_fall = self.read_bool()?;
        let _music_ignored_in_fall_debris = self.read_bool()?;
        let _music_ignored_in_winter = self.read_bool()?;
        let _music_is_town_theme = self.read_bool()?;
        self.skip_nullable_string_dictionary()?;

        Ok(RawLocationFishingData { fish_areas, fish })
    }
}
