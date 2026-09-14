//! 姜岛火山地牢布局解析。
//!
//! 火山地牢的每一层布局由两个游戏文件决定：
//! - `Content/VolcanoLayouts/Layouts.xnb`：一张 640×640 的贴图，按 64×64 切成 10×10 共 100 块，
//!   每块是一个候选布局，尾部若干块是全墙的占位块（会被丢弃）。像素颜色编码图块类型。
//! - `Content/Maps/Mines/Volcano_SetPieces_{3,4,8,16,32}.xnb`：set piece 的 tBIN 地图，
//!   `Paths` 图层上的瓦片 id 标记了放置后会触发什么（消耗随机数 / 龙牙 / 宝箱）。
//!
//! 两者都是纯「给 Content 目录就能算出来」的逻辑，所以放在共享 crate，桌面端与手机端共用。

use std::path::Path;

use serde::{Deserialize, Serialize};

use super::tbin::load_tbin_map_from_xnb;
use super::xnb::load_xnb_texture;

/// 单个布局的边长（格）。
pub const LAYOUT_TILE_SIZE: usize = 64;

/// 布局贴图的图块类型，取值与游戏内部枚举一致。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum VolcanoTile {
    Floor = 0,
    Lava = 1,
    Wall = 2,
    Enter = 3,
    Exit = 4,
    SetPiece = 5,
    Switch = 6,
    Monster = 7,
}

/// set piece 触发的特征。`Rng` 只是消耗一次随机数（不产出东西），但会推进随机流，
/// 因此必须原样记下来，否则后续所有预测都会错位。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum SetPieceFeature {
    Rng = 0,
    Tooth = 1,
    Chest = 2,
}

/// 某个尺寸的 set piece 图集排布。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VolcanoPieceSize {
    pub size: i32,
    pub rows: i32,
    pub cols: i32,
}

/// 某个 set piece 具体位置上按触发顺序排列的特征。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VolcanoPieceEvents {
    pub size: i32,
    pub row: i32,
    pub col: i32,
    pub events: Vec<u8>,
}

/// 火山地牢布局数据，可直接序列化给前端。
///
/// `layouts_rle` 是全部布局按行优先首尾相接后再游程编码 + base64 的结果。
/// 之所以先拼接再压缩：run 会跨越布局边界，逐块独立编码会让下一块开头的像素被上一块吃掉，
/// 导致后面所有布局整体错位。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VolcanoLayoutData {
    pub layout_count: usize,
    pub layouts_rle: String,
    pub piece_sizes: Vec<VolcanoPieceSize>,
    pub piece_events: Vec<VolcanoPieceEvents>,
}

/// set piece 的尺寸档位，与游戏里的三档 set piece 一一对应。
const SET_PIECE_SIZES: [i32; 5] = [3, 4, 8, 16, 32];

/// 从游戏 Content 目录读取全部火山布局数据。
pub fn load_volcano_layout_data(content_dir: &Path) -> Result<VolcanoLayoutData, String> {
    let layouts = load_volcano_layouts(content_dir)?;
    let (piece_sizes, piece_events) = load_volcano_set_pieces(content_dir)?;

    Ok(VolcanoLayoutData {
        layout_count: layouts.len(),
        layouts_rle: encode_rle_base64(&layouts),
        piece_sizes,
        piece_events,
    })
}

