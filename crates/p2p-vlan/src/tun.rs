//! TUN 虚拟网卡抽象与真实设备（tun-rs / Wintun）的创建。

use std::future::Future;
use std::io;
use std::net::Ipv4Addr;
use std::path::PathBuf;
use std::pin::Pin;

use anyhow::{anyhow, Result};

/// 需要管理员权限时错误文本的固定前缀（前端据此提示"以管理员身份运行"）
pub const PERMISSION_HINT: &str = "需要以管理员身份运行";

/// `Send` 的装箱 Future
pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// 一块三层 TUN 设备：一次 `recv` 读出一个完整 IP 包，一次 `send` 写入一个完整 IP 包。
///
/// 用装箱 Future 而非 RPITIT，以便引擎以 `Arc<dyn TunIo>` 持有（测试用内存实现、生产用 Wintun）。
pub trait TunIo: Send + Sync + 'static {
    fn recv<'a>(&'a self, buf: &'a mut [u8]) -> BoxFuture<'a, io::Result<usize>>;
    fn send<'a>(&'a self, pkt: &'a [u8]) -> BoxFuture<'a, io::Result<usize>>;
}

/// 真实 TUN 设备参数
#[derive(Clone, Debug)]
pub struct TunConfig {
    /// 本机虚拟 IP
    pub vip: Ipv4Addr,
    /// 前缀长度（默认 24 → 10.77.0.0/24）
    pub prefix_len: u8,
    /// MTU（默认 1280）
    pub mtu: u16,
    /// 网卡名（默认 "StardewVLAN"）
    pub name: String,
    /// Windows：wintun.dll 路径；`None` 时由 Wintun 加载器按默认搜索路径查找
    pub wintun_dll: Option<PathBuf>,
}

impl TunConfig {
    pub const DEFAULT_NAME: &'static str = "StardewVLAN";
    pub const DEFAULT_PREFIX_LEN: u8 = 24;
    pub const DEFAULT_MTU: u16 = 1280;

    pub fn new(vip: Ipv4Addr) -> Self {
        Self {
            vip,
            prefix_len: Self::DEFAULT_PREFIX_LEN,
            mtu: Self::DEFAULT_MTU,
            name: Self::DEFAULT_NAME.to_string(),
            wintun_dll: None,
        }
    }
}

impl Default for TunConfig {
    fn default() -> Self {
        Self::new(Ipv4Addr::UNSPECIFIED)
    }
}

impl TunIo for Box<dyn TunIo> {
    fn recv<'a>(&'a self, buf: &'a mut [u8]) -> BoxFuture<'a, io::Result<usize>> {
        (**self).recv(buf)
    }

    fn send<'a>(&'a self, pkt: &'a [u8]) -> BoxFuture<'a, io::Result<usize>> {
        (**self).send(pkt)
    }
}

impl TunIo for tun_rs::AsyncDevice {
    fn recv<'a>(&'a self, buf: &'a mut [u8]) -> BoxFuture<'a, io::Result<usize>> {
        Box::pin(tun_rs::AsyncDevice::recv(self, buf))
    }

    fn send<'a>(&'a self, pkt: &'a [u8]) -> BoxFuture<'a, io::Result<usize>> {
        Box::pin(tun_rs::AsyncDevice::send(self, pkt))
    }
}

/// Android：接管 `VpnService.establish()` 建好的 tun 文件描述符。
///
/// 和桌面端最大的不同是**谁来建网卡**。桌面端由 [`open_tun`] 自己创建适配器并配 IP，
/// Android 上应用没有这个权限：网卡由系统按 `VpnService.Builder` 的描述建好，
/// IP、掩码、MTU、路由全都在 Java 侧配置完毕，Rust 只拿到一个已经能读写 IP 包的 fd。
/// 所以这里不做任何设备配置，只把 fd 包成异步 I/O。
///
/// 调用方必须保证 Java 侧调过 `ParcelFileDescriptor.detachFd()`——描述符的所有权
/// 转移给了 Rust，返回的设备析构时会关闭它。若 Java 侧仍持有同一个 fd，
/// 双方都会去 close，可能误关到别的文件。
///
/// # Safety
///
/// `fd` 必须是有效的、当前进程独占的 tun 文件描述符。
#[cfg(target_os = "android")]
pub unsafe fn tun_from_fd(fd: std::os::fd::RawFd) -> Result<impl TunIo> {
    if fd < 0 {
        return Err(anyhow!("VpnService 未返回有效的虚拟网卡描述符"));
    }
    // `from_fd` 内部会把描述符设成非阻塞并注册到 tokio 的事件循环。
    tun_rs::AsyncDevice::from_fd(fd).map_err(|e| anyhow!("接管 VpnService 虚拟网卡失败: {e}"))
}

