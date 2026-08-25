use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};

use serde::{Deserialize, Serialize};

use crate::game::find_stardew_valley;
use crate::game_data::image_utils::{Canvas, Pixel, Rect, Texture};
use crate::game_data::xnb::load_xnb_texture;

const SPRITE_SCALE: i32 = 4;
const BODY_X: i32 = 8;
const BODY_Y: i32 = 8;
const CANVAS_WIDTH: usize = 80;
const CANVAS_HEIGHT: usize = 136;
const HAIRSTYLE_HAT_OFFSET: [i32; 16] = [0, 0, 0, 4, 0, 0, 3, 0, 4, 0, 0, 0, 0, 0, 0, 0];

#[derive(Serialize, Deserialize, Debug, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct RgbaColor {
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub a: u8,
}

impl RgbaColor {
    fn new(r: u8, g: u8, b: u8, a: u8) -> Self {
        Self { r, g, b, a }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FarmerAppearance {
    pub gender: String,
    pub is_male: bool,
    pub hair: i32,
    pub skin: i32,
    pub shoes: String,
    pub shirt: String,
    pub pants: String,
    pub accessory: i32,
    pub hat_index: Option<i32>,
    pub hat_ignore_hairstyle_offset: bool,
    pub hat_hair_draw_type: Option<i32>,
    pub shirt_index: i32,
    pub pants_index: i32,
    pub hair_color: RgbaColor,
    pub eye_color: RgbaColor,
    pub pants_color: RgbaColor,
    pub shirt_color: RgbaColor,
}

impl FarmerAppearance {
    pub fn from_save_xml(xml: &str) -> Self {
        let gender = extract_tag_string(xml, "Gender")
            .or_else(|| extract_tag_string(xml, "gender"))
            .unwrap_or_else(|| "Male".to_string());
        let is_male = match extract_tag_string(xml, "isMale").as_deref() {
            Some("true") => true,
            Some("false") => false,
            _ => !gender.eq_ignore_ascii_case("female"),
        };

        let shirt = extract_tag_string(xml, "shirt").unwrap_or_else(|| "1000".to_string());
        let pants = extract_tag_string(xml, "pants").unwrap_or_else(|| "0".to_string());
        let shirt_item = extract_tag_block(xml, "shirtItem");
        let pants_item = extract_tag_block(xml, "pantsItem");
        let hat = extract_tag_block(xml, "hat");

        let shirt_index = displayed_shirt_index(&shirt, shirt_item.as_deref(), is_male);
        let pants_index = displayed_pants_index(&pants, pants_item.as_deref());
        let shirt_color = shirt_item
            .as_deref()
            .and_then(|block| extract_color(block, "clothesColor", None))
            .unwrap_or_else(|| RgbaColor::new(255, 255, 255, 255));

        Self {
            gender,
            is_male,
            hair: extract_tag_i32(xml, "hair").unwrap_or(0),
            skin: extract_tag_i32(xml, "skin").unwrap_or(0),
            shoes: extract_tag_string(xml, "shoes").unwrap_or_else(|| "2".to_string()),
            shirt,
            pants,
            accessory: extract_tag_i32(xml, "accessory").unwrap_or(-1),
            hat_index: hat
                .as_deref()
                .and_then(|block| extract_tag_i32(block, "itemId"))
                .or_else(|| {
                    hat.as_deref()
                        .and_then(|block| extract_tag_i32(block, "which"))
                }),
            hat_ignore_hairstyle_offset: hat
                .as_deref()
                .and_then(|block| extract_tag_bool(block, "ignoreHairstyleOffset"))
                .unwrap_or(false),
            hat_hair_draw_type: hat
                .as_deref()
                .and_then(|block| extract_tag_i32(block, "hairDrawType")),
            shirt_index,
            pants_index,
            hair_color: extract_color(xml, "hairstyleColor", None)
                .unwrap_or_else(|| RgbaColor::new(193, 90, 50, 255)),
            eye_color: extract_color(xml, "newEyeColor", None)
                .unwrap_or_else(|| RgbaColor::new(122, 68, 52, 255)),
            pants_color: pants_item
                .as_deref()
                .and_then(|block| extract_color(block, "clothesColor", None))
                .or_else(|| extract_color(xml, "pantsColor", None))
                .unwrap_or_else(|| RgbaColor::new(46, 85, 183, 255)),
            shirt_color,
        }
    }
}

fn from_rgba(color: RgbaColor) -> Pixel {
    Pixel {
        r: color.r,
        g: color.g,
        b: color.b,
        a: color.a,
    }
}

pub fn render_farmer_avatar(
    appearance: &FarmerAppearance,
    game_dir: Option<&str>,
) -> Result<String, String> {
    let assets = locate_farmer_asset_dir(game_dir)?;
    let base_name = farmer_base_texture_name(appearance);
    let mut base = load_farmer_texture(&assets, &base_name)?;
    let hairstyles = load_farmer_texture(&assets, "hairstyles")?;
    let shirts = load_farmer_texture(&assets, "shirts")?;
    let pants = load_farmer_texture(&assets, "pants")?;
    let skin_colors = load_farmer_texture(&assets, "skinColors")?;
    let shoe_colors = load_farmer_texture(&assets, "shoeColors")?;
    let accessories = load_farmer_texture(&assets, "accessories").ok();
    let hats = load_farmer_texture(&assets, "hats").ok();

    recolor_base_texture(
        &mut base,
        appearance,
        &shirts,
        &skin_colors,
        &shoe_colors,
        appearance.is_male,
    );

    let mut canvas = Canvas::new(CANVAS_WIDTH, CANVAS_HEIGHT);
    draw_scaled(
        &mut canvas,
        &base,
        Rect {
            x: 0,
            y: 0,
            width: 16,
            height: 32,
        },
        BODY_X,
        BODY_Y,
        Pixel::WHITE,
        false,
    );

    draw_pants(&mut canvas, &pants, appearance);
    draw_accessory(&mut canvas, accessories.as_ref(), appearance, true);
    draw_hair(&mut canvas, &hairstyles, appearance);
    draw_accessory(&mut canvas, accessories.as_ref(), appearance, false);
    draw_shirt(&mut canvas, &shirts, appearance);
    draw_hat(&mut canvas, hats.as_ref(), appearance);
    draw_arms(&mut canvas, &base);

    canvas.to_png_data_url()
}

/// 已渲染的 NPC 头像缓存，键为 `<肖像资源目录>|<NPC id>`。
///
/// 单张头像需要把整张肖像图集从 XNB 里 LZX 解压出来再重新编码 PNG（约 24ms），
/// 而肖像资源在应用运行期间不会变化，因此结果可以长期复用。
static NPC_PORTRAIT_CACHE: LazyLock<Mutex<HashMap<String, String>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn render_npc_portrait_from_dir(portraits_dir: &Path, npc_id: &str) -> Result<String, String> {
    let file_stem = npc_portrait_file_stem(npc_id);
    let texture = load_xnb_texture(&portraits_dir.join(format!("{}.xnb", file_stem)))?;
    texture.crop_to_png_data_url(Rect {
        x: 0,
        y: 0,
        width: 64,
        height: 64,
    })
}

#[cfg(test)]
fn render_npc_portrait(npc_id: &str, game_dir: Option<&str>) -> Result<String, String> {
    let portraits = locate_portrait_asset_dir(game_dir)?;
    render_npc_portrait_from_dir(&portraits, npc_id)
}

/// 标记为 `async` 让 Tauri 把它调度到线程池：同步命令会在主线程执行，
/// 首次渲染 48 张头像需要一秒以上，期间所有其它 IPC 与原生窗口操作都会排队。
#[tauri::command(async)]
pub fn get_npc_portraits(
    npc_ids: Vec<String>,
    game_dir: Option<String>,
) -> Result<HashMap<String, String>, String> {
    // 目录探测会遍历 Steam 库与当前目录的所有祖先，每张头像重跑一次纯属浪费。
    let portraits_dir = locate_portrait_asset_dir(game_dir.as_deref())?;
    let dir_key = portraits_dir.to_string_lossy();

    let mut portraits = HashMap::new();
    let mut missing = Vec::new();

    {
        let cache = NPC_PORTRAIT_CACHE
            .lock()
            .map_err(|_| "NPC 头像缓存锁定失败".to_string())?;
        for npc_id in npc_ids {
            if !is_safe_asset_name(&npc_id) || portraits.contains_key(&npc_id) {
                continue;
            }
            match cache.get(&format!("{}|{}", dir_key, npc_id)) {
                Some(data_url) => {
                    portraits.insert(npc_id, data_url.clone());
                }
                None => missing.push(npc_id),
            }
        }
    }

    if missing.is_empty() {
        return Ok(portraits);
    }

    let rendered = missing
        .into_iter()
        .filter_map(|npc_id| {
            render_npc_portrait_from_dir(&portraits_dir, &npc_id)
                .ok()
                .map(|data_url| (npc_id, data_url))
        })
        .collect::<Vec<_>>();

    if let Ok(mut cache) = NPC_PORTRAIT_CACHE.lock() {
        for (npc_id, data_url) in &rendered {
            cache.insert(format!("{}|{}", dir_key, npc_id), data_url.clone());
        }
    }
    portraits.extend(rendered);

    Ok(portraits)
}

/// 资源目录的定位结果缓存，键为 `<用途>|<传入的 game_dir>`。
static ASSET_DIR_CACHE: LazyLock<Mutex<HashMap<String, PathBuf>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// 按「显式目录 → 自动探测 → 源码树」的顺序逐个求值并缓存结果。
///
/// 关键是惰性：调用方给了有效目录时就不会去读注册表、解析 Steam 库配置，
/// 也不会遍历当前目录的所有祖先——那套探测每次要几十次文件系统调用。
fn locate_asset_dir<F>(kind: &str, game_dir: Option<&str>, matches: F) -> Result<PathBuf, String>
where
    F: Fn(&Path) -> bool,
{
    let explicit = game_dir.map(str::trim).filter(|value| !value.is_empty());
    let cache_key = format!("{}|{}", kind, explicit.unwrap_or(""));

    if let Ok(cache) = ASSET_DIR_CACHE.lock() {
        if let Some(hit) = cache.get(&cache_key) {
            if matches(hit) {
                return Ok(hit.clone());
            }
        }
    }

    let push = |root: &Path| -> Vec<PathBuf> {
        match kind {
            "portraits" => vec![
                root.join("Content").join("Portraits"),
                root.join("StardewValleyGame")
                    .join("Content")
                    .join("Portraits"),
                root.join("Portraits"),
            ],
            _ => vec![
                root.join("Content").join("Characters").join("Farmer"),
                root.join("StardewValleyGame")
                    .join("Content")
                    .join("Characters")
                    .join("Farmer"),
                root.join("Characters").join("Farmer"),
            ],
        }
    };
    let first_hit = |root: &Path| push(root).into_iter().find(|path| matches(path));

    let resolved = explicit
        .and_then(|dir| first_hit(Path::new(dir)))
        .or_else(|| find_stardew_valley().and_then(|dir| first_hit(Path::new(&dir))))
        .or_else(|| {
            let current_dir = std::env::current_dir().ok()?;
            current_dir.ancestors().find_map(|ancestor| {
                first_hit(ancestor).or_else(|| {
                    let parent = ancestor.parent()?;
                    first_hit(
                        &parent
                            .join("stardew-valley-source")
                            .join("StardewValleyGame"),
                    )
                })
            })
        })
        .ok_or_else(|| {
            format!(
                "Could not locate Stardew Valley {} assets. Set the game directory first.",
                kind
            )
        })?;

    if let Ok(mut cache) = ASSET_DIR_CACHE.lock() {
        cache.insert(cache_key, resolved.clone());
    }
    Ok(resolved)
}

fn locate_farmer_asset_dir(game_dir: Option<&str>) -> Result<PathBuf, String> {
    locate_asset_dir("farmer", game_dir, |path| {
        path.join("farmer_base.xnb").exists() && path.join("hairstyles.xnb").exists()
    })
}

fn locate_portrait_asset_dir(game_dir: Option<&str>) -> Result<PathBuf, String> {
    locate_asset_dir("portraits", game_dir, |path| {
        path.join("Abigail.xnb").exists() && path.join("Wizard.xnb").exists()
    })
}

fn npc_portrait_file_stem(npc_id: &str) -> &str {
    match npc_id {
        "Leo" => "ParrotBoy",
        _ => npc_id,
    }
}

fn is_safe_asset_name(name: &str) -> bool {
    !name.is_empty()
        && name
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == ' ')
}

fn load_farmer_texture(assets: &Path, name: &str) -> Result<Texture, String> {
    load_xnb_texture(&assets.join(format!("{}.xnb", name)))
}

fn farmer_base_texture_name(appearance: &FarmerAppearance) -> &'static str {
    match (appearance.is_male, is_bald_base_hair(appearance.hair)) {
        (true, true) => "farmer_base_bald",
        (true, false) => "farmer_base",
        (false, true) => "farmer_girl_base_bald",
        (false, false) => "farmer_girl_base",
    }
}

