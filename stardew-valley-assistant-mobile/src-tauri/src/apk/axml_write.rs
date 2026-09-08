//! 二进制 AndroidManifest.xml 的**改写**与重新序列化。
//!
//! [`super::axml`] 只负责读，够用来识别安装包；但"打 Mod 启动"要把游戏包重打成一个
//! 独立应用，就必须真的改清单：换包名、换入口 Activity、换 `MonoRuntimeProvider`
//! 的 authority（authority 里带着包名，不改会和商店版游戏冲突，系统直接拒绝安装）。
//!
//! 这里没有复用只读解析器的 [`super::axml::AxmlElement`]：那个结构为了好用丢掉了
//! 命名空间块、资源映射表、行号、属性的原始 `Res_value` 位模式，而这些东西重新
//! 序列化时一个都不能少。所以本模块保留一份**低层**表示——字符串池 + 资源映射表 +
//! 扁平的节点流——改完原样写回去。
//!
//! 几个容易踩的地方，写在最前面：
//!
//! * 属性表的 `attributeStart` 是相对 `ResXMLTree_attrExt`（块起点 +16）的偏移，
//!   不是相对块起点的。
//! * 属性名在池里的下标同时是**资源映射表的下标**：Android 解析清单靠的是资源 ID
//!   而不是属性名字符串。所以新字符串只能往池尾追加（追加不会打乱前面的下标），
//!   要新增一个带资源 ID 的属性名时还得把资源映射表一起补长。
//! * `idIndex`/`classIndex`/`styleIndex` 是 1 基的属性下标，插入属性后必须跟着挪。
//! * aapt2 把属性按资源 ID 升序排列、无资源 ID 的排在最后；框架侧有代码依赖这个
//!   顺序，所以插入新属性也要插到正确位置。

use std::fmt;

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const RES_XML_TYPE: u16 = 0x0003;
const CHUNK_STRING_POOL: u16 = 0x0001;
const CHUNK_XML_START_NAMESPACE: u16 = 0x0100;
const CHUNK_XML_END_NAMESPACE: u16 = 0x0101;
const CHUNK_XML_START_ELEMENT: u16 = 0x0102;
const CHUNK_XML_END_ELEMENT: u16 = 0x0103;
const CHUNK_XML_CDATA: u16 = 0x0104;
const CHUNK_XML_RESOURCE_MAP: u16 = 0x0180;

const FLAG_SORTED: u32 = 1 << 0;
const FLAG_UTF8: u32 = 1 << 8;

const TYPE_STRING: u8 = 0x03;
const TYPE_INT_DEC: u8 = 0x10;
const TYPE_INT_BOOLEAN: u8 = 0x12;

/// 字符串池头部固定 28 字节。
const POOL_HEADER_SIZE: usize = 28;
/// 属性扩展结构相对块起点的偏移：块头 8 + lineNumber 4 + comment 4。
const ATTR_EXT_OFFSET: usize = 16;
/// 单条属性 20 字节。
const ATTR_ENTRY_SIZE: usize = 20;
/// 开始标签块的固定部分：块头 8 + 行号/注释 8 + ns/name 8 + 属性表元信息 12。
const START_ELEMENT_FIXED: usize = 36;

/// 空索引。
const NO_ENTRY: u32 = u32::MAX;

pub const ANDROID_NS: &str = "http://schemas.android.com/apk/res/android";

// 用得到的框架属性资源 ID。这些值是 `android.R.attr` 里公开的常量，永远不会变。
pub const ATTR_LABEL: u32 = 0x0101_0001;
pub const ATTR_NAME: u32 = 0x0101_0003;
pub const ATTR_EXPORTED: u32 = 0x0101_0010;
pub const ATTR_AUTHORITIES: u32 = 0x0101_0018;
pub const ATTR_MIN_SDK_VERSION: u32 = 0x0101_020c;
pub const ATTR_TARGET_ACTIVITY: u32 = 0x0101_0202;
pub const ATTR_TARGET_SDK_VERSION: u32 = 0x0101_0270;
pub const ATTR_EXTRACT_NATIVE_LIBS: u32 = 0x0101_04ea;
pub const ATTR_DEBUGGABLE: u32 = 0x0101_000f;

/// 会把 `android:name` 当类名解释的元素。改包名时这些元素上的相对类名
/// （`.Foo` 或裸 `Foo`）会跟着包名一起飘走，必须先补全成绝对类名。
const CLASS_ELEMENTS: &[&str] = &[
    "application",
    "activity",
    "activity-alias",
    "service",
    "receiver",
    "provider",
];

// ---------------------------------------------------------------------------
// 错误
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub struct AxmlEditError(String);

impl fmt::Display for AxmlEditError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "改写 AndroidManifest.xml 失败: {}", self.0)
    }
}

impl std::error::Error for AxmlEditError {}

impl From<AxmlEditError> for String {
    fn from(err: AxmlEditError) -> String {
        err.to_string()
    }
}

type Result<T> = std::result::Result<T, AxmlEditError>;

fn err<T>(msg: impl Into<String>) -> Result<T> {
    Err(AxmlEditError(msg.into()))
}

// ---------------------------------------------------------------------------
// 读取游标
// ---------------------------------------------------------------------------

struct Reader<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn at(data: &'a [u8], pos: usize) -> Self {
        Reader { data, pos }
    }

    fn remaining(&self) -> usize {
        self.data.len().saturating_sub(self.pos)
    }

    fn u8(&mut self) -> Result<u8> {
        if self.remaining() < 1 {
            return err("读取 u8 时数据已结束");
        }
        let v = self.data[self.pos];
        self.pos += 1;
        Ok(v)
    }

    fn u16(&mut self) -> Result<u16> {
        if self.remaining() < 2 {
            return err("读取 u16 时数据已结束");
        }
        let v = u16::from_le_bytes([self.data[self.pos], self.data[self.pos + 1]]);
        self.pos += 2;
        Ok(v)
    }

    fn u32(&mut self) -> Result<u32> {
        if self.remaining() < 4 {
            return err("读取 u32 时数据已结束");
        }
        let v = u32::from_le_bytes([
            self.data[self.pos],
            self.data[self.pos + 1],
            self.data[self.pos + 2],
            self.data[self.pos + 3],
        ]);
        self.pos += 4;
        Ok(v)
    }

    fn bytes(&mut self, len: usize) -> Result<&'a [u8]> {
        if self.remaining() < len {
            return err("读取固定长度数据时越界");
        }
        let out = &self.data[self.pos..self.pos + len];
        self.pos += len;
        Ok(out)
    }
}

// ---------------------------------------------------------------------------
// 可编辑字符串池
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct StringPool {
    strings: Vec<String>,
    utf8: bool,
    /// 除 UTF8/SORTED 之外的位原样保留。SORTED 会被清掉——追加的字符串不保证有序，
    /// 留着这个标志会让框架的二分查找找错东西。
    other_flags: u32,
    /// 样式表。清单里基本不会出现，但原样带走比丢掉安全。
    style_offsets: Vec<u32>,
    style_data: Vec<u8>,
}

