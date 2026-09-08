//! 辅助进程协议的进程内测试：`serve_with`（内存网卡）与 `HelperClient` 经真实命名管道对话。
//! 无需管理员权限。

#![cfg(windows)]

use std::net::Ipv4Addr;
use std::sync::Arc;
use std::time::Duration;

use p2p_vlan::helper::{serve_with, HelperClient, HelperEvent, HelperEventKind, ServeOptions};
use p2p_vlan::mem::mem_tun;
use p2p_vlan::{IceConfig, MemberInfo, PeerState, TunIo};
use tokio::sync::mpsc;

fn member(id: &str, last: u8) -> MemberInfo {
    MemberInfo {
        id: id.to_string(),
        vip: Ipv4Addr::new(10, 77, 0, last),
    }
}

/// 在本进程内以 `token` 启动辅助端（内存网卡 + 无 STUN、仅回环候选）
fn serve_options(pipe: &str, token: &str) -> ServeOptions {
    ServeOptions {
        pipe_name: pipe.to_string(),
        token: token.to_string(),
        wintun_dll: None,
        tun_factory: Some(Arc::new(|_cfg| {
            let (tun, host) = mem_tun(16);
            // 测试里不需要"操作系统"一侧，握住它以免通道关闭
            std::mem::forget(host);
            Ok(Box::new(tun) as Box<dyn TunIo>)
        })),
        ice_factory: Some(Arc::new(|_cfg| IceConfig {
            stun_urls: Vec::new(),
            firewall_probe: false,
            ip_filter: Some(Arc::new(|ip| ip.is_loopback())),
            interface_filter: None,
        })),
    }
}

async fn next_event_of(rx: &mut mpsc::Receiver<HelperEvent>, kind: HelperEventKind) -> HelperEvent {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(20);
    loop {
        let left = deadline.saturating_duration_since(tokio::time::Instant::now());
        match tokio::time::timeout(left, rx.recv()).await {
            Ok(Some(ev)) if ev.kind == kind => return ev,
            Ok(Some(ev)) => println!("event: {ev:?}"),
            Ok(None) => panic!("事件通道已关闭，未等到 {kind:?}"),
            Err(_) => panic!("20s 内未等到事件 {kind:?}"),
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn hello_start_status_stop_roundtrip() {
    let pipe = HelperClient::new_pipe_name();
    let token = HelperClient::new_token();
    let opts_pipe = pipe.clone();
    let opts_token = token.clone();
    let serve_task = Arc::new(std::sync::Mutex::new(None));
    let serve_slot = Arc::clone(&serve_task);
    let (client, mut events) = HelperClient::spawn(&pipe, &token, move |p, t| {
        assert_eq!((p.as_str(), t.as_str()), (opts_pipe.as_str(), opts_token.as_str()));
        let h = tokio::spawn(serve_with(serve_options(&p, &t)));
        *serve_slot.lock().expect("slot") = Some(h);
        Ok(())
    })
    .await
    .expect("spawn helper client");
    assert!(client.is_alive());

    // 未 start 时 status 为停止态
    let st = client.status().await.expect("status");
    assert!(!st.running && st.vip.is_none());

    // start：本机 a，成员还有 b（不会真的连上，但会发握手事件）
    let st = client
        .start("a".into(), Ipv4Addr::new(10, 77, 0, 2), vec![member("a", 2), member("b", 3)])
        .await
        .expect("start");
    assert!(st.running);
    assert_eq!(st.vip, Some(Ipv4Addr::new(10, 77, 0, 2)));
    assert_eq!(st.peers.len(), 1);
    assert_eq!(st.peers[0].id, "b");

    // 事件传播：started、peer(connecting)、signal_out（握手）
    next_event_of(&mut events, HelperEventKind::Started).await;
    let peer = next_event_of(&mut events, HelperEventKind::Peer).await;
    assert_eq!(peer.peer.as_ref().map(|p| p.state), Some(PeerState::Connecting));
    let sig = next_event_of(&mut events, HelperEventKind::SignalOut).await;
    assert_eq!(sig.to.as_deref(), Some("b"));
    assert_eq!(
        sig.data.as_ref().and_then(|d| d.get("kind")).and_then(|k| k.as_str()),
        Some("vlan-handshake")
    );

    // update_members：加 c 去 b
    client
        .update_members(vec![member("a", 2), member("c", 4)])
        .await
        .expect("update_members");
    let st = client.status().await.expect("status");
    assert_eq!(st.peers.iter().map(|p| p.id.as_str()).collect::<Vec<_>>(), vec!["c"]);

    // signal_in：一条 bye 让 c 变 disconnected
    client
        .signal_in("c".into(), serde_json::json!({"kind": "vlan-bye"}))
        .await
        .expect("signal_in");
    let st = client.status().await.expect("status");
    assert_eq!(st.peers[0].state, PeerState::Disconnected);

    // stop → 停止态，并收到 stopped 事件
    client.stop().await.expect("stop");
    next_event_of(&mut events, HelperEventKind::Stopped).await;
    let st = client.status().await.expect("status");
    assert!(!st.running);

    // shutdown → 辅助端 serve 正常返回
    client.shutdown().await;
    assert!(!client.is_alive());
    let h = serve_task.lock().expect("slot").take().expect("serve task");
    let r = tokio::time::timeout(Duration::from_secs(5), h)
        .await
        .expect("serve 应在 shutdown 后退出")
        .expect("serve task join");
    assert!(r.is_ok(), "serve 应正常返回: {r:?}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn bad_token_is_rejected() {
    let pipe = HelperClient::new_pipe_name();
    let token = HelperClient::new_token();
    let serve_task = Arc::new(std::sync::Mutex::new(None));
    let serve_slot = Arc::clone(&serve_task);
    let err = match HelperClient::spawn(&pipe, &token, move |p, _t| {
        let h = tokio::spawn(serve_with(serve_options(&p, "wrong-token")));
        *serve_slot.lock().expect("slot") = Some(h);
        Ok(())
    })
    .await
    {
        Ok(_) => panic!("错误的 token 不应通过握手"),
        Err(e) => e.to_string(),
    };
    assert!(err.contains("token"), "错误信息应提到 token: {err}");
    // 辅助端应因管道断开而退出
    let h = serve_task.lock().expect("slot").take().expect("serve task");
    let _ = tokio::time::timeout(Duration::from_secs(5), h)
        .await
        .expect("serve 应在管道断开后退出");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn launch_failure_propagates() {
    let pipe = HelperClient::new_pipe_name();
    let err = HelperClient::spawn(&pipe, "t", |_p, _t| Err(anyhow::anyhow!("未获得管理员权限：测试")))
        .await
        .err()
        .expect("launch 失败应传播")
        .to_string();
    assert!(err.starts_with("未获得管理员权限"), "{err}");
}