fn is_bald_base_hair(hair: i32) -> bool {
    (49..=55).contains(&hair)
}

fn draw_pants(canvas: &mut Canvas, pants: &Texture, appearance: &FarmerAppearance) {
    let index = appearance.pants_index.max(0) as usize;
    let x = (index % 10) * 192 + if appearance.is_male { 0 } else { 96 };
    let y = (index / 10) * 688;
    draw_scaled(
        canvas,
        pants,
        Rect {
            x,
            y,
            width: 16,
            height: 32,
        },
        BODY_X,
        BODY_Y,
        from_rgba(appearance.pants_color).opaque(),
        false,
    );
}

fn draw_hair(canvas: &mut Canvas, hairstyles: &Texture, appearance: &FarmerAppearance) {
    let hair = appearance.hair.max(0) as usize;
    let x = (hair * 16) % hairstyles.width;
    let y = (hair * 16 / hairstyles.width) * 96;
    let gender_offset = if appearance.is_male && appearance.hair >= 16 {
        -4
    } else if !appearance.is_male && appearance.hair < 16 {
        4
    } else {
        0
    };

    draw_scaled(
        canvas,
        hairstyles,
        Rect {
            x,
            y,
            width: 16,
            height: 32,
        },
        BODY_X,
        BODY_Y + 4 + gender_offset,
        from_rgba(appearance.hair_color),
        false,
    );
}

