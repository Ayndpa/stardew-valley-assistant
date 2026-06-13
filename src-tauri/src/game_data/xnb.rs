use lzxd::{Lzxd, WindowSize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use super::calendar::{resolve_localized_text, season_name, CalendarBirthday, CalendarFestival};
use super::image_utils::{Pixel, Texture};
use super::npc::NpcProfile;

pub const XNB_FLAG_COMPRESSED_LZX: u8 = 0x80;
pub const XNB_HEADER_COMPRESSED_LEN: usize = 14;
pub const XNB_HEADER_UNCOMPRESSED_LEN: usize = 10;
pub const XNB_CHUNK_SIZE: usize = 0x8000;

#[derive(Debug, Clone)]
pub struct RawCropData {
    pub seasons: Vec<i32>,
    pub days_in_phase: Vec<i32>,
    pub regrow_days: i32,
    pub needs_watering: bool,
    pub harvest_item_id: String,
}

#[derive(Debug, Clone)]
pub struct RawObjectData {
    pub name: String,
    pub display_name: String,
    pub description: String,
    pub object_type: String,
    pub category: i32,
    pub price: i32,
    pub texture: String,
    pub sprite_index: i32,
    pub edibility: i32,
    pub can_be_given_as_gift: bool,
    pub can_be_trashed: bool,
}

#[derive(Debug, Clone)]
pub struct RawLocationFishArea {
    pub display_name: String,
    pub position: Option<(i32, i32, i32, i32)>,
}

#[derive(Debug, Clone)]
pub struct RawLocationFishEntry {
    pub item_ids: Vec<String>,
    pub fish_area_id: String,
}

#[derive(Debug, Clone, Default)]
pub struct RawLocationFishingData {
    pub fish_areas: HashMap<String, RawLocationFishArea>,
    pub fish: Vec<RawLocationFishEntry>,
}

pub fn require_reader(
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

pub fn load_xnb_payload(path: &Path) -> Result<Vec<u8>, String> {
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

pub fn decompress_xnb_lzx(data: &[u8], expected_size: usize) -> Result<Vec<u8>, String> {
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

pub struct XnbPayloadReader<'a> {
    pub data: &'a [u8],
    pub pos: usize,
}

impl<'a> XnbPayloadReader<'a> {
    pub fn new(data: &'a [u8]) -> Self {
        Self { data, pos: 0 }
    }

    pub fn read_type_readers(&mut self) -> Result<Vec<String>, String> {
        let reader_count = self.read_7bit_usize()?;
        let mut readers = Vec::with_capacity(reader_count);
        for _ in 0..reader_count {
            readers.push(self.read_string()?);
            let _version = self.read_i32()?;
        }
        let _shared_resource_count = self.read_7bit_usize()?;
        Ok(readers)
    }

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
    ) -> Result<Option<Vec<CalendarFestival>>, String> {
        let display_name =
            resolve_localized_text(&self.read_object_string_any()?, localized_tables);
        let _condition = self.read_object_string_any()?;
        let show_on_calendar = self.read_bool()?;
        let season = season_name(self.read_i32()?);
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
                date: if start_day == end_day {
                    format!("{} {}日", season, day)
                } else {
                    format!("{} {}-{}日", season, start_day, end_day)
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

        let season = season_name(birth_season).to_string();
        if season == "未知" || name.trim().is_empty() {
            return Ok(None);
        }

        Ok(Some(CalendarBirthday {
            name,
            date: format!("{} {}日", season, birth_day),
            day: birth_day,
            season,
        }))
    }

    pub fn read_npc_profile(
        &mut self,
        id: &str,
        localized_tables: &HashMap<String, HashMap<String, String>>,
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
            let season_name = season_name(season);
            (season_name != "未知").then(|| format!("{} {}日", season_name, birth_day))
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

    fn skip_character_data_tail(&mut self) -> Result<(), String> {
        let _home_region = self.read_object_string_any()?;
        let _language = self.read_i32()?;
        let _gender = self.read_i32()?;
        let _age = self.read_i32()?;
        let _manner = self.read_i32()?;
        let _social_anxiety = self.read_i32()?;
        let _optimism = self.read_i32()?;
        let _is_dark_skinned = self.read_bool()?;
        let _can_be_romanced = self.read_bool()?;
        let _love_interest = self.read_object_string_any()?;
        let _calendar = self.read_i32()?;
        let _social_tab = self.read_i32()?;
        let _can_socialize = self.read_object_string_any()?;
        let _can_receive_gifts = self.read_bool()?;
        let _can_greet_nearby_characters = self.read_bool()?;
        self.skip_nullable_bool()?;
        let _can_visit_island = self.read_object_string_any()?;
        self.skip_nullable_bool()?;
        let _item_delivery_quests = self.read_object_string_any()?;
        let _perfection_score = self.read_bool()?;
        let _end_slide_show = self.read_i32()?;
        let _spouse_adopts = self.read_object_string_any()?;
        let _spouse_wants_children = self.read_object_string_any()?;
        let _spouse_gift_jealousy = self.read_object_string_any()?;
        let _spouse_gift_jealousy_friendship_change = self.read_i32()?;
        self.skip_nullable_character_spouse_room_data()?;
        self.skip_nullable_character_spouse_patio_data()?;
        self.skip_nullable_string_list()?;
        self.skip_nullable_string_list()?;
        let _dumpster_dive_friendship_effect = self.read_i32()?;
        self.skip_nullable_i32()?;
        self.skip_nullable_string_dictionary()?;
        self.skip_nullable_bool()?;
        self.skip_nullable_generic_spawn_item_data_with_condition_list()?;
        let _winter_star_participant = self.read_object_string_any()?;
        let _unlock_conditions = self.read_object_string_any()?;
        let _spawn_if_missing = self.read_bool()?;
        self.skip_nullable_character_home_data_list()?;
        let _texture_name = self.read_object_string_any()?;
        self.skip_nullable_character_appearance_data_list()?;
        self.skip_nullable_rectangle()?;
        self.skip_point()?;
        let _breather = self.read_bool()?;
        self.skip_nullable_rectangle()?;
        self.skip_nullable_point()?;
        self.skip_nullable_character_shadow_data()?;
        self.skip_point()?;
        self.skip_object_i32_list()?;
        let _kiss_sprite_index = self.read_i32()?;
        let _kiss_sprite_facing_right = self.read_bool()?;
        let _hidden_profile_emote_sound = self.read_object_string_any()?;
        let _hidden_profile_emote_duration = self.read_i32()?;
        let _hidden_profile_emote_start_frame = self.read_i32()?;
        let _hidden_profile_emote_frame_count = self.read_i32()?;
        let _hidden_profile_emote_frame_duration = self.read_f32()?;
        self.skip_nullable_string_list()?;
        let _festival_vanilla_actor_index = self.read_i32()?;
        self.skip_nullable_string_dictionary()?;
        Ok(())
    }

    fn skip_character_data_tail_after_social_tab(&mut self) -> Result<(), String> {
        let _can_socialize = self.read_object_string_any()?;
        let _can_receive_gifts = self.read_bool()?;
        let _can_greet_nearby_characters = self.read_bool()?;
        self.skip_nullable_bool()?;
        let _can_visit_island = self.read_object_string_any()?;
        self.skip_nullable_bool()?;
        let _item_delivery_quests = self.read_object_string_any()?;
        let _perfection_score = self.read_bool()?;
        let _end_slide_show = self.read_i32()?;
        let _spouse_adopts = self.read_object_string_any()?;
        let _spouse_wants_children = self.read_object_string_any()?;
        let _spouse_gift_jealousy = self.read_object_string_any()?;
        let _spouse_gift_jealousy_friendship_change = self.read_i32()?;
        self.skip_nullable_character_spouse_room_data()?;
        self.skip_nullable_character_spouse_patio_data()?;
        self.skip_nullable_string_list()?;
        self.skip_nullable_string_list()?;
        let _dumpster_dive_friendship_effect = self.read_i32()?;
        self.skip_nullable_i32()?;
        self.skip_nullable_string_dictionary()?;
        self.skip_nullable_bool()?;
        self.skip_nullable_generic_spawn_item_data_with_condition_list()?;
        let _winter_star_participant = self.read_object_string_any()?;
        let _unlock_conditions = self.read_object_string_any()?;
        let _spawn_if_missing = self.read_bool()?;
        self.skip_nullable_character_home_data_list()?;
        let _texture_name = self.read_object_string_any()?;
        self.skip_nullable_character_appearance_data_list()?;
        self.skip_nullable_rectangle()?;
        self.skip_point()?;
        let _breather = self.read_bool()?;
        self.skip_nullable_rectangle()?;
        self.skip_nullable_point()?;
        self.skip_nullable_character_shadow_data()?;
        self.skip_point()?;
        self.skip_object_i32_list()?;
        let _kiss_sprite_index = self.read_i32()?;
        let _kiss_sprite_facing_right = self.read_bool()?;
        let _hidden_profile_emote_sound = self.read_object_string_any()?;
        let _hidden_profile_emote_duration = self.read_i32()?;
        let _hidden_profile_emote_start_frame = self.read_i32()?;
        let _hidden_profile_emote_frame_count = self.read_i32()?;
        let _hidden_profile_emote_frame_duration = self.read_f32()?;
        self.skip_nullable_string_list()?;
        let _festival_vanilla_actor_index = self.read_i32()?;
        self.skip_nullable_string_dictionary()?;
        Ok(())
    }

    fn read_object_i32_list(&mut self) -> Result<Vec<i32>, String> {
        if self.read_7bit_usize()? == 0 {
            return Ok(Vec::new());
        }
        self.read_i32_list()
    }

    fn skip_object_i32_list(&mut self) -> Result<(), String> {
        if self.read_7bit_usize()? == 0 {
            return Ok(());
        }
        let count = self.read_i32()?.max(0) as usize;
        for _ in 0..count {
            let _ = self.read_i32()?;
        }
        Ok(())
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

    fn read_nullable_i32(&mut self) -> Result<Option<i32>, String> {
        if self.read_bool()? {
            return Ok(Some(self.read_i32()?));
        }
        Ok(None)
    }

    fn skip_nullable_bool(&mut self) -> Result<(), String> {
        if self.read_bool()? {
            let _ = self.read_bool()?;
        }
        Ok(())
    }

    fn read_nullable_string_list_values(&mut self) -> Result<Vec<String>, String> {
        if self.read_7bit_usize()? == 0 {
            return Ok(Vec::new());
        }
        let count = self.read_i32()?.max(0) as usize;
        let mut values = Vec::with_capacity(count);
        for _ in 0..count {
            values.push(self.read_object_string_any()?);
        }
        Ok(values)
    }

    fn skip_point(&mut self) -> Result<(), String> {
        let _x = self.read_i32()?;
        let _y = self.read_i32()?;
        Ok(())
    }

    fn skip_nullable_point(&mut self) -> Result<(), String> {
        if self.read_bool()? {
            self.skip_point()?;
        }
        Ok(())
    }

    fn skip_rectangle(&mut self) -> Result<(), String> {
        let _x = self.read_i32()?;
        let _y = self.read_i32()?;
        let _width = self.read_i32()?;
        let _height = self.read_i32()?;
        Ok(())
    }

    fn skip_nullable_rectangle(&mut self) -> Result<(), String> {
        if self.read_bool()? {
            self.skip_rectangle()?;
        }
        Ok(())
    }

    fn read_nullable_rectangle_tuple(&mut self) -> Result<Option<(i32, i32, i32, i32)>, String> {
        if self.read_bool()? {
            let x = self.read_i32()?;
            let y = self.read_i32()?;
            let width = self.read_i32()?;
            let height = self.read_i32()?;
            return Ok(Some((x, y, width, height)));
        }
        Ok(None)
    }

    fn skip_nullable_create_location_data(&mut self) -> Result<(), String> {
        if self.read_7bit_usize()? == 0 {
            return Ok(());
        }
        let _map_path = self.read_object_string_any()?;
        let _type = self.read_object_string_any()?;
        let _always_active = self.read_bool()?;
        Ok(())
    }

    fn skip_nullable_artifact_spot_drop_list(&mut self) -> Result<(), String> {
        if self.read_7bit_usize()? == 0 {
            return Ok(());
        }
        let count = self.read_i32()?.max(0) as usize;
        for _ in 0..count {
            if self.read_7bit_usize()? == 0 {
                continue;
            }
            self.read_spawn_item_with_condition_stub()?;
            let _chance = self.read_f64()?;
            let _apply_generous_enchantment = self.read_bool()?;
            let _one_debris_per_drop = self.read_bool()?;
            let _precedence = self.read_i32()?;
            let _continue_on_drop = self.read_bool()?;
        }
        Ok(())
    }

    fn read_nullable_fish_area_dictionary(
        &mut self,
    ) -> Result<HashMap<String, RawLocationFishArea>, String> {
        if self.read_7bit_usize()? == 0 {
            return Ok(HashMap::new());
        }
        let count = self.read_i32()?.max(0) as usize;
        let mut fish_areas = HashMap::with_capacity(count);
        for _ in 0..count {
            let key = self.read_object_string_any()?;
            if self.read_7bit_usize()? == 0 {
                continue;
            }
            let display_name = self.read_object_string_any()?;
            let position = self.read_nullable_rectangle_tuple()?;
            let _crab_pot_fish_types = self.read_nullable_string_list_values()?;
            let _crab_pot_junk_chance = self.read_f32()?;
            fish_areas.insert(
                key,
                RawLocationFishArea {
                    display_name,
                    position,
                },
            );
        }
        Ok(fish_areas)
    }

    fn read_nullable_spawn_fish_list(&mut self) -> Result<Vec<RawLocationFishEntry>, String> {
        if self.read_7bit_usize()? == 0 {
            return Ok(Vec::new());
        }
        let count = self.read_i32()?.max(0) as usize;
        let mut fish = Vec::with_capacity(count);
        for _ in 0..count {
            if self.read_7bit_usize()? == 0 {
                continue;
            }
            let item_ids = self.read_spawn_item_with_condition_stub()?;
            let _chance = self.read_f32()?;
            self.skip_nullable_i32()?;
            let fish_area_id = self.read_object_string_any()?;
            self.skip_nullable_rectangle()?;
            self.skip_nullable_rectangle()?;
            let _min_fishing_level = self.read_i32()?;
            let _min_distance_from_shore = self.read_i32()?;
            let _max_distance_from_shore = self.read_i32()?;
            let _apply_daily_luck = self.read_bool()?;
            let _curiosity_lure_buff = self.read_f32()?;
            let _specific_bait_buff = self.read_f32()?;
            let _specific_bait_multiplier = self.read_f32()?;
            let _catch_limit = self.read_i32()?;
            self.skip_nullable_bool()?;
            let _is_boss_fish = self.read_bool()?;
            let _set_flag_on_catch = self.read_object_string_any()?;
            let _require_magic_bait = self.read_bool()?;
            let _precedence = self.read_i32()?;
            let _ignore_fish_data_requirements = self.read_bool()?;
            let _can_be_inherited = self.read_bool()?;
            self.skip_nullable_quantity_modifier_list()?;
            let _chance_modifier_mode = self.read_i32()?;
            let _chance_boost_per_luck_level = self.read_f32()?;
            let _use_fish_caught_seeded_random = self.read_bool()?;
            fish.push(RawLocationFishEntry {
                item_ids,
                fish_area_id,
            });
        }
        Ok(fish)
    }

    fn skip_nullable_spawn_forage_list(&mut self) -> Result<(), String> {
        if self.read_7bit_usize()? == 0 {
            return Ok(());
        }
        let count = self.read_i32()?.max(0) as usize;
        for _ in 0..count {
            if self.read_7bit_usize()? == 0 {
                continue;
            }
            self.read_spawn_item_with_condition_stub()?;
            let _chance = self.read_f64()?;
            self.skip_nullable_i32()?;
        }
        Ok(())
    }

    fn skip_nullable_location_music_list(&mut self) -> Result<(), String> {
        if self.read_7bit_usize()? == 0 {
            return Ok(());
        }
        let count = self.read_i32()?.max(0) as usize;
        for _ in 0..count {
            if self.read_7bit_usize()? == 0 {
                continue;
            }
            let _id = self.read_object_string_any()?;
            let _track = self.read_object_string_any()?;
            let _condition = self.read_object_string_any()?;
        }
        Ok(())
    }

    fn skip_nullable_character_spouse_room_data(&mut self) -> Result<(), String> {
        if self.read_7bit_usize()? == 0 {
            return Ok(());
        }
        let _map_asset = self.read_object_string_any()?;
        self.skip_rectangle()?;
        Ok(())
    }

    fn skip_nullable_character_spouse_patio_data(&mut self) -> Result<(), String> {
        if self.read_7bit_usize()? == 0 {
            return Ok(());
        }
        let _map_asset = self.read_object_string_any()?;
        self.skip_rectangle()?;
        self.skip_nullable_i32_array_list()?;
        self.skip_point()?;
        Ok(())
    }

    fn skip_nullable_i32_array_list(&mut self) -> Result<(), String> {
        if self.read_7bit_usize()? == 0 {
            return Ok(());
        }
        let count = self.read_i32()?.max(0) as usize;
        for _ in 0..count {
            if self.read_7bit_usize()? == 0 {
                continue;
            }
            let len = self.read_i32()?.max(0) as usize;
            for _ in 0..len {
                let _ = self.read_i32()?;
            }
        }
        Ok(())
    }

    fn skip_nullable_character_home_data_list(&mut self) -> Result<(), String> {
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
            let _location = self.read_object_string_any()?;
            self.skip_point()?;
            let _direction = self.read_object_string_any()?;
        }
        Ok(())
    }

    fn skip_nullable_character_appearance_data_list(&mut self) -> Result<(), String> {
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
            self.skip_nullable_i32()?;
            let _indoors = self.read_bool()?;
            let _outdoors = self.read_bool()?;
            let _portrait = self.read_object_string_any()?;
            let _sprite = self.read_object_string_any()?;
            let _is_island_attire = self.read_bool()?;
            let _precedence = self.read_i32()?;
            let _weight = self.read_i32()?;
        }
        Ok(())
    }

    fn skip_nullable_character_shadow_data(&mut self) -> Result<(), String> {
        if self.read_7bit_usize()? == 0 {
            return Ok(());
        }
        let _visible = self.read_bool()?;
        self.skip_point()?;
        let _scale = self.read_f32()?;
        Ok(())
    }

    fn skip_nullable_generic_spawn_item_data_with_condition_list(&mut self) -> Result<(), String> {
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

    fn read_spawn_item_stub(&mut self) -> Result<Vec<String>, String> {
        let _id = self.read_object_string_any()?;
        let item_id = self.read_object_string_any()?;
        let random_item_ids = self.read_nullable_string_list_values()?;
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

        let mut item_ids = Vec::new();
        if !item_id.trim().is_empty() {
            item_ids.push(item_id);
        }
        item_ids.extend(
            random_item_ids
                .into_iter()
                .filter(|value| !value.trim().is_empty()),
        );
        Ok(item_ids)
    }

    fn read_spawn_item_with_condition_stub(&mut self) -> Result<Vec<String>, String> {
        let item_ids = self.read_spawn_item_stub()?;
        let _condition = self.read_object_string_any()?;
        Ok(item_ids)
    }

    fn skip_generic_spawn_item_data(&mut self) -> Result<(), String> {
        let _ = self.read_spawn_item_stub()?;
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

    pub fn read_i32(&mut self) -> Result<i32, String> {
        let bytes = self.read_array::<4>()?;
        Ok(i32::from_le_bytes(bytes))
    }

    pub fn read_f32(&mut self) -> Result<f32, String> {
        let bytes = self.read_array::<4>()?;
        Ok(f32::from_le_bytes(bytes))
    }

    pub fn read_f64(&mut self) -> Result<f64, String> {
        let bytes = self.read_array::<8>()?;
        Ok(f64::from_le_bytes(bytes))
    }

    pub fn read_bool(&mut self) -> Result<bool, String> {
        match self.read_u8()? {
            0 => Ok(false),
            1 => Ok(true),
            value => Err(format!("Invalid bool byte {}", value)),
        }
    }

    pub fn read_7bit_usize(&mut self) -> Result<usize, String> {
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

    pub fn read_string(&mut self) -> Result<String, String> {
        let len = self.read_7bit_usize()?;
        if len == 0 {
            return Ok(String::new());
        }
        let bytes = self.read_bytes(len)?;
        String::from_utf8(bytes.to_vec()).map_err(|e| format!("Invalid UTF-8 string: {}", e))
    }

    pub fn read_object_string(&mut self, type_readers: &[String]) -> Result<String, String> {
        let reader_index = self.read_7bit_usize()?;
        if reader_index == 0 {
            return Ok(String::new());
        }
        require_reader(type_readers, reader_index, "StringReader")?;
        self.read_string()
    }

    pub fn read_object_string_any(&mut self) -> Result<String, String> {
        if self.read_7bit_usize()? == 0 {
            return Ok(String::new());
        }
        self.read_string()
    }

    pub fn read_bytes(&mut self, len: usize) -> Result<&'a [u8], String> {
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

    pub fn read_u8(&mut self) -> Result<u8, String> {
        let bytes = self.read_bytes(1)?;
        Ok(bytes[0])
    }

    pub fn read_array<const N: usize>(&mut self) -> Result<[u8; N], String> {
        let bytes = self.read_bytes(N)?;
        let mut out = [0u8; N];
        out.copy_from_slice(bytes);
        Ok(out)
    }
}

pub fn read_u32_le(data: &[u8], offset: usize) -> Result<u32, String> {
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

pub fn load_crops_xnb(path: &Path) -> Result<HashMap<String, RawCropData>, String> {
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

pub fn load_objects_xnb(path: &Path) -> Result<HashMap<String, RawObjectData>, String> {
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

pub fn load_location_fishing_xnb(
    path: &Path,
) -> Result<HashMap<String, RawLocationFishingData>, String> {
    let payload = load_xnb_payload(path)?;
    let mut reader = XnbPayloadReader::new(&payload);
    let type_readers = reader.read_type_readers()?;
    let root_reader = reader.read_7bit_usize()?;
    if root_reader == 0 {
        return Ok(HashMap::new());
    }
    require_reader(&type_readers, root_reader, "DictionaryReader")?;

    let count = reader.read_i32()?.max(0) as usize;
    let mut locations = HashMap::with_capacity(count);
    for _ in 0..count {
        let key = reader.read_object_string(&type_readers)?;
        let value_reader = reader.read_7bit_usize()?;
        if value_reader == 0 {
            continue;
        }
        require_reader(&type_readers, value_reader, "ReflectiveReader")
            .map_err(|e| format!("Failed to parse location '{}' reader: {}", key, e))?;
        let value = reader.read_location_fishing_data().map_err(|e| {
            format!("Failed to parse location fishing data '{}' : {}", key, e)
        })?;
        locations.insert(key, value);
    }
    Ok(locations)
}

pub fn load_string_dictionary_best_effort(paths: &[PathBuf]) -> HashMap<String, String> {
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

pub fn load_string_dictionary_xnb(path: &Path) -> Result<HashMap<String, String>, String> {
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

pub fn load_localized_string_tables(
    content_dir: &Path,
    asset_names: &[&str],
) -> HashMap<String, HashMap<String, String>> {
    let mut tables = HashMap::new();
    for asset_name in asset_names {
        let values = load_string_dictionary_best_effort(&[
            content_dir
                .join("Strings")
                .join(format!("{}.zh-CN.xnb", asset_name)),
            content_dir
                .join("Strings")
                .join(format!("{}.xnb", asset_name)),
        ]);
        if !values.is_empty() {
            tables.insert((*asset_name).to_string(), values);
        }
    }
    tables
}

pub fn load_xnb_texture(path: &Path) -> Result<Texture, String> {
    let payload = load_xnb_payload(path)?;
    parse_texture_payload(&payload)
        .map_err(|e| format!("Failed to parse texture {}: {}", path.display(), e))
}

pub fn parse_texture_payload(payload: &[u8]) -> Result<Texture, String> {
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
