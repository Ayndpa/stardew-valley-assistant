//! 二进制 AndroidManifest.xml（AXML）只读解析。
//!
//! 安装包里的清单是编译过的资源块格式而不是文本 XML，所以导入游戏安装包时无法直接
//! 用 XML 解析器读它。这里实现一个最小可用的解析器：字符串池 + 元素/属性遍历，
//! 足够回答"包名是什么、版本号多少、入口 Activity 是谁、声明了哪些权限"这几个问题，
//! 也就是校验"这确实是星露谷物语安装包"所需要的全部信息。
//!
//! 参考的是 AOSP `ResourceTypes.h` 里的块结构定义。

use std::fmt;

// 资源块类型。
const CHUNK_STRING_POOL: u16 = 0x0001;
const CHUNK_XML_START_ELEMENT: u16 = 0x0102;
const CHUNK_XML_END_ELEMENT: u16 = 0x0103;

// 字符串池 flags。
const FLAG_UTF8: u32 = 1 << 8;

// 属性值类型（`Res_value::dataType`）。
const TYPE_REFERENCE: u8 = 0x01;
const TYPE_STRING: u8 = 0x03;
const TYPE_FLOAT: u8 = 0x04;
const TYPE_INT_DEC: u8 = 0x10;
const TYPE_INT_HEX: u8 = 0x11;
const TYPE_INT_BOOLEAN: u8 = 0x12;

/// 单个属性值。数值类型保留原始位模式，调用方按需要再解释。
#[derive(Debug, Clone, PartialEq)]
pub enum AxmlValue {
    Str(String),
    Int(i64),
    Bool(bool),
    Float(f32),
    /// `@0x7f030000` 这类资源引用，清单里读不到具体内容。
    Reference(u32),
    Other { data_type: u8, data: u32 },
}

impl AxmlValue {
    /// 取字符串值。数值类型会格式化成人类可读的形式，方便直接展示。
    pub fn as_display_string(&self) -> String {
        match self {
            AxmlValue::Str(s) => s.clone(),
            AxmlValue::Int(v) => v.to_string(),
            AxmlValue::Bool(v) => v.to_string(),
            AxmlValue::Float(v) => v.to_string(),
            AxmlValue::Reference(id) => format!("@0x{:08x}", id),
            AxmlValue::Other { data, .. } => data.to_string(),
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            AxmlValue::Str(s) => Some(s.as_str()),
            _ => None,
        }
    }

    pub fn as_i64(&self) -> Option<i64> {
        match self {
            AxmlValue::Int(v) => Some(*v),
            AxmlValue::Bool(v) => Some(if *v { 1 } else { 0 }),
            AxmlValue::Other { data, .. } => Some(*data as i64),
            _ => None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct AxmlAttribute {
    /// 完整命名空间 URI；Android 属性是 `http://schemas.android.com/apk/res/android`。
    pub namespace: Option<String>,
    pub name: String,
    pub value: AxmlValue,
}

#[derive(Debug, Clone)]
pub struct AxmlElement {
    pub name: String,
    pub attributes: Vec<AxmlAttribute>,
    pub children: Vec<AxmlElement>,
}

impl AxmlElement {
    /// 按属性名查值，忽略命名空间。清单里同名属性不会重复，够用了。
    pub fn attr(&self, name: &str) -> Option<&AxmlValue> {
        self.attributes
            .iter()
            .find(|a| a.name == name)
            .map(|a| &a.value)
    }

    /// 只在 Android 命名空间里查属性，避免和同名的无命名空间属性混淆
    /// （例如 `<manifest package=...>` 没有命名空间，而 `android:versionCode` 有）。
    pub fn android_attr(&self, name: &str) -> Option<&AxmlValue> {
        self.attributes
            .iter()
            .find(|a| {
                a.name == name
                    && a.namespace.as_deref() == Some("http://schemas.android.com/apk/res/android")
            })
            .map(|a| &a.value)
    }

    /// 直接子元素里第一个叫 `name` 的。
    pub fn child(&self, name: &str) -> Option<&AxmlElement> {
        self.children.iter().find(|c| c.name == name)
    }

    /// 直接子元素里所有叫 `name` 的。
    pub fn children_named<'a>(&'a self, name: &'a str) -> impl Iterator<Item = &'a AxmlElement> {
        self.children.iter().filter(move |c| c.name == name)
    }

    /// 深度优先遍历整棵子树（含自身）。
    pub fn walk(&self) -> AxmlWalk<'_> {
        AxmlWalk { stack: vec![self] }
    }
}

pub struct AxmlWalk<'a> {
    stack: Vec<&'a AxmlElement>,
}

impl<'a> Iterator for AxmlWalk<'a> {
    type Item = &'a AxmlElement;