impl StringPool {
    fn parse(chunk: &[u8]) -> Result<StringPool> {
        let mut r = Reader::at(chunk, 0);
        let _chunk_type = r.u16()?;
        let header_size = r.u16()? as usize;
        let _chunk_size = r.u32()?;
        let string_count = r.u32()? as usize;
        let style_count = r.u32()? as usize;
        let flags = r.u32()?;
        let strings_start = r.u32()? as usize;
        let styles_start = r.u32()? as usize;

        if header_size > chunk.len() {
            return err("字符串池头部长度越界");
        }

        let mut offsets = Vec::with_capacity(string_count);
        let mut off_reader = Reader::at(chunk, header_size);
        for _ in 0..string_count {
            offsets.push(off_reader.u32()? as usize);
        }
        let mut style_offsets = Vec::with_capacity(style_count);
        for _ in 0..style_count {
            style_offsets.push(off_reader.u32()?);
        }

        let utf8 = flags & FLAG_UTF8 != 0;
        let mut strings = Vec::with_capacity(string_count);
        for offset in offsets {
            let start = strings_start
                .checked_add(offset)
                .ok_or_else(|| AxmlEditError("字符串偏移溢出".into()))?;
            if start >= chunk.len() {
                // 悬空偏移：补空串保持下标对齐，让改写继续走下去。
                strings.push(String::new());
                continue;
            }
            strings.push(if utf8 {
                read_utf8_string(chunk, start)?
            } else {
                read_utf16_string(chunk, start)?
            });
        }

        let style_data = if style_count > 0 && styles_start != 0 && styles_start < chunk.len() {
            chunk[styles_start..].to_vec()
        } else {
            Vec::new()
        };

        Ok(StringPool {
            strings,
            utf8,
            other_flags: flags & !(FLAG_UTF8 | FLAG_SORTED),
            style_offsets,
            style_data,
        })
    }

    fn get(&self, index: u32) -> &str {
        if index == NO_ENTRY {
            return "";
        }
        self.strings
            .get(index as usize)
            .map(String::as_str)
            .unwrap_or("")
    }

    /// 已有就复用，没有就追加到池尾。**只能追加**：前面的下标被资源映射表和
    /// 所有节点引用着，插到中间等于把整份清单打乱。
    fn intern(&mut self, value: &str) -> u32 {
        if let Some(pos) = self.strings.iter().position(|s| s == value) {
            return pos as u32;
        }
        self.strings.push(value.to_string());
        (self.strings.len() - 1) as u32
    }

    fn encode(&self) -> Result<Vec<u8>> {
        let mut data = Vec::new();
        let mut offsets = Vec::with_capacity(self.strings.len());
        for s in &self.strings {
            offsets.push(data.len() as u32);
            if self.utf8 {
                write_utf8_string(&mut data, s)?;
            } else {
                write_utf16_string(&mut data, s)?;
            }
        }
        // 字符串数据整体补齐到 4 字节，后面的样式表和下一个块都要求对齐。
        while data.len() % 4 != 0 {
            data.push(0);
        }

        let strings_start = POOL_HEADER_SIZE + 4 * (offsets.len() + self.style_offsets.len());
        let styles_start = if self.style_data.is_empty() {
            0
        } else {
            strings_start + data.len()
        };
        let size = strings_start + data.len() + self.style_data.len();

        let mut out = Vec::with_capacity(size);
        out.extend_from_slice(&CHUNK_STRING_POOL.to_le_bytes());
        out.extend_from_slice(&(POOL_HEADER_SIZE as u16).to_le_bytes());
        out.extend_from_slice(&(size as u32).to_le_bytes());
        out.extend_from_slice(&(offsets.len() as u32).to_le_bytes());
        out.extend_from_slice(&(self.style_offsets.len() as u32).to_le_bytes());
        out.extend_from_slice(
            &(self.other_flags | if self.utf8 { FLAG_UTF8 } else { 0 }).to_le_bytes(),
        );
        out.extend_from_slice(&(strings_start as u32).to_le_bytes());
        out.extend_from_slice(&(styles_start as u32).to_le_bytes());
        for off in &offsets {
            out.extend_from_slice(&off.to_le_bytes());
        }
        for off in &self.style_offsets {
            out.extend_from_slice(&off.to_le_bytes());
        }
        out.extend_from_slice(&data);
        out.extend_from_slice(&self.style_data);
        debug_assert_eq!(out.len(), size);
        Ok(out)
    }
}

/// UTF-8 池条目：`utf16 长度`、`utf8 字节长度`、字节、`0x00`。
fn read_utf8_string(chunk: &[u8], start: usize) -> Result<String> {
    let mut r = Reader::at(chunk, start);
    let mut len = r.u8()? as usize;
    if len & 0x80 != 0 {
        len = ((len & 0x7f) << 8) | r.u8()? as usize;
    }
    let _ = len;

    let mut byte_len = r.u8()? as usize;
    if byte_len & 0x80 != 0 {
        byte_len = ((byte_len & 0x7f) << 8) | r.u8()? as usize;
    }
    let bytes = r.bytes(byte_len)?;
    Ok(String::from_utf8_lossy(bytes).into_owned())
}

/// UTF-16 池条目：`长度`、UTF-16 码元、`0x0000`。
fn read_utf16_string(chunk: &[u8], start: usize) -> Result<String> {
    let mut r = Reader::at(chunk, start);
    let mut len = r.u16()? as usize;
    if len & 0x8000 != 0 {
        len = ((len & 0x7fff) << 16) | r.u16()? as usize;
    }
    if r.remaining() < len * 2 {
        return err("UTF-16 字符串长度越界");
    }
    let mut units = Vec::with_capacity(len);
    for _ in 0..len {
        units.push(r.u16()?);
    }
    Ok(String::from_utf16_lossy(&units))
}

fn write_utf8_string(out: &mut Vec<u8>, s: &str) -> Result<()> {
    let utf16_len = s.encode_utf16().count();
    let bytes = s.as_bytes();
    // 变长长度只有一字节和两字节两种形式，两字节形式最多表达 0x7fff。
    if utf16_len > 0x7fff || bytes.len() > 0x7fff {
        return err("字符串过长，无法写回 UTF-8 字符串池");
    }
    write_varint8(out, utf16_len);
    write_varint8(out, bytes.len());
    out.extend_from_slice(bytes);
    out.push(0);
    Ok(())
}

fn write_varint8(out: &mut Vec<u8>, value: usize) {
    if value > 0x7f {
        out.push(((value >> 8) & 0x7f) as u8 | 0x80);
        out.push((value & 0xff) as u8);
    } else {
        out.push(value as u8);
    }
}

fn write_utf16_string(out: &mut Vec<u8>, s: &str) -> Result<()> {
    let units: Vec<u16> = s.encode_utf16().collect();
    if units.len() > 0x7fff {
        // 长度超过 0x7fff 要用两个 u16 的形式；清单里不会有这种串，直接拒绝
        // 比写出一个自己都没验证过的编码安全。
        return err("字符串过长，无法写回 UTF-16 字符串池");
    }
    out.extend_from_slice(&(units.len() as u16).to_le_bytes());
    for u in units {
        out.extend_from_slice(&u.to_le_bytes());
    }
    out.extend_from_slice(&0u16.to_le_bytes());
    Ok(())
}

// ---------------------------------------------------------------------------
// 节点
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct Attribute {
    ns: u32,
    name: u32,
    raw_value: u32,
    value_size: u16,
    res0: u8,
    data_type: u8,
    data: u32,
}