/// 解析 `VolcanoLayouts/Layouts.xnb`，返回若干个 64×64 的布局。
pub fn load_volcano_layouts(content_dir: &Path) -> Result<Vec<Vec<u8>>, String> {
    let path = content_dir.join("VolcanoLayouts").join("Layouts.xnb");
    let texture = load_xnb_texture(&path)?;
    if texture.width % LAYOUT_TILE_SIZE != 0 || texture.height % LAYOUT_TILE_SIZE != 0 {
        return Err(format!(
            "火山布局贴图尺寸 {}x{} 不是 {} 的整数倍",
            texture.width, texture.height, LAYOUT_TILE_SIZE
        ));
    }

    let cols = texture.width / LAYOUT_TILE_SIZE;
    let rows = texture.height / LAYOUT_TILE_SIZE;
    let mut layouts = Vec::with_capacity(cols * rows);

    for layout_y in 0..rows {
        for layout_x in 0..cols {
            let mut tiles = Vec::with_capacity(LAYOUT_TILE_SIZE * LAYOUT_TILE_SIZE);
            for y in 0..LAYOUT_TILE_SIZE {
                for x in 0..LAYOUT_TILE_SIZE {
                    let px = layout_x * LAYOUT_TILE_SIZE + x;
                    let py = layout_y * LAYOUT_TILE_SIZE + y;
                    let pixel = texture.get(px, py);
                    tiles.push(tile_from_color(pixel.r, pixel.g, pixel.b, px, py)? as u8);
                }
            }
            layouts.push(tiles);
        }
    }

    // 尾部整块都是墙的是没用到的占位块，直接丢弃，否则会被当成合法布局参与随机。
    while layouts
        .last()
        .is_some_and(|layout| layout.iter().all(|&tile| tile == VolcanoTile::Wall as u8))
    {
        layouts.pop();
    }

    if layouts.is_empty() {
        return Err("火山布局贴图没有解析出任何有效布局".to_string());
    }

    Ok(layouts)
}

/// 解析五个 set piece 地图，得到尺寸排布与每个位置的触发特征。
pub fn load_volcano_set_pieces(
    content_dir: &Path,
) -> Result<(Vec<VolcanoPieceSize>, Vec<VolcanoPieceEvents>), String> {
    let mut sizes = Vec::with_capacity(SET_PIECE_SIZES.len());
    let mut events = Vec::new();

    for &set_size in SET_PIECE_SIZES.iter() {
        let path = content_dir
            .join("Maps")
            .join("Mines")
            .join(format!("Volcano_SetPieces_{}.xnb", set_size));
        let Some(map) = load_tbin_map_from_xnb(&path)? else {
            return Err(format!(
                "{} 不是可解析的 tBIN 地图",
                path.display()
            ));
        };
        let Some(layer) = map.layer("Paths") else {
            return Err(format!("{} 缺少 Paths 图层", path.display()));
        };

        let size = set_size.max(1) as i32;
        let cols = layer.width / size;
        let rows = layer.height / size;
        if cols <= 0 || rows <= 0 {
            return Err(format!(
                "{} 的 Paths 图层尺寸 {}x{} 小于 set piece 尺寸 {}",
                path.display(),
                layer.width,
                layer.height,
                set_size
            ));
        }
        sizes.push(VolcanoPieceSize {
            size: set_size,
            rows,
            cols,
        });

        for col in 0..cols {
            for row in 0..rows {
                let mut collected = Vec::new();
                for setx in 0..size {
                    // 这里用 `..=` 是照抄游戏的行为：它多扫了一行，而这行可能带有事件。
                    for sety in 0..=size {
                        let src_x = col * size + setx;
                        let src_y = row * size + sety;
                        let Some(tile) = layer.tile(src_x, src_y) else {
                            continue;
                        };
                        if let Some(feature) = feature_from_tile_id(tile.tile_index, src_x, src_y)? {
                            collected.push(feature as u8);
                        }
                    }
                }
                if !collected.is_empty() {
                    events.push(VolcanoPieceEvents {
                        size: set_size,
                        row,
                        col,
                        events: collected,
                    });
                }
            }
        }
    }

    Ok((sizes, events))
}

