//! P2P ICE 双人聊天 CLI：库（lib.rs）之上的薄壳——参数解析、事件打印、stdin 转发。

use std::io::{IsTerminal, Write as _};
use std::process::exit;

use anyhow::{anyhow, bail, Result};
use p2p_ice_chat::{ConnectOptions, P2pEvent, P2pEventKind, Role, Session, DEFAULT_STUN_URL};
use tokio::io::AsyncBufReadExt as _;
use tokio::sync::{mpsc, watch};

/// println + 立即 flush（stdout 重定向到文件时是块缓冲，不 flush 看不到进度）
macro_rules! outln {
    ($($arg:tt)*) => {{
        println!($($arg)*);
        let _ = std::io::Write::flush(&mut std::io::stdout());
    }};
}

struct Opts {
    name: String,
    stuns: Vec<String>,
    no_stun: bool,
    server: String,
    room: Option<String>,
}

fn print_help() {
    outln!(
        "P2P ICE 双人聊天 —— 基于 webrtc-ice 的纯 CLI 交互式聊天

用法:
  cargo run -- --server <信令服务器> [--room <房间号>] [选项]

两端连接同一台信令服务器、以相同房间号入房即可自动配对；
角色由服务器按入房顺序分配（先到 offer，后到 answer）。
服务器只负责交换握手信息，聊天数据完全 P2P 直连、不经服务器。

选项:
  --server <url>  信令服务器地址（必填），如 ws://192.168.1.10:9877/ws（支持 wss://）
  --room <房间号> 房间号（3~32 位字母/数字/下划线/连字符，不区分大小写）
                  省略则由服务器随机分配 6 位房间号，把分配到的号告诉对方即可
  --stun <url>    追加 STUN 服务器（默认已含 Google 公共 STUN，跨局域网时使用）
  --no-stun       禁用 STUN，仅收集本机候选地址（局域网/本机联机更快）
  --name <名字>   自己的显示名（默认: 发起方/应答方）
  -h, --help      显示本帮助

调试:
  RUST_LOG=debug cargo run -- ...   # 打印 ICE 候选配对详细过程

聊天命令:
  /quit           退出（Ctrl-C 亦可）"
    );
}

fn parse_args() -> Result<Opts> {
    let mut o = Opts {
        name: String::new(),
        stuns: vec![DEFAULT_STUN_URL.to_string()],
        no_stun: false,
        server: String::new(),
        room: None,
    };
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--server" => {
                o.server = args.next().ok_or_else(|| {
                    anyhow!("--server 需要一个参数，如 --server ws://192.168.1.10:9877/ws")
                })?
            }
            "--room" => o.room = Some(args.next().ok_or_else(|| anyhow!("--room 需要一个参数"))?),
            "--stun" => o
                .stuns
                .push(args.next().ok_or_else(|| anyhow!("--stun 需要一个参数，如 --stun stun:stun.l.google.com:19302"))?),
            "--no-stun" => o.no_stun = true,
            "--name" => o.name = args.next().ok_or_else(|| anyhow!("--name 需要一个参数"))?,
            "-h" | "--help" => {
                print_help();
                exit(0);
            }
            other => bail!("未知参数: {other}（--help 查看用法）"),
        }
    }
    if o.no_stun {
        o.stuns.clear();
    }
    if o.server.is_empty() {
        bail!("缺少 --server 参数（信令服务器地址，如 --server ws://192.168.1.10:9877/ws）");
    }
    Ok(o)
}

/// 后台任务持续读取 stdin，按行转发到 channel；EOF 后 channel 关闭
fn spawn_stdin_reader() -> mpsc::Receiver<String> {
    let (tx, rx) = mpsc::channel::<String>(64);
    tokio::spawn(async move {
        let mut lines = tokio::io::BufReader::new(tokio::io::stdin()).lines();
        loop {
            match lines.next_line().await {
                Ok(Some(l)) => {
                    if tx.send(l).await.is_err() {
                        break;
                    }
                }
                _ => break,
            }
        }
    });
    rx
}

