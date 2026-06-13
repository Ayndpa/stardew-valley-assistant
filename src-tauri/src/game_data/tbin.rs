use std::collections::HashMap;
use std::path::Path;

use super::image_utils::{object_texture_key, resolve_object_texture_path, Canvas, Texture};
use super::xnb::{load_xnb_payload, load_xnb_texture, XnbPayloadReader};

pub const MAX_MAP_PREVIEW_PIXELS: usize = 16_000_000;

#[derive(Debug, Clone, Default)]
pub struct TbinMap {
    pub tile_sheets: HashMap<String, TbinTileSheet>,
    pub layers: Vec<TbinLayer>,
}

#[derive(Debug, Clone, Default)]
pub struct TbinTileSheet {
    pub image_source: String,
    pub sheet_width: i32,
    pub tile_width: i32,
    pub tile_height: i32,
    pub margin_x: i32,
    pub margin_y: i32,
    pub spacing_x: i32,
    pub spacing_y: i32,
    pub tile_index_properties: HashMap<i32, HashMap<String, String>>,
}

#[derive(Debug, Clone)]
pub struct TbinLayer {
    pub id: String,
    pub visible: bool,
    pub width: i32,
    pub height: i32,
    pub tile_width: i32,
    pub tile_height: i32,
    pub tiles: Vec<Option<TbinTile>>,
}

#[derive(Debug, Clone)]
pub struct TbinTile {
    pub tile_sheet_id: String,
    pub tile_index: i32,
    pub properties: HashMap<String, String>,
}

impl TbinMap {
    pub fn layer(&self, id: &str) -> Option<&TbinLayer> {
        self.layers.iter().find(|layer| layer.id == id)
    }

    pub fn tile_property<'a>(
        &'a self,
        layer: &'a TbinLayer,
        x: i32,
        y: i32,
        property: &str,
    ) -> Option<&'a str> {
        let tile = layer.tile(x, y)?;
        if let Some(value) = tile.properties.get(property) {
            return Some(value);
        }
        self.tile_sheets
            .get(&tile.tile_sheet_id)
            .and_then(|tile_sheet| tile_sheet.tile_index_properties.get(&tile.tile_index))
            .and_then(|properties| properties.get(property))
            .map(String::as_str)
    }
}

impl TbinLayer {
    pub fn tile(&self, x: i32, y: i32) -> Option<&TbinTile> {
        if x < 0 || y < 0 || x >= self.width || y >= self.height {
            return None;
        }
        self.tiles
            .get((y * self.width + x) as usize)
            .and_then(Option::as_ref)
    }
}

pub struct TbinMapReader<'a> {
    data: &'a [u8],
    pos: usize,
    map: TbinMap,
}

impl<'a> TbinMapReader<'a> {
    pub fn new(data: &'a [u8]) -> Self {
        Self {
            data,
            pos: 0,
            map: TbinMap::default(),
        }
    }

    pub fn read_map(mut self) -> Result<TbinMap, String> {
        self.expect_bytes(b"tBIN10")?;
        let _id = self.read_string()?;
        let _description = self.read_string()?;
        let _properties = self.read_properties()?;
        self.read_tile_sheets()?;
        self.read_layers()?;
        Ok(self.map)
    }

    fn read_tile_sheets(&mut self) -> Result<(), String> {
        let count = self.read_i32()?.max(0);
        for _ in 0..count {
            let id = self.read_string()?;
            let _description = self.read_string()?;
            let image_source = self.read_string()?;
            let (sheet_width, sheet_height) = self.read_size()?;
            let (tile_width, tile_height) = self.read_size()?;
            let (margin_x, margin_y) = self.read_size()?;
            let (spacing_x, spacing_y) = self.read_size()?;
            let properties = self.read_properties()?;
            let tile_sheet = TbinTileSheet {
                image_source,
                sheet_width,
                tile_width,
                tile_height,
                margin_x,
                margin_y,
                spacing_x,
                spacing_y,
                tile_index_properties: parse_tile_index_properties(
                    sheet_width,
                    sheet_height,
                    properties,
                ),
            };
            self.map.tile_sheets.insert(id, tile_sheet);
        }
        Ok(())
    }

