//! 真实 Wintun 网卡 + ICE 网状网络的端到端测试（需要管理员权限，默认 ignore）：
//! `cargo test --test wintun_e2e -- --ignored --nocapture`
//!
//! 同一进程内：引擎 A 用真实 Wintun（10.77.0.2/24，网卡 "StardewVLANTestA"），
//! 引擎 B 用内存网卡（10.77.0.3），信令在两者之间直接搬运。
//! 1. 两端连通；
//! 2. 本机套接字（绑定 10.77.0.2）向 10.77.0.3:24642 发 100 字节 → B 的内存网卡收到该 IPv4/UDP 包；
//! 3. 反向：构造 10.77.0.3:24642 → 10.77.0.2:<步骤 2 的源端口> 的包注入 B 的内存网卡 →
//!    A 的本机套接字收到载荷（证明写入 TUN 的包进入了 Windows 协议栈）；
//! 4. 停止两端，网卡被移除。
//! wintun.dll 依次取：环境变量 `WINTUN_DLL`、src-tauri/resources/wintun.dll、系统默认搜索路径。

#![cfg(windows)]

use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddrV4};
use std::path::PathBuf;
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use p2p_vlan::mem::mem_tun;
use p2p_vlan::packet::{build_ipv4_udp, ipv4_dst, ipv4_src};
use p2p_vlan::{
    open_tun, IceConfig, MemberInfo, PeerState, TunConfig, TunIo, VlanEngine, VlanEvent,
};
use tokio::sync::mpsc;

const ADAPTER: &str = "StardewVLANTestA";
const VIP_A: Ipv4Addr = Ipv4Addr::new(10, 77, 0, 2);
const VIP_B: Ipv4Addr = Ipv4Addr::new(10, 77, 0, 3);
const GAME_PORT: u16 = 24642;
const ICE_WAIT: Duration = Duration::from_secs(30);
const PKT_WAIT: Duration = Duration::from_secs(5);

type Directory = Arc<Mutex<HashMap<String, Arc<VlanEngine>>>>;

fn wintun_dll() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("WINTUN_DLL") {
        return Some(PathBuf::from(p));
    }
    let bundled = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../resources/wintun.dll");
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

/// 只用回环候选：本机上的代理/虚拟网卡地址会让 webrtc-ice 的提名卡死
fn ice() -> IceConfig {
    IceConfig {
        stun_urls: Vec::new(),
        firewall_probe: false,
        ip_filter: Some(Arc::new(|ip| ip.is_loopback())),
        interface_filter: None,
    }
}

fn members() -> Vec<MemberInfo> {
    vec![
        MemberInfo {
            id: "a".into(),
            vip: VIP_A,
        },
        MemberInfo {
            id: "b".into(),
            vip: VIP_B,
        },
    ]
}

/// 启动引擎并挂上信令垫片（与 tests/mesh.rs 相同：SignalOut 直接喂给目录里的目标引擎）
fn spawn_engine(id: &str, vip: Ipv4Addr, tun: impl TunIo, dir: &Directory) -> Arc<VlanEngine> {
    let (tx, mut rx) = mpsc::channel(256);
    let engine = VlanEngine::start(id.to_string(), vip, members(), tun, ice(), tx);
    dir.lock().expect("dir").insert(id.to_string(), Arc::clone(&engine));
    let me = id.to_string();
    let dir = Arc::clone(dir);
    tokio::spawn(async move {
        while let Some(ev) = rx.recv().await {
            match ev {
                VlanEvent::SignalOut { to, data } => {
                    let target = dir.lock().expect("dir").get(&to).cloned();
                    if let Some(target) = target {
                        target.signal_in(&me, data).await;
                    }
                }
                VlanEvent::Log(text) => println!("[{me}] {text}"),
                VlanEvent::Error(text) => println!("[{me}] ERROR {text}"),
                VlanEvent::Peer(p) => println!("[{me}] peer {} -> {:?}", p.id, p.state),
                VlanEvent::Started => println!("[{me}] started"),
                VlanEvent::Stopped => println!("[{me}] stopped"),
            }
        }
    });
    engine
}

