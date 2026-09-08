//! 从原始安装包生成一个新的安装包。
//!
//! "打 Mod 启动"在 Android 上没有别的路子：系统只认已安装应用的私有目录，SMAPI
//! 必须和游戏跑在同一个进程里。所以要把游戏包和 SMAPI 载荷合成一个新的安装包，
//! 换掉清单和包名，重新签名，再交给系统安装器装成一个独立应用。
//!
//! 这里只负责"合成"这一步，改清单在 [`super::axml_write`]，签名在 [`super::sign`]。
//!
//! 两条硬性规则，违反了包能装上但跑不起来：
//!
//! * `lib/**/*.so` 必须以 **STORED**（不压缩）写入并按页大小对齐（见
//!   [`NATIVE_LIB_ALIGNMENT`]，取 16384 以兼容 16 KB 页设备，它同时也是 4096 的倍数）。
//!   Android 从 API 23 起直接 mmap 安装包里的原生库，压缩过或没对齐的库映射不了。
//! * `resources.arsc` 必须 STORED 且 4 字节对齐。targetSdk ≥ 30 的应用不满足这条
//!   会被安装器直接拒绝。
//!
//! 安装包接近 400 MB，所以全程流式：能原样搬运的条目直接搬压缩流（连解压都省了），
//! 必须重写的条目也是边读边写，任何时候内存里只有一个几百 KB 的缓冲区。

use std::collections::{BTreeMap, HashSet};
use std::fs::File;
use std::io::{self, BufReader, BufWriter, Read, Seek, Write};
use std::path::{Path, PathBuf};

use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

/// 原生库的对齐要求。
///
/// Android 直接按页大小 mmap `.so`，历史上页是 4096 字节，所以 4096 是底线。
/// 但 Android 15 起有一批设备用 16 KB 页，在那些设备上只有 16384 对齐的库才能
/// 直接映射。16384 是 4096 的整数倍，取大的那个两头都满足；代价是每个库最多多
/// 16 KB 填充，几十个库总共一两兆，可以忽略。
///
/// 星露谷的商店版安装包本身就是按 16 KB 对齐的（`zipalign -c -P 16` 通过），
/// 重打包降到 4096 等于把原包的兼容性做没了。
const NATIVE_LIB_ALIGNMENT: u16 = 16384;
/// 其余需要 mmap 的条目按 4 字节对齐即可。
const DEFAULT_ALIGNMENT: u16 = 4;

const COPY_BUFFER: usize = 256 * 1024;

/// 要注入的内容。
pub enum Payload {
    /// 本地文件。SMAPI 的托管程序集、模组文件走这条路，全程流式，不进内存。
    File(PathBuf),
    /// 内存里的小文件，主要是改写过的清单。
    Bytes(Vec<u8>),
}

/// 重打包方案：换掉什么、加进什么、剔掉什么。
pub struct RepackPlan {
    /// 压缩包内路径 → 内容。和原包重名的条目会被替换掉。
    entries: BTreeMap<String, Payload>,
    /// 需要整块剔除的原包条目前缀。
    drop_prefixes: Vec<String>,
}

impl Default for RepackPlan {
    fn default() -> Self {
        RepackPlan::new()
    }
}

impl RepackPlan {
    pub fn new() -> Self {
        RepackPlan {
            entries: BTreeMap::new(),
            drop_prefixes: Vec::new(),
        }
    }

    /// 替换 `AndroidManifest.xml`。
    pub fn set_manifest(&mut self, manifest: Vec<u8>) -> &mut Self {
        self.entries
            .insert("AndroidManifest.xml".to_string(), Payload::Bytes(manifest));
        self
    }

    /// 注入一个本地文件。
    pub fn add_file(&mut self, zip_path: impl Into<String>, local: impl Into<PathBuf>) -> &mut Self {
        self.entries
            .insert(normalize(zip_path.into()), Payload::File(local.into()));
        self
    }

    /// 注入一段内存内容。
    pub fn add_bytes(&mut self, zip_path: impl Into<String>, bytes: Vec<u8>) -> &mut Self {
        self.entries
            .insert(normalize(zip_path.into()), Payload::Bytes(bytes));
        self
    }

