use std::fs;
use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use image::codecs::png::PngEncoder;
use image::{ColorType, ImageEncoder};
use lzxd::{Lzxd, WindowSize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::game::find_stardew_valley;

const XNB_FLAG_COMPRESSED_LZX: u8 = 0x80;
const XNB_HEADER_COMPRESSED_LEN: usize = 14;
const XNB_HEADER_UNCOMPRESSED_LEN: usize = 10;
const XNB_CHUNK_SIZE: usize = 0x8000;
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Pixel {
    r: u8,
    g: u8,
    b: u8,
    a: u8,
}

impl Pixel {
    const TRANSPARENT: Self = Self {
        r: 0,
        g: 0,
        b: 0,
        a: 0,
    };
    const WHITE: Self = Self {
        r: 255,
        g: 255,
        b: 255,
        a: 255,
    };

    fn from_rgba(color: RgbaColor) -> Self {
        Self {
            r: color.r,
            g: color.g,
            b: color.b,
            a: color.a,
        }
    }

    fn multiply(self, tint: Self) -> Self {
        Self {
            r: multiply_channel(self.r, tint.r),
            g: multiply_channel(self.g, tint.g),
            b: multiply_channel(self.b, tint.b),
            a: multiply_channel(self.a, tint.a),
        }
    }

    fn opaque(mut self) -> Self {
        self.a = 255;
        self
    }
}

#[derive(Clone)]
struct Texture {
    width: usize,
    height: usize,
    pixels: Vec<Pixel>,
}

impl Texture {
    fn get(&self, x: usize, y: usize) -> Pixel {
        if x >= self.width || y >= self.height {
            return Pixel::TRANSPARENT;
        }
        self.pixels[y * self.width + x]
    }

    fn set(&mut self, x: usize, y: usize, pixel: Pixel) {
        if x < self.width && y < self.height {
            self.pixels[y * self.width + x] = pixel;
        }
    }

    fn get_index(&self, index: usize) -> Option<Pixel> {
        self.pixels.get(index).copied()
    }

    fn crop_to_png_data_url(&self, source: Rect) -> Result<String, String> {
        let width = source.width.min(self.width.saturating_sub(source.x));
        let height = source.height.min(self.height.saturating_sub(source.y));
        if width == 0 || height == 0 {
            return Err("Texture crop is empty".to_string());
        }

        let mut raw = Vec::with_capacity(width * height * 4);
        for y in 0..height {
            for x in 0..width {
                let pixel = self.get(source.x + x, source.y + y);
                raw.extend_from_slice(&[pixel.r, pixel.g, pixel.b, pixel.a]);
            }
        }

        encode_png_data_url(&raw, width, height)
    }
}

struct Canvas {
    width: usize,
    height: usize,
    pixels: Vec<Pixel>,
}

impl Canvas {
    fn new(width: usize, height: usize) -> Self {
        Self {
            width,
            height,
            pixels: vec![Pixel::TRANSPARENT; width * height],
        }
    }

    fn blend(&mut self, x: i32, y: i32, src: Pixel) {
        if src.a == 0 || x < 0 || y < 0 {
            return;
        }
        let x = x as usize;
        let y = y as usize;
        if x >= self.width || y >= self.height {
            return;
        }

        let index = y * self.width + x;
        self.pixels[index] = blend_pixel(self.pixels[index], src);
    }

    fn to_png_data_url(&self) -> Result<String, String> {
        let mut raw = Vec::with_capacity(self.width * self.height * 4);
        for pixel in &self.pixels {
            raw.extend_from_slice(&[pixel.r, pixel.g, pixel.b, pixel.a]);
        }

        encode_png_data_url(&raw, self.width, self.height)
    }
}

fn encode_png_data_url(raw: &[u8], width: usize, height: usize) -> Result<String, String> {
    let mut png = Vec::new();
    let encoder = PngEncoder::new(&mut png);
    encoder
        .write_image(raw, width as u32, height as u32, ColorType::Rgba8.into())
        .map_err(|e| format!("Failed to encode PNG: {}", e))?;

    Ok(format!(
        "data:image/png;base64,{}",
        BASE64_STANDARD.encode(png)
    ))
}

#[derive(Clone, Copy)]
struct Rect {
    x: usize,
    y: usize,
    width: usize,
    height: usize,
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

pub fn render_npc_portrait(npc_id: &str, game_dir: Option<&str>) -> Result<String, String> {
    let portraits = locate_portrait_asset_dir(game_dir)?;
    let file_stem = npc_portrait_file_stem(npc_id);
    let texture = load_xnb_texture(&portraits.join(format!("{}.xnb", file_stem)))?;
    texture.crop_to_png_data_url(Rect {
        x: 0,
        y: 0,
        width: 64,
        height: 64,
    })
}

#[tauri::command]
pub fn get_npc_portraits(
    npc_ids: Vec<String>,
    game_dir: Option<String>,
) -> Result<HashMap<String, String>, String> {
    let mut portraits = HashMap::new();

    for npc_id in npc_ids {
        if !is_safe_asset_name(&npc_id) {
            continue;
        }

        if let Ok(data_url) = render_npc_portrait(&npc_id, game_dir.as_deref()) {
            portraits.insert(npc_id, data_url);
        }
    }

    Ok(portraits)
}

fn locate_farmer_asset_dir(game_dir: Option<&str>) -> Result<PathBuf, String> {
    let mut candidates = Vec::new();

    if let Some(game_dir) = game_dir.map(str::trim).filter(|value| !value.is_empty()) {
        push_asset_candidates(Path::new(game_dir), &mut candidates);
    }

    if let Some(game_dir) = find_stardew_valley() {
        push_asset_candidates(Path::new(&game_dir), &mut candidates);
    }

    if let Ok(current_dir) = std::env::current_dir() {
        for ancestor in current_dir.ancestors() {
            push_asset_candidates(ancestor, &mut candidates);
            if let Some(parent) = ancestor.parent() {
                push_asset_candidates(
                    &parent
                        .join("stardew-valley-source")
                        .join("StardewValleyGame"),
                    &mut candidates,
                );
            }
        }
    }

    candidates
        .into_iter()
        .find(|path| path.join("farmer_base.xnb").exists() && path.join("hairstyles.xnb").exists())
        .ok_or_else(|| {
            "Could not locate Stardew Valley Content/Characters/Farmer assets. Set the game directory first.".to_string()
        })
}

fn locate_portrait_asset_dir(game_dir: Option<&str>) -> Result<PathBuf, String> {
    let mut candidates = Vec::new();

    if let Some(game_dir) = game_dir.map(str::trim).filter(|value| !value.is_empty()) {
        push_portrait_asset_candidates(Path::new(game_dir), &mut candidates);
    }

    if let Some(game_dir) = find_stardew_valley() {
        push_portrait_asset_candidates(Path::new(&game_dir), &mut candidates);
    }

    if let Ok(current_dir) = std::env::current_dir() {
        for ancestor in current_dir.ancestors() {
            push_portrait_asset_candidates(ancestor, &mut candidates);
            if let Some(parent) = ancestor.parent() {
                push_portrait_asset_candidates(
                    &parent
                        .join("stardew-valley-source")
                        .join("StardewValleyGame"),
                    &mut candidates,
                );
            }
        }
    }

    candidates
        .into_iter()
        .find(|path| path.join("Abigail.xnb").exists() && path.join("Wizard.xnb").exists())
        .ok_or_else(|| {
            "Could not locate Stardew Valley Content/Portraits assets. Set the game directory first.".to_string()
        })
}

fn push_asset_candidates(root: &Path, candidates: &mut Vec<PathBuf>) {
    candidates.push(root.join("Content").join("Characters").join("Farmer"));
    candidates.push(
        root.join("StardewValleyGame")
            .join("Content")
            .join("Characters")
            .join("Farmer"),
    );
    candidates.push(root.join("Characters").join("Farmer"));
}

fn push_portrait_asset_candidates(root: &Path, candidates: &mut Vec<PathBuf>) {
    candidates.push(root.join("Content").join("Portraits"));
    candidates.push(
        root.join("StardewValleyGame")
            .join("Content")
            .join("Portraits"),
    );
    candidates.push(root.join("Portraits"));
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
        Pixel::from_rgba(appearance.pants_color).opaque(),
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
        Pixel::from_rgba(appearance.hair_color),
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
        Pixel::from_rgba(appearance.hair_color)
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
        Pixel::from_rgba(appearance.shirt_color).opaque(),
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
                    canvas.blend(px + x, py + y, pixel);
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
    let lightest = Pixel::from_rgba(eye_color);
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

    let shirt_color = Pixel::from_rgba(appearance.shirt_color).opaque();
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

fn multiply_channel(a: u8, b: u8) -> u8 {
    ((a as u16 * b as u16) / 255) as u8
}

fn blend_pixel(dst: Pixel, src: Pixel) -> Pixel {
    if src.a == 255 {
        return src;
    }
    if dst.a == 0 {
        return src;
    }

    let src_a = src.a as u32;
    let inv_a = 255 - src_a;
    let out_a = src_a + (dst.a as u32 * inv_a + 127) / 255;
    if out_a == 0 {
        return Pixel::TRANSPARENT;
    }

    let blend_channel = |src_c: u8, dst_c: u8| -> u8 {
        let value = src_c as u32 * src_a + dst_c as u32 * dst.a as u32 * inv_a / 255;
        ((value + out_a / 2) / out_a).min(255) as u8
    };

    Pixel {
        r: blend_channel(src.r, dst.r),
        g: blend_channel(src.g, dst.g),
        b: blend_channel(src.b, dst.b),
        a: out_a.min(255) as u8,
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

fn load_xnb_texture(path: &Path) -> Result<Texture, String> {
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
    let payload = if flags & XNB_FLAG_COMPRESSED_LZX != 0 {
        if data.len() < XNB_HEADER_COMPRESSED_LEN {
            return Err(format!("{} has a truncated XNB header", path.display()));
        }
        let expected_size = read_u32_le(&data, 10)? as usize;
        decompress_xnb_lzx(&data[XNB_HEADER_COMPRESSED_LEN..], expected_size)
            .map_err(|e| format!("Failed to decompress {}: {}", path.display(), e))?
    } else {
        data[XNB_HEADER_UNCOMPRESSED_LEN..].to_vec()
    };

    parse_texture_payload(&payload)
        .map_err(|e| format!("Failed to parse texture {}: {}", path.display(), e))
}

fn decompress_xnb_lzx(data: &[u8], expected_size: usize) -> Result<Vec<u8>, String> {
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

fn parse_texture_payload(payload: &[u8]) -> Result<Texture, String> {
    let mut reader = XnbPayloadReader::new(payload);
    let reader_count = reader.read_7bit_usize()?;
    for _ in 0..reader_count {
        let _type_name = reader.read_string()?;
        let _version = reader.read_i32()?;
    }
    let _shared_resource_count = reader.read_7bit_usize()?;
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

struct XnbPayloadReader<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> XnbPayloadReader<'a> {
    fn new(data: &'a [u8]) -> Self {
        Self { data, pos: 0 }
    }

    fn read_i32(&mut self) -> Result<i32, String> {
        let bytes = self.read_array::<4>()?;
        Ok(i32::from_le_bytes(bytes))
    }

    fn read_7bit_usize(&mut self) -> Result<usize, String> {
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

    fn read_string(&mut self) -> Result<String, String> {
        let len = self.read_7bit_usize()?;
        let bytes = self.read_bytes(len)?;
        String::from_utf8(bytes.to_vec()).map_err(|e| format!("Invalid UTF-8 string: {}", e))
    }

    fn read_bytes(&mut self, len: usize) -> Result<&'a [u8], String> {
        if self.pos + len > self.data.len() {
            return Err("Unexpected end of XNB payload".to_string());
        }
        let start = self.pos;
        self.pos += len;
        Ok(&self.data[start..self.pos])
    }

    fn read_u8(&mut self) -> Result<u8, String> {
        let bytes = self.read_bytes(1)?;
        Ok(bytes[0])
    }

    fn read_array<const N: usize>(&mut self) -> Result<[u8; N], String> {
        let bytes = self.read_bytes(N)?;
        let mut out = [0u8; N];
        out.copy_from_slice(bytes);
        Ok(out)
    }
}

fn read_u32_le(data: &[u8], offset: usize) -> Result<u32, String> {
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