#[derive(Debug, Clone)]
struct StartElement {
    line: u32,
    comment: u32,
    ns: u32,
    name: u32,
    /// 1 基属性下标，0 表示没有。插入/删除属性时必须跟着调整。
    id_index: u16,
    class_index: u16,
    style_index: u16,
    attributes: Vec<Attribute>,
}

#[derive(Debug, Clone)]
enum Node {
    NamespaceStart {
        line: u32,
        comment: u32,
        prefix: u32,
        uri: u32,
    },
    NamespaceEnd {
        line: u32,
        comment: u32,
        prefix: u32,
        uri: u32,
    },
    Start(StartElement),
    End {
        line: u32,
        comment: u32,
        ns: u32,
        name: u32,
    },
    CData {
        line: u32,
        comment: u32,
        data: u32,
        value: [u8; 8],
    },
}

// ---------------------------------------------------------------------------
// 清单编辑器
// ---------------------------------------------------------------------------

/// 一份可改写的二进制清单。
pub struct ManifestEditor {
    pool: StringPool,
    /// 属性名下标 → 属性资源 ID。Android 认的是资源 ID，属性名字符串只是给
    /// aapt 打印用的，所以查属性优先按资源 ID 匹配。
    resource_map: Vec<u32>,
    has_resource_map: bool,
    nodes: Vec<Node>,
}

impl ManifestEditor {
    /// 解析一份二进制清单。
    pub fn parse(data: &[u8]) -> Result<ManifestEditor> {
        if data.len() < 8 {
            return err("文件太小，不是有效的二进制清单");
        }
        let mut r = Reader::at(data, 0);
        let root_type = r.u16()?;
        let header_size = r.u16()? as usize;
        let _size = r.u32()?;
        if root_type != RES_XML_TYPE {
            return err(format!("根块类型是 0x{:04x}，不是二进制 XML", root_type));
        }
        if header_size < 8 || header_size > data.len() {
            return err("根块头部长度非法");
        }
        r.pos = header_size;

        let mut pool: Option<StringPool> = None;
        let mut resource_map: Vec<u32> = Vec::new();
        let mut has_resource_map = false;
        let mut nodes: Vec<Node> = Vec::new();

        while r.remaining() >= 8 {
            let chunk_start = r.pos;
            let chunk_type = r.u16()?;
            let _chunk_header_size = r.u16()?;
            let chunk_size = r.u32()? as usize;
            if chunk_size < 8 {
                return err("资源块长度非法");
            }
            let chunk_end = chunk_start
                .checked_add(chunk_size)
                .filter(|end| *end <= data.len())
                .ok_or_else(|| AxmlEditError("资源块越界".into()))?;

            match chunk_type {
                CHUNK_STRING_POOL => pool = Some(StringPool::parse(&data[chunk_start..chunk_end])?),
                CHUNK_XML_RESOURCE_MAP => {
                    has_resource_map = true;
                    let mut mr = Reader::at(data, chunk_start + 8);
                    while mr.pos + 4 <= chunk_end {
                        resource_map.push(mr.u32()?);
                    }
                }
                CHUNK_XML_START_NAMESPACE | CHUNK_XML_END_NAMESPACE => {
                    let mut nr = Reader::at(data, chunk_start + 8);
                    let line = nr.u32()?;
                    let comment = nr.u32()?;
                    let prefix = nr.u32()?;
                    let uri = nr.u32()?;
                    nodes.push(if chunk_type == CHUNK_XML_START_NAMESPACE {
                        Node::NamespaceStart {
                            line,
                            comment,
                            prefix,
                            uri,
                        }
                    } else {
                        Node::NamespaceEnd {
                            line,
                            comment,
                            prefix,
                            uri,
                        }
                    });
                }
                CHUNK_XML_START_ELEMENT => {
                    nodes.push(Node::Start(parse_start_element(
                        data,
                        chunk_start,
                        chunk_end,
                    )?));
                }
                CHUNK_XML_END_ELEMENT => {
                    let mut nr = Reader::at(data, chunk_start + 8);
                    nodes.push(Node::End {
                        line: nr.u32()?,
                        comment: nr.u32()?,
                        ns: nr.u32()?,
                        name: nr.u32()?,
                    });
                }
                CHUNK_XML_CDATA => {
                    let mut nr = Reader::at(data, chunk_start + 8);
                    let line = nr.u32()?;
                    let comment = nr.u32()?;
                    let data_idx = nr.u32()?;
                    let mut value = [0u8; 8];
                    value.copy_from_slice(nr.bytes(8)?);
                    nodes.push(Node::CData {
                        line,
                        comment,
                        data: data_idx,
                        value,
                    });
                }
                // 其它块（例如未来新增的）直接丢掉会破坏文档，但目前的 AXML 规格里
                // 除上面这些之外不会出现别的东西，遇到就报错比默默产出坏清单强。
                other => return err(format!("清单里出现无法改写的资源块 0x{:04x}", other)),
            }

            r.pos = chunk_end;
        }

        let pool = pool.ok_or_else(|| AxmlEditError("清单里没有字符串池".into()))?;
        if !nodes.iter().any(|n| matches!(n, Node::Start(_))) {
            return err("清单里没有任何元素");
        }
        Ok(ManifestEditor {
            pool,
            resource_map,
            has_resource_map,
            nodes,
        })
    }

    // -- 低层访问 ----------------------------------------------------------

    fn s(&self, index: u32) -> &str {
        self.pool.get(index)
    }

    fn res_id_of(&self, name_index: u32) -> u32 {
        self.resource_map
            .get(name_index as usize)
            .copied()
            .unwrap_or(0)
    }

    /// 找一个可以当作"带资源 ID 的属性名"用的池下标。
    ///
    /// 优先复用资源映射表里已有的条目；实在没有就追加字符串并把资源映射表补长
    /// （中间空出来的位置填 0——那些下标不会被当属性名用，填什么都无所谓）。
    fn attr_name_index(&mut self, name: &str, res_id: u32) -> u32 {
        if let Some(pos) = self.resource_map.iter().position(|id| *id == res_id) {
            return pos as u32;
        }
        let index = self.pool.intern(name);
        if self.resource_map.len() <= index as usize {
            self.resource_map.resize(index as usize + 1, 0);
        }
        self.resource_map[index as usize] = res_id;
        self.has_resource_map = true;
        index
    }

    fn android_ns_index(&mut self) -> u32 {
        self.pool.intern(ANDROID_NS)
    }

    // -- 元素定位 ----------------------------------------------------------

    /// 按绝对路径找元素，返回节点下标。
    fn find_elements(&self, path: &[&str]) -> Vec<usize> {
        let mut stack: Vec<&str> = Vec::new();
        let mut out = Vec::new();
        for (i, node) in self.nodes.iter().enumerate() {
            match node {
                Node::Start(e) => {
                    stack.push(self.s(e.name));
                    if stack.len() == path.len() && stack.iter().zip(path).all(|(a, b)| a == b) {
                        out.push(i);
                    }
                }
                Node::End { .. } => {
                    stack.pop();
                }
                _ => {}
            }
        }
        out
    }

    fn find_element(&self, path: &[&str]) -> Option<usize> {
        self.find_elements(path).into_iter().next()
    }

