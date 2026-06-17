use std::collections::HashMap;

use super::primitives::XnbPayloadReader;
use super::{RawLocationFishArea, RawLocationFishEntry};

impl<'a> XnbPayloadReader<'a> {
    // ── Collection / list helpers ──────────────────────────────────────

    pub(crate) fn read_object_i32_list(&mut self) -> Result<Vec<i32>, String> {
        if self.read_7bit_usize()? == 0 {
            return Ok(Vec::new());
        }
        self.read_i32_list()
    }

    pub(crate) fn skip_object_i32_list(&mut self) -> Result<(), String> {
        if self.read_7bit_usize()? == 0 {
            return Ok(());
        }
        let count = self.read_i32()?.max(0) as usize;
        for _ in 0..count {
            let _ = self.read_i32()?;
        }
        Ok(())
    }

    pub(crate) fn read_i32_list(&mut self) -> Result<Vec<i32>, String> {
        let count = self.read_i32()?.max(0) as usize;
        let mut values = Vec::with_capacity(count);
        for _ in 0..count {
            values.push(self.read_i32()?);
        }
        Ok(values)
    }

    pub(crate) fn skip_string_list(&mut self) -> Result<(), String> {
        let count = self.read_i32()?.max(0) as usize;
        for _ in 0..count {
            let _ = self.read_object_string_any()?;
        }
        Ok(())
    }

    pub(crate) fn skip_nullable_string_list(&mut self) -> Result<(), String> {
        if self.read_7bit_usize()? == 0 {
            return Ok(());
        }
        self.skip_string_list()
    }