    fn read_layers(&mut self) -> Result<(), String> {
        let count = self.read_i32()?.max(0);
        for _ in 0..count {
            self.read_layer()?;
        }
        Ok(())
    }

    fn read_layer(&mut self) -> Result<(), String> {
        let id = self.read_string()?;
        let visible = self.read_bool()?;
        let _description = self.read_string()?;
        let (width, height) = self.read_size()?;
        let (tile_width, tile_height) = self.read_size()?;
        let _properties = self.read_properties()?;
        let mut layer = TbinLayer {
            id,
            visible,
            width,
            height,
            tile_width,
            tile_height,
            tiles: vec![None; (width.max(0) * height.max(0)) as usize],
        };
        let mut y = 0;
        let mut tile_sheet_id = String::new();

        while y < height {
            let mut x = 0;
            while x < width {
                match self.read_u8()? as char {
                    'T' => {
                        tile_sheet_id = self.read_string()?;
                    }
                    'N' => {
                        x += self.read_i32()?.max(0);
                    }
                    'S' => {
                        let tile = self.read_static_tile(tile_sheet_id.clone())?;
                        let index = (y * width + x) as usize;
                        if let Some(slot) = layer.tiles.get_mut(index) {
                            *slot = Some(tile);
                        }
                        x += 1;
                    }
                    'A' => {
                        let tile = self.read_animated_tile(tile_sheet_id.clone())?;
                        let index = (y * width + x) as usize;
                        if let Some(slot) = layer.tiles.get_mut(index) {
                            *slot = Some(tile);
                        }
                        x += 1;
                    }
                    value => {
                        return Err(format!("Unexpected tBIN layer token '{}'", value));
                    }
                }
            }
            y += 1;
        }

        self.map.layers.push(layer);
        Ok(())
    }

    fn read_static_tile(&mut self, tile_sheet_id: String) -> Result<TbinTile, String> {
        let tile_index = self.read_i32()?;
        let _blend_mode = self.read_u8()?;
        let properties = self.read_properties()?;
        Ok(TbinTile {
            tile_sheet_id,
            tile_index,
            properties,
        })
    }

    fn read_animated_tile(&mut self, current_tile_sheet_id: String) -> Result<TbinTile, String> {
        let _frame_interval = self.read_i32()?;
        let frame_count = self.read_i32()?.max(0);
        let mut tile_sheet_id = current_tile_sheet_id;
        let mut first_tile: Option<TbinTile> = None;

        for _ in 0..frame_count {
            loop {
                match self.read_u8()? as char {
                    'T' => {
                        tile_sheet_id = self.read_string()?;
                    }
                    'S' => {
                        let tile = self.read_static_tile(tile_sheet_id.clone())?;
                        if first_tile.is_none() {
                            first_tile = Some(tile);
                        }
                        break;
                    }
                    value => {
                        return Err(format!("Unexpected tBIN animated tile token '{}'", value));
                    }
                }
            }
        }

        let animation_properties = self.read_properties()?;
        let mut tile = first_tile.ok_or_else(|| "Animated tile has no frames".to_string())?;
        tile.properties.extend(animation_properties);
        Ok(tile)
    }

    fn read_properties(&mut self) -> Result<HashMap<String, String>, String> {
        let count = self.read_i32()?.max(0);
        let mut properties = HashMap::with_capacity(count as usize);
        for _ in 0..count {
            let key = self.read_string()?;
            let value_type = self.read_u8()?;
            let value = match value_type {
                0 => self.read_bool()?.to_string(),
                1 => self.read_i32()?.to_string(),
                2 => self.read_f32()?.to_string(),
                3 => self.read_string()?,
                _ => return Err(format!("Unsupported tBIN property type {}", value_type)),
            };
            properties.insert(key, value);
        }
        Ok(properties)
    }

    fn read_size(&mut self) -> Result<(i32, i32), String> {
        Ok((self.read_i32()?, self.read_i32()?))
    }