    /// 元素自身及其子树占据的节点区间 `[start, end]`，`end` 是配对的结束标签。
    fn element_range(&self, start: usize) -> Result<(usize, usize)> {
        let mut depth = 0usize;
        for i in start..self.nodes.len() {
            match &self.nodes[i] {
                Node::Start(_) => depth += 1,
                Node::End { .. } => {
                    depth -= 1;
                    if depth == 0 {
                        return Ok((start, i));
                    }
                }
                _ => {}
            }
        }
        err("开始标签没有配对的结束标签")
    }

    fn element_name(&self, index: usize) -> &str {
        match &self.nodes[index] {
            Node::Start(e) => self.s(e.name),
            _ => "",
        }
    }

    // -- 属性读写 ----------------------------------------------------------

    fn attr_pos(&self, elem: usize, res_id: u32, name: &str) -> Option<usize> {
        let Node::Start(e) = &self.nodes[elem] else {
            return None;
        };
        e.attributes.iter().position(|a| {
            if res_id != 0 && self.res_id_of(a.name) == res_id {
                return true;
            }
            // 没有资源映射表的清单（少见，但 apktool 产出的会这样）只能靠名字匹配。
            self.res_id_of(a.name) == 0 && self.s(a.name) == name && self.s(a.ns) == ANDROID_NS
        })
    }

    fn attr_string(&self, elem: usize, res_id: u32, name: &str) -> Option<&str> {
        let pos = self.attr_pos(elem, res_id, name)?;
        let Node::Start(e) = &self.nodes[elem] else {
            return None;
        };
        let a = &e.attributes[pos];
        if a.data_type != TYPE_STRING {
            return None;
        }
        let idx = if a.raw_value == NO_ENTRY {
            a.data
        } else {
            a.raw_value
        };
        Some(self.s(idx))
    }

    /// 无命名空间的属性（`<manifest package=...>` 这种）。
    fn plain_attr_pos(&self, elem: usize, name: &str) -> Option<usize> {
        let Node::Start(e) = &self.nodes[elem] else {
            return None;
        };
        e.attributes
            .iter()
            .position(|a| a.ns == NO_ENTRY && self.s(a.name) == name)
    }

    /// 插入一条属性，保持"有资源 ID 的按 ID 升序在前、无资源 ID 的在后"。
    fn insert_attribute(&mut self, elem: usize, attr: Attribute) {
        let res_id = self.res_id_of(attr.name);
        let insert_at = {
            let Node::Start(e) = &self.nodes[elem] else {
                return;
            };
            let mut at = e.attributes.len();
            for (i, existing) in e.attributes.iter().enumerate() {
                let existing_id = self.res_id_of(existing.name);
                if existing_id == 0 || (res_id != 0 && existing_id > res_id) {
                    at = i;
                    break;
                }
            }
            at
        };
        let Node::Start(e) = &mut self.nodes[elem] else {
            return;
        };
        e.attributes.insert(insert_at, attr);
        // 这三个是 1 基下标，指向插入点之后的要整体后移。
        for idx in [&mut e.id_index, &mut e.class_index, &mut e.style_index] {
            if *idx != 0 && (*idx as usize) > insert_at {
                *idx += 1;
            }
        }
    }

    fn set_string_attr(&mut self, elem: usize, res_id: u32, name: &str, value: &str) {
        let value_index = self.pool.intern(value);
        if let Some(pos) = self.attr_pos(elem, res_id, name) {
            let Node::Start(e) = &mut self.nodes[elem] else {
                return;
            };
            let a = &mut e.attributes[pos];
            a.raw_value = value_index;
            a.value_size = 8;
            a.res0 = 0;
            a.data_type = TYPE_STRING;
            a.data = value_index;
            return;
        }
        let ns = self.android_ns_index();
        let name_index = self.attr_name_index(name, res_id);
        self.insert_attribute(
            elem,
            Attribute {
                ns,
                name: name_index,
                raw_value: value_index,
                value_size: 8,
                res0: 0,
                data_type: TYPE_STRING,
                data: value_index,
            },
        );
    }

    fn set_scalar_attr(&mut self, elem: usize, res_id: u32, name: &str, ty: u8, data: u32) {
        if let Some(pos) = self.attr_pos(elem, res_id, name) {
            let Node::Start(e) = &mut self.nodes[elem] else {
                return;
            };
            let a = &mut e.attributes[pos];
            // 数值属性没有原始文本，rawValue 必须写成"无"，否则 aapt 会去池里
            // 按这个下标取一个风马牛不相及的字符串当原始值打印出来。
            a.raw_value = NO_ENTRY;
            a.value_size = 8;
            a.res0 = 0;
            a.data_type = ty;
            a.data = data;
            return;
        }
        let ns = self.android_ns_index();
        let name_index = self.attr_name_index(name, res_id);
        self.insert_attribute(
            elem,
            Attribute {
                ns,
                name: name_index,
                raw_value: NO_ENTRY,
                value_size: 8,
                res0: 0,
                data_type: ty,
                data,
            },
        );
    }

    fn set_plain_string_attr(&mut self, elem: usize, name: &str, value: &str) {
        let value_index = self.pool.intern(value);
        if let Some(pos) = self.plain_attr_pos(elem, name) {
            let Node::Start(e) = &mut self.nodes[elem] else {
                return;
            };
            let a = &mut e.attributes[pos];
            a.raw_value = value_index;
            a.value_size = 8;
            a.res0 = 0;
            a.data_type = TYPE_STRING;
            a.data = value_index;
            return;
        }
        let name_index = self.pool.intern(name);
        self.insert_attribute(
            elem,
            Attribute {
                ns: NO_ENTRY,
                name: name_index,
                raw_value: value_index,
                value_size: 8,
                res0: 0,
                data_type: TYPE_STRING,
                data: value_index,
            },
        );
    }

    // -- 对外的编辑接口 ----------------------------------------------------

    /// 当前包名。
    pub fn package(&self) -> Option<&str> {
        let manifest = self.find_element(&["manifest"])?;
        let pos = self.plain_attr_pos(manifest, "package")?;
        let Node::Start(e) = &self.nodes[manifest] else {
            return None;
        };
        let a = &e.attributes[pos];
        let idx = if a.raw_value == NO_ENTRY {
            a.data
        } else {
            a.raw_value
        };
        Some(self.s(idx))
    }

    /// 换包名。
    ///
    /// 只改 `<manifest package>` 是不够的：
    ///
    /// * 组件的相对类名（`.MainActivity`）是相对包名解析的，包名一变就指向不存在的类，
    ///   所以先按旧包名补全成绝对类名。
    /// * `<provider android:authorities>` 里带着包名。authority 在整机范围内唯一，
    ///   不改的话装到已经装了商店版游戏的手机上会直接被系统拒绝。
    pub fn set_package(&mut self, new_package: &str) -> Result<()> {
        if new_package.is_empty() {
            return err("包名不能为空");
        }
        let manifest = self
            .find_element(&["manifest"])
            .ok_or_else(|| AxmlEditError("清单里没有 <manifest> 元素".into()))?;
        let old_package = self.package().unwrap_or_default().to_string();

        if !old_package.is_empty() {
            self.absolutize_class_names(&old_package);
            self.rewrite_authorities(&old_package, new_package);
        }
        self.set_plain_string_attr(manifest, "package", new_package);
        Ok(())
    }

