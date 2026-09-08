//! APK Signature Scheme v2 签名。
//!
//! 为什么必须是 v2 而不是老的 JAR（v1）签名：Android 11 起，`targetSdkVersion ≥ 30`
//! 的应用只带 v1 签名会被安装器直接拒绝。星露谷物语 1.6 的 targetSdk 是 35，
//! 重打包后这个值不变，所以 v2 是硬要求。
//!
//! 相对的，v2 只有 Android 7.0（API 24）以上认。原包的 `minSdkVersion` 是 21，
//! 但一个只有 v2 签名的包在 API 21~23 上装不了——所以重打包时要把 minSdk 抬到 24，
//! 这件事由 [`super::axml_write::ManifestEditor::set_min_sdk_version`] 完成，
//! 本模块只负责签名本身。
//!
//! ## 签名密钥
//!
//! 密钥在设备上生成一次然后一直复用。Android 认"包名 + 签名"这一对：同一个包名
//! 换了签名就装不上（必须先卸载，存档也就没了）。所以密钥必须持久化，
//! 每次重打包重新生成等于每次都逼玩家卸载重装。
//!
//! ## 摘要算法（v2 规范）
//!
//! 待签名的内容分三段：ZIP 条目区 `[0, 中央目录起点)`、中央目录、EOCD。
//! 每段各自按 1 MB 切块，块摘要是 `SHA-256(0xa5 ‖ u32le(块长) ‖ 块内容)`，
//! 总摘要是 `SHA-256(0x5a ‖ u32le(块数) ‖ 所有块摘要按序拼接)`。
//!
//! 关键细节：参与摘要的 EOCD，其"中央目录偏移"字段要指向**签名块的起点**。
//! 由于签名块正好插在原中央目录的位置上，这个值就等于原始 EOCD 里已有的值——
//! 也就是说摘要用的是**原封不动的** EOCD 字节；反倒是最终写出去的 EOCD 需要
//! 把偏移往后挪一个签名块的长度。写反了 `apksigner` 会报摘要不匹配。