async fn wait_connected(engine: &VlanEngine, peer: &str) {
    let start = Instant::now();
    loop {
        let st = engine.status().await;
        if st
            .peers
            .iter()
            .any(|p| p.id == peer && p.state == PeerState::Connected)
        {
            return;
        }
        assert!(
            start.elapsed() < ICE_WAIT,
            "等待对端 {peer} 连通超时（{}s），当前状态: {:?}",
            ICE_WAIT.as_secs(),
            st.peers
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "需要管理员权限创建 Wintun 适配器"]
async fn wintun_and_ice_mesh_end_to_end() {
    let _ = env_logger::builder().is_test(false).try_init();

    // 真实网卡
    let mut cfg = TunConfig::new(VIP_A);
    cfg.name = ADAPTER.to_string();
    cfg.wintun_dll = wintun_dll();
    let tun_a = match open_tun(&cfg) {
        Ok(t) => t,
        Err(e) => panic!("打开 Wintun 网卡失败: {e}"),
    };
    assert!(adapter_listed(ADAPTER), "Get-NetAdapter 里应能看到 {ADAPTER}");
    // 给系统一点时间把地址/路由装好
    tokio::time::sleep(Duration::from_millis(1500)).await;

    let (tun_b, mut host_b) = mem_tun(64);
    let dir: Directory = Arc::default();
    let a = spawn_engine("a", VIP_A, tun_a, &dir);
    let b = spawn_engine("b", VIP_B, tun_b, &dir);

    // (1) 双方连通
    wait_connected(&a, "b").await;
    wait_connected(&b, "a").await;
    println!("=== (1) A/B 已连通 ===");

    // (2) 本机套接字 10.77.0.2 → 10.77.0.3:24642
    // Windows 在网卡创建后需要数秒才把地址配置为可用（DAD 期间为 tentative），绑定失败时重试
    let bind_deadline = Instant::now() + Duration::from_secs(20);
    let sock = loop {
        match tokio::net::UdpSocket::bind(SocketAddrV4::new(VIP_A, 0)).await {
            Ok(s) => break s,
            Err(e) if Instant::now() < bind_deadline => {
                println!("绑定 {VIP_A}:0 暂未就绪（{e}），500ms 后重试");
                tokio::time::sleep(Duration::from_millis(500)).await;
            }
            Err(e) => panic!("20s 内绑定 {VIP_A}:0 始终失败（网卡地址未就绪？）: {e}"),
        }
    };
    let src_port = match sock.local_addr() {
        Ok(std::net::SocketAddr::V4(v4)) => v4.port(),
        other => panic!("本机套接字地址异常: {other:?}"),
    };
    let payload: Vec<u8> = (0..100u8).collect();
    let deadline = Instant::now() + PKT_WAIT;
    // 第一个包可能在系统路由/邻居就绪前丢失，按 250ms 间隔重发直到 B 收到
    let got = loop {
        sock.send_to(&payload, SocketAddrV4::new(VIP_B, GAME_PORT))
            .await
            .expect("向 10.77.0.3 发送 UDP 失败");
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            panic!("{}s 内 B 未收到本机发往 {VIP_B}:{GAME_PORT} 的 UDP 包", PKT_WAIT.as_secs());
        }
        match host_b.next(Duration::from_millis(250).min(left)).await {
            Some(pkt)
                if pkt.len() >= 28
                    && pkt[9] == 17
                    && ipv4_dst(&pkt) == Some(VIP_B)
                    && u16::from_be_bytes([pkt[22], pkt[23]]) == GAME_PORT
                    && pkt.ends_with(&payload) =>
            {
                break pkt;
            }
            _ => continue,
        }
    };
    assert_eq!(ipv4_src(&got), Some(VIP_A), "源地址应为 A 的 vip");
    assert_eq!(u16::from_be_bytes([got[20], got[21]]), src_port, "源端口应等于本机套接字端口");
    assert_eq!(&got[28..], &payload[..], "载荷应原样到达");
    println!("=== (2) 本机 → TUN → ICE → B 内存网卡 OK（源端口 {src_port}）===");

    // (3) 反向：B 内存网卡注入 10.77.0.3:24642 → 10.77.0.2:src_port，本机套接字应收到
    let reply = b"reply-from-b-over-vlan";
    let pkt = build_ipv4_udp(VIP_B, VIP_A, GAME_PORT, src_port, reply);
    let mut buf = [0u8; 2048];
    let deadline = Instant::now() + PKT_WAIT;
    let mut delivered = false;
    while !delivered {
        host_b.inject(&pkt).await.expect("注入 B 内存网卡失败");
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            break;
        }
        match tokio::time::timeout(Duration::from_millis(500).min(left), sock.recv_from(&mut buf)).await {
            Ok(Ok((n, from))) => {
                assert_eq!(&buf[..n], &reply[..], "本机套接字收到的载荷应等于注入的载荷");
                assert_eq!(from, std::net::SocketAddr::V4(SocketAddrV4::new(VIP_B, GAME_PORT)));
                delivered = true;
            }
            Ok(Err(e)) => panic!("本机套接字接收失败: {e}"),
            Err(_) => {}
        }
    }
    assert!(
        delivered,
        "{}s 内本机套接字未收到经 B → ICE → A 的 TUN 写入 Windows 协议栈的 UDP 包（检查 Windows 防火墙对本测试程序的入站 UDP 放行）",
        PKT_WAIT.as_secs()
    );
    // 顺带确认一路的计数器
    let st = a.status().await;
    let pb = st.peers.iter().find(|p| p.id == "b").expect("peer b");
    assert!(pb.tx_bytes > 0 && pb.rx_bytes > 0, "A 的收发计数器应有增长: {pb:?}");
    println!("=== (3) B 内存网卡 → ICE → A 的 TUN → 本机套接字 OK ===");

    // (4) 停止并确认网卡被移除
    a.stop().await;
    b.stop().await;
    dir.lock().expect("dir").clear();
    drop(sock);
    drop(a);
    drop(b);
    let deadline = Instant::now() + Duration::from_secs(10);
    while adapter_listed(ADAPTER) {
        assert!(
            Instant::now() < deadline,
            "停止后 10s 内网卡 {ADAPTER} 仍然存在"
        );
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    println!("=== (4) 网卡 {ADAPTER} 已移除 ===");
}