    fn next(&mut self) -> Option<Self::Item> {
        let node = self.stack.pop()?;
        // 逆序压栈，让遍历顺序和文档顺序一致。
        for child in node.children.iter().rev() {
            self.stack.push(child);
        }
        Some(node)
    }
}

#[derive(Debug)]
pub struct AxmlError(String);

impl fmt::Display for AxmlError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "解析 AndroidManifest.xml 失败: {}", self.0)
    }
}

impl std::error::Error for AxmlError {}

impl From<AxmlError> for String {
    fn from(err: AxmlError) -> String {
        err.to_string()
    }
}

type Result<T> = std::result::Result<T, AxmlError>;

fn err<T>(msg: impl Into<String>) -> Result<T> {
    Err(AxmlError(msg.into()))
}

/// 小端字节读取游标。所有越界访问都返回错误而不是 panic —— 输入是用户随手选的
/// 文件，格式不对是常态，不能让整个应用挂掉。
struct Reader<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn new(data: &'a [u8]) -> Self {
        Reader { data, pos: 0 }
    }

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

}

/// 解析出来的字符串池。索引 `0xFFFFFFFF` 表示"无"。
struct StringPool {
    strings: Vec<String>,
}

impl StringPool {
    fn get(&self, index: u32) -> Option<&str> {
        if index == u32::MAX {
            return None;
        }
        self.strings.get(index as usize).map(|s| s.as_str())
    }

    /// 取字符串，索引非法时返回占位符而不是报错：个别厂商工具产出的清单里
    /// 会有悬空索引，为此让整个导入流程失败并不划算。
    fn get_or_empty(&self, index: u32) -> String {
        self.get(index).unwrap_or_default().to_string()
    }
}

fn parse_string_pool(chunk: &[u8]) -> Result<StringPool> {
    let mut r = Reader::new(chunk);
    let _chunk_type = r.u16()?;
    let header_size = r.u16()?;
    let _chunk_size = r.u32()?;
    let string_count = r.u32()? as usize;
    let _style_count = r.u32()?;
    let flags = r.u32()?;
    let strings_start = r.u32()? as usize;
    let _styles_start = r.u32()?;

    if header_size as usize > chunk.len() {
        return err("字符串池头部长度越界");
    }

    // 偏移表紧跟在头部之后。
    let mut offsets = Vec::with_capacity(string_count);
    let mut off_reader = Reader::at(chunk, header_size as usize);
    for _ in 0..string_count {
        offsets.push(off_reader.u32()? as usize);
    }

    let is_utf8 = flags & FLAG_UTF8 != 0;
    let mut strings = Vec::with_capacity(string_count);
    for offset in offsets {
        let start = strings_start
            .checked_add(offset)
            .ok_or_else(|| AxmlError("字符串偏移溢出".into()))?;
        if start >= chunk.len() {
            // 悬空偏移：补空串保持索引对齐。
            strings.push(String::new());
            continue;
        }
        let value = if is_utf8 {
            read_utf8_string(chunk, start)?
        } else {
            read_utf16_string(chunk, start)?
        };
        strings.push(value);
    }

    Ok(StringPool { strings })
}

