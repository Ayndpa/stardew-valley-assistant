use serde::{Deserialize, Serialize};

use super::calendar::resolve_localized_text;
use super::image_utils::render_object_icon;
use super::xnb::{load_localized_string_tables, load_objects_xnb};

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ItemEncyclopediaEntry {
    pub id: String,
    pub name: String,
    pub internal_name: String,
    pub description: String,
    pub item_type: String,
    pub item_type_key: String,
    pub category: String,
    pub category_key: String,
    pub icon: Option<String>,
    pub sell_price: i32,
    pub edibility: Option<i32>,
    pub can_be_given_as_gift: bool,
    pub can_be_trashed: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ItemGameData {
    pub encyclopedia: Vec<ItemEncyclopediaEntry>,
    pub categories: Vec<String>,
    pub item_types: Vec<String>,
}

#[tauri::command]
pub fn get_item_game_data(game_dir: Option<String>) -> Result<ItemGameData, String> {
    let content_dir = super::locate_content_dir(game_dir.as_deref())?;
    let objects = load_objects_xnb(&content_dir.join("Data").join("Objects.xnb"))?;
    let localized_tables = load_localized_string_tables(
        &content_dir,
        &["Objects", "1_6_Strings", "StringsFromCSFiles"],
    );

    let mut encyclopedia = Vec::with_capacity(objects.len());
    let mut texture_cache = std::collections::HashMap::new();

    for (id, object) in objects {
        let name = resolve_localized_text(&object.display_name, &localized_tables);
        let description = resolve_localized_text(&object.description, &localized_tables);
        let icon = render_object_icon(&content_dir, &object, &mut texture_cache).ok();
        let (item_type_key, item_type) = classify_item_type(&object.object_type, object.category);
        let (category_key, category) = classify_category(object.category, &object.object_type);
        let edibility = (object.edibility > -300).then_some(object.edibility);

        encyclopedia.push(ItemEncyclopediaEntry {
            id,
            name: if name.trim().is_empty() {
                object.name.clone()
            } else {
                name
            },
            internal_name: object.name,
            description: if description.trim().is_empty() {
                "游戏内容未提供描述。".to_string()
            } else {
                description
            },
            item_type,
            item_type_key,
            category,
            category_key,
            icon,
            sell_price: object.price,
            edibility,
            can_be_given_as_gift: object.can_be_given_as_gift,
            can_be_trashed: object.can_be_trashed,
        });
    }

    encyclopedia.sort_by(|a, b| {
        item_type_order(&a.item_type_key)
            .cmp(&item_type_order(&b.item_type_key))
            .then(category_order(&a.category_key).cmp(&category_order(&b.category_key)))
            .then(a.name.cmp(&b.name))
    });

    let mut categories = vec!["全部".to_string()];
    let mut item_types = vec!["全部".to_string()];
    for item in &encyclopedia {
        if !item_types.contains(&item.item_type) {
            item_types.push(item.item_type.clone());
        }
        if !categories.contains(&item.category) {
            categories.push(item.category.clone());
        }
    }

    Ok(ItemGameData {
        encyclopedia,
        categories,
        item_types,
    })
}

fn classify_item_type(object_type: &str, category: i32) -> (String, String) {
    let normalized = object_type.trim();
    if !normalized.is_empty() {
        let key = normalized.to_ascii_lowercase();
        let label = match key.as_str() {
            "basic" => "基础物品",
            "arch" => "古物",
            "fish" => "鱼类",
            "ring" => "戒指",
            "minerals" => "矿物",
            "cooking" => "料理",
            "crafting" => "工艺品",
            "asdf" => "特殊物品",
            _ => normalized,
        };
        return (key, label.to_string());
    }

    let (key, label) = classify_category(category, normalized);
    (key, label)
}

fn classify_category(category: i32, object_type: &str) -> (String, String) {
    match category {
        -2 => ("gem".to_string(), "宝石".to_string()),
        -4 => ("fish".to_string(), "鱼类".to_string()),
        -5 => ("egg".to_string(), "蛋类".to_string()),
        -6 => ("milk".to_string(), "奶制品".to_string()),
        -7 => ("cooking".to_string(), "料理".to_string()),
        -8 => ("crafting".to_string(), "工艺品".to_string()),
        -9 => ("big_craftable".to_string(), "大型工艺品".to_string()),
        -12 => ("mineral".to_string(), "矿物".to_string()),
        -14 => ("meat".to_string(), "肉类".to_string()),
        -15 => ("metal_resource".to_string(), "金属资源".to_string()),
        -16 => ("building_resource".to_string(), "建筑资源".to_string()),
        -17 => ("sell_at_pierre".to_string(), "杂货商品".to_string()),
        -18 => ("animal_product".to_string(), "动物产物".to_string()),
        -19 => ("fertilizer".to_string(), "肥料".to_string()),
        -20 => ("junk".to_string(), "垃圾".to_string()),
        -21 => ("bait".to_string(), "鱼饵".to_string()),
        -22 => ("tackle".to_string(), "渔具".to_string()),
        -24 => ("furniture".to_string(), "家具".to_string()),
        -25 => ("ingredient".to_string(), "食材".to_string()),
        -26 => ("artisan_goods".to_string(), "工匠物品".to_string()),
        -27 => ("syrup".to_string(), "树液制品".to_string()),
        -28 => ("monster_loot".to_string(), "怪物掉落".to_string()),
        -74 => ("seed".to_string(), "种子".to_string()),
        -75 => ("vegetable".to_string(), "蔬菜".to_string()),
        -76 => ("flower".to_string(), "花卉".to_string()),
        -77 => ("forage".to_string(), "采集物".to_string()),
        -78 => ("fruit".to_string(), "水果".to_string()),
        -79 => ("shellfish".to_string(), "贝类".to_string()),
        -80 => ("festival_reward".to_string(), "节日奖励".to_string()),
        -81 => ("fodder".to_string(), "饲料".to_string()),
        -82 => ("clothing".to_string(), "服饰".to_string()),
        -95 => ("hat".to_string(), "帽子".to_string()),
        -96 => ("trinket".to_string(), "饰品".to_string()),
        0 if !object_type.trim().is_empty() => (
            object_type.trim().to_ascii_lowercase(),
            object_type.trim().to_string(),
        ),
        _ => ("other".to_string(), "其他".to_string()),
    }
}

fn item_type_order(key: &str) -> i32 {
    match key {
        "basic" => 0,
        "fish" => 1,
        "cooking" => 2,
        "crafting" => 3,
        "minerals" => 4,
        "arch" => 5,
        "ring" => 6,
        "asdf" => 7,
        _ => 9,
    }
}

fn category_order(key: &str) -> i32 {
    match key {
        "seed" => 0,
        "vegetable" => 1,
        "fruit" => 2,
        "flower" => 3,
        "forage" => 4,
        "fish" => 5,
        "cooking" => 6,
        "ingredient" => 7,
        "artisan_goods" => 8,
        "animal_product" => 9,
        "mineral" | "gem" => 10,
        "metal_resource" => 11,
        "building_resource" => 12,
        "monster_loot" => 13,
        _ => 99,
    }
}
