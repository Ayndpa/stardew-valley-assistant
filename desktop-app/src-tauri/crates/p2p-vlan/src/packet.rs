//! IPv4 数据包解析与转发规则（REALTIME.md §7.2）。
//!
//! 只看 IPv4 头的固定偏移：版本半字节、源地址（12..16）、目的地址（16..20）；
//! 不校验校验和——链路两端都是可信的 TUN 与 ICE 连接，坏包由操作系统协议栈处理。

use std::net::Ipv4Addr;

/// 单个数据包上限（字节）。TUN MTU 为 1280，留出余量；超过则丢弃。
pub const MAX_PACKET: usize = 1400;
/// IPv4 最小头长
pub const IPV4_HEADER_MIN: usize = 20;
/// 受限广播地址
pub const LIMITED_BROADCAST: Ipv4Addr = Ipv4Addr::new(255, 255, 255, 255);

/// 出站丢包原因
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DropReason {
    /// 非 IPv4（IPv6、ARP、截断包…）
    NotIpv4,
    /// 超过 [`MAX_PACKET`]
    TooLarge,
}

/// TUN 读到一个包后的转发决定
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Route {
    Drop(DropReason),
    /// 单播：由调用方按目的地址查对端；查不到即丢弃（未知目的地址）
    Unicast(Ipv4Addr),
    /// 广播：发给所有已连接对端
    Broadcast,
}

/// 是否是一个（至少含完整头部的）IPv4 包
pub fn is_ipv4(pkt: &[u8]) -> bool {
    pkt.len() >= IPV4_HEADER_MIN && pkt[0] >> 4 == 4
}

/// IPv4 源地址
pub fn ipv4_src(pkt: &[u8]) -> Option<Ipv4Addr> {
    is_ipv4(pkt).then(|| Ipv4Addr::new(pkt[12], pkt[13], pkt[14], pkt[15]))
}

/// IPv4 目的地址
pub fn ipv4_dst(pkt: &[u8]) -> Option<Ipv4Addr> {
    is_ipv4(pkt).then(|| Ipv4Addr::new(pkt[16], pkt[17], pkt[18], pkt[19]))
}

/// 子网定向广播地址：`vip` 所在 `/prefix_len` 网段的最后一个地址
pub fn subnet_broadcast(vip: Ipv4Addr, prefix_len: u8) -> Ipv4Addr {
    let prefix = prefix_len.min(32) as u32;
    let host_mask = if prefix == 0 {
        u32::MAX
    } else {
        u32::MAX.checked_shr(prefix).unwrap_or(0)
    };
    Ipv4Addr::from(u32::from(vip) | host_mask)
}

/// 目的地址是否应广播给所有对端（子网定向广播或受限广播）
pub fn is_broadcast(dst: Ipv4Addr, subnet_bcast: Ipv4Addr) -> bool {
    dst == subnet_bcast || dst == LIMITED_BROADCAST
}

/// 出站转发决定：非 IPv4 / 超长 → 丢弃；广播地址 → 广播；否则单播到目的地址
pub fn route(pkt: &[u8], subnet_bcast: Ipv4Addr) -> Route {
    let Some(dst) = ipv4_dst(pkt) else {
        return Route::Drop(DropReason::NotIpv4);
    };
    if pkt.len() > MAX_PACKET {
        return Route::Drop(DropReason::TooLarge);
    }
    if is_broadcast(dst, subnet_bcast) {
        Route::Broadcast
    } else {
        Route::Unicast(dst)
    }
}

/// 入站校验：从对端收到的数据报必须是 IPv4、不超长，且源地址等于该对端的 vip（防伪造）
pub fn accept_inbound(pkt: &[u8], peer_vip: Ipv4Addr) -> bool {
    pkt.len() <= MAX_PACKET && ipv4_src(pkt) == Some(peer_vip)
}