fn draw_accessory(
    canvas: &mut Canvas,
    accessories: Option<&Texture>,
    appearance: &FarmerAppearance,
    below_hair_pass: bool,
) {
    let Some(accessories) = accessories else {
        return;
    };
    if appearance.accessory < 0 {
        return;
    }

    let below_hair = draw_accessory_below_hair(appearance.accessory);
    if below_hair != below_hair_pass {
        return;
    }

    let index = appearance.accessory as usize;
    let x = (index * 16) % accessories.width;
    let y = (index * 16 / accessories.width) * 32;
    let tint = if is_accessory_facial_hair(appearance.accessory) {
        from_rgba(appearance.hair_color)
    } else {
        Pixel::WHITE
    };

    draw_scaled(
        canvas,
        accessories,
        Rect {
            x,
            y,
            width: 16,
            height: 16,
        },
        BODY_X,
        BODY_Y + 8 + height_offset(appearance) - 4,
        tint,
        false,
    );
}

fn draw_shirt(canvas: &mut Canvas, shirts: &Texture, appearance: &FarmerAppearance) {
    let index = appearance.shirt_index.max(0) as usize;
    let x = (index * 8) % 128;
    let y = (index * 8 / 128) * 32;
    let dest_x = BODY_X + 16;
    let dest_y = BODY_Y + 56 + 4 + height_offset(appearance);

    let source = Rect {
        x,
        y,
        width: 8,
        height: 8,
    };
    draw_scaled(canvas, shirts, source, dest_x, dest_y, Pixel::WHITE, false);

    draw_scaled(
        canvas,
        shirts,
        Rect {
            x: x + 128,
            ..source
        },
        dest_x,
        dest_y,
        from_rgba(appearance.shirt_color).opaque(),
        false,
    );
}