    /// 把组件上的相对类名补全成绝对类名。
    ///
    /// Android 的规则（`PackageParser.buildClassName`）：以 `.` 开头 → 包名 + 名字；
    /// 不含 `.` → 包名 + "." + 名字；其余原样。
    fn absolutize_class_names(&mut self, package: &str) {
        for i in 0..self.nodes.len() {
            if !matches!(self.nodes[i], Node::Start(_)) {
                continue;
            }
            if !CLASS_ELEMENTS.contains(&self.element_name(i)) {
                continue;
            }
            for (res_id, attr_name) in [
                (ATTR_NAME, "name"),
                (ATTR_TARGET_ACTIVITY, "targetActivity"),
            ] {
                let Some(current) = self.attr_string(i, res_id, attr_name).map(str::to_string)
                else {
                    continue;
                };
                let absolute = if let Some(rest) = current.strip_prefix('.') {
                    format!("{}.{}", package, rest)
                } else if !current.contains('.') && !current.is_empty() {
                    format!("{}.{}", package, current)
                } else {
                    continue;
                };
                self.set_string_attr(i, res_id, attr_name, &absolute);
            }
        }
    }

    fn rewrite_authorities(&mut self, old_package: &str, new_package: &str) {
        for i in 0..self.nodes.len() {
            if !matches!(self.nodes[i], Node::Start(_)) {
                continue;
            }
            let Some(current) = self
                .attr_string(i, ATTR_AUTHORITIES, "authorities")
                .map(str::to_string)
            else {
                continue;
            };
            // authority 可以是分号分隔的一串，逐个处理。
            let rewritten = current
                .split(';')
                .map(|one| match one.strip_prefix(old_package) {
                    Some(rest) => format!("{}{}", new_package, rest),
                    None => one.to_string(),
                })
                .collect::<Vec<_>>()
                .join(";");
            if rewritten != current {
                self.set_string_attr(i, ATTR_AUTHORITIES, "authorities", &rewritten);
            }
        }
    }

    /// 直接指定某个 provider 的 authority。`provider_class` 是 `android:name`。
    pub fn set_provider_authorities(&mut self, provider_class: &str, authorities: &str) -> bool {
        let providers = self.find_elements(&["manifest", "application", "provider"]);
        for index in providers {
            if self.attr_string(index, ATTR_NAME, "name") == Some(provider_class) {
                self.set_string_attr(index, ATTR_AUTHORITIES, "authorities", authorities);
                return true;
            }
        }
        false
    }

    /// `<application android:label>`。
    pub fn set_application_label(&mut self, label: &str) -> Result<()> {
        let app = self
            .find_element(&["manifest", "application"])
            .ok_or_else(|| AxmlEditError("清单里没有 <application> 元素".into()))?;
        self.set_string_attr(app, ATTR_LABEL, "label", label);
        Ok(())
    }

    /// `<application android:name>`：.NET for Android 的 Application 子类。
    pub fn set_application_name(&mut self, class: &str) -> Result<()> {
        let app = self
            .find_element(&["manifest", "application"])
            .ok_or_else(|| AxmlEditError("清单里没有 <application> 元素".into()))?;
        self.set_string_attr(app, ATTR_NAME, "name", class);
        Ok(())
    }

    /// 带 MAIN/LAUNCHER 过滤器的那个 activity 的 `android:name`。
    pub fn launcher_activity(&self) -> Option<String> {
        let index = self.find_launcher_activity()?;
        self.attr_string(index, ATTR_NAME, "name")
            .map(str::to_string)
    }

    /// 换掉入口 Activity——SMAPI 要先跑自己的 Activity 装载模组，再把控制权交给游戏。
    pub fn set_launcher_activity_name(&mut self, class: &str) -> Result<()> {
        let index = self
            .find_launcher_activity()
            .ok_or_else(|| AxmlEditError("清单里找不到带 MAIN/LAUNCHER 的 activity".into()))?;
        self.set_string_attr(index, ATTR_NAME, "name", class);
        Ok(())
    }

    /// 按现有类名改某个 activity 的 `android:name`。
    pub fn set_activity_name(&mut self, current_class: &str, new_class: &str) -> bool {
        for index in self.find_elements(&["manifest", "application", "activity"]) {
            if self.attr_string(index, ATTR_NAME, "name") == Some(current_class) {
                self.set_string_attr(index, ATTR_NAME, "name", new_class);
                return true;
            }
        }
        false
    }

    fn find_launcher_activity(&self) -> Option<usize> {
        for index in self.find_elements(&["manifest", "application", "activity"]) {
            let Ok((start, end)) = self.element_range(index) else {
                continue;
            };
            let mut i = start + 1;
            while i <= end {
                if matches!(&self.nodes[i], Node::Start(_)) && self.element_name(i) == "intent-filter"
                {
                    let Ok((fs, fe)) = self.element_range(i) else {
                        break;
                    };
                    let mut has_main = false;
                    let mut has_launcher = false;
                    for j in fs + 1..=fe {
                        if !matches!(&self.nodes[j], Node::Start(_)) {
                            continue;
                        }
                        let value = self.attr_string(j, ATTR_NAME, "name");
                        match self.element_name(j) {
                            "action" if value == Some("android.intent.action.MAIN") => {
                                has_main = true
                            }
                            "category" if value == Some("android.intent.category.LAUNCHER") => {
                                has_launcher = true
                            }
                            _ => {}
                        }
                    }
                    if has_main && has_launcher {
                        return Some(index);
                    }
                    i = fe + 1;
                    continue;
                }
                i += 1;
            }
        }
        None
    }

    /// 已声明的权限。
    pub fn permissions(&self) -> Vec<String> {
        self.find_elements(&["manifest", "uses-permission"])
            .into_iter()
            .filter_map(|i| self.attr_string(i, ATTR_NAME, "name").map(str::to_string))
            .collect()
    }

    /// 加一条 `<uses-permission>`。已经有了返回 `false`。
    pub fn add_uses_permission(&mut self, name: &str) -> Result<bool> {
        if self.permissions().iter().any(|p| p == name) {
            return Ok(false);
        }
        let manifest = self
            .find_element(&["manifest"])
            .ok_or_else(|| AxmlEditError("清单里没有 <manifest> 元素".into()))?;

        // 插到最后一条 uses-permission 后面；一条都没有就紧跟 <manifest> 开始标签。
        // 放在 <application> 之前是习惯问题，但也确实有工具按顺序做假设。
        let insert_at = match self.find_elements(&["manifest", "uses-permission"]).last() {
            Some(last) => self.element_range(*last)?.1 + 1,
            None => manifest + 1,
        };

        let line = match &self.nodes[manifest] {
            Node::Start(e) => e.line,
            _ => 0,
        };
        let ns = self.android_ns_index();
        let name_attr = self.attr_name_index("name", ATTR_NAME);
        let element_name = self.pool.intern("uses-permission");
        let value = self.pool.intern(name);

        let start = Node::Start(StartElement {
            line,
            comment: NO_ENTRY,
            ns: NO_ENTRY,
            name: element_name,
            id_index: 0,
            class_index: 0,
            style_index: 0,
            attributes: vec![Attribute {
                ns,
                name: name_attr,
                raw_value: value,
                value_size: 8,
                res0: 0,
                data_type: TYPE_STRING,
                data: value,
            }],
        });
        let end = Node::End {
            line,
            comment: NO_ENTRY,
            ns: NO_ENTRY,
            name: element_name,
        };
        self.nodes.insert(insert_at, end);
        self.nodes.insert(insert_at, start);
        Ok(true)
    }