fn prompt(s: &str) {
    print!("{s}");
    let _ = std::io::stdout().flush();
}

/// 后台任务把库事件打印到 stdout；收到 closed 时通过 watch 通知主循环退出
fn spawn_event_printer(
    mut rx: mpsc::Receiver<P2pEvent>,
    server: String,
    room_given: bool,
) -> watch::Receiver<bool> {
    let (closed_tx, closed_rx) = watch::channel(false);
    tokio::spawn(async move {
        while let Some(ev) = rx.recv().await {
            let text = ev.text.unwrap_or_default();
            match ev.kind {
                P2pEventKind::Status => {
                    let room = ev.room.unwrap_or_default();
                    let role = ev
                        .role
                        .as_deref()
                        .and_then(|r| Role::from_server(r).ok())
                        .map(Role::label)
                        .unwrap_or("未知");
                    outln!("房间号: {room}    你的角色: {role}");
                    if !room_given {
                        outln!("    服务器已随机分配房间号，请让对方执行:");
                        outln!("    cargo run -- --server {server} --room {room}");
                    }
                    outln!("    {text}");
                }
                P2pEventKind::Log => outln!("{text}"),
                P2pEventKind::Connected => {
                    outln!(
                        "\n=== P2P 已建立（对方: {}）！输入消息回车发送，/quit 退出 ===\n",
                        ev.peer.unwrap_or_default()
                    );
                }
                P2pEventKind::Message => {
                    outln!("\n[{}] {text}", ev.peer.unwrap_or_else(|| "对方".to_string()));
                }
                P2pEventKind::Error => outln!("\n[!] {text}"),
                P2pEventKind::Closed => {
                    let _ = closed_tx.send(true);
                    break;
                }
            }
        }
    });
    closed_rx
}

/// 聊天主循环：stdin -> 发送；closed / Ctrl-C -> 退出
async fn chat_loop(
    session: &Session,
    mut stdin_rx: mpsc::Receiver<String>,
    mut closed_rx: watch::Receiver<bool>,
) -> Result<()> {
    let tty = std::io::stdout().is_terminal();
    let mut stdin_open = true;
    loop {
        if tty && stdin_open {
            prompt("你> ");
        }
        tokio::select! {
            line = stdin_rx.recv(), if stdin_open => match line {
                Some(l) => {
                    let l = l.trim();
                    if l.is_empty() {
                        continue;
                    }
                    if l == "/quit" || l == "/q" {
                        outln!("\n[退出]");
                        break;
                    }
                    let msg = p2p_ice_chat::truncate_msg(l);
                    session.send(msg).await?;
                    outln!("[我] {msg}");
                }
                None => stdin_open = false,
            },
            _ = closed_rx.changed() => {
                // 接收循环已结束（对端断开 / ICE 异常），错误文本已由打印任务输出
                return Ok(());
            }
            _ = tokio::signal::ctrl_c() => {
                outln!("\n[退出]");
                break;
            }
        }
    }
    session.close().await;
    // 等接收循环发出 closed，确保 Agent 已关闭
    let _ = closed_rx.changed().await;
    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {
    env_logger::init();
    let opts = parse_args()?;
    let stdin_rx = spawn_stdin_reader();

    let (ev_tx, ev_rx) = mpsc::channel::<P2pEvent>(64);
    let closed_rx = spawn_event_printer(ev_rx, opts.server.clone(), opts.room.is_some());

    let connect_opts = ConnectOptions {
        server: opts.server.clone(),
        room: opts.room.clone().unwrap_or_default(),
        name: opts.name.clone(),
        stun_urls: opts.stuns.clone(),
        firewall_probe: true,
    };
    let session = p2p_ice_chat::connect(connect_opts, ev_tx).await?;
    chat_loop(&session, stdin_rx, closed_rx).await?;
    outln!("已退出。");
    Ok(())
}