fn draw_hat(canvas: &mut Canvas, hats: Option<&Texture>, appearance: &FarmerAppearance) {
    let Some(hats) = hats else {
        return;
    };
    let Some(index) = appearance.hat_index.filter(|index| *index >= 0) else {
        return;
    };

    let index = index as usize;
    let x = (index * 20) % hats.width;
    let y = (index * 20 / hats.width) * 80;
    let hat_offset = if appearance.hat_ignore_hairstyle_offset {
        0
    } else {
        HAIRSTYLE_HAT_OFFSET[appearance.hair.rem_euclid(16) as usize]
    };

    draw_scaled(
        canvas,
        hats,
        Rect {
            x,
            y,
            width: 20,
            height: 20,
        },
        BODY_X - 8,
        BODY_Y - 8 + hat_offset + height_offset(appearance),
        Pixel::WHITE,
        false,
    );
}

fn draw_arms(canvas: &mut Canvas, base: &Texture) {
    draw_scaled(
        canvas,
        base,
        Rect {
            x: 96,
            y: 0,
            width: 16,
            height: 32,
        },
        BODY_X,
        BODY_Y,
        Pixel::WHITE,
        false,
    );
}

fn draw_scaled(
    canvas: &mut Canvas,
    texture: &Texture,
    source: Rect,
    dest_x: i32,
    dest_y: i32,
    tint: Pixel,
    flip_horizontally: bool,
) {
    if source.x + source.width > texture.width || source.y + source.height > texture.height {
        return;
    }

    for sy in 0..source.height {
        for sx in 0..source.width {
            let source_x = if flip_horizontally {
                source.x + source.width - 1 - sx
            } else {
                source.x + sx
            };
            let source_y = source.y + sy;
            let pixel = texture.get(source_x, source_y).multiply(tint);
            if pixel.a == 0 {
                continue;
            }

            let px = dest_x + (sx as i32 * SPRITE_SCALE);
            let py = dest_y + (sy as i32 * SPRITE_SCALE);
            for y in 0..SPRITE_SCALE {
                for x in 0..SPRITE_SCALE {
                    canvas.blend_i32(px + x, py + y, pixel);
                }
            }
        }
    }
}

