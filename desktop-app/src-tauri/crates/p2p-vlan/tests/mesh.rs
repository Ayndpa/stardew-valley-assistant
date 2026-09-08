//! 进程内多节点网状网络测试：内存网卡 + 把 `SignalOut` 在引擎之间搬运的信令垫片。
//! ICE 不用 STUN，仅靠回环候选即可在同一进程内打通。

use std::collections::HashMap;
use std::net::Ipv4Addr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use p2p_vlan::mem::{mem_tun, MemTunHost};
use p2p_vlan::packet::build_ipv4_udp;
use p2p_vlan::{IceConfig, MemberInfo, PeerState, PeerStatus, VlanEngine, VlanEvent};
use tokio::sync::mpsc;

const CONNECT_WAIT: Duration = Duration::from_secs(40);
const PKT_WAIT: Duration = Duration::from_secs(5);

/// 一次性记录：信令流水 (from, to, kind) 与全部 Peer 事件
#[derive(Default)]
struct Trace {
    signals: Vec<(String, String, String)>,
    peers: Vec<(String, PeerStatus)>,
}

type SharedTrace = Arc<Mutex<Trace>>;
type Directory = Arc<Mutex<HashMap<String, Arc<VlanEngine>>>>;

struct Node {
    id: String,
    engine: Arc<VlanEngine>,
    host: MemTunHost,
}

/// 不用 STUN，且只收集回环地址：本机上的代理/虚拟网卡地址会让 webrtc-ice 的提名卡死
fn ice() -> IceConfig {
    IceConfig {
        stun_urls: Vec::new(),
        firewall_probe: false,
        ip_filter: Some(Arc::new(|ip| ip.is_loopback())),
        interface_filter: None,
    }
}

fn member(id: &str, last: u8) -> MemberInfo {
    MemberInfo {
        id: id.to_string(),
        vip: Ipv4Addr::new(10, 77, 0, last),
    }
}

/// 启动一个节点，并挂上信令垫片：把它的 SignalOut 交给目录里的目标引擎
fn spawn_node(id: &str, last: u8, members: Vec<MemberInfo>, dir: &Directory, trace: &SharedTrace) -> Node {
    let (tun, host) = mem_tun(64);
    let (tx, mut rx) = mpsc::channel(256);
    let engine = VlanEngine::start(
        id.to_string(),
        Ipv4Addr::new(10, 77, 0, last),
        members,
        tun,
        ice(),
        tx,
    );
    dir.lock().expect("dir").insert(id.to_string(), Arc::clone(&engine));

    let me = id.to_string();
    let dir = Arc::clone(dir);
    let trace = Arc::clone(trace);
    tokio::spawn(async move {
        while let Some(ev) = rx.recv().await {
            match ev {
                VlanEvent::SignalOut { to, data } => {
                    let kind = data
                        .get("kind")
                        .and_then(|k| k.as_str())
                        .unwrap_or("")
                        .to_string();
                    trace
                        .lock()
                        .expect("trace")
                        .signals
                        .push((me.clone(), to.clone(), kind));
                    let target = dir.lock().expect("dir").get(&to).cloned();
                    if let Some(target) = target {
                        target.signal_in(&me, data).await;
                    }
                }
                VlanEvent::Peer(p) => {
                    trace.lock().expect("trace").peers.push((me.clone(), p));
                }
                VlanEvent::Log(text) => println!("[{me}] {text}"),
                VlanEvent::Error(text) => println!("[{me}] ERROR {text}"),
                VlanEvent::Started => println!("[{me}] started"),
                VlanEvent::Stopped => println!("[{me}] stopped"),
            }
        }
    });

    Node {
        id: id.to_string(),
        engine,
        host,
    }
}