use std::fs::{self, File};
use std::io::{BufReader, BufWriter, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::time::Duration;

use der::Encode;
use rsa::pkcs1v15::{Signature, SigningKey};
use rsa::pkcs8::{DecodePrivateKey, EncodePrivateKey, LineEnding};
use rsa::signature::{SignatureEncoding, Signer};
use rsa::{RsaPrivateKey, RsaPublicKey};
use sha2::{Digest, Sha256};
use x509_cert::builder::{Builder, CertificateBuilder, Profile};
use x509_cert::spki::{EncodePublicKey, SubjectPublicKeyInfoOwned};
use x509_cert::name::Name;
use x509_cert::serial_number::SerialNumber;
use x509_cert::time::Validity;
use x509_cert::Certificate;

/// v2 规范固定的分块大小。
const CHUNK_SIZE: usize = 1024 * 1024;
/// 块摘要前缀。
const CHUNK_PREFIX: u8 = 0xa5;
/// 总摘要前缀。
const TOP_PREFIX: u8 = 0x5a;

/// APK 签名块的魔数，写在块尾。
const BLOCK_MAGIC: &[u8; 16] = b"APK Sig Block 42";
/// APK Signature Scheme v2 的块 ID。
const V2_BLOCK_ID: u32 = 0x7109_871a;
/// RSASSA-PKCS1-v1_5 + SHA2-256。
const SIG_ALG_RSA_PKCS1_SHA256: u32 = 0x0103;
/// 与签名算法配套的内容摘要算法（v2 里这两者一一对应）。
const CONTENT_DIGEST_CHUNKED_SHA256: u32 = SIG_ALG_RSA_PKCS1_SHA256;

const EOCD_SIGNATURE: u32 = 0x0605_4b50;
const EOCD_MIN_SIZE: usize = 22;
/// EOCD 后面最多跟 64 KB 注释，往前扫这么多就够。
const EOCD_SEARCH_LIMIT: usize = EOCD_MIN_SIZE + u16::MAX as usize;

const KEY_FILE: &str = "signing_key.pk8";
const CERT_FILE: &str = "signing_cert.der";
/// 只是为了方便玩家自己拿去核对指纹，签名流程不读它。
const CERT_PEM_FILE: &str = "signing_cert.pem";

/// 证书有效期。装过一次的应用如果证书过期不会被系统卸载，但重新安装会失败，
/// 所以给足 30 年。
const CERT_VALID_SECS: u64 = 30 * 365 * 24 * 60 * 60;

/// 用来签名的密钥与自签名证书。
pub struct SigningIdentity {
    signing_key: SigningKey<Sha256>,
    /// X.509 证书的 DER，直接进签名块。
    cert_der: Vec<u8>,
    /// SubjectPublicKeyInfo 的 DER，v2 签名块里单独带一份。
    public_key_der: Vec<u8>,
}

impl SigningIdentity {
    /// 证书的 SHA-256 指纹，界面上用来告诉玩家"这台设备的签名是这个"。
    pub fn certificate_fingerprint(&self) -> String {
        let digest = Sha256::digest(&self.cert_der);
        digest
            .iter()
            .map(|b| format!("{:02X}", b))
            .collect::<Vec<_>>()
            .join(":")
    }

    pub fn certificate_der(&self) -> &[u8] {
        &self.cert_der
    }
}

/// 读出设备上的签名密钥；没有就生成一个并落盘。
///
/// `dir` 一般是 `<app_data>/keystore`。
pub fn load_or_create_identity(dir: &Path) -> Result<SigningIdentity, String> {
    fs::create_dir_all(dir).map_err(|e| format!("创建密钥目录失败: {}", e))?;
    let key_path = dir.join(KEY_FILE);
    let cert_path = dir.join(CERT_FILE);

    if key_path.is_file() && cert_path.is_file() {
        let key_bytes = fs::read(&key_path).map_err(|e| format!("读取签名密钥失败: {}", e))?;
        let cert_der = fs::read(&cert_path).map_err(|e| format!("读取签名证书失败: {}", e))?;
        let private_key = RsaPrivateKey::from_pkcs8_der(&key_bytes)
            .map_err(|e| format!("签名密钥已损坏: {}", e))?;
        // 证书能不能解析要当场验一下：坏证书要等到 apksigner 或系统安装器才报错，
        // 那时候用户已经等了几分钟的重打包。
        Certificate::from_der_bytes(&cert_der)?;
        return Ok(build_identity(private_key, cert_der));
    }

    let (private_key, cert_der) = generate_identity()?;
    fs::write(
        &key_path,
        private_key
            .to_pkcs8_der()
            .map_err(|e| format!("序列化签名密钥失败: {}", e))?
            .as_bytes(),
    )
    .map_err(|e| format!("写入签名密钥失败: {}", e))?;
    fs::write(&cert_path, &cert_der).map_err(|e| format!("写入签名证书失败: {}", e))?;
    // PEM 只是给人看的，写失败不影响功能。
    if let Ok(cert) = Certificate::from_der_bytes(&cert_der) {
        if let Ok(pem) = x509_cert::der::EncodePem::to_pem(&cert, LineEnding::LF) {
            let _ = fs::write(dir.join(CERT_PEM_FILE), pem);
        }
    }

    Ok(build_identity(private_key, cert_der))
}

/// 内部小工具：`Certificate::from_der` 的错误类型转成中文文案。
trait FromDerBytes: Sized {
    fn from_der_bytes(bytes: &[u8]) -> Result<Self, String>;
}

impl FromDerBytes for Certificate {
    fn from_der_bytes(bytes: &[u8]) -> Result<Self, String> {
        use der::Decode;
        Certificate::from_der(bytes).map_err(|e| format!("签名证书无法解析: {}", e))
    }
}

fn build_identity(private_key: RsaPrivateKey, cert_der: Vec<u8>) -> SigningIdentity {
    let public_key = RsaPublicKey::from(&private_key);
    let public_key_der = public_key
        .to_public_key_der()
        .expect("RSA 公钥总能编码成 SubjectPublicKeyInfo")
        .as_bytes()
        .to_vec();
    SigningIdentity {
        signing_key: SigningKey::<Sha256>::new(private_key),
        cert_der,
        public_key_der,
    }
}

fn generate_identity() -> Result<(RsaPrivateKey, Vec<u8>), String> {
    let mut rng = rand::thread_rng();
    // 2048 位是 Android 上的通行做法，也是纯 Rust 实现能在手机上几秒内生成的上限。
    let private_key =
        RsaPrivateKey::new(&mut rng, 2048).map_err(|e| format!("生成签名密钥失败: {}", e))?;
    let signing_key = SigningKey::<Sha256>::new(private_key.clone());

    let public_key = RsaPublicKey::from(&private_key);
    let spki = SubjectPublicKeyInfoOwned::from_key(public_key)
        .map_err(|e| format!("编码公钥失败: {}", e))?;

    // RFC 4514 的 RDN 串按逗号切分后不做 trim，逗号后面多一个空格就会被当成
    // 属性名的一部分，直接报 "malformed OID"。这里刻意不留空格。
    let subject = Name::from_str(
        "CN=Stardew Valley Assistant,OU=Modded Package,O=Stardew Valley Assistant,C=CN",
    )
    .map_err(|e| format!("构造证书主体失败: {}", e))?;
    // 序列号必须是正数，用固定值即可：自签名证书不进任何信任链。
    let serial = SerialNumber::from(1u32);
    let validity = Validity::from_now(Duration::from_secs(CERT_VALID_SECS))
        .map_err(|e| format!("构造证书有效期失败: {}", e))?;

    let builder = CertificateBuilder::new(Profile::Root, serial, validity, subject, spki, &signing_key)
        .map_err(|e| format!("构造自签名证书失败: {}", e))?;
    let certificate: Certificate = builder
        .build::<Signature>()
        .map_err(|e| format!("签发自签名证书失败: {}", e))?;
    let cert_der = certificate
        .to_der()
        .map_err(|e| format!("序列化自签名证书失败: {}", e))?;

    Ok((private_key, cert_der))
}

// ---------------------------------------------------------------------------
// ZIP 结构定位
// ---------------------------------------------------------------------------

struct ZipLayout {
    /// 中央目录起点，也就是签名块要插入的位置。
    central_directory_offset: u64,
    central_directory_size: u64,
    /// EOCD 及其后面的注释，原样带走。
    eocd: Vec<u8>,
}

fn locate_zip_layout(file: &mut File, file_len: u64) -> Result<ZipLayout, String> {
    if file_len < EOCD_MIN_SIZE as u64 {
        return Err("文件太小，不是有效的 ZIP".to_string());
    }
    let search_len = EOCD_SEARCH_LIMIT.min(file_len as usize);
    let search_start = file_len - search_len as u64;
    let mut tail = vec![0u8; search_len];
    file.seek(SeekFrom::Start(search_start))
        .map_err(|e| format!("定位 ZIP 尾部失败: {}", e))?;
    file.read_exact(&mut tail)
        .map_err(|e| format!("读取 ZIP 尾部失败: {}", e))?;

    // 从后往前找：注释里可能混进一段看着像 EOCD 的字节，最后一个匹配才是真的。
    let mut eocd_rel = None;
    let mut i = search_len.saturating_sub(EOCD_MIN_SIZE);
    loop {
        if u32::from_le_bytes([tail[i], tail[i + 1], tail[i + 2], tail[i + 3]]) == EOCD_SIGNATURE {
            let comment_len = u16::from_le_bytes([tail[i + 20], tail[i + 21]]) as usize;
            if i + EOCD_MIN_SIZE + comment_len == search_len {
                eocd_rel = Some(i);
                break;
            }
        }
        if i == 0 {
            break;
        }
        i -= 1;
    }
    let eocd_rel = eocd_rel.ok_or_else(|| "找不到 ZIP 的中央目录结束记录".to_string())?;
    let eocd = tail[eocd_rel..].to_vec();

    let cd_size = u32::from_le_bytes([eocd[12], eocd[13], eocd[14], eocd[15]]) as u64;
    let cd_offset = u32::from_le_bytes([eocd[16], eocd[17], eocd[18], eocd[19]]) as u64;
    if cd_size == u32::MAX as u64 || cd_offset == u32::MAX as u64 {
        return Err("这是 ZIP64 格式的安装包，当前的 v2 签名实现不支持".to_string());
    }
    let eocd_offset = search_start + eocd_rel as u64;
    if cd_offset + cd_size != eocd_offset {
        return Err(format!(
            "中央目录不在 EOCD 之前（偏移 {} + 长度 {} ≠ {}），安装包结构异常",
            cd_offset, cd_size, eocd_offset
        ));
    }

    Ok(ZipLayout {
        central_directory_offset: cd_offset,
        central_directory_size: cd_size,
        eocd,
    })
}

// ---------------------------------------------------------------------------
// 分块摘要
// ---------------------------------------------------------------------------

/// 按 v2 规范累积块摘要。
struct ChunkedDigest {
    chunk_digests: Vec<u8>,
    chunk_count: u32,
}

impl ChunkedDigest {
    fn new() -> Self {
        ChunkedDigest {
            chunk_digests: Vec::new(),
            chunk_count: 0,
        }
    }

    fn push_chunk(&mut self, chunk: &[u8]) {
        let mut hasher = Sha256::new();
        hasher.update([CHUNK_PREFIX]);
        hasher.update((chunk.len() as u32).to_le_bytes());
        hasher.update(chunk);
        self.chunk_digests.extend_from_slice(&hasher.finalize());
        self.chunk_count += 1;
    }

    /// 一整段内容按 1 MB 切块喂进去。切块**不跨段**：三段各自独立切。
    fn push_section(&mut self, data: &[u8]) {
        for chunk in data.chunks(CHUNK_SIZE) {
            self.push_chunk(chunk);
        }
    }

    fn push_section_from_reader<R: Read>(
        &mut self,
        reader: &mut R,
        mut remaining: u64,
    ) -> Result<(), String> {
        let mut buffer = vec![0u8; CHUNK_SIZE];
        while remaining > 0 {
            let want = CHUNK_SIZE.min(remaining as usize);
            reader
                .read_exact(&mut buffer[..want])
                .map_err(|e| format!("读取安装包内容失败: {}", e))?;
            self.push_chunk(&buffer[..want]);
            remaining -= want as u64;
        }
        Ok(())
    }

    fn finish(self) -> Vec<u8> {
        let mut hasher = Sha256::new();
        hasher.update([TOP_PREFIX]);
        hasher.update(self.chunk_count.to_le_bytes());
        hasher.update(&self.chunk_digests);
        hasher.finalize().to_vec()
    }
}

// ---------------------------------------------------------------------------
// 签名块编码
// ---------------------------------------------------------------------------

/// `u32le 长度 + 内容`。
fn length_prefixed(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(4 + data.len());
    out.extend_from_slice(&(data.len() as u32).to_le_bytes());
    out.extend_from_slice(data);
    out
}

/// "带长度前缀的、由带长度前缀的元素组成的序列"：外层一个总长度，
/// 内层每个元素各自一个长度。v2 规范里几乎所有结构都是这个形状。
fn length_prefixed_sequence(elements: &[Vec<u8>]) -> Vec<u8> {
    let mut inner = Vec::new();
    for element in elements {
        inner.extend_from_slice(&(element.len() as u32).to_le_bytes());
        inner.extend_from_slice(element);
    }
    length_prefixed(&inner)
}

fn build_v2_block_value(identity: &SigningIdentity, content_digest: &[u8]) -> Result<Vec<u8>, String> {
    // digests：(算法 ID, 摘要)
    let mut digest_element = Vec::new();
    digest_element.extend_from_slice(&CONTENT_DIGEST_CHUNKED_SHA256.to_le_bytes());
    digest_element.extend_from_slice(&length_prefixed(content_digest));

    let mut signed_data = Vec::new();
    signed_data.extend_from_slice(&length_prefixed_sequence(&[digest_element]));
    signed_data.extend_from_slice(&length_prefixed_sequence(std::slice::from_ref(
        &identity.cert_der,
    )));
    // 附加属性：v2 里可以为空。v3 的"proof-of-rotation"才需要它。
    signed_data.extend_from_slice(&length_prefixed_sequence(&[]));

    let signature: Signature = identity
        .signing_key
        .try_sign(&signed_data)
        .map_err(|e| format!("对签名数据做 RSA 签名失败: {}", e))?;
    let signature_bytes = signature.to_vec();

    let mut signature_element = Vec::new();
    signature_element.extend_from_slice(&SIG_ALG_RSA_PKCS1_SHA256.to_le_bytes());
    signature_element.extend_from_slice(&length_prefixed(&signature_bytes));

    let mut signer = Vec::new();
    signer.extend_from_slice(&length_prefixed(&signed_data));
    signer.extend_from_slice(&length_prefixed_sequence(&[signature_element]));
    signer.extend_from_slice(&length_prefixed(&identity.public_key_der));

    Ok(length_prefixed_sequence(&[signer]))
}

/// 把若干 ID-值对包成完整的 APK 签名块。
fn build_signing_block(pairs: &[(u32, Vec<u8>)]) -> Vec<u8> {
    let mut body = Vec::new();
    for (id, value) in pairs {
        // 长度字段算的是 "ID + 值"，不含长度字段自己。
        body.extend_from_slice(&((4 + value.len()) as u64).to_le_bytes());
        body.extend_from_slice(&id.to_le_bytes());
        body.extend_from_slice(value);
    }
    // 块长度字段同样不含它自己，但**包含**块尾那份重复的长度和魔数。
    let size_of_block = (body.len() + 8 + BLOCK_MAGIC.len()) as u64;

    let mut out = Vec::with_capacity(8 + size_of_block as usize);
    out.extend_from_slice(&size_of_block.to_le_bytes());
    out.extend_from_slice(&body);
    out.extend_from_slice(&size_of_block.to_le_bytes());
    out.extend_from_slice(BLOCK_MAGIC);
    out
}

// ---------------------------------------------------------------------------
// 对外接口
// ---------------------------------------------------------------------------

/// 给一个未签名的安装包做 v2 签名，结果写到 `output`。
///
/// `input` 和 `output` 必须是两个不同的文件：签名块要插在中央目录之前，
/// 整份文件的后半段都得往后挪，原地改写没法流式做。
pub fn sign_apk_v2(
    input: &Path,
    output: &Path,
    identity: &SigningIdentity,
) -> Result<(), String> {
    let mut file = File::open(input).map_err(|e| format!("打开待签名安装包失败: {}", e))?;
    let file_len = file
        .metadata()
        .map(|m| m.len())
        .map_err(|e| format!("读取待签名安装包大小失败: {}", e))?;
    let layout = locate_zip_layout(&mut file, file_len)?;

    // 中央目录通常几百 KB，整段读进内存没问题；条目区才是几百 MB，那部分流式读。
    let mut central_directory = vec![0u8; layout.central_directory_size as usize];
    file.seek(SeekFrom::Start(layout.central_directory_offset))
        .map_err(|e| format!("定位中央目录失败: {}", e))?;
    file.read_exact(&mut central_directory)
        .map_err(|e| format!("读取中央目录失败: {}", e))?;

    let mut digest = ChunkedDigest::new();
    file.seek(SeekFrom::Start(0))
        .map_err(|e| format!("回到安装包开头失败: {}", e))?;
    {
        let mut reader = BufReader::with_capacity(256 * 1024, &mut file);
        digest.push_section_from_reader(&mut reader, layout.central_directory_offset)?;
    }
    digest.push_section(&central_directory);
    // 参与摘要的 EOCD 里，中央目录偏移必须指向签名块起点——而签名块正好插在
    // 原中央目录的位置，所以这里用的就是原始字节，一个字节都不用改。
    digest.push_section(&layout.eocd);
    let content_digest = digest.finish();

    let value = build_v2_block_value(identity, &content_digest)?;
    let block = build_signing_block(&[(V2_BLOCK_ID, value)]);

    // 最终写出去的 EOCD 才需要把中央目录偏移往后挪一个签名块。
    let mut eocd = layout.eocd.clone();
    let new_cd_offset = layout.central_directory_offset + block.len() as u64;
    if new_cd_offset > u32::MAX as u64 {
        return Err("加上签名块后中央目录偏移超过 4 GB，需要 ZIP64".to_string());
    }
    eocd[16..20].copy_from_slice(&(new_cd_offset as u32).to_le_bytes());

    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建输出目录失败: {}", e))?;
    }
    let out_file = File::create(output).map_err(|e| format!("创建已签名安装包失败: {}", e))?;
    let mut out = BufWriter::with_capacity(256 * 1024, out_file);

    file.seek(SeekFrom::Start(0))
        .map_err(|e| format!("回到安装包开头失败: {}", e))?;
    let mut remaining = layout.central_directory_offset;
    let mut buffer = vec![0u8; 256 * 1024];
    while remaining > 0 {
        let want = buffer.len().min(remaining as usize);
        file.read_exact(&mut buffer[..want])
            .map_err(|e| format!("读取安装包内容失败: {}", e))?;
        out.write_all(&buffer[..want])
            .map_err(|e| format!("写入已签名安装包失败: {}", e))?;
        remaining -= want as u64;
    }
    out.write_all(&block)
        .map_err(|e| format!("写入签名块失败: {}", e))?;
    out.write_all(&central_directory)
        .map_err(|e| format!("写入中央目录失败: {}", e))?;
    out.write_all(&eocd)
        .map_err(|e| format!("写入 EOCD 失败: {}", e))?;
    out.flush()
        .map_err(|e| format!("刷新已签名安装包失败: {}", e))?;
    Ok(())
}

