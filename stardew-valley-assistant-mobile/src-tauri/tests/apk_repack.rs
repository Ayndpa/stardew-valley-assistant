//! 针对真实安装包的重打包 + 签名端到端测试。
//!
//! 安装包本身不进仓库（几百 MB），路径通过环境变量 `SDV_TEST_APK` 传入，
//! 没设置时整条测试跳过，不影响常规 `cargo test`。
//!
//! ```powershell
//! $env:SDV_TEST_APK = "C:\path\to\stardew-valley.apk"
//! cargo test --test apk_repack -- --nocapture
//! ```
//!
//! 产物**故意不删**：真正的验收标准是外部工具的判断，跑完要用
//!
//! ```powershell
//! apksigner verify --verbose <产物>
//! aapt2 dump xmltree <产物> --file AndroidManifest.xml
//! ```
//!
//! 再确认一遍。产物目录会打印在输出里，也可以用 `SDV_TEST_OUT` 指定。

use stardew_valley_assistant_mobile_lib::apk::{axml, axml_write, repack, sign};
use std::io::Read;
use std::path::{Path, PathBuf};

/// 打好 Mod 的游戏用的新包名。必须和原包名不同，否则和玩家已装的正版撞签名。
const MODDED_PACKAGE: &str = "io.github.ayndpa.sdv_assistant_mobile.game";

fn test_apk() -> Option<PathBuf> {
    let path = std::env::var("SDV_TEST_APK").ok()?;
    let path = PathBuf::from(path);
    path.is_file().then_some(path)
}

fn out_dir() -> PathBuf {
    let dir = match std::env::var("SDV_TEST_OUT") {
        Ok(v) => PathBuf::from(v),
        Err(_) => std::env::temp_dir().join("sva-repack-integration"),
    };
    std::fs::create_dir_all(&dir).expect("应能创建产物目录");
    dir
}

fn read_manifest(apk: &Path) -> Vec<u8> {
    let file = std::fs::File::open(apk).expect("应能打开安装包");
    let mut archive = zip::ZipArchive::new(std::io::BufReader::new(file)).expect("应是有效 ZIP");
    let mut entry = archive
        .by_name("AndroidManifest.xml")
        .expect("安装包里应有清单");
    let mut bytes = Vec::new();
    entry.read_to_end(&mut bytes).expect("应能读出清单");
    bytes
}

