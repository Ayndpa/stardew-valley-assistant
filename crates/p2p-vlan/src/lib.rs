//! p2p-vlan：星露谷助手的虚拟局域网引擎（REALTIME.md §7）。
//!
//! - [`ice`]：与信令无关的 ICE 核心（收集候选 → 交换 [`Handshake`] → dial/accept）；
//! - [`tun`]：TUN 网卡抽象（[`TunIo`]）与真实设备创建（[`open_tun`]，Windows 用 Wintun）；
//! - [`mem`]：通道模拟的内存网卡，供测试；
//! - [`packet`]：IPv4 解析与 §7.2 的转发/丢弃规则；
//! - [`engine`]：[`VlanEngine`]——按成员列表两两 ICE 直连，TUN ↔ 对端之间搬运 IP 包；
//! - [`helper`] / [`elevation`]（Windows）：§7.4 的提权辅助进程协议与 UAC 拉起。
//!
//! 信令不经本 crate：引擎通过 [`VlanEvent::SignalOut`] 交出要发给某成员的 JSON，
//! 调用方经房间 `room.signal` 转发；对端信令由调用方喂给 [`VlanEngine::signal_in`]。

#[cfg(windows)]
pub mod elevation;
pub mod engine;
#[cfg(windows)]
pub mod helper;
pub mod ice;
pub mod mem;
pub mod packet;
pub mod tun;

use std::net::{IpAddr, Ipv4Addr};
use std::sync::Arc;

pub use engine::{MemberInfo, PeerState, PeerStatus, VlanEngine, VlanEvent, VlanStatus, SUBNET};
pub use ice::{
    Handshake, IceCloseHandle, IceConfig, IceConn, IceEndpoint, InterfaceFilter, IpFilter, Role,
    DEFAULT_STUN_URL,
};
pub use tun::{TunConfig, TunIo, PERMISSION_HINT};
#[cfg(not(target_os = "android"))]
pub use tun::open_tun;
#[cfg(target_os = "android")]
pub use tun::tun_from_fd;

/// 生产环境推荐的 ICE 配置：默认 STUN，并过滤掉会让 webrtc-ice 提名卡死的本机地址——
/// 链路本地地址（169.254/16、fe80::/10）、代理软件 fake-IP 常用的 198.18/15、
/// 以及虚拟局域网自己的网段与网卡（否则 10.77.0.x 会被当成候选，数据包绕回自己的 TUN）。
pub fn recommended_ice_config(vip: Ipv4Addr, prefix_len: u8, adapter_name: &str) -> IceConfig {
    let subnet_mask = u32::MAX
        .checked_shl(32u32.saturating_sub(prefix_len.min(32) as u32))
        .unwrap_or(0);
    let subnet = u32::from(vip) & subnet_mask;
    let adapter = adapter_name.to_string();
    IceConfig {
        ip_filter: Some(Arc::new(move |ip: IpAddr| match ip {
            IpAddr::V4(v4) => {
                let n = u32::from(v4);
                let o = v4.octets();
                let link_local = o[0] == 169 && o[1] == 254;
                let fake_ip = o[0] == 198 && (o[1] == 18 || o[1] == 19);
                let own_subnet = n & subnet_mask == subnet;
                !(link_local || fake_ip || own_subnet)
            }
            IpAddr::V6(v6) => (v6.segments()[0] & 0xffc0) != 0xfe80,
        })),
        interface_filter: Some(Arc::new(move |name: &str| name != adapter)),
        ..IceConfig::default()
    }
}

/// Android 推荐的 ICE 配置。
///
/// 与 [`recommended_ice_config`] 的差别有三处，都源于手机环境：
///
/// 1. **不按网卡名过滤**。桌面端能给适配器起名并据此排除，`VpnService` 建出来的
///    接口名由系统决定（通常是 `tun0`），应用管不着。所幸网段过滤已经覆盖了它——
///    虚拟网卡上的地址必然落在 VLAN 网段里。
/// 2. **排除回环地址**。桌面端保留 127.0.0.1 是为了同机双开调试，手机上没这个场景，
///    而多余的回环候选会让"提名最先验证成功的候选对"这条规则误选到一条走不通的路。
/// 3. **STUN 服务器可传入**。桌面端硬编码的默认 STUN 在部分网络下不可达，
///    手机换网频繁，这里让调用方按需下发；传空则退回默认。
pub fn android_ice_config(vip: Ipv4Addr, prefix_len: u8, stun_urls: Vec<String>) -> IceConfig {
    let base = recommended_ice_config(vip, prefix_len, "");
    let inner = base.ip_filter.expect("recommended_ice_config 总会给出 ip_filter");
    IceConfig {
        ip_filter: Some(Arc::new(move |ip: IpAddr| !ip.is_loopback() && inner(ip))),
        // 网卡名过滤在 Android 上没有可用的判据，交给网段过滤兜底。
        interface_filter: None,
        stun_urls: if stun_urls.is_empty() {
            vec![DEFAULT_STUN_URL.to_string()]
        } else {
            stun_urls
        },
        // Windows 防火墙探测在 Android 上没有对应物。
        firewall_probe: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn android_filter_drops_loopback_and_own_subnet() {
        let cfg = android_ice_config(
            Ipv4Addr::new(10, 77, 0, 3),
            24,
            vec!["stun:stun.example.com:3478".to_string()],
        );
        let f = cfg.ip_filter.as_ref().expect("filter");
        // 手机上回环候选没有意义，必须排除。
        assert!(!f("127.0.0.1".parse().expect("ip")));
        // 虚拟网卡自己的网段会让数据包绕回自己。
        assert!(!f("10.77.0.9".parse().expect("ip")));
        // 真实的局域网与蜂窝地址要保留。
        assert!(f("192.168.1.3".parse().expect("ip")));
        assert!(f("10.78.0.9".parse().expect("ip")));
        // 网卡名过滤在 Android 上不可用，应为 None。
        assert!(cfg.interface_filter.is_none());
        assert_eq!(cfg.stun_urls, vec!["stun:stun.example.com:3478"]);
        assert!(!cfg.firewall_probe);
    }

    #[test]
    fn android_config_falls_back_to_default_stun() {
        let cfg = android_ice_config(Ipv4Addr::new(10, 77, 0, 3), 24, Vec::new());
        assert_eq!(cfg.stun_urls, vec![DEFAULT_STUN_URL.to_string()]);
    }

    #[test]
    fn recommended_filter_drops_virtual_ranges() {
        let cfg = recommended_ice_config(Ipv4Addr::new(10, 77, 0, 3), 24, "StardewVLAN");
        let f = cfg.ip_filter.as_ref().expect("filter");
        assert!(f("192.168.1.3".parse().expect("ip")));
        assert!(f("127.0.0.1".parse().expect("ip")));
        assert!(!f("169.254.83.107".parse().expect("ip")));
        assert!(!f("198.18.0.1".parse().expect("ip")));
        assert!(!f("198.19.5.5".parse().expect("ip")));
        assert!(!f("10.77.0.9".parse().expect("ip")));
        assert!(f("10.78.0.9".parse().expect("ip")));
        assert!(!f("fe80::1".parse().expect("ip")));
        assert!(f("2001:db8::1".parse().expect("ip")));
        let i = cfg.interface_filter.as_ref().expect("iface filter");
        assert!(!i("StardewVLAN"));
        assert!(i("以太网"));
    }
}