fn tile_from_color(r: u8, g: u8, b: u8, x: usize, y: usize) -> Result<VolcanoTile, String> {
    match (r, g, b) {
        (255, 0, 0) => Ok(VolcanoTile::Exit),
        (0, 255, 0) => Ok(VolcanoTile::Enter),
        (0, 0, 255) => Ok(VolcanoTile::Lava),
        (255, 255, 0) => Ok(VolcanoTile::SetPiece),
        (128, 128, 128) => Ok(VolcanoTile::Switch),
        (0, 255, 255) => Ok(VolcanoTile::Monster),
        (0, 0, 0) => Ok(VolcanoTile::Wall),
        (255, 255, 255) => Ok(VolcanoTile::Floor),
        _ => Err(format!(
            "火山布局贴图在 ({}, {}) 出现未识别的颜色 rgb({}, {}, {})",
            x, y, r, g, b
        )),
    }
}

/// `Paths` 图层瓦片 id 到 set piece 特征的映射。
///
/// 这是游戏 `VolcanoDungeon` 生成逻辑里硬编码的编号，改版本时若有新增瓦片会在报错里暴露出来。
fn feature_from_tile_id(tile_id: i32, x: i32, y: i32) -> Result<Option<SetPieceFeature>, String> {
    match tile_id {
        // 可能的闸门位置，游戏会为此消耗一次随机数
        234..=239 => Ok(Some(SetPieceFeature::Rng)),
        // 地下城自己的开关位置，不影响掉落，不记录
        250 => Err(format!(
            "set piece 在 ({}, {}) 出现了闸门开关瓦片 250",
            x, y
        )),
        251..=255 | 330 | 331 | 333 => Ok(None),
        332 => Ok(Some(SetPieceFeature::Chest)),
        // 木桶
        334 => Ok(Some(SetPieceFeature::Rng)),
        335 => Ok(Some(SetPieceFeature::Tooth)),
        // 尖刺怪刷新点
        346 => Ok(None),
        _ => Err(format!(
            "Paths 图层在 ({}, {}) 出现未识别的瓦片 id {}",
            x, y, tile_id
        )),
    }
}