    pub(crate) fn skip_nullable_string_dictionary(&mut self) -> Result<(), String> {
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

    pub(crate) fn skip_nullable_i32(&mut self) -> Result<(), String> {
        if self.read_bool()? {
            let _ = self.read_i32()?;
        }
        Ok(())
    }

    pub(crate) fn read_nullable_i32(&mut self) -> Result<Option<i32>, String> {
        if self.read_bool()? {
            return Ok(Some(self.read_i32()?));
        }
        Ok(None)
    }

    pub(crate) fn skip_nullable_bool(&mut self) -> Result<(), String> {
        if self.read_bool()? {
            let _ = self.read_bool()?;
        }
        Ok(())
    }

    pub(crate) fn read_nullable_string_list_values(&mut self) -> Result<Vec<String>, String> {
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

    // ── Geometry helpers ───────────────────────────────────────────────

    pub(crate) fn skip_point(&mut self) -> Result<(), String> {
        let _x = self.read_i32()?;
        let _y = self.read_i32()?;
        Ok(())
    }

    pub(crate) fn skip_nullable_point(&mut self) -> Result<(), String> {
        if self.read_bool()? {
            self.skip_point()?;
        }
        Ok(())
    }

    pub(crate) fn skip_rectangle(&mut self) -> Result<(), String> {
        let _x = self.read_i32()?;
        let _y = self.read_i32()?;
        let _width = self.read_i32()?;
        let _height = self.read_i32()?;
        Ok(())
    }

    pub(crate) fn skip_nullable_rectangle(&mut self) -> Result<(), String> {
        if self.read_bool()? {
            self.skip_rectangle()?;
        }
        Ok(())
    }

    pub(crate) fn read_nullable_rectangle_tuple(
        &mut self,
    ) -> Result<Option<(i32, i32, i32, i32)>, String> {
        if self.read_bool()? {
            let x = self.read_i32()?;
            let y = self.read_i32()?;
            let width = self.read_i32()?;
            let height = self.read_i32()?;
            return Ok(Some((x, y, width, height)));
        }
        Ok(None)
    }

    // ── Stardew Valley complex type skippers ───────────────────────────

    pub(crate) fn skip_nullable_create_location_data(&mut self) -> Result<(), String> {
        if self.read_7bit_usize()? == 0 {
            return Ok(());
        }
        let _map_path = self.read_object_string_any()?;
        let _type = self.read_object_string_any()?;
        let _always_active = self.read_bool()?;
        Ok(())
    }

    pub(crate) fn skip_nullable_artifact_spot_drop_list(&mut self) -> Result<(), String> {
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

    pub(crate) fn read_nullable_fish_area_dictionary(
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

    pub(crate) fn read_nullable_spawn_fish_list(
        &mut self,
    ) -> Result<Vec<RawLocationFishEntry>, String> {
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
            let min_distance_from_shore = self.read_i32()?;
            let max_distance_from_shore = self.read_i32()?;
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
                min_distance_from_shore,
                max_distance_from_shore,
            });
        }
        Ok(fish)
    }

    pub(crate) fn skip_nullable_spawn_forage_list(&mut self) -> Result<(), String> {
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

    pub(crate) fn skip_nullable_location_music_list(&mut self) -> Result<(), String> {
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

    pub(crate) fn skip_nullable_character_spouse_room_data(&mut self) -> Result<(), String> {
        if self.read_7bit_usize()? == 0 {
            return Ok(());
        }
        let _map_asset = self.read_object_string_any()?;
        self.skip_rectangle()?;
        Ok(())
    }

    pub(crate) fn skip_nullable_character_spouse_patio_data(&mut self) -> Result<(), String> {
        if self.read_7bit_usize()? == 0 {
            return Ok(());
        }
        let _map_asset = self.read_object_string_any()?;
        self.skip_rectangle()?;
        self.skip_nullable_i32_array_list()?;
        self.skip_point()?;
        Ok(())
    }

    pub(crate) fn skip_nullable_i32_array_list(&mut self) -> Result<(), String> {
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

    pub(crate) fn skip_nullable_character_home_data_list(&mut self) -> Result<(), String> {
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

    pub(crate) fn skip_nullable_character_appearance_data_list(&mut self) -> Result<(), String> {
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

    pub(crate) fn skip_nullable_character_shadow_data(&mut self) -> Result<(), String> {
        if self.read_7bit_usize()? == 0 {
            return Ok(());
        }
        let _visible = self.read_bool()?;
        self.skip_point()?;
        let _scale = self.read_f32()?;
        Ok(())
    }

    pub(crate) fn skip_nullable_generic_spawn_item_data_with_condition_list(
        &mut self,
    ) -> Result<(), String> {
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

    pub(crate) fn skip_nullable_plantable_rules(&mut self) -> Result<(), String> {
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

    pub(crate) fn skip_nullable_object_buffs(&mut self) -> Result<(), String> {
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

    pub(crate) fn skip_nullable_buff_attributes(&mut self) -> Result<(), String> {
        if self.read_7bit_usize()? == 0 {
            return Ok(());
        }
        for _ in 0..18 {
            let _attribute = self.read_f32()?;
        }
        Ok(())
    }

    pub(crate) fn skip_nullable_quantity_modifier_list(&mut self) -> Result<(), String> {
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

    pub(crate) fn skip_nullable_f32_list(&mut self) -> Result<(), String> {
        if self.read_7bit_usize()? == 0 {
            return Ok(());
        }
        let count = self.read_i32()?.max(0) as usize;
        for _ in 0..count {
            let _amount = self.read_f32()?;
        }
        Ok(())
    }

    // ── Spawn item helpers ─────────────────────────────────────────────

    pub(crate) fn read_spawn_item_stub(&mut self) -> Result<Vec<String>, String> {
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

    pub(crate) fn read_spawn_item_with_condition_stub(&mut self) -> Result<Vec<String>, String> {
        let item_ids = self.read_spawn_item_stub()?;
        let _condition = self.read_object_string_any()?;
        Ok(item_ids)
    }

    pub(crate) fn skip_generic_spawn_item_data(&mut self) -> Result<(), String> {
        let _ = self.read_spawn_item_stub()?;
        Ok(())
    }

    pub(crate) fn skip_nullable_geode_drops(&mut self) -> Result<(), String> {
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

    pub(crate) fn skip_nullable_artifact_spot_chances(&mut self) -> Result<(), String> {
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

    // ── Character data tail skippers ───────────────────────────────────

    pub(crate) fn skip_character_data_tail(&mut self) -> Result<(), String> {
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

    pub(crate) fn skip_character_data_tail_after_social_tab(&mut self) -> Result<(), String> {
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
}