    /// 删一条 `<uses-permission>`。没有这条返回 `false`。
    pub fn remove_uses_permission(&mut self, name: &str) -> Result<bool> {
        let target = self
            .find_elements(&["manifest", "uses-permission"])
            .into_iter()
            .find(|i| self.attr_string(*i, ATTR_NAME, "name") == Some(name));
        let Some(index) = target else {
            return Ok(false);
        };
        let (start, end) = self.element_range(index)?;
        self.nodes.drain(start..=end);
        Ok(true)
    }

    /// `<uses-sdk android:minSdkVersion>`。没有 `<uses-sdk>` 就补一个。
    pub fn set_min_sdk_version(&mut self, level: u32) -> Result<()> {
        let uses_sdk = self.ensure_uses_sdk()?;
        self.set_scalar_attr(
            uses_sdk,
            ATTR_MIN_SDK_VERSION,
            "minSdkVersion",
            TYPE_INT_DEC,
            level,
        );
        Ok(())
    }

    /// 当前 `minSdkVersion`，没写就返回 `None`。
    pub fn min_sdk_version(&self) -> Option<u32> {
        let uses_sdk = self.find_element(&["manifest", "uses-sdk"])?;
        let pos = self.attr_pos(uses_sdk, ATTR_MIN_SDK_VERSION, "minSdkVersion")?;
        let Node::Start(e) = &self.nodes[uses_sdk] else {
            return None;
        };
        Some(e.attributes[pos].data)
    }

    /// `<application android:extractNativeLibs>`。
    ///
    /// 重打包后原生库仍然以 STORED + 4096 对齐写在包里，可以直接 mmap，
    /// 所以这里应当是 `false`——设成 true 会让系统安装时把几百 MB 的 `.so`
    /// 再解一份到 `/data`。
    pub fn set_extract_native_libs(&mut self, value: bool) -> Result<()> {
        let app = self
            .find_element(&["manifest", "application"])
            .ok_or_else(|| AxmlEditError("清单里没有 <application> 元素".into()))?;
        self.set_scalar_attr(
            app,
            ATTR_EXTRACT_NATIVE_LIBS,
            "extractNativeLibs",
            TYPE_INT_BOOLEAN,
            if value { 0xffff_ffff } else { 0 },
        );
        Ok(())
    }

    /// `<application android:debuggable>`。
    pub fn set_debuggable(&mut self, value: bool) -> Result<()> {
        let app = self
            .find_element(&["manifest", "application"])
            .ok_or_else(|| AxmlEditError("清单里没有 <application> 元素".into()))?;
        self.set_scalar_attr(
            app,
            ATTR_DEBUGGABLE,
            "debuggable",
            TYPE_INT_BOOLEAN,
            if value { 0xffff_ffff } else { 0 },
        );
        Ok(())
    }

    fn ensure_uses_sdk(&mut self) -> Result<usize> {
        if let Some(index) = self.find_element(&["manifest", "uses-sdk"]) {
            return Ok(index);
        }
        let manifest = self
            .find_element(&["manifest"])
            .ok_or_else(|| AxmlEditError("清单里没有 <manifest> 元素".into()))?;
        let line = match &self.nodes[manifest] {
            Node::Start(e) => e.line,
            _ => 0,
        };
        let element_name = self.pool.intern("uses-sdk");
        let start = Node::Start(StartElement {
            line,
            comment: NO_ENTRY,
            ns: NO_ENTRY,
            name: element_name,
            id_index: 0,
            class_index: 0,
            style_index: 0,
            attributes: Vec::new(),
        });
        let end = Node::End {
            line,
            comment: NO_ENTRY,
            ns: NO_ENTRY,
            name: element_name,
        };
        self.nodes.insert(manifest + 1, end);
        self.nodes.insert(manifest + 1, start);
        Ok(manifest + 1)
    }

    // -- 序列化 ------------------------------------------------------------

    /// 重新序列化成二进制清单。
    pub fn to_bytes(&self) -> Result<Vec<u8>> {
        if self.resource_map.len() > self.pool.strings.len() {
            return err("资源映射表比字符串池还长，清单已损坏");
        }

        let mut body = self.pool.encode()?;
        if self.has_resource_map && !self.resource_map.is_empty() {
            let size = 8 + 4 * self.resource_map.len();
            body.extend_from_slice(&CHUNK_XML_RESOURCE_MAP.to_le_bytes());
            body.extend_from_slice(&8u16.to_le_bytes());
            body.extend_from_slice(&(size as u32).to_le_bytes());
            for id in &self.resource_map {
                body.extend_from_slice(&id.to_le_bytes());
            }
        }

        for node in &self.nodes {
            encode_node(&mut body, node)?;
        }

        let mut out = Vec::with_capacity(body.len() + 8);
        out.extend_from_slice(&RES_XML_TYPE.to_le_bytes());
        out.extend_from_slice(&8u16.to_le_bytes());
        out.extend_from_slice(&((body.len() + 8) as u32).to_le_bytes());
        out.extend_from_slice(&body);
        Ok(out)
    }
}

fn parse_start_element(data: &[u8], chunk_start: usize, chunk_end: usize) -> Result<StartElement> {
    let mut r = Reader::at(data, chunk_start + 8);
    let line = r.u32()?;
    let comment = r.u32()?;
    let ns = r.u32()?;
    let name = r.u32()?;
    let attribute_start = r.u16()? as usize;
    let attribute_size = r.u16()? as usize;
    let attribute_count = r.u16()? as usize;
    let id_index = r.u16()?;
    let class_index = r.u16()?;
    let style_index = r.u16()?;

    if attribute_size < ATTR_ENTRY_SIZE {
        return err("属性条目长度非法");
    }

    let mut attributes = Vec::with_capacity(attribute_count);
    for i in 0..attribute_count {
        // 又是那个坑：偏移基准是块起点 +16，不是块起点。
        let entry = chunk_start
            .checked_add(ATTR_EXT_OFFSET)
            .and_then(|base| base.checked_add(attribute_start))
            .and_then(|base| base.checked_add(i * attribute_size))
            .filter(|off| off + ATTR_ENTRY_SIZE <= chunk_end)
            .ok_or_else(|| AxmlEditError("属性表越界".into()))?;
        let mut ar = Reader::at(data, entry);
        attributes.push(Attribute {
            ns: ar.u32()?,
            name: ar.u32()?,
            raw_value: ar.u32()?,
            value_size: ar.u16()?,
            res0: ar.u8()?,
            data_type: ar.u8()?,
            data: ar.u32()?,
        });
    }

    Ok(StartElement {
        line,
        comment,
        ns,
        name,
        id_index,
        class_index,
        style_index,
        attributes,
    })
}