fn recolor_base_texture(
    base: &mut Texture,
    appearance: &FarmerAppearance,
    shirts: &Texture,
    skin_colors: &Texture,
    shoe_colors: &Texture,
    is_male: bool,
) {
    apply_eye_color(base, appearance.eye_color);
    apply_skin_color(base, appearance.skin, skin_colors);
    apply_shoe_color(base, &appearance.shoes, shoe_colors);
    apply_sleeve_color(base, appearance, shirts, skin_colors, is_male);
}

fn apply_eye_color(base: &mut Texture, eye_color: RgbaColor) {
    let lightest = from_rgba(eye_color);
    let mut darker = change_brightness(lightest, -75);
    if darker == lightest {
        darker.b = darker.b.saturating_add(10);
    }
    swap_marker_color(base, 276, lightest);
    swap_marker_color(base, 277, darker);
}

fn apply_skin_color(base: &mut Texture, skin: i32, skin_colors: &Texture) {
    let mut index = skin;
    if index < 0 {
        index = skin_colors.height as i32 - 1;
    }
    if index >= skin_colors.height as i32 {
        index = 0;
    }
    let y = index.max(0) as usize;
    swap_marker_color(base, 260, skin_colors.get(0, y));
    swap_marker_color(base, 261, skin_colors.get(1, y));
    swap_marker_color(base, 262, skin_colors.get(2, y));
}

fn apply_shoe_color(base: &mut Texture, shoes: &str, shoe_colors: &Texture) {
    let index = shoes
        .rsplit_once(':')
        .map(|(_, value)| value)
        .unwrap_or(shoes)
        .parse::<usize>()
        .unwrap_or(12)
        .min(shoe_colors.height.saturating_sub(1));

    swap_marker_color(base, 268, shoe_colors.get(0, index));
    swap_marker_color(base, 269, shoe_colors.get(1, index));
    swap_marker_color(base, 270, shoe_colors.get(2, index));
    swap_marker_color(base, 271, shoe_colors.get(3, index));
}