    /// 把本地目录整棵注入到压缩包的某个前缀下（`Mods/` 的初始内容就是这么进去的）。
    pub fn add_dir(&mut self, zip_prefix: &str, local_dir: &Path) -> io::Result<&mut Self> {
        let prefix = zip_prefix.trim_end_matches('/').to_string();
        let mut stack = vec![(prefix, local_dir.to_path_buf())];
        while let Some((prefix, dir)) = stack.pop() {
            for entry in std::fs::read_dir(&dir)? {
                let entry = entry?;
                let name = entry.file_name().to_string_lossy().to_string();
                let child_zip = if prefix.is_empty() {
                    name
                } else {
                    format!("{}/{}", prefix, name)
                };
                if entry.file_type()?.is_dir() {
                    stack.push((child_zip, entry.path()));
                } else {
                    self.add_file(child_zip, entry.path());
                }
            }
        }
        Ok(self)
    }

    /// 剔除原包里以 `prefix` 开头的所有条目。
    pub fn drop_prefix(&mut self, prefix: impl Into<String>) -> &mut Self {
        self.drop_prefixes.push(prefix.into());
        self
    }

    fn is_dropped(&self, name: &str) -> bool {
        self.drop_prefixes.iter().any(|p| name.starts_with(p))
    }
}

fn normalize(path: String) -> String {
    path.replace('\\', "/").trim_start_matches('/').to_string()
}

/// 重打包的结果统计，给界面和排障用。
#[derive(Debug, Default, Clone)]
pub struct RepackStats {
    /// 从原包原样搬过来的条目数。
    pub copied: u64,
    /// 重新压缩/对齐写入的条目数（原生库、`resources.arsc`）。
    pub rewritten: u64,
    /// 注入的新条目数。
    pub injected: u64,
    /// 因为剔除规则或被替换而跳过的原包条目数。
    pub skipped: u64,
    /// 按 4096 对齐写入的原生库数量。
    pub aligned_libs: u64,
    pub output_bytes: u64,
}

/// 旧的 JAR 签名必须扔掉：内容一改，`META-INF/*.SF` 里的摘要就全错了，
/// 留着只会让 `apksigner` 报"v1 签名损坏"。
fn is_stale_signature(name: &str) -> bool {
    let Some(rest) = name.strip_prefix("META-INF/") else {
        return false;
    };
    if rest.contains('/') {
        return false;
    }
    let upper = rest.to_ascii_uppercase();
    upper == "MANIFEST.MF"
        || upper.ends_with(".SF")
        || upper.ends_with(".RSA")
        || upper.ends_with(".DSA")
        || upper.ends_with(".EC")
}

/// 必须强制不压缩的条目，返回它要求的对齐字节数。
///
/// 这两类条目在原包里就算是压缩的也得换成 STORED，所以判断只看名字。
fn forced_alignment(name: &str) -> Option<u16> {
    if name.starts_with("lib/") && name.ends_with(".so") {
        return Some(NATIVE_LIB_ALIGNMENT);
    }
    if name == "resources.arsc" {
        return Some(DEFAULT_ALIGNMENT);
    }
    None
}

/// 条目最终要按几字节对齐。压缩的条目不需要对齐（系统只会解压读它，不会 mmap），
/// 返回 `None`。
///
/// 注意这里把"原包里本来就是 STORED"的条目也算进来：星露谷的 `assets/Content/*.xnb`
/// 有三千多个，Google Play 把它们不压缩存放并做过 4 字节对齐，重打包时如果只搬字节
/// 不管对齐，`zipalign -c` 会报一大片 BAD——AssetManager 仍然读得出来，但白白丢掉了
/// 原包的 mmap 友好布局。
fn alignment_for(name: &str, stored_in_source: bool) -> Option<u16> {
    forced_alignment(name).or(if stored_in_source {
        Some(DEFAULT_ALIGNMENT)
    } else {
        None
    })
}