/// 打开一块真实 TUN 设备并配置 IP / 前缀 / MTU。
///
/// 权限不足（Windows 下创建 Wintun 适配器需要管理员）时返回的错误文本以
/// [`PERMISSION_HINT`] 开头，其余错误给出 dll 路径等诊断信息。
///
/// Android 上不存在这个函数：应用无权自己创建网卡，只能由系统按
/// `VpnService.Builder` 建好后交回描述符，见 [`tun_from_fd`]。
#[cfg(not(target_os = "android"))]
pub fn open_tun(cfg: &TunConfig) -> Result<impl TunIo> {
    if cfg.vip.is_unspecified() {
        return Err(anyhow!("虚拟 IP 未指定"));
    }
    if let Some(dll) = &cfg.wintun_dll {
        if cfg!(windows) && !dll.is_file() {
            return Err(anyhow!("未找到 wintun.dll: {}", dll.display()));
        }
    }

    let builder = tun_rs::DeviceBuilder::new()
        .ipv4(cfg.vip, cfg.prefix_len, None)
        .mtu(cfg.mtu);
    // macOS 的 utun 设备名由内核分配、且只接受 `utunN`，传自定义名字会被直接拒绝
    // （tun-rs: "device name must start with utun"）。这条平台上没有网卡名可指定，
    // ICE 的网卡名过滤也就无从谈起，改由网段过滤兜底（见 recommended_ice_config）。
    #[cfg(not(target_os = "macos"))]
    let builder = builder.name(cfg.name.clone());
    #[cfg(windows)]
    let builder = {
        let mut b = builder.description("Stardew Valley Assistant VLAN");
        if let Some(dll) = &cfg.wintun_dll {
            b = b.wintun_file(dll.to_string_lossy().into_owned());
        }
        b
    };

    builder.build_async().map_err(|e| classify_error(e, cfg))
}

/// 把创建设备的 I/O 错误翻译成给用户看的中文
#[cfg(not(target_os = "android"))]
fn classify_error(e: io::Error, cfg: &TunConfig) -> anyhow::Error {
    if is_permission_denied(&e) {
        return anyhow!(
            "{PERMISSION_HINT}：创建虚拟网卡「{}」需要管理员权限（{e}）",
            cfg.name
        );
    }
    let dll = cfg
        .wintun_dll
        .as_ref()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|| "默认搜索路径".to_string());
    anyhow!(
        "创建虚拟网卡「{}」失败: {e}（wintun.dll: {dll}）",
        cfg.name
    )
}

/// 操作系统层面的"拒绝访问"：ErrorKind::PermissionDenied、
/// Windows ERROR_ACCESS_DENIED(5) / ERROR_PRIVILEGE_NOT_HELD(1314)、Unix EPERM(1) / EACCES(13)
#[cfg(not(target_os = "android"))]
fn is_permission_denied(e: &io::Error) -> bool {
    if e.kind() == io::ErrorKind::PermissionDenied {
        return true;
    }
    match e.raw_os_error() {
        #[cfg(windows)]
        Some(5) | Some(1314) => true,
        #[cfg(not(windows))]
        Some(1) | Some(13) => true,
        _ => false,
    }
}

#[cfg(all(test, not(target_os = "android")))]
mod tests {
    use super::*;

    #[test]
    fn permission_error_has_hint_prefix() {
        let cfg = TunConfig::new(Ipv4Addr::new(10, 77, 0, 2));
        let e = classify_error(io::Error::from(io::ErrorKind::PermissionDenied), &cfg);
        assert!(e.to_string().starts_with(PERMISSION_HINT));
        let e = classify_error(io::Error::other("driver missing"), &cfg);
        assert!(!e.to_string().starts_with(PERMISSION_HINT));
        assert!(e.to_string().contains("driver missing"));
    }
}