fn apply_sleeve_color(
    base: &mut Texture,
    appearance: &FarmerAppearance,
    shirts: &Texture,
    skin_colors: &Texture,
    _is_male: bool,
) {
    let shirt_index = appearance.shirt_index.max(0) as usize;
    let source_x = (shirt_index * 8) % 128;
    let source_y = (shirt_index * 8 / 128) * 32;
    let num = source_y * shirts.width + source_x + shirts.width * 4;
    let num2 = num + 128;

    if num2 >= shirts.pixels.len() || num2 < shirts.width * 2 {
        apply_skin_sleeve_color(base, appearance.skin, skin_colors);
        return;
    }

    let shirt_color = from_rgba(appearance.shirt_color).opaque();
    let mut sleeve_0 = shirts.get_index(num2).unwrap_or(Pixel::TRANSPARENT);
    let mut tint = shirt_color;
    if sleeve_0.a < 255 {
        sleeve_0 = shirts.get_index(num).unwrap_or(Pixel::TRANSPARENT);
        tint = Pixel::WHITE;
    }
    swap_marker_color(base, 256, sleeve_0.multiply(tint));

    let mut sleeve_1 = shirts
        .get_index(num2 - shirts.width)
        .unwrap_or(Pixel::TRANSPARENT);
    tint = shirt_color;
    if sleeve_1.a < 255 {
        sleeve_1 = shirts
            .get_index(num - shirts.width)
            .unwrap_or(Pixel::TRANSPARENT);
        tint = Pixel::WHITE;
    }
    swap_marker_color(base, 257, sleeve_1.multiply(tint));

    let mut sleeve_2 = shirts
        .get_index(num2 - shirts.width * 2)
        .unwrap_or(Pixel::TRANSPARENT);
    tint = shirt_color;
    if sleeve_2.a < 255 {
        sleeve_2 = shirts
            .get_index(num - shirts.width * 2)
            .unwrap_or(Pixel::TRANSPARENT);
        tint = Pixel::WHITE;
    }
    swap_marker_color(base, 258, sleeve_2.multiply(tint));
}

fn apply_skin_sleeve_color(base: &mut Texture, skin: i32, skin_colors: &Texture) {
    let y = if skin < 0 || skin as usize >= skin_colors.height {
        0
    } else {
        skin as usize
    };
    swap_marker_color(base, 256, skin_colors.get(0, y));
    swap_marker_color(base, 257, skin_colors.get(1, y));
    swap_marker_color(base, 258, skin_colors.get(2, y));
}

fn swap_marker_color(texture: &mut Texture, marker_index: usize, replacement: Pixel) {
    let Some(marker) = texture.get_index(marker_index) else {
        return;
    };
    for y in 0..texture.height {
        for x in 0..texture.width {
            if texture.get(x, y) == marker {
                texture.set(x, y, replacement);
            }
        }
    }
}

fn displayed_shirt_index(shirt: &str, shirt_item: Option<&str>, is_male: bool) -> i32 {
    if shirt != "-1" {
        if let Ok(id) = shirt.parse::<i32>() {
            return (id - 1000).max(0);
        }
    }

    if let Some(index) = shirt_item.and_then(|block| extract_tag_i32(block, "indexInTileSheet")) {
        return index;
    }

    if is_male {
        209
    } else {
        41
    }
}

fn displayed_pants_index(pants: &str, pants_item: Option<&str>) -> i32 {
    if pants != "-1" {
        if let Ok(id) = pants.parse::<i32>() {
            return id.max(0);
        }
    }

    pants_item
        .and_then(|block| extract_tag_i32(block, "indexInTileSheet"))
        .unwrap_or(14)
}

fn is_accessory_facial_hair(which: i32) -> bool {
    which < 6 || (19..=22).contains(&which)
}

fn draw_accessory_below_hair(which: i32) -> bool {
    which < 8 || is_accessory_facial_hair(which)
}

fn height_offset(appearance: &FarmerAppearance) -> i32 {
    if appearance.is_male {
        0
    } else {
        4
    }
}

fn change_brightness(color: Pixel, brightness: i32) -> Pixel {
    let blue_delta = if brightness > 0 {
        brightness * 5 / 6
    } else {
        brightness * 8 / 7
    };

    Pixel {
        r: add_clamped(color.r, brightness),
        g: add_clamped(color.g, brightness),
        b: add_clamped(color.b, blue_delta),
        a: color.a,
    }
}

fn add_clamped(value: u8, delta: i32) -> u8 {
    (value as i32 + delta).clamp(0, 255) as u8
}

fn extract_tag_value<'a>(xml: &'a str, tag: &str) -> Option<&'a str> {
    let start_tag = format!("<{}>", tag);
    let end_tag = format!("</{}>", tag);
    let start_idx = xml.find(&start_tag)?;
    let end_idx = xml[start_idx + start_tag.len()..].find(&end_tag)? + start_idx + start_tag.len();
    Some(&xml[start_idx + start_tag.len()..end_idx])
}