/// UTF-8 池条目：`utf16 长度`、`utf8 长度`、字节、`0x00`。
/// 两个长度都用"高位置 1 表示占两字节"的变长编码。
fn read_utf8_string(chunk: &[u8], start: usize) -> Result<String> {
    let mut r = Reader::at(chunk, start);
    // utf16 长度只用于宽字符换算，这里用不到但必须跳过。
    let mut len = r.u8()? as usize;
    if len & 0x80 != 0 {
        len = ((len & 0x7f) << 8) | r.u8()? as usize;
    }
    let _ = len;

    let mut byte_len = r.u8()? as usize;
    if byte_len & 0x80 != 0 {
        byte_len = ((byte_len & 0x7f) << 8) | r.u8()? as usize;
    }

    if r.remaining() < byte_len {
        return err("UTF-8 字符串长度越界");
    }
    let bytes = &chunk[r.pos..r.pos + byte_len];
    // 用 lossy：清单里出现非法字节时不该让导入整体失败。
    Ok(String::from_utf8_lossy(bytes).into_owned())
}

/// UTF-16 池条目：`长度`、UTF-16 码元、`0x0000`。
/// 长度同样是变长的，高位置 1 表示占两个 u16。
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

fn parse_value(pool: &StringPool, raw_value: u32, data_type: u8, data: u32) -> AxmlValue {
    match data_type {
        TYPE_STRING => {
            // 字符串属性的值索引在 `rawValue` 里；个别编译器会把它写成 0xFFFFFFFF，
            // 这时退回到 `data`。
            let idx = if raw_value == u32::MAX { data } else { raw_value };
            AxmlValue::Str(pool.get_or_empty(idx))
        }
        TYPE_INT_DEC | TYPE_INT_HEX => AxmlValue::Int(data as i32 as i64),
        TYPE_INT_BOOLEAN => AxmlValue::Bool(data != 0),
        TYPE_FLOAT => AxmlValue::Float(f32::from_bits(data)),
        TYPE_REFERENCE => AxmlValue::Reference(data),
        _ => AxmlValue::Other { data_type, data },
    }
}

/// 解析二进制清单，返回根元素（`<manifest>`）。
pub fn parse(data: &[u8]) -> Result<AxmlElement> {
    if data.len() < 8 {
        return err("文件太小，不是有效的二进制清单");
    }

    let mut r = Reader::new(data);
    let _type = r.u16()?;
    let header_size = r.u16()?;
    let _size = r.u32()?;
    r.pos = header_size as usize;

    let mut pool: Option<StringPool> = None;
    // 正在构建的元素栈；根元素闭合时弹出返回。
    let mut stack: Vec<AxmlElement> = Vec::new();
    let mut root: Option<AxmlElement> = None;

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
            .ok_or_else(|| AxmlError("资源块越界".into()))?;

        match chunk_type {
            CHUNK_STRING_POOL => {
                pool = Some(parse_string_pool(&data[chunk_start..chunk_end])?);
            }
            CHUNK_XML_START_ELEMENT => {
                let pool = pool
                    .as_ref()
                    .ok_or_else(|| AxmlError("元素出现在字符串池之前".into()))?;
                let element = parse_start_element(data, chunk_start, chunk_end, pool)?;
                stack.push(element);
            }
            CHUNK_XML_END_ELEMENT => {
                let finished = stack
                    .pop()
                    .ok_or_else(|| AxmlError("结束标签没有对应的开始标签".into()))?;
                match stack.last_mut() {
                    Some(parent) => parent.children.push(finished),
                    // 栈空了说明这是根元素闭合。
                    None => root = Some(finished),
                }
            }
            // 命名空间声明和资源映射表对我们没用，跳过。
            _ => {}
        }

        r.pos = chunk_end;
    }

    root.ok_or_else(|| AxmlError("清单中没有根元素".into()))
}