/// 从文件路径重打包。
pub fn repack(source: &Path, output: &Path, plan: &RepackPlan) -> Result<RepackStats, String> {
    let file = File::open(source).map_err(|e| format!("打开原始安装包失败: {}", e))?;
    repack_from_reader(BufReader::with_capacity(COPY_BUFFER, file), output, plan)
}

/// 从任意可读可定位的来源重打包。
///
/// Android 上文件选择器给的是 `content://` URI，只能拿到文件描述符、没有路径，
/// 所以入口必须接受读取器而不是路径。
pub fn repack_from_reader<R: Read + Seek>(
    source: R,
    output: &Path,
    plan: &RepackPlan,
) -> Result<RepackStats, String> {
    let mut archive =
        ZipArchive::new(source).map_err(|e| format!("原始安装包不是有效的 ZIP: {}", e))?;

    if let Some(parent) = output.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建输出目录失败: {}", e))?;
    }
    let out_file = File::create(output).map_err(|e| format!("创建目标安装包失败: {}", e))?;
    let mut writer = ZipWriter::new(BufWriter::with_capacity(COPY_BUFFER, out_file));

    let mut stats = RepackStats::default();
    let mut written: HashSet<String> = HashSet::new();
    let mut buffer = vec![0u8; COPY_BUFFER];

    for index in 0..archive.len() {
        let (name, stored_in_source) = {
            let entry = archive
                .by_index_raw(index)
                .map_err(|e| format!("读取原包条目失败: {}", e))?;
            (
                entry.name().to_string(),
                entry.compression() == CompressionMethod::Stored,
            )
        };

        // 目录条目在 APK 里没有意义，Android 从不看它们，重打包时一律不写。
        if name.ends_with('/') {
            stats.skipped += 1;
            continue;
        }
        if is_stale_signature(&name) || plan.is_dropped(&name) {
            stats.skipped += 1;
            continue;
        }
        if !written.insert(name.clone()) {
            // 原包里出现同名条目（少见但确实有），只保留第一个，否则中央目录会打架。
            stats.skipped += 1;
            continue;
        }

        // 被方案替换掉的条目在这里就地写入新内容，保持原包的条目顺序。
        if let Some(payload) = plan.entries.get(&name) {
            write_payload(&mut writer, &name, payload, &mut stats)?;
            stats.injected += 1;
            continue;
        }

        match alignment_for(&name, stored_in_source) {
            Some(alignment) => {
                // 对齐要求落在"数据起点"上，而 `raw_copy_file` 不支持对齐，
                // 所以这类条目只能解出来重写一遍（原包里它们本来就是 STORED，
                // 这一步实际只是拷贝字节）。
                let options = SimpleFileOptions::default()
                    .compression_method(CompressionMethod::Stored)
                    .with_alignment(alignment);
                writer
                    .start_file(name.as_str(), options)
                    .map_err(|e| format!("写入条目 {} 失败: {}", name, e))?;
                let mut entry = archive
                    .by_index(index)
                    .map_err(|e| format!("读取原包条目 {} 失败: {}", name, e))?;
                copy_stream(&mut entry, &mut writer, &mut buffer)
                    .map_err(|e| format!("写入条目 {} 失败: {}", name, e))?;
                stats.rewritten += 1;
                if alignment == NATIVE_LIB_ALIGNMENT {
                    stats.aligned_libs += 1;
                }
            }
            None => {
                let entry = archive
                    .by_index_raw(index)
                    .map_err(|e| format!("读取原包条目 {} 失败: {}", name, e))?;
                // 压缩流原样搬运：不解压也不重压，几百 MB 的资源省下大量时间。
                writer
                    .raw_copy_file(entry)
                    .map_err(|e| format!("复制条目 {} 失败: {}", name, e))?;
                stats.copied += 1;
            }
        }
    }

    // 原包里没有的注入条目补在后面。
    for (name, payload) in &plan.entries {
        if written.contains(name) {
            continue;
        }
        written.insert(name.clone());
        write_payload(&mut writer, name, payload, &mut stats)?;
        stats.injected += 1;
    }

    let inner = writer
        .finish()
        .map_err(|e| format!("收尾目标安装包失败: {}", e))?;
    let mut inner = inner
        .into_inner()
        .map_err(|e| format!("刷新目标安装包失败: {}", e))?;
    inner
        .flush()
        .map_err(|e| format!("刷新目标安装包失败: {}", e))?;
    stats.output_bytes = inner
        .metadata()
        .map(|m| m.len())
        .map_err(|e| format!("读取目标安装包大小失败: {}", e))?;

    Ok(stats)
}

