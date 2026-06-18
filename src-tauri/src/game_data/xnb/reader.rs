use std::collections::HashMap;

use super::super::calendar::{
    resolve_localized_text, season_name_localized, CalendarBirthday, CalendarFestival,
};
use super::super::npc::NpcProfile;
use super::primitives::XnbPayloadReader;
use super::{
    RawCropData, RawFarmAnimalData, RawFarmAnimalProduce, RawLocationFishingData, RawObjectData,
    RawToolData, RawWeaponData,
};

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

    pub fn read_weapon_data(&mut self) -> Result<RawWeaponData, String> {
        let name = self.read_object_string_any()?;
        let display_name = self.read_object_string_any()?;
        let description = self.read_object_string_any()?;
        let min_damage = self.read_i32()?;
        let max_damage = self.read_i32()?;
        let _knockback = self.read_f32()?;
        let _speed = self.read_i32()?;
        let _precision = self.read_i32()?;
        let _defense = self.read_i32()?;
        let weapon_type = self.read_i32()?;
        let _mine_base_level = self.read_i32()?;
        let _mine_min_level = self.read_i32()?;
        let _area_of_effect = self.read_i32()?;
        let _crit_chance = self.read_f32()?;
        let _crit_multiplier = self.read_f32()?;
        let _can_be_lost_on_death = self.read_bool()?;
        let texture = self.read_object_string_any()?;
        let sprite_index = self.read_i32()?;
        self.skip_nullable_weapon_projectile_list()?;
        self.skip_nullable_string_dictionary()?;

        Ok(RawWeaponData {
            name,
            display_name,
            description,
            min_damage,
            max_damage,
            weapon_type,
            texture,
            sprite_index,
        })
    }

    pub fn read_tool_data(&mut self) -> Result<RawToolData, String> {
        let class_name = self.read_object_string_any()?;
        let name = self.read_object_string_any()?;
        let attachment_slots = self.read_i32()?;
        let sale_price = self.read_i32()?;
        let display_name = self.read_object_string_any()?;
        let description = self.read_object_string_any()?;
        let texture = self.read_object_string_any()?;
        let sprite_index = self.read_i32()?;
        let menu_sprite_index = self.read_i32()?;
        let upgrade_level = self.read_i32()?;
        let _conventional_upgrade_from = self.read_object_string_any()?;
        self.skip_nullable_tool_upgrade_data_list()?;
        let _can_be_lost_on_death = self.read_bool()?;
        self.skip_nullable_string_dictionary()?; // SetProperties
        self.skip_nullable_string_dictionary()?; // ModData
        self.skip_nullable_string_dictionary()?; // CustomFields

        Ok(RawToolData {
            class_name,
            name,
            display_name,
            description,
            texture,
            sprite_index,
            menu_sprite_index,
            upgrade_level,
            sale_price,
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

    pub fn read_farm_animal_data(&mut self) -> Result<RawFarmAnimalData, String> {
        // Field order matches FarmAnimalData.cs declaration order for XNA ReflectiveReader.
        // Lists in XNB are serialized as: reader_index (7-bit) + count (i32) + elements.
        let _display_name_raw = self.read_object_string_any()?;
        let house = self.read_object_string_any()?;
        let _gender = self.read_i32()?; // FarmAnimalGender enum
        let purchase_price = self.read_i32()?;
        let sell_price = self.read_i32()?;
        let _shop_texture = self.read_object_string_any()?;
        // ShopSourceRect is a Rectangle (struct, not nullable)
        let _shop_src_x = self.read_i32()?;
        let _shop_src_y = self.read_i32()?;
        let _shop_src_w = self.read_i32()?;
        let _shop_src_h = self.read_i32()?;
        let _shop_display_name = self.read_object_string_any()?;
        let _shop_description = self.read_object_string_any()?;
        let _shop_missing_building_desc = self.read_object_string_any()?;
        let _required_building = self.read_object_string_any()?;
        let _unlock_condition = self.read_object_string_any()?;
        // AlternatePurchaseTypes: List<AlternatePurchaseAnimals>
        self.skip_alternate_purchase_list()?;
        // EggItemIds: List<string>
        self.skip_xnb_string_list()?;
        let _incubation_time = self.read_i32()?;
        let _incubator_parent_sheet_offset = self.read_i32()?;
        let _birth_text = self.read_object_string_any()?;
        let days_to_mature = self.read_i32()?;
        let can_get_pregnant = self.read_bool()?;
        let days_to_produce = self.read_i32()?;
        let harvest_type = self.read_i32()?; // FarmAnimalHarvestType enum
        let harvest_tool = self.read_object_string_any()?;
        // ProduceItemIds: List<FarmAnimalProduce>
        let produce_items = self.read_farm_animal_produce_list()?;
        // DeluxeProduceItemIds: List<FarmAnimalProduce>
        let deluxe_produce_items = self.read_farm_animal_produce_list()?;
        let _produce_on_mature = self.read_bool()?;
        let _friendship_for_faster_produce = self.read_i32()?;
        let deluxe_produce_min_friendship = self.read_i32()?;
        let _deluxe_produce_care_divisor = self.read_f32()?;
        let _deluxe_produce_luck_multiplier = self.read_f32()?;
        let can_eat_golden_crackers = self.read_bool()?;
        let _profession_happiness_boost = self.read_i32()?;
        let _profession_quality_boost = self.read_i32()?;
        let _profession_faster_produce = self.read_i32()?;
        let _sound = self.read_object_string_any()?;
        let _baby_sound = self.read_object_string_any()?;
        let texture = self.read_object_string_any()?;
        let _harvested_texture = self.read_object_string_any()?;
        let baby_texture = self.read_object_string_any()?;
        let _use_flipped_right_for_left = self.read_bool()?;
        let sprite_width = self.read_i32()?;
        let sprite_height = self.read_i32()?;
        let _use_double_unique_anim = self.read_bool()?;
        let _sleep_frame = self.read_i32()?;
        // EmoteOffset: Point (struct)
        let _emote_x = self.read_i32()?;
        let _emote_y = self.read_i32()?;
        // SwimOffset: Point (struct)
        let _swim_x = self.read_i32()?;
        let _swim_y = self.read_i32()?;
        // Skins: List<FarmAnimalSkin>
        self.skip_farm_animal_skin_list()?;
        // ShadowWhenBabySwims: nullable FarmAnimalShadowData
        self.skip_nullable_shadow_data()?;
        // ShadowWhenBaby: nullable FarmAnimalShadowData
        self.skip_nullable_shadow_data()?;
        // ShadowWhenAdultSwims: nullable FarmAnimalShadowData
        self.skip_nullable_shadow_data()?;
        // ShadowWhenAdult: nullable FarmAnimalShadowData
        self.skip_nullable_shadow_data()?;
        // Shadow: nullable FarmAnimalShadowData
        self.skip_nullable_shadow_data()?;
        let can_swim = self.read_bool()?;
        let _babies_follow_adults = self.read_bool()?;
        let _grass_eat_amount = self.read_i32()?;
        let _happiness_drain = self.read_i32()?;
        // UpDownPetHitboxTileSize: Vector2
        let _pet_hitbox_ud_x = self.read_f32()?;
        let _pet_hitbox_ud_y = self.read_f32()?;
        // LeftRightPetHitboxTileSize: Vector2
        let _pet_hitbox_lr_x = self.read_f32()?;
        let _pet_hitbox_lr_y = self.read_f32()?;
        // BabyUpDownPetHitboxTileSize: Vector2
        let _baby_hitbox_ud_x = self.read_f32()?;
        let _baby_hitbox_ud_y = self.read_f32()?;
        // BabyLeftRightPetHitboxTileSize: Vector2
        let _baby_hitbox_lr_x = self.read_f32()?;
        let _baby_hitbox_lr_y = self.read_f32()?;
        // StatToIncrementOnProduce: List<StatIncrement>
        self.skip_stat_increment_list()?;
        let _show_in_summit_credits = self.read_bool()?;
        // CustomFields: Dictionary<string, string>
        self.skip_nullable_string_dictionary()?;

        Ok(RawFarmAnimalData {
            display_name: _display_name_raw,
            house,
            purchase_price,
            sell_price,
            days_to_mature,
            days_to_produce,
            can_get_pregnant,
            harvest_type,
            harvest_tool,
            produce_items,
            deluxe_produce_items,
            deluxe_produce_min_friendship,
            can_swim,
            can_eat_golden_crackers,
            texture,
            baby_texture,
            sprite_width,
            sprite_height,
        })
    }

    /// Skip a List<string> in XNB format: reader_index (7-bit) + count (i32) + strings.
    fn skip_xnb_string_list(&mut self) -> Result<(), String> {
        if self.read_7bit_usize()? == 0 {
            return Ok(());
        }
        let count = self.read_i32()?.max(0) as usize;
        for _ in 0..count {
            let _ = self.read_object_string_any()?;
        }
        Ok(())
    }

    fn read_farm_animal_produce_list(
        &mut self,
    ) -> Result<Vec<RawFarmAnimalProduce>, String> {
        if self.read_7bit_usize()? == 0 {
            return Ok(Vec::new());
        }
        let count = self.read_i32()?.max(0) as usize;
        let mut items = Vec::with_capacity(count);
        for _ in 0..count {
            // Per-element reader index (ReflectiveReader)
            if self.read_7bit_usize()? == 0 {
                continue;
            }
            let _id = self.read_object_string_any()?;
            let _condition = self.read_object_string_any()?;
            let _minimum_friendship = self.read_i32()?;
            let item_id = self.read_object_string_any()?;
            items.push(RawFarmAnimalProduce { item_id });
        }
        Ok(items)
    }

    fn skip_alternate_purchase_list(&mut self) -> Result<(), String> {
        if self.read_7bit_usize()? == 0 {
            return Ok(());
        }
        let count = self.read_i32()?.max(0) as usize;
        for _ in 0..count {
            // Per-element reader index (ReflectiveReader)
            if self.read_7bit_usize()? == 0 {
                continue;
            }
            let _id = self.read_object_string_any()?;
            let _condition = self.read_object_string_any()?;
            // AnimalIds: List<string>
            self.skip_xnb_string_list()?;
        }
        Ok(())
    }

    fn skip_farm_animal_skin_list(&mut self) -> Result<(), String> {
        if self.read_7bit_usize()? == 0 {
            return Ok(());
        }
        let count = self.read_i32()?.max(0) as usize;
        for _ in 0..count {
            // Per-element reader index (ReflectiveReader)
            if self.read_7bit_usize()? == 0 {
                continue;
            }
            let _id = self.read_object_string_any()?;
            let _weight = self.read_f32()?;
            let _texture = self.read_object_string_any()?;
            let _harvested_texture = self.read_object_string_any()?;
            let _baby_texture = self.read_object_string_any()?;
        }
        Ok(())
    }

    fn skip_nullable_shadow_data(&mut self) -> Result<(), String> {
        // FarmAnimalShadowData is a class (reference type), so nullable class references
        // are serialized as a 7-bit type reader index (0 = null), not a bool presence flag.
        // NullableReader<T> only handles value types (where T : struct).
        if self.read_7bit_usize()? == 0 {
            return Ok(());
        }
        let _visible = self.read_bool()?;
        // Offset: nullable Point (value type, uses bool presence flag)
        if self.read_bool()? {
            let _x = self.read_i32()?;
            let _y = self.read_i32()?;
        }
        // Scale: nullable float (value type, uses bool presence flag)
        if self.read_bool()? {
            let _ = self.read_f32()?;
        }
        Ok(())
    }

    fn skip_stat_increment_list(&mut self) -> Result<(), String> {
        if self.read_7bit_usize()? == 0 {
            return Ok(());
        }
        let count = self.read_i32()?.max(0) as usize;
        for _ in 0..count {
            // Per-element reader index (ReflectiveReader)
            if self.read_7bit_usize()? == 0 {
                continue;
            }
            let _id = self.read_object_string_any()?;
            let _required_item_id = self.read_object_string_any()?;
            // RequiredTags: List<string>
            self.skip_xnb_string_list()?;
            let _stat_name = self.read_object_string_any()?;
        }
        Ok(())
    }
}