    fn expect_bytes(&mut self, expected: &[u8]) -> Result<(), String> {
        let actual = self.read_bytes(expected.len())?;
        if actual == expected {
            Ok(())
        } else {
            Err("Invalid tBIN header".to_string())
        }
    }

    fn read_i32(&mut self) -> Result<i32, String> {
        let bytes = self.read_array::<4>()?;
        Ok(i32::from_le_bytes(bytes))
    }

    fn read_f32(&mut self) -> Result<f32, String> {
        let bytes = self.read_array::<4>()?;
        Ok(f32::from_le_bytes(bytes))
    }

    fn read_bool(&mut self) -> Result<bool, String> {
        Ok(self.read_u8()? > 0)
    }

    fn read_string(&mut self) -> Result<String, String> {
        let len = self.read_i32()?.max(0) as usize;
        let bytes = self.read_bytes(len)?;
        String::from_utf8(bytes.to_vec()).map_err(|e| format!("Invalid tBIN UTF-8 string: {}", e))
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

    fn read_bytes(&mut self, len: usize) -> Result<&'a [u8], String> {
        if self.pos + len > self.data.len() {
            return Err(format!(
                "Unexpected end of tBIN payload at byte {}, wanted {} more bytes",
                self.pos, len
            ));
        }
        let start = self.pos;
        self.pos += len;
        Ok(&self.data[start..self.pos])
    }
}

pub fn load_tbin_map_from_xnb(path: &Path) -> Result<Option<TbinMap>, String> {
    let payload = load_xnb_payload(path)?;
    let mut reader = XnbPayloadReader::new(&payload);
    let type_readers = reader.read_type_readers()?;
    let root_reader = reader.read_7bit_usize()?;
    if root_reader == 0 {
        return Ok(None);
    }

    let Some(reader_name) = type_readers.get(root_reader.saturating_sub(1)) else {
        return Ok(None);
    };
    if !reader_name.contains("xTile.Pipeline.TideReader") {
        return Ok(None);
    }

    let map_payload_len = reader.read_i32()?.max(0) as usize;
    let map_payload = reader.read_bytes(map_payload_len)?;
    TbinMapReader::new(map_payload).read_map().map(Some)
}

pub fn render_tbin_map_preview(content_dir: &Path, path: &Path) -> Result<String, String> {
    let Some(map) = load_tbin_map_from_xnb(path)? else {
        return Err("所选文件不是可渲染的 tBIN 地图。".to_string());
    };
    let back_layer = map
        .layer("Back")
        .ok_or_else(|| "地图缺少 Back 图层，无法渲染底图。".to_string())?;
    let tile_width = back_layer.tile_width.max(1) as usize;
    let tile_height = back_layer.tile_height.max(1) as usize;
    let width = (back_layer.width.max(0) as usize)
        .checked_mul(tile_width)
        .ok_or_else(|| "地图宽度过大，无法渲染。".to_string())?;
    let height = (back_layer.height.max(0) as usize)
        .checked_mul(tile_height)
        .ok_or_else(|| "地图高度过大，无法渲染。".to_string())?;
    if width == 0 || height == 0 {
        return Err("地图尺寸为空，无法渲染。".to_string());
    }
    if width.saturating_mul(height) > MAX_MAP_PREVIEW_PIXELS {
        return Err(format!(
            "地图预览尺寸 {}x{} 过大，已跳过底图渲染。",
            width, height
        ));
    }

    let mut canvas = Canvas::new(width, height);
    let mut texture_cache = HashMap::new();
    let mut drawn_tiles = 0usize;

    for layer in map.layers.iter().filter(|layer| layer.visible) {
        for y in 0..layer.height {
            for x in 0..layer.width {
                let Some(tile) = layer.tile(x, y) else {
                    continue;
                };
                let Some(tile_sheet) = map.tile_sheets.get(&tile.tile_sheet_id) else {
                    continue;
                };
                let texture_key = object_texture_key(&tile_sheet.image_source);
                if !texture_cache.contains_key(&texture_key) {
                    let texture_path = resolve_object_texture_path(content_dir, &texture_key)?;
                    let texture = load_xnb_texture(&texture_path)?;
                    texture_cache.insert(texture_key.clone(), texture);
                }
                let texture = texture_cache
                    .get(&texture_key)
                    .ok_or_else(|| format!("贴图 '{}' 未缓存。", texture_key))?;
                if draw_tbin_tile(
                    &mut canvas,
                    texture,
                    tile_sheet,
                    layer,
                    x,
                    y,
                    tile.tile_index,
                ) {
                    drawn_tiles += 1;
                }
            }
        }
    }

    if drawn_tiles == 0 {
        return Err("地图没有可绘制的瓦片。".to_string());
    }

    canvas.to_png_data_url()
}