fn write_payload<W: Write + Seek>(
    writer: &mut ZipWriter<W>,
    name: &str,
    payload: &Payload,
    stats: &mut RepackStats,
) -> Result<(), String> {
    // 注入的内容默认压缩，只有强制 STORED 的那几类（原生库、resources.arsc）例外。
    let options = match forced_alignment(name) {
        Some(alignment) => {
            if alignment == NATIVE_LIB_ALIGNMENT {
                stats.aligned_libs += 1;
            }
            SimpleFileOptions::default()
                .compression_method(CompressionMethod::Stored)
                .with_alignment(alignment)
        }
        None => SimpleFileOptions::default().compression_method(CompressionMethod::Deflated),
    };
    writer
        .start_file(name, options)
        .map_err(|e| format!("写入条目 {} 失败: {}", name, e))?;

    match payload {
        Payload::Bytes(bytes) => writer
            .write_all(bytes)
            .map_err(|e| format!("写入条目 {} 失败: {}", name, e))?,
        Payload::File(path) => {
            let mut file =
                File::open(path).map_err(|e| format!("打开注入文件 {} 失败: {}", path.display(), e))?;
            let mut buffer = vec![0u8; COPY_BUFFER];
            copy_stream(&mut file, writer, &mut buffer)
                .map_err(|e| format!("写入条目 {} 失败: {}", name, e))?;
        }
    }
    Ok(())
}

fn copy_stream<R: Read + ?Sized, W: Write + ?Sized>(
    src: &mut R,
    dst: &mut W,
    buffer: &mut [u8],
) -> io::Result<u64> {
    let mut total = 0u64;
    loop {
        let read = src.read(buffer)?;
        if read == 0 {
            return Ok(total);
        }
        dst.write_all(&buffer[..read])?;
        total += read as u64;
    }
}

