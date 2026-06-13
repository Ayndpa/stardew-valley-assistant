use std::collections::HashMap;
use std::path::{Path, PathBuf};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use image::codecs::png::PngEncoder;
use image::{ColorType, ImageEncoder};

pub const ITEM_ICON_SIZE: usize = 16;
pub const DEFAULT_OBJECT_TEXTURE: &str = "Maps/springobjects";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Pixel {
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub a: u8,
}

impl Pixel {
    pub const TRANSPARENT: Self = Self {
        r: 0,
        g: 0,
        b: 0,
        a: 0,
    };
    pub const WHITE: Self = Self {
        r: 255,
        g: 255,
        b: 255,
        a: 255,
    };

    pub fn multiply(self, tint: Self) -> Self {
        Self {
            r: (((self.r as u16) * (tint.r as u16)) / 255) as u8,
            g: (((self.g as u16) * (tint.g as u16)) / 255) as u8,
            b: (((self.b as u16) * (tint.b as u16)) / 255) as u8,
            a: (((self.a as u16) * (tint.a as u16)) / 255) as u8,
        }
    }

    pub fn opaque(mut self) -> Self {
        self.a = 255;
        self
    }
}

#[derive(Clone, Debug)]
pub struct Texture {
    pub width: usize,
    pub height: usize,
    pub pixels: Vec<Pixel>,
}

impl Texture {
    pub fn get(&self, x: usize, y: usize) -> Pixel {
        if x >= self.width || y >= self.height {
            return Pixel::TRANSPARENT;
        }
        self.pixels[y * self.width + x]
    }

    pub fn set(&mut self, x: usize, y: usize, pixel: Pixel) {
        if x < self.width && y < self.height {
            self.pixels[y * self.width + x] = pixel;
        }
    }

    pub fn get_index(&self, index: usize) -> Option<Pixel> {
        self.pixels.get(index).copied()
    }

    pub fn crop_to_png_data_url(&self, source: Rect) -> Result<String, String> {
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

pub struct Canvas {
    pub width: usize,
    pub height: usize,
    pub pixels: Vec<Pixel>,
}

impl Canvas {
    pub fn new(width: usize, height: usize) -> Self {
        Self {
            width,
            height,
            pixels: vec![Pixel::TRANSPARENT; width * height],
        }
    }

    pub fn blend(&mut self, x: usize, y: usize, src: Pixel) {
        if src.a == 0 || x >= self.width || y >= self.height {
            return;
        }

        let index = y * self.width + x;
        self.pixels[index] = blend_pixel(self.pixels[index], src);
    }

    pub fn blend_i32(&mut self, x: i32, y: i32, src: Pixel) {
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

    pub fn to_png_data_url(&self) -> Result<String, String> {
        let mut raw = Vec::with_capacity(self.width * self.height * 4);
        for pixel in &self.pixels {
            raw.extend_from_slice(&[pixel.r, pixel.g, pixel.b, pixel.a]);
        }

        encode_png_data_url(&raw, self.width, self.height)
    }
}

pub fn blend_pixel(dst: Pixel, src: Pixel) -> Pixel {
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rect {
    pub x: usize,
    pub y: usize,
    pub width: usize,
    pub height: usize,
}

pub fn render_object_icon(
    content_dir: &Path,
    object: &super::xnb::RawObjectData,
    texture_cache: &mut HashMap<String, Texture>,
) -> Result<String, String> {
    let texture_key = object_texture_key(&object.texture);
    if !texture_cache.contains_key(&texture_key) {
        let texture_path = resolve_object_texture_path(content_dir, &texture_key)?;
        let texture = super::xnb::load_xnb_texture(&texture_path)?;
        texture_cache.insert(texture_key.clone(), texture);
    }

    let texture = texture_cache
        .get(&texture_key)
        .ok_or_else(|| format!("Object texture '{}' was not cached", texture_key))?;
    let rect = item_icon_rect(texture, object.sprite_index)?;
    texture.crop_to_png_data_url(rect)
}

pub fn object_texture_key(texture: &str) -> String {
    let value = if texture.trim().is_empty() {
        DEFAULT_OBJECT_TEXTURE
    } else {
        texture.trim()
    };
    let mut normalized = value.replace('\\', "/");
    while let Some(stripped) = normalized.strip_prefix("./") {
        normalized = stripped.to_string();
    }
    normalized = normalized.trim_start_matches('/').to_string();
    if normalized.to_ascii_lowercase().ends_with(".xnb") {
        normalized.truncate(normalized.len().saturating_sub(4));
    }
    if normalized.trim().is_empty() {
        DEFAULT_OBJECT_TEXTURE.to_string()
    } else {
        normalized
    }
}

pub fn resolve_object_texture_path(content_dir: &Path, texture_key: &str) -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    push_texture_path_candidate(&mut candidates, content_dir, texture_key);

    if !texture_key.contains('/') {
        push_texture_path_candidate(
            &mut candidates,
            content_dir,
            &format!("Maps/{}", texture_key),
        );
        push_texture_path_candidate(
            &mut candidates,
            content_dir,
            &format!("TileSheets/{}", texture_key),
        );
    }

    candidates
        .into_iter()
        .find(|path| path.exists())
        .ok_or_else(|| {
            format!(
                "无法定位物品贴图 '{}.xnb'，请确认游戏 Content 目录完整。",
                texture_key
            )
        })
}

pub fn push_texture_path_candidate(
    candidates: &mut Vec<PathBuf>,
    content_dir: &Path,
    texture_key: &str,
) {
    let Some(path) = texture_path_candidate(content_dir, texture_key) else {
        return;
    };
    if !candidates.iter().any(|candidate| candidate == &path) {
        candidates.push(path);
    }
}

pub fn texture_path_candidate(content_dir: &Path, texture_key: &str) -> Option<PathBuf> {
    let mut path = content_dir.to_path_buf();
    for segment in texture_key.split('/') {
        let segment = segment.trim();
        if segment.is_empty() || segment == "." || segment == ".." || segment.contains(':') {
            return None;
        }
        path.push(segment);
    }
    path.set_extension("xnb");
    Some(path)
}

pub fn item_icon_rect(texture: &Texture, sprite_index: i32) -> Result<Rect, String> {
    if sprite_index < 0 {
        return Err(format!("Invalid negative sprite index {}", sprite_index));
    }

    let columns = texture.width / ITEM_ICON_SIZE;
    if columns == 0 || texture.height < ITEM_ICON_SIZE {
        return Err("Object texture is smaller than a single item icon".to_string());
    }

    let sprite_index = sprite_index as usize;
    let x = (sprite_index % columns) * ITEM_ICON_SIZE;
    let y = (sprite_index / columns) * ITEM_ICON_SIZE;
    if x + ITEM_ICON_SIZE > texture.width || y + ITEM_ICON_SIZE > texture.height {
        return Err(format!(
            "Sprite index {} is outside object texture bounds {}x{}",
            sprite_index, texture.width, texture.height
        ));
    }

    Ok(Rect {
        x,
        y,
        width: ITEM_ICON_SIZE,
        height: ITEM_ICON_SIZE,
    })
}

pub fn encode_png_data_url(raw: &[u8], width: usize, height: usize) -> Result<String, String> {
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