/// 把全部布局首尾相接后做游程编码，再 base64。
///
/// 布局是高度重复的（大片连续墙/地板），RLE 后体积能压到原始的百分之一量级。
/// 编码单元固定为「1 字节图块值 + 1 字节长度」，超过 255 的连续段会拆成多段，
/// 这样解码侧只要按字节交替读就行，不需要处理变长长度。
fn encode_rle_base64(layouts: &[Vec<u8>]) -> String {
    // 最坏情况（完全没有连续同值）是每字节多出一倍开销，按这个预留避免反复扩容。
    let total: usize = layouts.iter().map(Vec::len).sum();
    let mut raw = Vec::with_capacity(total * 2);

    for layout in layouts {
        let mut index = 0;
        while index < layout.len() {
            let value = layout[index];
            let mut run = 1usize;
            while index + run < layout.len() && layout[index + run] == value && run < 255 {
                run += 1;
            }
            raw.push(value);
            raw.push(run as u8);
            index += run;
        }
    }

    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD.encode(raw)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use std::path::PathBuf;

    /// 测试用的 Content 目录：`SDV_CONTENT_DIR` 优先，否则退回源码树下的那份。
    fn test_content_dir() -> Option<PathBuf> {
        if let Ok(dir) = env::var("SDV_CONTENT_DIR") {
            let path = PathBuf::from(dir);
            if path.join("Data").join("Crops.xnb").exists() {
                return Some(path);
            }
        }
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .and_then(|path| path.parent())
            .map(|path| {
                path.join("stardew-valley-source")
                    .join("StardewValleyGame")
                    .join("Content")
            })
            .filter(|path| path.exists())
    }

    #[test]
    fn loads_volcano_layouts_from_game_files() {
        let Some(content) = test_content_dir() else {
            eprintln!("skip: no content dir");
            return;
        };

        let data = load_volcano_layout_data(&content).unwrap();
        eprintln!("layout_count = {}", data.layout_count);
        for entry in &data.piece_sizes {
            eprintln!("size {} => rows {} cols {}", entry.size, entry.rows, entry.cols);
        }
        for entry in &data.piece_events {
            eprintln!(
                "{}|{}|{} => {:?}",
                entry.size, entry.row, entry.col, entry.events
            );
        }

        assert_eq!(data.layout_count, 58, "1.6 的火山布局应有 58 个");
        assert!(!data.layouts_rle.is_empty());
    }

    /// 开发用：设置 `VOLCANO_DUMP=<路径>` 就把解析结果写成 JSON，
    /// 供前端预测器做端到端对拍（见 `.workbuddy/verify-full.mts`）。
    #[test]
    fn dumps_volcano_layout_data_json() {
        let Ok(out_path) = env::var("VOLCANO_DUMP") else {
            eprintln!("skip: VOLCANO_DUMP not set");
            return;
        };
        let Some(content) = test_content_dir() else {
            eprintln!("skip: no content dir");
            return;
        };

        let data = load_volcano_layout_data(&content).unwrap();
        let json = serde_json::to_string(&data).unwrap();
        std::fs::write(&out_path, &json).unwrap();
        eprintln!("dumped {} bytes to {}", json.len(), out_path);
    }

    /// 开发用：把 XNB 解析出的布局与一份参考 PNG（参考实现仓库里的 `game_data/Layouts.png`）
    /// 逐格比对，用来判断差异是「实现不同」还是「参考数据版本不同」。
    #[test]
    fn layouts_match_reference_png() {
        let Ok(png_path) = env::var("VOLCANO_LAYOUTS_PNG") else {
            eprintln!("skip: VOLCANO_LAYOUTS_PNG not set");
            return;
        };
        let Some(content) = test_content_dir() else {
            eprintln!("skip: no content dir");
            return;
        };

        let from_xnb = load_volcano_layouts(&content).unwrap();

        let img = image::open(&png_path).unwrap().to_rgba8();
        let (width, height) = (img.width() as usize, img.height() as usize);
        let cols = width / LAYOUT_TILE_SIZE;
        let rows = height / LAYOUT_TILE_SIZE;

        let mut from_png: Vec<Vec<u8>> = Vec::new();
        for layout_y in 0..rows {
            for layout_x in 0..cols {
                let mut tiles = Vec::with_capacity(LAYOUT_TILE_SIZE * LAYOUT_TILE_SIZE);
                for y in 0..LAYOUT_TILE_SIZE {
                    for x in 0..LAYOUT_TILE_SIZE {
                        let px = layout_x * LAYOUT_TILE_SIZE + x;
                        let py = layout_y * LAYOUT_TILE_SIZE + y;
                        let p = img.get_pixel(px as u32, py as u32);
                        tiles.push(
                            tile_from_color(p[0], p[1], p[2], px, py).unwrap() as u8,
                        );
                    }
                }
                from_png.push(tiles);
            }
        }
        while from_png
            .last()
            .is_some_and(|layout| layout.iter().all(|&tile| tile == VolcanoTile::Wall as u8))
        {
            from_png.pop();
        }

        eprintln!("xnb layouts = {}, png layouts = {}", from_xnb.len(), from_png.len());
        assert_eq!(from_xnb.len(), from_png.len(), "布局数量不一致");

        let mut total = 0usize;
        for (index, (a, b)) in from_xnb.iter().zip(from_png.iter()).enumerate() {
            let diff = a.iter().zip(b.iter()).filter(|(x, y)| x != y).count();
            if diff != 0 {
                total += diff;
                let first = a
                    .iter()
                    .zip(b.iter())
                    .enumerate()
                    .find(|(_, (x, y))| x != y)
                    .map(|(i, (x, y))| (i % 64, i / 64, *x, *y));
                eprintln!("layout {} 有 {} 格不同，首个: {:?}", index, diff, first);
            }
        }
        eprintln!("合计 {} 格不同", total);
    }
}