/// 属性扩展结构（`ResXMLTree_attrExt`）相对于块起点的偏移：
/// 块头 8 字节 + lineNumber(4) + comment(4)。
const ATTR_EXT_OFFSET: usize = 16;

fn parse_start_element(
    data: &[u8],
    chunk_start: usize,
    chunk_end: usize,
    pool: &StringPool,
) -> Result<AxmlElement> {
    // 块头 8 字节之后是 lineNumber(4) + comment(4)，再是 ns(4) + name(4)。
    let mut r = Reader::at(data, chunk_start + 8);
    let _line_number = r.u32()?;
    let _comment = r.u32()?;
    let _ns = r.u32()?;
    let name_idx = r.u32()?;
    let attribute_start = r.u16()? as usize;
    let attribute_size = r.u16()? as usize;
    let attribute_count = r.u16()? as usize;
    let _id_index = r.u16()?;
    let _class_index = r.u16()?;
    let _style_index = r.u16()?;

    if attribute_size < 20 {
        return err("属性条目长度非法");
    }

    let mut attributes = Vec::with_capacity(attribute_count);
    for i in 0..attribute_count {
        // `attributeStart` 是相对属性扩展结构起点的偏移，不是相对块起点的。
        // 少加这 16 字节会读到元素头本身，解析出一堆空属性。
        let entry = chunk_start
            .checked_add(ATTR_EXT_OFFSET)
            .and_then(|base| base.checked_add(attribute_start))
            .and_then(|base| base.checked_add(i * attribute_size))
            .filter(|off| off + 20 <= chunk_end)
            .ok_or_else(|| AxmlError("属性表越界".into()))?;

        let mut ar = Reader::at(data, entry);
        let ns_idx = ar.u32()?;
        let attr_name_idx = ar.u32()?;
        let raw_value = ar.u32()?;
        let _value_size = ar.u16()?;
        let _res0 = ar.u8()?;
        let data_type = ar.u8()?;
        let value_data = ar.u32()?;

        attributes.push(AxmlAttribute {
            namespace: pool.get(ns_idx).map(str::to_string),
            name: pool.get_or_empty(attr_name_idx),
            value: parse_value(pool, raw_value, data_type, value_data),
        });
    }

    Ok(AxmlElement {
        name: pool.get_or_empty(name_idx),
        attributes,
        children: Vec::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 用一个手工拼出来的最小清单验证字符串池与属性解析。
    /// 真实安装包的解析由 `apk::tests` 里的集成测试覆盖。
    fn build_minimal_manifest() -> Vec<u8> {
        // 字符串池内容：0=android 命名空间 URI, 1="manifest", 2="package", 3="com.example"
        let strings = [
            "http://schemas.android.com/apk/res/android",
            "manifest",
            "package",
            "com.example",
        ];

        // UTF-16 编码的池数据。
        let mut string_data: Vec<u8> = Vec::new();
        let mut offsets: Vec<u32> = Vec::new();
        for s in strings {
            offsets.push(string_data.len() as u32);
            let units: Vec<u16> = s.encode_utf16().collect();
            string_data.extend_from_slice(&(units.len() as u16).to_le_bytes());
            for u in &units {
                string_data.extend_from_slice(&u.to_le_bytes());
            }
            string_data.extend_from_slice(&0u16.to_le_bytes());
        }
        // 池数据需要 4 字节对齐。
        while string_data.len() % 4 != 0 {
            string_data.push(0);
        }

        let pool_header_size = 28usize;
        let strings_start = pool_header_size + offsets.len() * 4;
        let pool_size = strings_start + string_data.len();

        let mut pool = Vec::new();
        pool.extend_from_slice(&CHUNK_STRING_POOL.to_le_bytes());
        pool.extend_from_slice(&(pool_header_size as u16).to_le_bytes());
        pool.extend_from_slice(&(pool_size as u32).to_le_bytes());
        pool.extend_from_slice(&(strings.len() as u32).to_le_bytes());
        pool.extend_from_slice(&0u32.to_le_bytes()); // styleCount
        pool.extend_from_slice(&0u32.to_le_bytes()); // flags: UTF-16
        pool.extend_from_slice(&(strings_start as u32).to_le_bytes());
        pool.extend_from_slice(&0u32.to_le_bytes()); // stylesStart
        for off in &offsets {
            pool.extend_from_slice(&off.to_le_bytes());
        }
        pool.extend_from_slice(&string_data);

        // <manifest package="com.example">
        let mut start = Vec::new();
        let start_size = 36 + 20;
        start.extend_from_slice(&CHUNK_XML_START_ELEMENT.to_le_bytes());
        start.extend_from_slice(&16u16.to_le_bytes());
        start.extend_from_slice(&(start_size as u32).to_le_bytes());
        start.extend_from_slice(&1u32.to_le_bytes()); // lineNumber
        start.extend_from_slice(&u32::MAX.to_le_bytes()); // comment
        start.extend_from_slice(&u32::MAX.to_le_bytes()); // ns
        start.extend_from_slice(&1u32.to_le_bytes()); // name = "manifest"
        // 相对属性扩展结构（块起点 +16）的偏移，所以属性表落在块内 36 字节处。
        start.extend_from_slice(&20u16.to_le_bytes()); // attributeStart
        start.extend_from_slice(&20u16.to_le_bytes()); // attributeSize
        start.extend_from_slice(&1u16.to_le_bytes()); // attributeCount
        start.extend_from_slice(&0u16.to_le_bytes()); // idIndex
        start.extend_from_slice(&0u16.to_le_bytes()); // classIndex
        start.extend_from_slice(&0u16.to_le_bytes()); // styleIndex
        start.extend_from_slice(&u32::MAX.to_le_bytes()); // attr ns
        start.extend_from_slice(&2u32.to_le_bytes()); // attr name = "package"
        start.extend_from_slice(&3u32.to_le_bytes()); // rawValue = "com.example"
        start.extend_from_slice(&8u16.to_le_bytes()); // valueSize
        start.push(0); // res0
        start.push(TYPE_STRING);
        start.extend_from_slice(&3u32.to_le_bytes()); // data

        let mut end = Vec::new();
        end.extend_from_slice(&CHUNK_XML_END_ELEMENT.to_le_bytes());
        end.extend_from_slice(&16u16.to_le_bytes());
        end.extend_from_slice(&24u32.to_le_bytes());
        end.extend_from_slice(&1u32.to_le_bytes());
        end.extend_from_slice(&u32::MAX.to_le_bytes());
        end.extend_from_slice(&u32::MAX.to_le_bytes());
        end.extend_from_slice(&1u32.to_le_bytes());

        let body_len = pool.len() + start.len() + end.len();
        let mut out = Vec::new();
        out.extend_from_slice(&0x0003u16.to_le_bytes()); // RES_XML_TYPE
        out.extend_from_slice(&8u16.to_le_bytes());
        out.extend_from_slice(&((body_len + 8) as u32).to_le_bytes());
        out.extend_from_slice(&pool);
        out.extend_from_slice(&start);
        out.extend_from_slice(&end);
        out
    }

    #[test]
    fn parses_root_element_and_attribute() {
        let data = build_minimal_manifest();
        let root = parse(&data).expect("应能解析最小清单");
        assert_eq!(root.name, "manifest");
        assert_eq!(
            root.attr("package").and_then(AxmlValue::as_str),
            Some("com.example")
        );
    }

    #[test]
    fn rejects_truncated_input() {
        assert!(parse(&[0u8; 4]).is_err());
        // 头部合法但内容被截断也不能 panic。
        let mut data = build_minimal_manifest();
        data.truncate(20);
        let _ = parse(&data);
    }

    #[test]
    fn walk_visits_every_node() {
        let data = build_minimal_manifest();
        let root = parse(&data).unwrap();
        assert_eq!(root.walk().count(), 1);
    }
}