/// 反码求和（RFC 1071）：返回未取反的累加结果
fn ones_complement_sum(mut acc: u32, data: &[u8]) -> u32 {
    for chunk in data.chunks(2) {
        let word = if chunk.len() == 2 {
            u16::from_be_bytes([chunk[0], chunk[1]])
        } else {
            u16::from_be_bytes([chunk[0], 0])
        };
        acc += u32::from(word);
    }
    acc
}

fn fold_checksum(mut acc: u32) -> u16 {
    while acc >> 16 != 0 {
        acc = (acc & 0xffff) + (acc >> 16);
    }
    !(acc as u16)
}

/// IPv4 头校验和（传入的头部校验和字段应为 0）
pub fn ipv4_header_checksum(header: &[u8]) -> u16 {
    fold_checksum(ones_complement_sum(0, header))
}

/// UDP 校验和（含 IPv4 伪首部；`udp` 为 UDP 头 + 载荷，校验和字段应为 0）。
/// 结果为 0 时按 RFC 768 改为 0xFFFF。
pub fn udp_checksum(src: Ipv4Addr, dst: Ipv4Addr, udp: &[u8]) -> u16 {
    let mut acc = ones_complement_sum(0, &src.octets());
    acc = ones_complement_sum(acc, &dst.octets());
    acc += 17; // 协议号
    acc += udp.len() as u32;
    let sum = fold_checksum(ones_complement_sum(acc, udp));
    if sum == 0 {
        0xffff
    } else {
        sum
    }
}

/// 构造一个 IPv4/UDP 包（测试与诊断用）：正确的头长、总长、协议号与两层校验和，
/// 可直接写入真实 TUN 交给操作系统协议栈。
pub fn build_ipv4_udp(
    src: Ipv4Addr,
    dst: Ipv4Addr,
    src_port: u16,
    dst_port: u16,
    payload: &[u8],
) -> Vec<u8> {
    let udp_len = 8 + payload.len();
    let total = IPV4_HEADER_MIN + udp_len;
    let mut pkt = Vec::with_capacity(total);
    pkt.push(0x45); // 版本 4，头长 5*4
    pkt.push(0); // DSCP/ECN
    pkt.extend_from_slice(&(total as u16).to_be_bytes());
    pkt.extend_from_slice(&[0, 0]); // 标识
    pkt.extend_from_slice(&[0x40, 0]); // 不分片
    pkt.push(64); // TTL
    pkt.push(17); // UDP
    pkt.extend_from_slice(&[0, 0]); // 头校验和，稍后回填
    pkt.extend_from_slice(&src.octets());
    pkt.extend_from_slice(&dst.octets());
    let hcs = ipv4_header_checksum(&pkt[..IPV4_HEADER_MIN]);
    pkt[10..12].copy_from_slice(&hcs.to_be_bytes());

    pkt.extend_from_slice(&src_port.to_be_bytes());
    pkt.extend_from_slice(&dst_port.to_be_bytes());
    pkt.extend_from_slice(&(udp_len as u16).to_be_bytes());
    pkt.extend_from_slice(&[0, 0]); // UDP 校验和，稍后回填
    pkt.extend_from_slice(payload);
    let ucs = udp_checksum(src, dst, &pkt[IPV4_HEADER_MIN..]);
    pkt[IPV4_HEADER_MIN + 6..IPV4_HEADER_MIN + 8].copy_from_slice(&ucs.to_be_bytes());
    pkt
}

#[cfg(test)]
mod tests {
    use super::*;

    const A: Ipv4Addr = Ipv4Addr::new(10, 77, 0, 2);
    const B: Ipv4Addr = Ipv4Addr::new(10, 77, 0, 3);
    const BCAST: Ipv4Addr = Ipv4Addr::new(10, 77, 0, 255);

    #[test]
    fn extracts_src_and_dst() {
        let pkt = build_ipv4_udp(A, B, 1000, 24642, b"hi");
        assert!(is_ipv4(&pkt));
        assert_eq!(ipv4_src(&pkt), Some(A));
        assert_eq!(ipv4_dst(&pkt), Some(B));
        assert_eq!(pkt.len(), 20 + 8 + 2);
    }

