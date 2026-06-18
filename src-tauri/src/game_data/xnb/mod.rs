pub mod loaders;
pub mod primitives;
pub mod reader;
mod skippers;

use lzxd::{Lzxd, WindowSize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

pub use loaders::{
    get_lang_suffix, load_crops_xnb, load_farm_animals_xnb, load_int_string_dictionary_best_effort,
    load_int_string_dictionary_xnb, load_localized_string_tables_with_lang,
    load_location_fishing_xnb, load_objects_xnb, load_string_dictionary_best_effort,
    load_string_dictionary_xnb, load_tools_xnb, load_weapons_xnb, load_xnb_texture,
};
pub use primitives::XnbPayloadReader;

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
pub struct RawWeaponData {
    pub name: String,
    pub display_name: String,
    pub description: String,
    pub min_damage: i32,
    pub max_damage: i32,
    pub weapon_type: i32,
    pub texture: String,
    pub sprite_index: i32,
}

#[derive(Debug, Clone)]
pub struct RawToolData {
    pub class_name: String,
    pub name: String,
    pub display_name: String,
    pub description: String,
    pub texture: String,
    pub sprite_index: i32,
    pub menu_sprite_index: i32,
    pub upgrade_level: i32,
    pub sale_price: i32,
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
    pub min_distance_from_shore: i32,
    pub max_distance_from_shore: i32,
}

#[derive(Debug, Clone, Default)]
pub struct RawLocationFishingData {
    pub fish_areas: HashMap<String, RawLocationFishArea>,
    pub fish: Vec<RawLocationFishEntry>,
}

#[derive(Debug, Clone)]
pub struct RawFarmAnimalProduce {
    pub item_id: String,
}

#[derive(Debug, Clone)]
pub struct RawFarmAnimalData {
    pub display_name: String,
    pub house: String,
    pub purchase_price: i32,
    pub sell_price: i32,
    pub days_to_mature: i32,
    pub days_to_produce: i32,
    pub can_get_pregnant: bool,
    pub harvest_type: i32,
    pub harvest_tool: String,
    pub produce_items: Vec<RawFarmAnimalProduce>,
    pub deluxe_produce_items: Vec<RawFarmAnimalProduce>,
    pub deluxe_produce_min_friendship: i32,
    pub can_swim: bool,
    pub can_eat_golden_crackers: bool,
    pub texture: String,
    pub baby_texture: String,
    pub sprite_width: i32,
    pub sprite_height: i32,
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

#[cfg(test)]
pub fn load_localized_string_tables(
    content_dir: &Path,
    asset_names: &[&str],
) -> HashMap<String, HashMap<String, String>> {
    load_localized_string_tables_with_lang(content_dir, asset_names, Some("zh"))
}