#[test]
fn repacks_and_signs_real_game_package() {
    let Some(source) = test_apk() else {
        eprintln!("跳过：未设置 SDV_TEST_APK");
        return;
    };
    let dir = out_dir();
    let unsigned = dir.join("stardew-modded-unsigned.apk");
    let signed = dir.join("stardew-modded.apk");
    let keystore = dir.join("keystore");

    // --- 1. 改清单 -------------------------------------------------------
    let original = read_manifest(&source);
    let mut editor = axml_write::ManifestEditor::parse(&original).expect("应能解析真实清单");
    let old_package = editor.package().expect("应能读出原包名").to_string();
    let old_launcher = editor.launcher_activity().expect("应能找到入口 Activity");
    println!("原包名        : {}", old_package);
    println!("原入口        : {}", old_launcher);
    println!("原 minSdk     : {:?}", editor.min_sdk_version());

    editor.set_package(MODDED_PACKAGE).expect("应能换包名");
    editor
        .set_application_label("星露谷物语（Mod）")
        .expect("应能改标签");
    // 只有 v2 签名的包在 API 21~23 上装不了，所以 minSdk 必须抬到 24。
    editor.set_min_sdk_version(24).expect("应能改 minSdk");
    // 原生库在产物里是 STORED + 4096 对齐的，可以直接 mmap，不必解到 /data。
    editor
        .set_extract_native_libs(false)
        .expect("应能改 extractNativeLibs");
    assert!(
        editor
            .add_uses_permission("android.permission.WAKE_LOCK")
            .expect("应能加权限"),
        "新权限应当被加进去"
    );
    assert!(
        editor
            .remove_uses_permission("com.android.vending.CHECK_LICENSE")
            .expect("应能删权限"),
        "原包里的许可校验权限应当被删掉"
    );

    let manifest = editor.to_bytes().expect("应能重新序列化清单");
    std::fs::write(dir.join("AndroidManifest.xml"), &manifest).expect("应能落盘清单");

    // 用只读解析器立刻回读一遍，别等到 aapt2 才发现写坏了。
    let root = axml::parse(&manifest).expect("改写后的清单应能被解析");
    assert_eq!(
        root.attr("package").and_then(axml::AxmlValue::as_str),
        Some(MODDED_PACKAGE)
    );
    let application = root.child("application").expect("应有 <application>");
    let provider = application
        .children_named("provider")
        .find(|p| {
            p.android_attr("name").and_then(axml::AxmlValue::as_str) == Some("mono.MonoRuntimeProvider")
        })
        .expect("应有 MonoRuntimeProvider");
    let authorities = provider
        .android_attr("authorities")
        .and_then(axml::AxmlValue::as_str)
        .expect("provider 应有 authorities");
    println!("新 authority  : {}", authorities);
    assert!(
        authorities.starts_with(MODDED_PACKAGE),
        "authority 必须跟着包名改，否则和正版游戏冲突装不上"
    );
    assert!(!authorities.contains(&old_package), "authority 里不该残留旧包名");
    // 入口类是绝对类名，不该跟着包名飘走。
    let launcher = application
        .children_named("activity")
        .filter_map(|a| a.android_attr("name").and_then(axml::AxmlValue::as_str))
        .find(|n| *n == old_launcher);
    assert_eq!(launcher, Some(old_launcher.as_str()));
    let permissions: Vec<&str> = root
        .children_named("uses-permission")
        .filter_map(|p| p.android_attr("name").and_then(axml::AxmlValue::as_str))
        .collect();
    println!("权限          : {:?}", permissions);
    assert!(permissions.contains(&"android.permission.WAKE_LOCK"));
    assert!(!permissions.contains(&"com.android.vending.CHECK_LICENSE"));

    // --- 2. 重打包 -------------------------------------------------------
    let mut plan = repack::RepackPlan::new();
    plan.set_manifest(manifest.clone());
    // 模拟 SMAPI 载荷与 Mods 初始内容：真实内容由上层填，这里只验证注入路径通。
    plan.add_bytes(
        "assets/smapi/StardewModdingAPI.dll",
        b"fake-smapi-assembly".to_vec(),
    );
    plan.add_bytes(
        "assets/Mods/ConsoleCommands/manifest.json",
        b"{\"Name\":\"Console Commands\"}".to_vec(),
    );

    let started = std::time::Instant::now();
    let stats = repack::repack(&source, &unsigned, &plan).expect("应能重打包");
    println!(
        "重打包        : 原样搬运 {} / 重写对齐 {} / 注入 {} / 跳过 {} / 对齐原生库 {} / {} 字节 / {:?}",
        stats.copied,
        stats.rewritten,
        stats.injected,
        stats.skipped,
        stats.aligned_libs,
        stats.output_bytes,
        started.elapsed()
    );
    assert!(stats.aligned_libs > 0, "安装包里应当有原生库");
    assert_eq!(stats.injected, 3, "清单 + 两个注入文件");

    let problems = repack::verify_alignment(&unsigned).expect("应能校验对齐");
    assert!(problems.is_empty(), "对齐检查不通过: {:?}", problems);

    // --- 3. 签名 ---------------------------------------------------------
    let started = std::time::Instant::now();
    let identity = sign::load_or_create_identity(&keystore).expect("应能取得签名密钥");
    println!("证书指纹      : {}", identity.certificate_fingerprint());
    sign::sign_apk_v2(&unsigned, &signed, &identity).expect("应能签名");
    println!("签名          : {:?}", started.elapsed());

    // 同一台设备必须复用同一个密钥，否则每次重打包都要玩家卸载重装。
    let again = sign::load_or_create_identity(&keystore).expect("应能复用签名密钥");
    assert_eq!(identity.certificate_der(), again.certificate_der());

    // --- 4. 产物自检 -----------------------------------------------------
    // 签名块插在中央目录之前，条目偏移不变，所以对齐必须仍然成立。
    let problems = repack::verify_alignment(&signed).expect("应能校验已签名产物的对齐");
    assert!(problems.is_empty(), "签名后对齐被破坏: {:?}", problems);

    let file = std::fs::File::open(&signed).expect("应能打开产物");
    let mut archive = zip::ZipArchive::new(std::io::BufReader::new(file)).expect("产物应是有效 ZIP");
    let mut roundtrip = Vec::new();
    archive
        .by_name("AndroidManifest.xml")
        .expect("产物里应有清单")
        .read_to_end(&mut roundtrip)
        .expect("应能读出产物里的清单");
    assert_eq!(roundtrip, manifest, "产物里的清单应当就是改写后的那份");
    assert!(
        archive.by_name("META-INF/MANIFEST.MF").is_err(),
        "旧的 JAR 签名必须被剔除"
    );
    let mut smapi = Vec::new();
    archive
        .by_name("assets/smapi/StardewModdingAPI.dll")
        .expect("注入的文件应在产物里")
        .read_to_end(&mut smapi)
        .unwrap();
    assert_eq!(smapi, b"fake-smapi-assembly");

    println!("产物目录      : {}", dir.display());
    println!("已签名产物    : {}", signed.display());
    println!("请用 apksigner verify --verbose 与 aapt2 dump xmltree 复核这个文件。");
}
