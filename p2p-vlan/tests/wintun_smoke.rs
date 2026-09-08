//! 真实 Wintun 网卡冒烟测试（需要管理员权限，默认 ignore）：
//! `cargo test --test wintun_smoke -- --ignored`
//!
//! 打开 10.77.0.2/24 的 TUN，确认 `Get-NetAdapter` 里能看到它，再从本机 UDP 套接字
//! 向 10.77.0.9:24642 发一个数据报，断言 TUN 读到目的地址为 10.77.0.9 的 IPv4 包。
//! wintun.dll 依次取：环境变量 `WINTUN_DLL`、desktop-app/src-tauri/resources/wintun.dll、
//! 系统默认搜索路径。

#![cfg(windows)]

use std::net::Ipv4Addr;
use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;

use p2p_vlan::packet::ipv4_dst;
use p2p_vlan::{open_tun, TunConfig, TunIo};

fn wintun_dll() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("WINTUN_DLL") {
        return Some(PathBuf::from(p));
    }
    let bundled = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../desktop-app/src-tauri/resources/wintun.dll");
    bundled.is_file().then_some(bundled)
}

fn adapter_listed(name: &str) -> bool {
    let out = Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            &format!("(Get-NetAdapter -Name '{name}' -ErrorAction SilentlyContinue).Name"),
        ])
        .output();
    match out {
        Ok(o) => String::from_utf8_lossy(&o.stdout).trim() == name,
        Err(_) => false,
    }
}

#[tokio::test]
#[ignore = "需要管理员权限创建 Wintun 适配器"]
async fn wintun_open_and_receive() {
    let name = "StardewVLANTest";
    let cfg = TunConfig {
        vip: Ipv4Addr::new(10, 77, 0, 2),
        name: name.to_string(),
        wintun_dll: wintun_dll(),
        ..TunConfig::default()
    };
    let tun = match open_tun(&cfg) {
        Ok(t) => t,
        Err(e) => panic!("打开 TUN 失败: {e}"),
    };
    assert!(adapter_listed(name), "Get-NetAdapter 里应能看到 {name}");

    // 给系统一点时间把地址/路由装好
    tokio::time::sleep(Duration::from_millis(1500)).await;

    let sock = tokio::net::UdpSocket::bind("0.0.0.0:0").await.expect("bind udp");
    let target = Ipv4Addr::new(10, 77, 0, 9);
    let payload = b"stardew-vlan-smoke";

    let mut buf = vec![0u8; 2048];
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    let mut found = false;
    while tokio::time::Instant::now() < deadline && !found {
        sock.send_to(payload, (target, 24642)).await.expect("send udp");
        let n = match tokio::time::timeout(Duration::from_millis(500), tun.recv(&mut buf)).await {
            Ok(Ok(n)) => n,
            Ok(Err(e)) => panic!("TUN 读取失败: {e}"),
            Err(_) => continue,
        };
        let pkt = &buf[..n];
        if ipv4_dst(pkt) == Some(target) && pkt.ends_with(payload) {
            found = true;
        }
    }
    assert!(found, "TUN 应读到目的地址为 {target} 的 IPv4 包");
    drop(tun);
}