fn extract_tag_block(xml: &str, tag: &str) -> Option<String> {
    let start_prefix = format!("<{}", tag);
    let end_tag = format!("</{}>", tag);
    let start = xml.find(&start_prefix)?;
    let start_close = xml[start..].find('>')? + start;
    if xml[start..=start_close].contains("xsi:nil=\"true\"")
        || xml[start..=start_close].ends_with("/>")
    {
        return None;
    }
    let end = xml[start_close + 1..].find(&end_tag)? + start_close + 1;
    Some(xml[start..end + end_tag.len()].to_string())
}

fn extract_tag_string(xml: &str, tag: &str) -> Option<String> {
    extract_tag_value(xml, tag).map(|value| value.trim().to_string())
}

fn extract_tag_i32(xml: &str, tag: &str) -> Option<i32> {
    extract_tag_value(xml, tag)?.trim().parse().ok()
}

fn extract_tag_bool(xml: &str, tag: &str) -> Option<bool> {
    match extract_tag_value(xml, tag)?.trim() {
        "true" => Some(true),
        "false" => Some(false),
        _ => None,
    }
}

fn extract_color(xml: &str, tag: &str, default: Option<RgbaColor>) -> Option<RgbaColor> {
    let block = extract_tag_value(xml, tag)?;
    let fallback = default.unwrap_or_else(|| RgbaColor::new(255, 255, 255, 255));
    let r = extract_tag_i32(block, "R").unwrap_or(fallback.r as i32);
    let g = extract_tag_i32(block, "G").unwrap_or(fallback.g as i32);
    let b = extract_tag_i32(block, "B").unwrap_or(fallback.b as i32);
    let a = extract_tag_i32(block, "A").unwrap_or(fallback.a as i32);
    Some(RgbaColor {
        r: r.clamp(0, 255) as u8,
        g: g.clamp(0, 255) as u8,
        b: b.clamp(0, 255) as u8,
        a: a.clamp(0, 255) as u8,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_compressed_texture_from_dev_source() {
        let assets = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .and_then(|path| path.parent())
            .map(|path| {
                path.join("stardew-valley-source")
                    .join("StardewValleyGame")
                    .join("Content")
                    .join("Characters")
                    .join("Farmer")
            });

        let Some(assets) = assets.filter(|path| path.exists()) else {
            return;
        };

        let texture = load_farmer_texture(&assets, "farmer_base").unwrap();
        assert_eq!(texture.width, 288);
        assert_eq!(texture.height, 672);
    }

    #[test]
    fn renders_default_avatar_from_dev_source() {
        let source_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .and_then(|path| path.parent())
            .map(|path| path.join("stardew-valley-source"));

        let Some(source_root) = source_root.filter(|path| path.exists()) else {
            return;
        };

        let appearance = FarmerAppearance::from_save_xml(
            r#"<Farmer>
                <Gender>Male</Gender>
                <shirt>1000</shirt>
                <hair>0</hair>
                <skin>0</skin>
                <shoes>2</shoes>
                <accessory>-1</accessory>
                <pants>0</pants>
                <hairstyleColor><R>193</R><G>90</G><B>50</B><A>255</A></hairstyleColor>
                <pantsColor><R>46</R><G>85</G><B>183</B><A>255</A></pantsColor>
                <newEyeColor><R>122</R><G>68</G><B>52</B><A>255</A></newEyeColor>
            </Farmer>"#,
        );

        let avatar = render_farmer_avatar(&appearance, source_root.to_str()).unwrap();
        assert!(avatar.starts_with("data:image/png;base64,"));
        assert!(avatar.len() > 1000);
    }

    #[test]
    fn renders_npc_portrait_from_dev_source() {
        let source_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .and_then(|path| path.parent())
            .map(|path| path.join("stardew-valley-source"));

        let Some(source_root) = source_root.filter(|path| path.exists()) else {
            return;
        };

        let portrait = render_npc_portrait("Abigail", source_root.to_str()).unwrap();
        assert!(portrait.starts_with("data:image/png;base64,"));
        assert!(portrait.len() > 1000);
    }
}