/// 轮询状态直到某对端达到目标状态
async fn wait_state(engine: &VlanEngine, peer: &str, want: PeerState, timeout: Duration) {
    let start = Instant::now();
    loop {
        let st = engine.status().await;
        if let Some(p) = st.peers.iter().find(|p| p.id == peer) {
            if p.state == want {
                return;
            }
        }
        assert!(
            start.elapsed() < timeout,
            "等待 {peer} 进入 {want:?} 超时，当前: {:?}",
            st.peers
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

async fn wait_all_connected(nodes: &[&Node]) {
    for n in nodes {
        for m in nodes {
            if n.id != m.id {
                wait_state(&n.engine, &m.id, PeerState::Connected, CONNECT_WAIT).await;
            }
        }
    }
}

/// 从 host 读包直到拿到一个等于 `want` 的（跳过其他包），超时返回 None
async fn recv_exact(host: &mut MemTunHost, want: &[u8]) -> Option<Vec<u8>> {
    let deadline = Instant::now() + PKT_WAIT;
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            return None;
        }
        let pkt = host.next(left).await?;
        if pkt == want {
            return Some(pkt);
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn two_node_mesh_end_to_end() {
    let _ = env_logger::builder().is_test(false).try_init();
    let dir: Directory = Arc::default();
    let trace: SharedTrace = Arc::default();
    let members = vec![member("a", 2), member("b", 3)];
    let mut a = spawn_node("a", 2, members.clone(), &dir, &trace);
    let mut b = spawn_node("b", 3, members.clone(), &dir, &trace);

    // (a) 双方连通
    wait_all_connected(&[&a, &b]).await;
    let st = a.engine.status().await;
    assert!(st.running);
    assert_eq!(st.vip, Some(Ipv4Addr::new(10, 77, 0, 2)));
    assert_eq!(st.subnet, "10.77.0.0/24");
    assert_eq!(st.mtu, 1280);

    // (b) 单播 A → B 原样到达
    let pkt = build_ipv4_udp(a.engine.vip(), b.engine.vip(), 4000, 24642, b"hello stardew");
    a.host.inject(&pkt).await.expect("inject");
    let got = recv_exact(&mut b.host, &pkt).await.expect("B 应收到 A 的单播包");
    assert_eq!(got, pkt);

    // 反向也通
    let back = build_ipv4_udp(b.engine.vip(), a.engine.vip(), 24642, 4000, b"pong");
    b.host.inject(&back).await.expect("inject");
    assert!(recv_exact(&mut a.host, &back).await.is_some(), "A 应收到 B 的回包");

    // (c) 子网广播到达
    let bcast = build_ipv4_udp(a.engine.vip(), Ipv4Addr::new(10, 77, 0, 255), 4000, 24642, b"anyone?");
    a.host.inject(&bcast).await.expect("inject");
    assert!(recv_exact(&mut b.host, &bcast).await.is_some(), "B 应收到广播包");
    let limited = build_ipv4_udp(a.engine.vip(), Ipv4Addr::new(255, 255, 255, 255), 4000, 24642, b"all");
    a.host.inject(&limited).await.expect("inject");
    assert!(recv_exact(&mut b.host, &limited).await.is_some(), "B 应收到受限广播包");

    // 丢弃规则：IPv6 / 超长 / 未知目的地址 都不会到达 B
    let mut v6 = pkt.clone();
    v6[0] = 0x60;
    a.host.inject(&v6).await.expect("inject");
    let big = build_ipv4_udp(a.engine.vip(), b.engine.vip(), 1, 2, &vec![7u8; 1400]);
    a.host.inject(&big).await.expect("inject");
    let unknown = build_ipv4_udp(a.engine.vip(), Ipv4Addr::new(10, 77, 0, 200), 1, 2, b"nobody");
    a.host.inject(&unknown).await.expect("inject");
    // 用一个合法包做"哨兵"：它到达时前面三个若被转发也早该到了
    let sentinel = build_ipv4_udp(a.engine.vip(), b.engine.vip(), 1, 2, b"sentinel");
    a.host.inject(&sentinel).await.expect("inject");
    let mut seen = Vec::new();
    loop {
        let p = b.host.next(PKT_WAIT).await.expect("哨兵包应到达");
        let done = p == sentinel;
        seen.push(p);
        if done {
            break;
        }
    }
    assert_eq!(seen.len(), 1, "只有哨兵包应到达，实际收到 {} 个", seen.len());

    // 计数器
    let st = a.engine.status().await;
    let pb = st.peers.iter().find(|p| p.id == "b").expect("peer b");
    assert!(pb.tx_bytes > 0 && pb.rx_bytes > 0, "计数器应有增长: {pb:?}");

    // (e) A 的成员列表里去掉 B → A 侧 B 变为 Disconnected 并释放
    a.engine.update_members(vec![member("a", 2)]).await;
    tokio::time::sleep(Duration::from_millis(200)).await;
    {
        let t = trace.lock().expect("trace");
        assert!(
            t.peers.iter().any(|(who, p)| who == "a" && p.id == "b" && p.state == PeerState::Disconnected),
            "A 应上报 B Disconnected: {:?}",
            t.peers
        );
    }
    assert!(a.engine.status().await.peers.iter().all(|p| p.id != "b"), "B 应从 A 的对端表中释放");
    // 加回来 → 重新协商并连通（B 侧因 A 的新握手而重启配对）
    a.engine.update_members(members.clone()).await;
    wait_all_connected(&[&a, &b]).await;

    // (f) A stop → 向 B 发 vlan-bye，B 侧 A 变为 Disconnected
    a.engine.stop().await;
    a.engine.stop().await; // 幂等
    assert!(!a.engine.status().await.running);
    wait_state(&b.engine, "a", PeerState::Disconnected, Duration::from_secs(5)).await;
    {
        let t = trace.lock().expect("trace");
        assert!(
            t.signals.iter().any(|(f, to, k)| f == "a" && to == "b" && k == "vlan-bye"),
            "A 停止时应向 B 发送 vlan-bye: {:?}",
            t.signals
        );
        assert!(t.signals.iter().any(|(f, _, k)| f == "a" && k == "vlan-handshake"));
    }
    b.engine.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn three_node_mesh() {
    let dir: Directory = Arc::default();
    let trace: SharedTrace = Arc::default();
    let members = vec![member("a", 2), member("b", 3), member("c", 4)];
    let mut a = spawn_node("a", 2, members.clone(), &dir, &trace);
    let mut b = spawn_node("b", 3, members.clone(), &dir, &trace);
    let mut c = spawn_node("c", 4, members.clone(), &dir, &trace);

    wait_all_connected(&[&a, &b, &c]).await;
    for n in [&a, &b, &c] {
        let st = n.engine.status().await;
        assert_eq!(st.peers.len(), 2, "{} 应有两个对端: {:?}", n.id, st.peers);
    }

    // A → C 单播、A 广播到 B 与 C
    let pkt = build_ipv4_udp(a.engine.vip(), c.engine.vip(), 1, 2, b"a->c");
    a.host.inject(&pkt).await.expect("inject");
    assert!(recv_exact(&mut c.host, &pkt).await.is_some(), "C 应收到 A 的单播包");

    let bcast = build_ipv4_udp(c.engine.vip(), Ipv4Addr::new(10, 77, 0, 255), 1, 2, b"c broadcast");
    c.host.inject(&bcast).await.expect("inject");
    assert!(recv_exact(&mut a.host, &bcast).await.is_some(), "A 应收到 C 的广播");
    assert!(recv_exact(&mut b.host, &bcast).await.is_some(), "B 应收到 C 的广播");

    // 后加入的成员：D 启动时 A/B/C 还不知道它，握手先到、成员列表后到（暂存握手路径）
    let mut all = members.clone();
    all.push(member("d", 5));
    let d = spawn_node("d", 5, all.clone(), &dir, &trace);
    tokio::time::sleep(Duration::from_millis(300)).await;
    for n in [&a, &c] {
        n.engine.update_members(all.clone()).await;
    }
    b.engine.update_members(all.clone()).await;
    wait_state(&d.engine, "a", PeerState::Connected, CONNECT_WAIT).await;
    wait_state(&a.engine, "d", PeerState::Connected, CONNECT_WAIT).await;
    wait_state(&d.engine, "c", PeerState::Connected, CONNECT_WAIT).await;

    for n in [&a, &b, &c, &d] {
        n.engine.stop().await;
    }
}
