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
pub use tun::{open_tun, TunConfig, TunIo, PERMISSION_HINT};

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

#[cfg(test)]
mod tests {
    use super::*;

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