pub fn draw_tbin_tile(
    canvas: &mut Canvas,
    texture: &Texture,
    tile_sheet: &TbinTileSheet,
    layer: &TbinLayer,
    tile_x: i32,
    tile_y: i32,
    tile_index: i32,
) -> bool {
    if tile_x < 0 || tile_y < 0 || tile_index < 0 {
        return false;
    }

    let source_width = tile_sheet.tile_width.max(1) as usize;
    let source_height = tile_sheet.tile_height.max(1) as usize;
    let columns = if tile_sheet.sheet_width > 0 {
        tile_sheet.sheet_width as usize
    } else {
        texture.width / source_width
    };
    if columns == 0 {
        return false;
    }

    let tile_index = tile_index as usize;
    let margin_x = tile_sheet.margin_x.max(0) as usize;
    let margin_y = tile_sheet.margin_y.max(0) as usize;
    let spacing_x = tile_sheet.spacing_x.max(0) as usize;
    let spacing_y = tile_sheet.spacing_y.max(0) as usize;
    let source_x = margin_x + (tile_index % columns) * (source_width + spacing_x);
    let source_y = margin_y + (tile_index / columns) * (source_height + spacing_y);
    if source_x >= texture.width || source_y >= texture.height {
        return false;
    }

    let dest_x = tile_x as usize * layer.tile_width.max(1) as usize;
    let dest_y = tile_y as usize * layer.tile_height.max(1) as usize;
    let draw_width = source_width
        .min(layer.tile_width.max(1) as usize)
        .min(texture.width.saturating_sub(source_x));
    let draw_height = source_height
        .min(layer.tile_height.max(1) as usize)
        .min(texture.height.saturating_sub(source_y));
    if draw_width == 0 || draw_height == 0 {
        return false;
    }

    for y in 0..draw_height {
        for x in 0..draw_width {
            canvas.blend(
                dest_x + x,
                dest_y + y,
                texture.get(source_x + x, source_y + y),
            );
        }
    }

    true
}

fn parse_tile_index_properties(
    sheet_width: i32,
    sheet_height: i32,
    properties: HashMap<String, String>,
) -> HashMap<i32, HashMap<String, String>> {
    let mut by_index: HashMap<i32, HashMap<String, String>> = HashMap::new();
    let tile_count = sheet_width.saturating_mul(sheet_height);

    for (key, value) in properties {
        let Some((index, property_name)) = parse_tile_index_property_key(&key, tile_count) else {
            continue;
        };
        by_index
            .entry(index)
            .or_default()
            .insert(property_name, value);
    }

    by_index
}

fn parse_tile_index_property_key(key: &str, tile_count: i32) -> Option<(i32, String)> {
    if let Some(rest) = key.strip_prefix("@TileIndex@") {
        let (index_text, property_name) = rest.split_once('@')?;
        let index = index_text.parse::<i32>().ok()?;
        if index < 0 || index >= tile_count || property_name.is_empty() {
            return None;
        }
        return Some((index, property_name.to_string()));
    }

    let (index_text, property_name) = key
        .split_once('@')
        .or_else(|| key.split_once(':'))
        .or_else(|| key.split_once('|'))?;
    let index = index_text.parse::<i32>().ok()?;
    if index < 0 || index >= tile_count || property_name.is_empty() {
        return None;
    }
    Some((index, property_name.to_string()))
}
