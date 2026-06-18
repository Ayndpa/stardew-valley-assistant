use std::collections::HashMap;
use std::path::{Path, PathBuf};

use super::super::image_utils::{Pixel, Texture};
use super::{
    load_xnb_payload, require_reader, RawCropData, RawFarmAnimalData, RawLocationFishingData,
    RawObjectData, RawToolData, RawWeaponData,
};
use super::primitives::XnbPayloadReader;

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

pub fn load_farm_animals_xnb(path: &Path) -> Result<HashMap<String, RawFarmAnimalData>, String> {
    let payload = load_xnb_payload(path)?;
    let mut reader = XnbPayloadReader::new(&payload);
    let type_readers = reader.read_type_readers()?;
    let root_reader = reader.read_7bit_usize()?;
    if root_reader == 0 {
        return Ok(HashMap::new());
    }
    require_reader(&type_readers, root_reader, "DictionaryReader")?;

    let count = reader.read_i32()?.max(0) as usize;
    let mut animals = HashMap::with_capacity(count);
    for _ in 0..count {
        let key = reader.read_object_string(&type_readers)?;
        let value_reader = reader.read_7bit_usize()?;
        if value_reader == 0 {
            continue;
        }
        require_reader(&type_readers, value_reader, "ReflectiveReader")
            .map_err(|e| format!("Failed to parse animal '{}' reader: {}", key, e))?;
        let start_pos = reader.pos;
        let value = reader.read_farm_animal_data().map_err(|e| {
            format!(
                "Failed to parse animal '{}' at byte {}: {}",
                key, start_pos, e
            )
        })?;
        animals.insert(key, value);
    }
    Ok(animals)
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
        let value = reader
            .read_location_fishing_data()
            .map_err(|e| format!("Failed to parse location fishing data '{}' : {}", key, e))?;
        locations.insert(key, value);
    }
    Ok(locations)
}

pub fn load_weapons_xnb(path: &Path) -> Result<HashMap<String, RawWeaponData>, String> {
    let payload = load_xnb_payload(path)?;
    let mut reader = XnbPayloadReader::new(&payload);
    let type_readers = reader.read_type_readers()?;
    let root_reader = reader.read_7bit_usize()?;
    if root_reader == 0 {
        return Ok(HashMap::new());
    }
    require_reader(&type_readers, root_reader, "DictionaryReader")?;

    let count = reader.read_i32()?.max(0) as usize;
    let mut weapons = HashMap::with_capacity(count);
    for _ in 0..count {
        let key = reader.read_object_string(&type_readers)?;
        let value_reader = reader.read_7bit_usize()?;
        if value_reader == 0 {
            continue;
        }
        require_reader(&type_readers, value_reader, "ReflectiveReader")
            .map_err(|e| format!("Failed to parse weapon '{}' reader: {}", key, e))?;
        let start_pos = reader.pos;
        let value = reader.read_weapon_data().map_err(|e| {
            format!(
                "Failed to parse weapon '{}' at byte {}: {}",
                key, start_pos, e
            )
        })?;
        weapons.insert(key, value);
    }
    Ok(weapons)
}

pub fn load_tools_xnb(path: &Path) -> Result<HashMap<String, RawToolData>, String> {
    let payload = load_xnb_payload(path)?;
    let mut reader = XnbPayloadReader::new(&payload);
    let type_readers = reader.read_type_readers()?;
    let root_reader = reader.read_7bit_usize()?;
    if root_reader == 0 {
        return Ok(HashMap::new());
    }
    require_reader(&type_readers, root_reader, "DictionaryReader")?;

    let count = reader.read_i32()?.max(0) as usize;
    let mut tools = HashMap::with_capacity(count);
    for _ in 0..count {
        let key = reader.read_object_string(&type_readers)?;
        let value_reader = reader.read_7bit_usize()?;
        if value_reader == 0 {
            continue;
        }
        require_reader(&type_readers, value_reader, "ReflectiveReader")
            .map_err(|e| format!("Failed to parse tool '{}' reader: {}", key, e))?;
        let start_pos = reader.pos;
        let value = reader.read_tool_data().map_err(|e| {
            format!(
                "Failed to parse tool '{}' at byte {}: {}",
                key, start_pos, e
            )
        })?;
        tools.insert(key, value);
    }
    Ok(tools)
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

/// Load a Dictionary<int, string> XNB file (e.g. Data/SecretNotes).
/// Keys are read as i32 and converted to strings; values are read as strings.
pub fn load_int_string_dictionary_xnb(path: &Path) -> Result<HashMap<String, String>, String> {
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
        // Key is stored as raw i32 (no reader index prefix in dictionary entries)
        let key = reader.read_i32()?;
        // Value is stored as object string (with reader index prefix)
        let value = reader.read_object_string(&type_readers)?;
        values.insert(key.to_string(), value);
    }
    Ok(values)
}

/// Best-effort loader for Dictionary<int, string> XNB files with localization fallback.
pub fn load_int_string_dictionary_best_effort(paths: &[PathBuf]) -> HashMap<String, String> {
    for path in paths {
        if !path.exists() {
            continue;
        }
        if let Ok(values) = load_int_string_dictionary_xnb(path) {
            return values;
        }
    }
    HashMap::new()
}

pub fn get_lang_suffix(lang: Option<&str>) -> &'static str {
    let lang_str = lang.unwrap_or("zh");
    match lang_str.to_lowercase().as_str() {
        "zh" | "zh-cn" => ".zh-CN",
        "ja" | "ja-jp" => ".ja-JP",
        "ru" | "ru-ru" => ".ru-RU",
        "de" | "de-de" => ".de-DE",
        "es" | "es-es" => ".es-ES",
        "fr" | "fr-fr" => ".fr-FR",
        "it" | "it-it" => ".it-IT",
        "ko" | "ko-kr" => ".ko-KR",
        "pt" | "pt-br" => ".pt-BR",
        "tr" | "tr-tr" => ".tr-TR",
        "hu" | "hu-hu" => ".hu-HU",
        _ => "",
    }
}

pub fn load_localized_string_tables_with_lang(
    content_dir: &Path,
    asset_names: &[&str],
    lang: Option<&str>,
) -> HashMap<String, HashMap<String, String>> {
    let lang_str = lang.unwrap_or("zh");
    let suffix = get_lang_suffix(Some(lang_str));

    let mut tables = HashMap::new();
    for asset_name in asset_names {
        let mut paths = Vec::new();
        if !suffix.is_empty() {
            paths.push(
                content_dir
                    .join("Strings")
                    .join(format!("{}{}.xnb", asset_name, suffix)),
            );
        }
        paths.push(
            content_dir
                .join("Strings")
                .join(format!("{}.xnb", asset_name)),
        );

        let values = load_string_dictionary_best_effort(&paths);
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