/// 校验产物：等价于 `zipalign -c -P 16 -v 4`，返回所有不合格的条目描述。
///
/// 对齐错了包照样能装上，只是启动时加载不了原生库——那种崩溃在手机上极难排查，
/// 所以宁可在打包完立刻自查一遍，别等玩家装完才发现。
pub fn verify_alignment(apk: &Path) -> Result<Vec<String>, String> {
    let file = File::open(apk).map_err(|e| format!("打开安装包失败: {}", e))?;
    let mut archive = ZipArchive::new(BufReader::with_capacity(COPY_BUFFER, file))
        .map_err(|e| format!("安装包不是有效的 ZIP: {}", e))?;

    let mut problems = Vec::new();
    for index in 0..archive.len() {
        let entry = archive
            .by_index_raw(index)
            .map_err(|e| format!("读取条目失败: {}", e))?;
        let name = entry.name().to_string();
        let stored = entry.compression() == CompressionMethod::Stored;

        if let Some(required) = forced_alignment(&name) {
            if !stored {
                problems.push(format!("{} 没有以 STORED 方式存放", name));
                continue;
            }
            let offset = entry.data_start();
            if offset % required as u64 != 0 {
                problems.push(format!(
                    "{} 的数据起点 {} 没有按 {} 字节对齐",
                    name, offset, required
                ));
            }
            continue;
        }

        // 压缩条目不需要对齐；不压缩的一律按 4 字节检查。
        if stored {
            let offset = entry.data_start();
            if offset % DEFAULT_ALIGNMENT as u64 != 0 {
                problems.push(format!(
                    "{} 的数据起点 {} 没有按 {} 字节对齐",
                    name, offset, DEFAULT_ALIGNMENT
                ));
            }
        }
    }
    Ok(problems)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn build_source_apk() -> Vec<u8> {
        let mut buffer = Cursor::new(Vec::new());
        {
            let mut zip = ZipWriter::new(&mut buffer);
            let deflated =
                SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
            zip.start_file("AndroidManifest.xml", deflated).unwrap();
            zip.write_all(b"old-manifest").unwrap();
            zip.start_file("assets/Content/Data.xnb", deflated).unwrap();
            zip.write_all(&vec![7u8; 40_000]).unwrap();
            // 商店版安装包里 xnb 资源大多是 STORED + 4 字节对齐的，重打包要保住这一点。
            let stored =
                SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
            zip.start_file("assets/Content/Stored.xnb", stored).unwrap();
            zip.write_all(&vec![5u8; 777]).unwrap();
            // 故意用 DEFLATE 存原生库：重打包必须把它换成 STORED 并对齐。
            zip.start_file("lib/arm64-v8a/libaot-StardewValley.dll.so", deflated)
                .unwrap();
            zip.write_all(&vec![3u8; 12_345]).unwrap();
            zip.start_file("resources.arsc", deflated).unwrap();
            zip.write_all(&vec![9u8; 1_000]).unwrap();
            zip.start_file("META-INF/MANIFEST.MF", deflated).unwrap();
            zip.write_all(b"Manifest-Version: 1.0\n").unwrap();
            zip.start_file("META-INF/CERT.RSA", deflated).unwrap();
            zip.write_all(b"junk").unwrap();
            zip.finish().unwrap();
        }
        buffer.into_inner()
    }

    #[test]
    fn replaces_manifest_strips_signatures_and_aligns_libs() {
        let source = build_source_apk();
        let dir = std::env::temp_dir().join(format!(
            "sva-repack-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let output = dir.join("out.apk");

        let mut plan = RepackPlan::new();
        plan.set_manifest(b"new-manifest".to_vec());
        plan.add_bytes("assets/smapi/StardewModdingAPI.dll", vec![1u8; 2048]);
        plan.add_bytes("lib/arm64-v8a/libinjected.so", vec![2u8; 5000]);

        let stats = repack_from_reader(Cursor::new(source), &output, &plan).unwrap();
        assert_eq!(stats.skipped, 2, "两个旧签名条目应当被剔除");
        assert_eq!(stats.injected, 3);
        assert_eq!(stats.aligned_libs, 2);

        assert!(
            verify_alignment(&output).unwrap().is_empty(),
            "原生库、resources.arsc 以及原本就不压缩的资源都必须对齐"
        );

        let mut archive = ZipArchive::new(File::open(&output).unwrap()).unwrap();
        let mut manifest = Vec::new();
        archive
            .by_name("AndroidManifest.xml")
            .unwrap()
            .read_to_end(&mut manifest)
            .unwrap();
        assert_eq!(manifest, b"new-manifest");
        assert!(archive.by_name("META-INF/MANIFEST.MF").is_err());
        assert!(archive.by_name("META-INF/CERT.RSA").is_err());

        let mut content = Vec::new();
        archive
            .by_name("assets/Content/Data.xnb")
            .unwrap()
            .read_to_end(&mut content)
            .unwrap();
        assert_eq!(content, vec![7u8; 40_000], "原样搬运的条目内容不能变");

        let mut lib = Vec::new();
        archive
            .by_name("lib/arm64-v8a/libaot-StardewValley.dll.so")
            .unwrap()
            .read_to_end(&mut lib)
            .unwrap();
        assert_eq!(lib, vec![3u8; 12_345]);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn drop_prefix_removes_entries() {
        let source = build_source_apk();
        let dir = std::env::temp_dir().join(format!(
            "sva-repack-drop-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let output = dir.join("out.apk");

        let mut plan = RepackPlan::new();
        plan.set_manifest(b"m".to_vec());
        plan.drop_prefix("assets/Content/");
        repack_from_reader(Cursor::new(source), &output, &plan).unwrap();

        let mut archive = ZipArchive::new(File::open(&output).unwrap()).unwrap();
        assert!(archive.by_name("assets/Content/Data.xnb").is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
