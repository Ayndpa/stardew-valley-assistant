use serde::{Deserialize, Serialize};
use std::fs;
use tokio::task;

use super::xml_utils::{extract_tag_i32, extract_tag_string};

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OwnedAnimal {
    pub id: i32,
    pub name: String,
    pub type_name: String,
    pub age: i32,
    pub is_baby: bool,
    pub friendship: i32,
    pub happiness: i32,
    pub mood_message: String,
    pub fullness: i32,
    pub was_pet: bool,
    pub home_building: String,
    pub produce_item: Option<String>,
    pub days_since_last_lay: i32,
}

fn mood_message_text(happiness: i32, fullness: i32, _was_pet: bool, is_zh: bool) -> String {
    if fullness < 30 {
        return if is_zh {
            "饥饿".to_string()
        } else {
            "Hungry".to_string()
        };
    }
    if happiness >= 200 {
        return if is_zh {
            "开心".to_string()
        } else {
            "Happy".to_string()
        };
    }
    if happiness >= 30 {
        return if is_zh {
            "还好".to_string()
        } else {
            "Fine".to_string()
        };
    }
    if is_zh {
        "不开心".to_string()
    } else {
        "Unhappy".to_string()
    }
}

fn parse_animals_from_xml(xml: &str) -> Vec<OwnedAnimal> {
    let mut animals = Vec::new();

    // Find all FarmAnimal blocks in the entire XML
    let mut pos = 0usize;
    while let Some(start_rel) = xml[pos..].find("<FarmAnimal>") {
        let start = pos + start_rel;
        let Some(end_rel) = xml[start..].find("</FarmAnimal>") else {
            break;
        };
        let end = start + end_rel + "</FarmAnimal>".len();
        let animal_xml = &xml[start..end];

        let id = extract_tag_i32(animal_xml, "myID");
        let name = extract_tag_string(animal_xml, "name");
        let type_name = extract_tag_string(animal_xml, "type");
        let age = extract_tag_i32(animal_xml, "age");
        let friendship = extract_tag_i32(animal_xml, "friendshipTowardFarmer");
        let happiness = extract_tag_i32(animal_xml, "happiness");
        let fullness = extract_tag_i32(animal_xml, "fullness");
        let days_since_last_lay = extract_tag_i32(animal_xml, "daysSinceLastLay");

        let was_pet = animal_xml.contains("<wasPet>true</wasPet>")
            || animal_xml.contains("<wasAutoPet>true</wasAutoPet>");

        // Determine if baby: age < daysToMature or type starts with "Baby"
        let is_baby = type_name.starts_with("Baby") || age < 1;

        // Find home building from homeLocation tag
        let home_building = extract_tag_string(animal_xml, "homeLocation");

        // Check for produce item
        let produce_item = if animal_xml.contains("<Produce>") {
            let produce_str = extract_tag_string(animal_xml, "Produce");
            if produce_str.is_empty() || produce_str == "0" {
                None
            } else {
                Some(produce_str)
            }
        } else {
            None
        };

        let mood = mood_message_text(happiness, fullness, was_pet, true);

        animals.push(OwnedAnimal {
            id,
            name,
            type_name,
            age,
            is_baby,
            friendship,
            happiness,
            mood_message: mood,
            fullness,
            was_pet,
            home_building,
            produce_item,
            days_since_last_lay,
        });

        pos = end;
    }

    animals
}

fn get_save_animals_sync(id: String) -> Result<Vec<OwnedAnimal>, String> {
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

    let animals = parse_animals_from_xml(&xml);

    // Sort by home building, then by name
    let mut sorted = animals;
    sorted.sort_by(|a, b| {
        a.home_building
            .cmp(&b.home_building)
            .then(a.name.cmp(&b.name))
    });

    Ok(sorted)
}

#[tauri::command]
pub async fn get_save_animals(id: String) -> Result<Vec<OwnedAnimal>, String> {
    task::spawn_blocking(move || get_save_animals_sync(id))
        .await
        .map_err(|e| format!("读取动物数据任务失败: {}", e))?
}