/// 默认密钥目录 `<app_data>/keystore`。
pub fn keystore_dir(app_data: &Path) -> PathBuf {
    app_data.join("keystore")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    /// 生成一次密钥要几秒，测试里共用一份。
    fn identity() -> &'static SigningIdentity {
        use std::sync::OnceLock;
        static IDENTITY: OnceLock<SigningIdentity> = OnceLock::new();
        IDENTITY.get_or_init(|| {
            let (key, cert) = generate_identity().expect("应能生成自签名密钥");
            build_identity(key, cert)
        })
    }

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "sva-sign-{}-{}",
            tag,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn make_zip(path: &Path, payload_len: usize) {
        let mut buffer = Cursor::new(Vec::new());
        {
            let mut zip = ZipWriter::new(&mut buffer);
            zip.start_file("AndroidManifest.xml", SimpleFileOptions::default())
                .unwrap();
            zip.write_all(b"manifest").unwrap();
            zip.start_file("assets/big.bin", SimpleFileOptions::default())
                .unwrap();
            // 用不可压缩的内容把条目区撑过 1 MB，逼出多块摘要的路径。
            let mut data = vec![0u8; payload_len];
            for (i, b) in data.iter_mut().enumerate() {
                *b = (i as u32).wrapping_mul(2654435761).to_le_bytes()[0];
            }
            zip.write_all(&data).unwrap();
            zip.finish().unwrap();
        }
        fs::write(path, buffer.into_inner()).unwrap();
    }

    #[test]
    fn keystore_is_reused_across_calls() {
        let dir = temp_dir("keystore");
        let first = load_or_create_identity(&dir).unwrap();
        let second = load_or_create_identity(&dir).unwrap();
        // 同一台设备必须拿到同一个证书，否则每次重打包都要玩家卸载重装。
        assert_eq!(first.certificate_der(), second.certificate_der());
        assert!(dir.join(KEY_FILE).is_file());
        assert!(dir.join(CERT_FILE).is_file());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn signing_block_is_well_formed_and_digest_matches() {
        let dir = temp_dir("block");
        let unsigned = dir.join("unsigned.apk");
        let signed = dir.join("signed.apk");
        make_zip(&unsigned, 3 * CHUNK_SIZE + 12_345);
        sign_apk_v2(&unsigned, &signed, identity()).unwrap();

        let bytes = fs::read(&signed).unwrap();
        // 按验证方的流程反着走一遍：EOCD → 中央目录 → 块尾 → 块头。
        let eocd_start = bytes.len() - EOCD_MIN_SIZE;
        assert_eq!(
            u32::from_le_bytes(bytes[eocd_start..eocd_start + 4].try_into().unwrap()),
            EOCD_SIGNATURE
        );
        let cd_offset =
            u32::from_le_bytes(bytes[eocd_start + 16..eocd_start + 20].try_into().unwrap()) as usize;
        assert_eq!(&bytes[cd_offset..cd_offset + 4], &[0x50, 0x4b, 0x01, 0x02]);
        assert_eq!(&bytes[cd_offset - 16..cd_offset], BLOCK_MAGIC);
        let trailing_size =
            u64::from_le_bytes(bytes[cd_offset - 24..cd_offset - 16].try_into().unwrap()) as usize;
        let block_start = cd_offset - trailing_size - 8;
        let leading_size =
            u64::from_le_bytes(bytes[block_start..block_start + 8].try_into().unwrap()) as usize;
        assert_eq!(leading_size, trailing_size, "块首块尾的长度必须一致");

        // 重新算一遍内容摘要，和签名块里带的那份对上。
        let mut digest = ChunkedDigest::new();
        digest.push_section(&bytes[..block_start]);
        digest.push_section(&bytes[cd_offset..eocd_start]);
        let mut eocd = bytes[eocd_start..].to_vec();
        eocd[16..20].copy_from_slice(&(block_start as u32).to_le_bytes());
        digest.push_section(&eocd);
        let expected = digest.finish();

        // 签名块里第一个 ID-值对就是 v2 块。
        let pair_len =
            u64::from_le_bytes(bytes[block_start + 8..block_start + 16].try_into().unwrap())
                as usize;
        let pair_id =
            u32::from_le_bytes(bytes[block_start + 16..block_start + 20].try_into().unwrap());
        assert_eq!(pair_id, V2_BLOCK_ID);
        let value = &bytes[block_start + 20..block_start + 16 + pair_len];
        // value = 签名者序列；剥掉两层长度前缀拿到第一个签名者。
        let signer = &value[8..];
        let signed_data_len = u32::from_le_bytes(signer[..4].try_into().unwrap()) as usize;
        let signed_data = &signer[4..4 + signed_data_len];
        // signed_data 的第一段是摘要序列，其中第一个元素是 (算法, 摘要)。
        let digests_len = u32::from_le_bytes(signed_data[..4].try_into().unwrap()) as usize;
        assert!(digests_len > 0);
        let first_elem_len = u32::from_le_bytes(signed_data[4..8].try_into().unwrap()) as usize;
        assert_eq!(first_elem_len, 4 + 4 + 32);
        let alg = u32::from_le_bytes(signed_data[8..12].try_into().unwrap());
        assert_eq!(alg, CONTENT_DIGEST_CHUNKED_SHA256);
        let digest_len = u32::from_le_bytes(signed_data[12..16].try_into().unwrap()) as usize;
        assert_eq!(digest_len, 32);
        assert_eq!(&signed_data[16..16 + 32], expected.as_slice());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn signed_apk_is_still_a_valid_zip() {
        let dir = temp_dir("zip");
        let unsigned = dir.join("unsigned.apk");
        let signed = dir.join("signed.apk");
        make_zip(&unsigned, 4096);
        sign_apk_v2(&unsigned, &signed, identity()).unwrap();

        let mut archive = zip::ZipArchive::new(File::open(&signed).unwrap()).unwrap();
        let mut manifest = Vec::new();
        archive
            .by_name("AndroidManifest.xml")
            .unwrap()
            .read_to_end(&mut manifest)
            .unwrap();
        assert_eq!(manifest, b"manifest");
        let _ = fs::remove_dir_all(&dir);
    }
}
