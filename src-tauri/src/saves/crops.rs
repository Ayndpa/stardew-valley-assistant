use serde::{Deserialize, Serialize};
use std::fs;
use std::time::Instant;
use tokio::task;

use super::xml_utils::{
    extract_direct_child_blocks, extract_tag_i32, extract_tag_string, get_direct_child_tag_value,
};

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PlantedCrop {
    pub location: String,
    pub x: i32,
    pub y: i32,
    pub seed_id: String,
    pub harvest_id: String,
    pub current_phase: i32,
    pub day_of_current_phase: i32,
    pub fully_grown: bool,
    pub dead: bool,
    pub is_watered: bool,
    pub phase_days: Vec<i32>,
}

fn extract_game_location_blocks(xml: &str) -> Vec<&str> {
    let Some(locations_start) = xml.find("<locations>") else {
        eprintln!("[get_planted_crops] no <locations> section found");
        return Vec::new();
    };
    let Some(locations_end_rel) = xml[locations_start..].find("</locations>") else {
        eprintln!("[get_planted_crops] no </locations> terminator found");
        return Vec::new();
    };
    let locations_end = locations_start + locations_end_rel;
    let locations_xml = &xml[locations_start..locations_end];
    eprintln!(
        "[get_planted_crops] locations section bytes={} start={}",
        locations_xml.len(),
        locations_start
    );

    let mut blocks = Vec::new();
    let mut pos = 0usize;
    let open_tag = "<GameLocation";
    let close_tag = "</GameLocation>";
    let mut location_index = 0usize;

    while let Some(start_rel) = locations_xml[pos..].find(open_tag) {
        let start = pos + start_rel;
        let Some(open_end_rel) = locations_xml[start..].find('>') else {
            eprintln!(
                "[get_planted_crops] malformed GameLocation opening tag at byte {}",
                start
            );
            break;
        };
        let mut search = start + open_end_rel + 1;
        let mut depth = 1usize;
        location_index += 1;
        if location_index <= 10 || location_index % 25 == 0 {
            eprintln!(
                "[get_planted_crops] scanning GameLocation #{} at local byte {}",
                location_index, start
            );
        }

        while depth > 0 {
            let next_open = locations_xml[search..]
                .find(open_tag)
                .map(|idx| search + idx);
            let next_close = locations_xml[search..]
                .find(close_tag)
                .map(|idx| search + idx);

            match (next_open, next_close) {
                (_, None) => {
                    eprintln!(
                        "[get_planted_crops] unterminated GameLocation #{} search={}",
                        location_index, search
                    );
                    return blocks;
                }
                (Some(open_idx), Some(close_idx)) if open_idx < close_idx => {
                    depth += 1;
                    search = open_idx + open_tag.len();
                }
                (_, Some(close_idx)) => {
                    depth -= 1;
                    search = close_idx + close_tag.len();
                }
            }
        }

        blocks.push(&locations_xml[start..search]);
        if location_index <= 10 || location_index % 25 == 0 {
            eprintln!(
                "[get_planted_crops] captured GameLocation #{} bytes={}",
                location_index,
                search - start
            );
        }
        pos = search;
    }

    eprintln!(
        "[get_planted_crops] extracted {} GameLocation blocks",
        blocks.len()
    );

    blocks
}

