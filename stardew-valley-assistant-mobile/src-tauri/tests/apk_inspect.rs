//! 针对真实安装包的识别测试。
//!
//! 安装包本身不进仓库（几百 MB），所以路径通过环境变量 `SDV_TEST_APK` 传入，
//! 没设置时整条测试跳过，不影响常规 `cargo test`。
//!
//! ```powershell
//! $env:SDV_TEST_APK = "C:\path\to\stardew-valley.apk"; cargo test --test apk_inspect -- --nocapture
//! ```

use stardew_valley_assistant_mobile_lib::apk;
use std::path::Path;

fn test_apk() -> Option<String> {
    let path = std::env::var("SDV_TEST_APK").ok()?;
    Path::new(&path).is_file().then_some(path)
}

#[test]
fn inspects_real_game_package() {
    let Some(path) = test_apk() else {
        eprintln!("跳过：未设置 SDV_TEST_APK");
        return;
    };

    let info = apk::inspect_package(Path::new(&path)).expect("应能识别安装包");
    println!("包名          : {}", info.package_name);
    println!("版本          : {} ({})", info.version_name, info.version_code);
    println!("标签          : {:?}", info.label);
    println!("SDK           : min={:?} target={:?}", info.min_sdk, info.target_sdk);
    println!("架构          : {:?}", info.abis);
    println!("入口 Activity : {:?}", info.main_activity);
    println!("资源文件数    : {}", info.content_file_count);
    println!("资源字节数    : {}", info.content_bytes);
    println!("条目总数      : {}", info.total_entries);
    println!("是星露谷      : {}", info.is_stardew_valley);
    println!("提示          : {:?}", info.warnings);

    assert!(info.is_stardew_valley, "真实安装包应被识别为星露谷物语");
    assert!(!info.package_name.is_empty(), "应能读出包名");
    assert!(!info.version_name.is_empty(), "应能读出版本号");
    assert!(info.version_code > 0, "应能读出版本代码");
    assert!(info.content_file_count > 1000, "应能统计到游戏资源");
    assert!(
        info.abis.iter().any(|a| a == "arm64-v8a"),
        "应能识别出 arm64-v8a 架构"
    );
    assert!(
        info.main_activity.is_some(),
        "应能找到带 MAIN/LAUNCHER 过滤器的入口 Activity"
    );
}

/// 构造一个字符串池为 UTF-8 编码的最小清单。
///
/// 真实的星露谷安装包用的是 UTF-16 池，所以那条集成测试覆盖不到 UTF-8 分支。
/// 但改包名后重新序列化、以及其它构建工具产出的清单都可能是 UTF-8 池，
/// 这里补一个用例把这条路径钉住。
fn build_utf8_manifest() -> Vec<u8> {
    const CHUNK_STRING_POOL: u16 = 0x0001;
    const CHUNK_START_ELEMENT: u16 = 0x0102;
    const CHUNK_END_ELEMENT: u16 = 0x0103;
    const FLAG_UTF8: u32 = 1 << 8;
    const TYPE_STRING: u8 = 0x03;

    let strings = ["manifest", "package", "com.example.utf8"];

    // UTF-8 池条目：utf16 长度、utf8 字节长度、字节、0x00 结尾。
    // 纯 ASCII 且长度小于 128，两个长度各占一字节。
    let mut string_data: Vec<u8> = Vec::new();
    let mut offsets: Vec<u32> = Vec::new();
    for s in strings {
        offsets.push(string_data.len() as u32);
        let bytes = s.as_bytes();
        string_data.push(s.chars().count() as u8);
        string_data.push(bytes.len() as u8);
        string_data.extend_from_slice(bytes);
        string_data.push(0);
    }
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
    pool.extend_from_slice(&FLAG_UTF8.to_le_bytes());
    pool.extend_from_slice(&(strings_start as u32).to_le_bytes());
    pool.extend_from_slice(&0u32.to_le_bytes()); // stylesStart
    for off in &offsets {
        pool.extend_from_slice(&off.to_le_bytes());
    }
    pool.extend_from_slice(&string_data);

    // <manifest package="com.example.utf8">
    let mut start = Vec::new();
    start.extend_from_slice(&CHUNK_START_ELEMENT.to_le_bytes());
    start.extend_from_slice(&16u16.to_le_bytes());
    start.extend_from_slice(&((36 + 20) as u32).to_le_bytes());
    start.extend_from_slice(&1u32.to_le_bytes()); // lineNumber
    start.extend_from_slice(&u32::MAX.to_le_bytes()); // comment
    start.extend_from_slice(&u32::MAX.to_le_bytes()); // ns
    start.extend_from_slice(&0u32.to_le_bytes()); // name = "manifest"
    // 相对属性扩展结构（块起点 +16）的偏移。
    start.extend_from_slice(&20u16.to_le_bytes());
    start.extend_from_slice(&20u16.to_le_bytes()); // attributeSize
    start.extend_from_slice(&1u16.to_le_bytes()); // attributeCount
    start.extend_from_slice(&0u16.to_le_bytes()); // idIndex
    start.extend_from_slice(&0u16.to_le_bytes()); // classIndex
    start.extend_from_slice(&0u16.to_le_bytes()); // styleIndex
    start.extend_from_slice(&u32::MAX.to_le_bytes()); // attr ns
    start.extend_from_slice(&1u32.to_le_bytes()); // attr name = "package"
    start.extend_from_slice(&2u32.to_le_bytes()); // rawValue = "com.example.utf8"
    start.extend_from_slice(&8u16.to_le_bytes()); // valueSize
    start.push(0); // res0
    start.push(TYPE_STRING);
    start.extend_from_slice(&2u32.to_le_bytes()); // data

    let mut end = Vec::new();
    end.extend_from_slice(&CHUNK_END_ELEMENT.to_le_bytes());
    end.extend_from_slice(&16u16.to_le_bytes());
    end.extend_from_slice(&24u32.to_le_bytes());
    end.extend_from_slice(&1u32.to_le_bytes());
    end.extend_from_slice(&u32::MAX.to_le_bytes());
    end.extend_from_slice(&u32::MAX.to_le_bytes());
    end.extend_from_slice(&0u32.to_le_bytes());

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
fn parses_utf8_string_pool() {
    let data = build_utf8_manifest();
    let root = apk::axml::parse(&data).expect("应能解析 UTF-8 字符串池的清单");
    assert_eq!(root.name, "manifest");
    assert_eq!(
        root.attr("package")
            .and_then(apk::axml::AxmlValue::as_str),
        Some("com.example.utf8")
    );
}

#[test]
fn rejects_non_apk_input() {
    // 用当前测试源码文件冒充安装包，应报错而不是 panic。
    let this_file = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/apk_inspect.rs");
    let result = apk::inspect_package(Path::new(this_file));
    assert!(result.is_err(), "非 ZIP 文件应被拒绝");
}