    #[test]
    fn checksums_verify_to_zero() {
        let pkt = build_ipv4_udp(A, B, 4000, 24642, b"checksum me");
        // 含校验和字段一起反码求和，折叠后应为 0xFFFF（即取反为 0）
        assert_eq!(fold_checksum(ones_complement_sum(0, &pkt[..20])), 0);
        let mut acc = ones_complement_sum(0, &A.octets());
        acc = ones_complement_sum(acc, &B.octets());
        acc += 17 + (pkt.len() - 20) as u32;
        assert_eq!(fold_checksum(ones_complement_sum(acc, &pkt[20..])), 0);
        assert_ne!(&pkt[10..12], &[0, 0]);
        assert_ne!(&pkt[26..28], &[0, 0]);
        // 奇数长度载荷也正确
        let odd = build_ipv4_udp(A, B, 1, 2, b"odd");
        assert_eq!(fold_checksum(ones_complement_sum(0, &odd[..20])), 0);
    }

    #[test]
    fn rejects_non_ipv4_by_version_nibble() {
        let mut pkt = build_ipv4_udp(A, B, 1, 2, b"");
        pkt[0] = 0x60; // IPv6
        assert!(!is_ipv4(&pkt));
        assert_eq!(ipv4_dst(&pkt), None);
        assert_eq!(route(&pkt, BCAST), Route::Drop(DropReason::NotIpv4));
        // 截断包也不算 IPv4
        assert!(!is_ipv4(&[0x45, 0, 0, 0]));
        assert_eq!(route(&[], BCAST), Route::Drop(DropReason::NotIpv4));
    }

    #[test]
    fn subnet_broadcast_math() {
        assert_eq!(subnet_broadcast(A, 24), BCAST);
        assert_eq!(subnet_broadcast(Ipv4Addr::new(192, 168, 5, 7), 16), Ipv4Addr::new(192, 168, 255, 255));
        assert_eq!(subnet_broadcast(A, 32), A);
        assert_eq!(subnet_broadcast(A, 0), LIMITED_BROADCAST);
    }

    #[test]
    fn broadcast_detection() {
        assert!(is_broadcast(BCAST, BCAST));
        assert!(is_broadcast(LIMITED_BROADCAST, BCAST));
        assert!(!is_broadcast(B, BCAST));
        assert_eq!(route(&build_ipv4_udp(A, BCAST, 1, 2, b"x"), BCAST), Route::Broadcast);
        assert_eq!(
            route(&build_ipv4_udp(A, LIMITED_BROADCAST, 1, 2, b"x"), BCAST),
            Route::Broadcast
        );
        assert_eq!(route(&build_ipv4_udp(A, B, 1, 2, b"x"), BCAST), Route::Unicast(B));
    }

    #[test]
    fn size_filter() {
        let ok = build_ipv4_udp(A, B, 1, 2, &vec![0u8; MAX_PACKET - 28]);
        assert_eq!(ok.len(), MAX_PACKET);
        assert_eq!(route(&ok, BCAST), Route::Unicast(B));
        assert!(accept_inbound(&ok, A));

        let big = build_ipv4_udp(A, B, 1, 2, &vec![0u8; MAX_PACKET - 28 + 1]);
        assert_eq!(route(&big, BCAST), Route::Drop(DropReason::TooLarge));
        assert!(!accept_inbound(&big, A));
    }

    #[test]
    fn inbound_requires_ipv4_and_matching_src() {
        let pkt = build_ipv4_udp(A, B, 1, 2, b"x");
        assert!(accept_inbound(&pkt, A));
        // 伪造源地址：声称来自 A 的对端实际填了 B
        assert!(!accept_inbound(&pkt, B));
        let mut v6 = pkt.clone();
        v6[0] = 0x60;
        assert!(!accept_inbound(&v6, A));
        assert!(!accept_inbound(b"short", A));
    }
}