fn get_planted_crops_sync(id: String) -> Result<Vec<PlantedCrop>, String> {
    let started_at = Instant::now();
    eprintln!("[get_planted_crops] start save_id={}", id);
    let saves_dir = super::get_saves_dir()
        .ok_or_else(|| "Could not locate APPDATA or HOME directory".to_string())?;

    let save_folder = saves_dir.join(&id);
    if !save_folder.exists() {
        return Err(format!("Save folder {} does not exist", id));
    }

    let main_save_path = save_folder.join(&id);
    if !main_save_path.exists() {
        return Err(format!("Main save file {} not found in {}", id, id));
    }

    let xml = fs::read_to_string(&main_save_path)
        .map_err(|e| format!("Failed to read main save file: {}", e))?;
    eprintln!(
        "[get_planted_crops] loaded save bytes={} path={}",
        xml.len(),
        main_save_path.display()
    );

    let mut planted_crops = Vec::new();
    let location_blocks = extract_game_location_blocks(&xml);
    eprintln!(
        "[get_planted_crops] begin processing {} location blocks",
        location_blocks.len()
    );

    for (location_index, loc_xml) in location_blocks.into_iter().enumerate() {
        let location_started_at = Instant::now();
        let name = get_direct_child_tag_value(loc_xml, "name")
            .unwrap_or("Unknown")
            .to_string();
        eprintln!(
            "[get_planted_crops] location-start #{} name={} bytes={}",
            location_index + 1,
            name,
            loc_xml.len()
        );

        let Some(tf_start) = loc_xml.find("<terrainFeatures>") else {
            continue;
        };
        let Some(tf_end_rel) = loc_xml[tf_start..].find("</terrainFeatures>") else {
            continue;
        };
        let terrain_features_section =
            &loc_xml[tf_start..tf_start + tf_end_rel + "</terrainFeatures>".len()];
        let terrain_feature_items = extract_direct_child_blocks(terrain_features_section, "item");
        if terrain_feature_items.is_empty() {
            continue;
        }

        let mut location_hoe_dirt_count = 0usize;
        let mut location_crop_count = 0usize;
        let mut scanned_items = 0usize;
        for item_xml in terrain_feature_items {
            scanned_items += 1;
            if scanned_items % 1000 == 0 {
                eprintln!(
                    "[get_planted_crops] location-progress name={} scanned_items={} hoe_dirt={} parsed_crops={} elapsed_ms={}",
                    name,
                    scanned_items,
                    location_hoe_dirt_count,
                    location_crop_count,
                    location_started_at.elapsed().as_millis()
                );
            }

            if item_xml.contains("xsi:type=\"HoeDirt\"") || item_xml.contains("type=\"HoeDirt\"") {
                location_hoe_dirt_count += 1;
                let mut x = 0;
                let mut y = 0;
                if let Some(key_start) = item_xml.find("<key>") {
                    if let Some(key_end) = item_xml.find("</key>") {
                        let key_xml = &item_xml[key_start..key_end];
                        if let Some(x_start) = key_xml.find("<X>") {
                            if let Some(x_end) = key_xml.find("</X>") {
                                x = key_xml[x_start + 3..x_end].parse::<i32>().unwrap_or(0);
                            }
                        }
                        if let Some(y_start) = key_xml.find("<Y>") {
                            if let Some(y_end) = key_xml.find("</Y>") {
                                y = key_xml[y_start + 3..y_end].parse::<i32>().unwrap_or(0);
                            }
                        }
                    }
                }

                if let Some(val_start) = item_xml.find("<value>") {
                    if let Some(val_end) = item_xml.find("</value>") {
                        let val_xml = &item_xml[val_start..val_end];

                        let mut is_watered = false;
                        if let Some(state_start) = val_xml.find("<state>") {
                            if let Some(state_end) = val_xml.find("</state>") {
                                let state_val = val_xml[state_start + 7..state_end]
                                    .parse::<i32>()
                                    .unwrap_or(0);
                                is_watered = state_val == 1;
                            }
                        }

                        if let Some(crop_start) = val_xml.find("<crop>") {
                            if let Some(crop_end) = val_xml.find("</crop>") {
                                let crop_xml = &val_xml[crop_start..crop_end];

                                let current_phase = extract_tag_i32(crop_xml, "currentPhase");
                                let day_of_current_phase =
                                    extract_tag_i32(crop_xml, "dayOfCurrentPhase");

                                let mut fully_grown = false;
                                if let Some(fg_start) = crop_xml.find("<fullGrown>") {
                                    if let Some(fg_end) = crop_xml.find("</fullGrown>") {
                                        fully_grown =
                                            crop_xml[fg_start + 11..fg_end].trim() == "true";
                                    }
                                }

                                let mut dead = false;
                                if let Some(d_start) = crop_xml.find("<dead>") {
                                    if let Some(d_end) = crop_xml.find("</dead>") {
                                        dead = crop_xml[d_start + 6..d_end].trim() == "true";
                                    }
                                }

                                let seed_id = extract_tag_string(crop_xml, "seedIndex");
                                let harvest_id = extract_tag_string(crop_xml, "indexOfHarvest");

                                let mut phase_days = Vec::new();
                                if let Some(pd_start) = crop_xml.find("<phaseDays>") {
                                    if let Some(pd_end) = crop_xml.find("</phaseDays>") {
                                        let pd_xml = &crop_xml[pd_start..pd_end];
                                        let mut pd_pos = 0;
                                        while let Some(int_start) = pd_xml[pd_pos..].find("<int>") {
                                            let abs_int_start = pd_pos + int_start;
                                            if let Some(int_end) =
                                                pd_xml[abs_int_start..].find("</int>")
                                            {
                                                let abs_int_end = abs_int_start + int_end;
                                                let val_str =
                                                    &pd_xml[abs_int_start + 5..abs_int_end];
                                                if let Ok(val) = val_str.parse::<i32>() {
                                                    phase_days.push(val);
                                                }
                                                pd_pos = abs_int_end + 6;
                                            } else {
                                                break;
                                            }
                                        }
                                    }
                                }

                                if seed_id.is_empty() && harvest_id.is_empty() {
                                    continue;
                                }

                                location_crop_count += 1;
                                planted_crops.push(PlantedCrop {
                                    location: name.clone(),
                                    x,
                                    y,
                                    seed_id,
                                    harvest_id,
                                    current_phase,
                                    day_of_current_phase,
                                    fully_grown,
                                    dead,
                                    is_watered,
                                    phase_days,
                                });
                            }
                        }
                    }
                }
            }
        }

        eprintln!(
            "[get_planted_crops] location-done name={} scanned_items={} hoe_dirt={} parsed_crops={} running_total={} elapsed_ms={}",
            name,
            scanned_items,
            location_hoe_dirt_count,
            location_crop_count,
            planted_crops.len(),
            location_started_at.elapsed().as_millis()
        );
    }

    eprintln!(
        "[get_planted_crops] finished total_parsed_crops={} total_elapsed_ms={}",
        planted_crops.len(),
        started_at.elapsed().as_millis()
    );
    Ok(planted_crops)
}

#[tauri::command]
pub async fn get_planted_crops(id: String) -> Result<Vec<PlantedCrop>, String> {
    task::spawn_blocking(move || get_planted_crops_sync(id))
        .await
        .map_err(|e| format!("读取种植作物任务失败: {}", e))?
}
