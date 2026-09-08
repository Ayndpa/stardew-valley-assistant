//! 真实提权辅助进程端到端：拉起已构建的桌面应用 exe（辅助模式，未提权时会弹一次 UAC），
//! 经管道执行 start / status / stop / shutdown，其间引擎在辅助进程里打开真实 Wintun 网卡。
//!
//! 用法：`cargo run --example helper_e2e [-- <exe 路径> [<wintun.dll 路径>]]`
//! 默认 exe：../desktop-app/src-tauri/target/debug/stardew-valley-assistant.exe，
//! 默认 dll：../desktop-app/src-tauri/resources/wintun.dll。

#[cfg(windows)]
fn main() -> anyhow::Result<()> {
    use std::net::Ipv4Addr;
    use std::path::PathBuf;
    use std::time::Duration;

    use p2p_vlan::elevation::{is_elevated, launch_helper};
    use p2p_vlan::helper::{HelperClient, HelperEventKind};
    use p2p_vlan::MemberInfo;

    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let mut args = std::env::args().skip(1);
    let exe = args
        .next()
        .map(PathBuf::from)
        .unwrap_or_else(|| root.join("../desktop-app/src-tauri/target/debug/stardew-valley-assistant.exe"));
    let dll = args
        .next()
        .map(PathBuf::from)
        .unwrap_or_else(|| root.join("../desktop-app/src-tauri/resources/wintun.dll"));
    anyhow::ensure!(exe.is_file(), "找不到应用 exe: {}", exe.display());
    anyhow::ensure!(dll.is_file(), "找不到 wintun.dll: {}", dll.display());
    let exe = exe.canonicalize()?;
    let dll = dll.canonicalize()?;

    let rt = tokio::runtime::Builder::new_multi_thread().enable_all().build()?;
    rt.block_on(async move {
        let elevated = is_elevated();
        println!("本进程已提权: {elevated}");
        let pipe = HelperClient::new_pipe_name();
        let token = HelperClient::new_token();
        println!("管道: {pipe}\n拉起辅助进程: {}（elevate={}）", exe.display(), !elevated);
        if !elevated {
            println!(">>> 请在 UAC 提示中点击「是」<<<");
        }
        let (exe2, dll2) = (exe.clone(), dll.clone());
        let (client, mut events) = HelperClient::spawn(&pipe, &token, move |p, t| {
            launch_helper(&exe2, &p, &t, &dll2, !elevated)
        })
        .await?;
        println!("辅助进程已连接并通过 hello 校验");

        let printer = tokio::spawn(async move {
            while let Some(ev) = events.recv().await {
                match ev.kind {
                    HelperEventKind::Log => println!("  [helper] {}", ev.text.unwrap_or_default()),
                    HelperEventKind::SignalOut => println!(
                        "  [helper] signal_out → {} kind={}",
                        ev.to.unwrap_or_default(),
                        ev.data.and_then(|d| d.get("kind").and_then(|k| k.as_str().map(String::from))).unwrap_or_default()
                    ),
                    other => println!("  [helper] {other:?} {:?}{}", ev.peer, ev.text.map(|t| format!(" {t}")).unwrap_or_default()),
                }
            }
        });

        let st = client.status().await?;
        println!("status(未启动): running={}", st.running);

        let members = vec![
            MemberInfo { id: "a".into(), vip: Ipv4Addr::new(10, 77, 0, 2) },
            MemberInfo { id: "b".into(), vip: Ipv4Addr::new(10, 77, 0, 3) },
        ];
        let st = client.start("a".into(), Ipv4Addr::new(10, 77, 0, 2), members).await?;
        println!("start → running={} vip={:?} peers={:?}", st.running, st.vip, st.peers.iter().map(|p| (&p.id, p.state)).collect::<Vec<_>>());

        let listed = std::process::Command::new("powershell")
            .args(["-NoProfile", "-Command", "(Get-NetAdapter -Name 'StardewVLAN' -ErrorAction SilentlyContinue).Status"])
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_default();
        println!("Get-NetAdapter StardewVLAN: {}", if listed.is_empty() { "<未找到>".to_string() } else { listed });

        tokio::time::sleep(Duration::from_secs(2)).await;
        let st = client.status().await?;
        println!("status(运行中): running={} peers={:?}", st.running, st.peers.iter().map(|p| (&p.id, p.state)).collect::<Vec<_>>());

        client.stop().await?;
        let st = client.status().await?;
        println!("stop → running={}", st.running);
        client.shutdown().await;
        println!("shutdown → alive={}", client.is_alive());
        let _ = tokio::time::timeout(Duration::from_secs(2), printer).await;

        let listed = std::process::Command::new("powershell")
            .args(["-NoProfile", "-Command", "(Get-NetAdapter -Name 'StardewVLAN' -ErrorAction SilentlyContinue).Name"])
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_default();
        println!("退出后 Get-NetAdapter StardewVLAN: {}", if listed.is_empty() { "<已移除>".to_string() } else { listed });
        Ok::<(), anyhow::Error>(())
    })
}

#[cfg(not(windows))]
fn main() {
    eprintln!("此示例仅支持 Windows");
}