fn encode_node(out: &mut Vec<u8>, node: &Node) -> Result<()> {
    match node {
        Node::NamespaceStart {
            line,
            comment,
            prefix,
            uri,
        }
        | Node::NamespaceEnd {
            line,
            comment,
            prefix,
            uri,
        } => {
            let chunk_type = if matches!(node, Node::NamespaceStart { .. }) {
                CHUNK_XML_START_NAMESPACE
            } else {
                CHUNK_XML_END_NAMESPACE
            };
            out.extend_from_slice(&chunk_type.to_le_bytes());
            out.extend_from_slice(&16u16.to_le_bytes());
            out.extend_from_slice(&24u32.to_le_bytes());
            out.extend_from_slice(&line.to_le_bytes());
            out.extend_from_slice(&comment.to_le_bytes());
            out.extend_from_slice(&prefix.to_le_bytes());
            out.extend_from_slice(&uri.to_le_bytes());
        }
        Node::Start(e) => {
            if e.attributes.len() > u16::MAX as usize {
                return err("单个元素的属性数超出上限");
            }
            let size = START_ELEMENT_FIXED + ATTR_ENTRY_SIZE * e.attributes.len();
            out.extend_from_slice(&CHUNK_XML_START_ELEMENT.to_le_bytes());
            out.extend_from_slice(&16u16.to_le_bytes());
            out.extend_from_slice(&(size as u32).to_le_bytes());
            out.extend_from_slice(&e.line.to_le_bytes());
            out.extend_from_slice(&e.comment.to_le_bytes());
            out.extend_from_slice(&e.ns.to_le_bytes());
            out.extend_from_slice(&e.name.to_le_bytes());
            // attributeStart 相对属性扩展结构起点：ns/name/这一串元信息共 20 字节。
            out.extend_from_slice(&20u16.to_le_bytes());
            out.extend_from_slice(&(ATTR_ENTRY_SIZE as u16).to_le_bytes());
            out.extend_from_slice(&(e.attributes.len() as u16).to_le_bytes());
            out.extend_from_slice(&e.id_index.to_le_bytes());
            out.extend_from_slice(&e.class_index.to_le_bytes());
            out.extend_from_slice(&e.style_index.to_le_bytes());
            for a in &e.attributes {
                out.extend_from_slice(&a.ns.to_le_bytes());
                out.extend_from_slice(&a.name.to_le_bytes());
                out.extend_from_slice(&a.raw_value.to_le_bytes());
                out.extend_from_slice(&a.value_size.to_le_bytes());
                out.push(a.res0);
                out.push(a.data_type);
                out.extend_from_slice(&a.data.to_le_bytes());
            }
        }
        Node::End {
            line,
            comment,
            ns,
            name,
        } => {
            out.extend_from_slice(&CHUNK_XML_END_ELEMENT.to_le_bytes());
            out.extend_from_slice(&16u16.to_le_bytes());
            out.extend_from_slice(&24u32.to_le_bytes());
            out.extend_from_slice(&line.to_le_bytes());
            out.extend_from_slice(&comment.to_le_bytes());
            out.extend_from_slice(&ns.to_le_bytes());
            out.extend_from_slice(&name.to_le_bytes());
        }
        Node::CData {
            line,
            comment,
            data,
            value,
        } => {
            out.extend_from_slice(&CHUNK_XML_CDATA.to_le_bytes());
            out.extend_from_slice(&16u16.to_le_bytes());
            out.extend_from_slice(&28u32.to_le_bytes());
            out.extend_from_slice(&line.to_le_bytes());
            out.extend_from_slice(&comment.to_le_bytes());
            out.extend_from_slice(&data.to_le_bytes());
            out.extend_from_slice(value);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::apk::axml;

    /// 手工拼一份带命名空间、资源映射表和多层元素的清单，覆盖改写会碰到的所有结构。
    fn sample_manifest(utf8_pool: bool) -> Vec<u8> {
        let strings = [
            "package",          // 0
            "name",             // 1: 资源映射表里对应 android:name
            "authorities",      // 2: android:authorities
            "label",            // 3: android:label
            "android",          // 4: 命名空间前缀
            ANDROID_NS,         // 5
            "manifest",         // 6
            "application",      // 7
            "activity",         // 8
            "provider",         // 9
            "intent-filter",    // 10
            "action",           // 11
            "category",         // 12
            "com.example.game", // 13
            ".MainActivity",    // 14
            "com.example.game.mono.MonoRuntimeProvider.__mono_init__", // 15
            "android.intent.action.MAIN", // 16
            "android.intent.category.LAUNCHER", // 17
            "示例",             // 18: 非 ASCII，验证两种池编码都能往返
        ];
        // 前 4 个字符串是属性名，资源映射表和它们一一对应。
        let res_map: [u32; 4] = [0, ATTR_NAME, ATTR_AUTHORITIES, ATTR_LABEL];

        let mut string_data: Vec<u8> = Vec::new();
        let mut offsets: Vec<u32> = Vec::new();
        for s in strings {
            offsets.push(string_data.len() as u32);
            if utf8_pool {
                write_utf8_string(&mut string_data, s).unwrap();
            } else {
                write_utf16_string(&mut string_data, s).unwrap();
            }
        }
        while string_data.len() % 4 != 0 {
            string_data.push(0);
        }

        let strings_start = POOL_HEADER_SIZE + offsets.len() * 4;
        let pool_size = strings_start + string_data.len();
        let mut pool = Vec::new();
        pool.extend_from_slice(&CHUNK_STRING_POOL.to_le_bytes());
        pool.extend_from_slice(&(POOL_HEADER_SIZE as u16).to_le_bytes());
        pool.extend_from_slice(&(pool_size as u32).to_le_bytes());
        pool.extend_from_slice(&(strings.len() as u32).to_le_bytes());
        pool.extend_from_slice(&0u32.to_le_bytes());
        pool.extend_from_slice(&(if utf8_pool { FLAG_UTF8 } else { 0 }).to_le_bytes());
        pool.extend_from_slice(&(strings_start as u32).to_le_bytes());
        pool.extend_from_slice(&0u32.to_le_bytes());
        for off in &offsets {
            pool.extend_from_slice(&off.to_le_bytes());
        }
        pool.extend_from_slice(&string_data);

        let mut map = Vec::new();
        map.extend_from_slice(&CHUNK_XML_RESOURCE_MAP.to_le_bytes());
        map.extend_from_slice(&8u16.to_le_bytes());
        map.extend_from_slice(&((8 + res_map.len() * 4) as u32).to_le_bytes());
        for id in res_map {
            map.extend_from_slice(&id.to_le_bytes());
        }

        // 用本模块的编码器拼节点流，省得再写一份手工序列化。
        let mut nodes: Vec<Node> = Vec::new();
        let attr = |ns: u32, name: u32, value: u32| Attribute {
            ns,
            name,
            raw_value: value,
            value_size: 8,
            res0: 0,
            data_type: TYPE_STRING,
            data: value,
        };
        nodes.push(Node::NamespaceStart {
            line: 1,
            comment: NO_ENTRY,
            prefix: 4,
            uri: 5,
        });
        nodes.push(Node::Start(StartElement {
            line: 1,
            comment: NO_ENTRY,
            ns: NO_ENTRY,
            name: 6,
            id_index: 0,
            class_index: 0,
            style_index: 0,
            attributes: vec![attr(NO_ENTRY, 0, 13)],
        }));
        nodes.push(Node::Start(StartElement {
            line: 2,
            comment: NO_ENTRY,
            ns: NO_ENTRY,
            name: 7,
            id_index: 0,
            class_index: 0,
            style_index: 0,
            attributes: vec![attr(5, 3, 18)],
        }));
        nodes.push(Node::Start(StartElement {
            line: 3,
            comment: NO_ENTRY,
            ns: NO_ENTRY,
            name: 8,
            id_index: 0,
            class_index: 0,
            style_index: 0,
            attributes: vec![attr(5, 1, 14)],
        }));
        nodes.push(Node::Start(StartElement {
            line: 4,
            comment: NO_ENTRY,
            ns: NO_ENTRY,
            name: 10,
            id_index: 0,
            class_index: 0,
            style_index: 0,
            attributes: vec![],
        }));
        nodes.push(Node::Start(StartElement {
            line: 5,
            comment: NO_ENTRY,
            ns: NO_ENTRY,
            name: 11,
            id_index: 0,
            class_index: 0,
            style_index: 0,
            attributes: vec![attr(5, 1, 16)],
        }));
        nodes.push(Node::End {
            line: 5,
            comment: NO_ENTRY,
            ns: NO_ENTRY,
            name: 11,
        });
        nodes.push(Node::Start(StartElement {
            line: 6,
            comment: NO_ENTRY,
            ns: NO_ENTRY,
            name: 12,
            id_index: 0,
            class_index: 0,
            style_index: 0,
            attributes: vec![attr(5, 1, 17)],
        }));
        nodes.push(Node::End {
            line: 6,
            comment: NO_ENTRY,
            ns: NO_ENTRY,
            name: 12,
        });
        nodes.push(Node::End {
            line: 4,
            comment: NO_ENTRY,
            ns: NO_ENTRY,
            name: 10,
        });
        nodes.push(Node::End {
            line: 3,
            comment: NO_ENTRY,
            ns: NO_ENTRY,
            name: 8,
        });
        nodes.push(Node::Start(StartElement {
            line: 7,
            comment: NO_ENTRY,
            ns: NO_ENTRY,
            name: 9,
            id_index: 0,
            class_index: 0,
            style_index: 0,
            attributes: vec![attr(5, 1, 9), attr(5, 2, 15)],
        }));
        nodes.push(Node::End {
            line: 7,
            comment: NO_ENTRY,
            ns: NO_ENTRY,
            name: 9,
        });
        nodes.push(Node::End {
            line: 2,
            comment: NO_ENTRY,
            ns: NO_ENTRY,
            name: 7,
        });
        nodes.push(Node::End {
            line: 1,
            comment: NO_ENTRY,
            ns: NO_ENTRY,
            name: 6,
        });
        nodes.push(Node::NamespaceEnd {
            line: 1,
            comment: NO_ENTRY,
            prefix: 4,
            uri: 5,
        });

        let mut body = pool;
        body.extend_from_slice(&map);
        for node in &nodes {
            encode_node(&mut body, node).unwrap();
        }
        let mut out = Vec::new();
        out.extend_from_slice(&RES_XML_TYPE.to_le_bytes());
        out.extend_from_slice(&8u16.to_le_bytes());
        out.extend_from_slice(&((body.len() + 8) as u32).to_le_bytes());
        out.extend_from_slice(&body);
        out
    }

    #[test]
    fn round_trip_is_byte_identical() {
        // 不改任何东西时重新序列化应该拿回原样的字节，否则说明有信息在解析时丢了。
        for utf8 in [false, true] {
            let original = sample_manifest(utf8);
            let editor = ManifestEditor::parse(&original).unwrap();
            assert_eq!(editor.to_bytes().unwrap(), original, "utf8={}", utf8);
        }
    }

    #[test]
    fn rename_package_rewrites_class_names_and_authorities() {
        for utf8 in [false, true] {
            let mut editor = ManifestEditor::parse(&sample_manifest(utf8)).unwrap();
            assert_eq!(editor.package(), Some("com.example.game"));
            editor.set_package("com.example.game.modded").unwrap();
            let out = editor.to_bytes().unwrap();

            // 用独立的只读解析器验证，避免"自己写自己读"的自证。
            let root = axml::parse(&out).unwrap();
            assert_eq!(
                root.attr("package").and_then(axml::AxmlValue::as_str),
                Some("com.example.game.modded")
            );
            let app = root.child("application").unwrap();
            let activity = app.child("activity").unwrap();
            // 相对类名要按**旧**包名补全，不能跟着新包名跑。
            assert_eq!(
                activity
                    .android_attr("name")
                    .and_then(axml::AxmlValue::as_str),
                Some("com.example.game.MainActivity")
            );
            let provider = app.child("provider").unwrap();
            assert_eq!(
                provider
                    .android_attr("authorities")
                    .and_then(axml::AxmlValue::as_str),
                Some("com.example.game.modded.mono.MonoRuntimeProvider.__mono_init__")
            );
        }
    }

    #[test]
    fn edits_label_activity_and_permissions() {
        let mut editor = ManifestEditor::parse(&sample_manifest(false)).unwrap();
        editor.set_application_label("星露谷物语（Mod）").unwrap();
        editor
            .set_launcher_activity_name("com.smapi.SMainActivity")
            .unwrap();
        assert!(editor
            .add_uses_permission("android.permission.INTERNET")
            .unwrap());
        assert!(editor
            .add_uses_permission("android.permission.WAKE_LOCK")
            .unwrap());
        // 重复添加应当是幂等的。
        assert!(!editor
            .add_uses_permission("android.permission.INTERNET")
            .unwrap());
        assert!(editor
            .remove_uses_permission("android.permission.WAKE_LOCK")
            .unwrap());
        assert!(!editor
            .remove_uses_permission("android.permission.WAKE_LOCK")
            .unwrap());
        editor.set_min_sdk_version(24).unwrap();
        editor.set_extract_native_libs(false).unwrap();

        let out = editor.to_bytes().unwrap();
        let root = axml::parse(&out).unwrap();
        let app = root.child("application").unwrap();
        assert_eq!(
            app.android_attr("label").and_then(axml::AxmlValue::as_str),
            Some("星露谷物语（Mod）")
        );
        assert_eq!(
            app.android_attr("extractNativeLibs")
                .and_then(axml::AxmlValue::as_i64),
            Some(0)
        );
        assert_eq!(
            app.child("activity")
                .unwrap()
                .android_attr("name")
                .and_then(axml::AxmlValue::as_str),
            Some("com.smapi.SMainActivity")
        );
        let perms: Vec<String> = root
            .children_named("uses-permission")
            .filter_map(|p| {
                p.android_attr("name")
                    .and_then(axml::AxmlValue::as_str)
                    .map(str::to_string)
            })
            .collect();
        assert_eq!(perms, vec!["android.permission.INTERNET".to_string()]);
        assert_eq!(
            root.child("uses-sdk")
                .unwrap()
                .android_attr("minSdkVersion")
                .and_then(axml::AxmlValue::as_i64),
            Some(24)
        );
        // 编辑器自己再读一遍也要能读回去。
        let reparsed = ManifestEditor::parse(&out).unwrap();
        assert_eq!(reparsed.min_sdk_version(), Some(24));
        assert_eq!(
            reparsed.launcher_activity().as_deref(),
            Some("com.smapi.SMainActivity")
        );
    }

    #[test]
    fn rejects_garbage_without_panicking() {
        assert!(ManifestEditor::parse(&[0u8; 4]).is_err());
        assert!(ManifestEditor::parse(&[0xffu8; 64]).is_err());
        let mut truncated = sample_manifest(false);
        truncated.truncate(40);
        assert!(ManifestEditor::parse(&truncated).is_err());
    }
}
