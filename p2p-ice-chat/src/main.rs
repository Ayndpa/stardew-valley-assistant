use std::io::{IsTerminal, Write as _};
use std::process::exit;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, bail, ensure, Context, Result};
use serde::{Deserialize, Serialize};
use tokio::io::AsyncBufReadExt as _;
use tokio::sync::{mpsc, watch};
use webrtc_ice::agent::agent_config::AgentConfig;
use webrtc_ice::agent::Agent;
use webrtc_ice::candidate::candidate_base::unmarshal_candidate;
use webrtc_ice::candidate::Candidate;
use webrtc_ice::mdns::MulticastDnsMode;
use webrtc_ice::network_type::NetworkType;
use webrtc_ice::state::ConnectionState;
use webrtc_ice::udp_network::UDPNetwork;
use webrtc_ice::url::Url;
use webrtc_ice::Error as IceError;
use webrtc_util::conn::Conn;

mod signaling;

use signaling::{Role, SigEvent};

const GATHER_TIMEOUT: Duration = Duration::from_secs(20);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(90);
const MAX_MSG_BYTES: usize = 1200;

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

/// 复制粘贴用的握手信息：用户名/密码 + 全部候选地址
#[derive(Serialize, Deserialize)]
struct Handshake {
    u: String,
    p: String,
    c: Vec<String>,
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
        stuns: vec!["stun:stun.l.google.com:19302".to_string()],
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

/// 后台线程持续读取 stdin，按行转发到 channel；EOF 后 channel 关闭
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

/// 信令模式下等待对端握手信息：过滤 peer-joined 等通知，收到合法 Handshake 即返回。
/// 拿到后立即与服务器告别——后续 ICE 协商与聊天不再需要中心服务器。
async fn wait_peer_handshake(mut sess: signaling::Session) -> Result<Handshake> {
    let hs = loop {
        match sess.recv_event().await {
            Some(SigEvent::Signal(v)) => match serde_json::from_value::<Handshake>(v) {
                Ok(h) if !h.u.is_empty() && !h.p.is_empty() && !h.c.is_empty() => break h,
                Ok(_) => outln!("    （收到不完整的信令数据，继续等待…）"),
                Err(e) => outln!("    （对方信令数据无法解析，继续等待…: {e}）"),
            },
            Some(SigEvent::PeerJoined(name)) => {
                if name.is_empty() {
                    outln!("    对方已加入房间");
                } else {
                    outln!("    对方已加入房间: {name}");
                }
            }
            Some(SigEvent::PeerLeft) => bail!("对方已离开房间，未完成握手"),
            Some(SigEvent::ConnLost) => bail!("与信令服务器的连接已断开，未完成握手"),
            Some(SigEvent::ServerError(text)) => bail!("信令服务器错误: {text}"),
            None => bail!("信令连接已关闭，未收到对方的握手信息"),
        }
    };
    sess.bye().await;
    Ok(hs)
}

async fn send_line(conn: &Arc<dyn Conn + Send + Sync>, msg: &str) -> Result<()> {
    let mut data = msg.as_bytes().to_vec();
    data.push(b'\n');
    conn.send(&data)
        .await
        .map_err(|e| anyhow!("发送失败: {e}"))?;
    Ok(())
}

async fn run(
    role: Role,
    opts: &Opts,
    mut stdin_rx: mpsc::Receiver<String>,
    session: signaling::Session,
) -> Result<()> {
    let my_name = if opts.name.is_empty() {
        match role {
            Role::Offer => "发起方",
            Role::Answer => "应答方",
        }
        .to_string()
    } else {
        opts.name.clone()
    };

    outln!("=== P2P ICE 双人聊天（webrtc-ice）===");
    outln!("角色: {}", role.label());

    // 1. 创建 ICE Agent
    let mut cfg = AgentConfig::default();
    cfg.udp_network = UDPNetwork::Ephemeral(Default::default());
    cfg.network_types = vec![NetworkType::Udp4, NetworkType::Udp6];
    cfg.multicast_dns_mode = MulticastDnsMode::Disabled; // 候选地址用真实 IP，方便复制粘贴直连
    cfg.include_loopback = true; // 允许本机双开测试
    if !opts.no_stun {
        for s in &opts.stuns {
            cfg.urls.push(
                Url::parse_url(s).with_context(|| format!("解析 STUN 地址失败: {s}"))?,
            );
        }
    }
    let agent = Arc::new(Agent::new(cfg).await.context("创建 ICE Agent 失败")?);
    if opts.stuns.is_empty() {
        outln!("    未使用 STUN 服务器（仅收集本机候选地址）");
    } else {
        for u in &opts.stuns {
            outln!("    STUN 服务器: {u}");
        }
    }

    // 防火墙唤醒: 防火墙授权弹窗只挂在 TCP listen 上，纯 UDP 应用永远不触发；
    // 这里开一个空闲 TCP 监听让系统弹出"Windows 安全中心警报"，用户点"允许访问"后
    // 生成的规则面向整个 exe（TCP+UDP 一起放行），UDP 打洞的入站包随之解封。
    match tokio::net::TcpListener::bind("0.0.0.0:0").await {
        Ok(l) => {
            let addr = l
                .local_addr()
                .map(|a| a.to_string())
                .unwrap_or_else(|_| "0.0.0.0:0".to_string());
            outln!("    防火墙唤醒: 正在监听 tcp/{addr} —— 若弹出\"Windows 安全中心警报\"，请勾选\"专用网络\"和\"公用网络\"后点\"允许访问\"（已放行过则不会再弹）");
            tokio::spawn(async move {
                loop {
                    match l.accept().await {
                        Ok((_sock, _)) => {} // 仅用于触发弹窗，连接直接丢弃
                        Err(_) => break,
                    }
                }
            });
        }
        Err(e) => outln!("    （防火墙唤醒监听创建失败，跳过: {e}）"),
    }

    // 2. 连接状态回调
    let (state_tx, mut state_rx) = watch::channel(ConnectionState::New);
    agent.on_connection_state_change(Box::new(move |s: ConnectionState| {
        let tx = state_tx.clone();
        Box::pin(async move {
            outln!("[ICE] 连接状态: {s}");
            let _ = tx.send(s);
        })
    }));

    // 3. trickle 收集本地候选地址
    let (cand_tx, mut cand_rx) =
        mpsc::unbounded_channel::<Option<Arc<dyn Candidate + Send + Sync>>>();
    agent.on_candidate(Box::new(move |c| {
        let tx = cand_tx.clone();
        Box::pin(async move {
            let _ = tx.send(c);
        })
    }));

    agent
        .gather_candidates()
        .context("启动候选地址收集失败")?;

    outln!("\n[1/3] 正在收集本机候选地址…");
    let mut local: Vec<Arc<dyn Candidate + Send + Sync>> = Vec::new();
    let deadline = tokio::time::Instant::now() + GATHER_TIMEOUT;
    loop {
        match tokio::time::timeout_at(deadline, cand_rx.recv()).await {
            Ok(Some(Some(c))) => local.push(c),
            _ => break, // 收集完成(None) / 通道关闭 / 超时
        }
    }
    ensure!(!local.is_empty(), "未收集到任何候选地址，无法建立连接");
    for c in &local {
        outln!("    候选: {}", c.marshal());
    }

    // 4. 生成自己的握手信息（ufrag/pwd + 全部候选地址）
    let (ufrag, pwd) = agent.get_local_user_credentials().await;
    let my_handshake = Handshake {
        u: ufrag,
        p: pwd,
        c: local.iter().map(|c| c.marshal()).collect(),
    };

    // 5. 经信令服务器交换握手信息（此后不再需要服务器）
    outln!("\n[2/3] 正在通过信令服务器交换握手信息…");
    if session.peer_present() {
        outln!("    对方已在房间，直接交换…");
    } else {
        outln!(
            "    等待对方加入房间 {}…（把房间号告诉对方即可，期间输入的消息会在连接后自动发送）",
            session.room()
        );
    }
    session
        .send_signal(&serde_json::to_value(&my_handshake).context("序列化握手信息失败")?)
        .await?;
    let hs = wait_peer_handshake(session).await?;
    outln!("    已获取对方连接信息（{} 个候选地址）", hs.c.len());

    // 6. 设置对端凭据与候选地址
    outln!("\n[3/3] 正在建立 P2P 连接…");
    agent
        .set_remote_credentials(hs.u.clone(), hs.p.clone())
        .await
        .context("设置对端凭据失败")?;
    for s in &hs.c {
        match unmarshal_candidate(s) {
            Ok(c) => {
                let c: Arc<dyn Candidate + Send + Sync> = Arc::new(c);
                let _ = agent.add_remote_candidate(&c);
            }
            Err(e) => outln!("    跳过无效候选地址: {e}"),
        }
    }

    // 7. dial（发起方）/ accept（应答方），返回可直接读写的 P2P 连接
    let (cancel_tx, cancel_rx) = mpsc::channel::<()>(1);
    let dial = tokio::time::timeout(CONNECT_TIMEOUT, async {
        match role {
            Role::Offer => {
                let c = agent.dial(cancel_rx, hs.u.clone(), hs.p.clone()).await?;
                let c: Arc<dyn Conn + Send + Sync> = c;
                Ok::<_, IceError>(c)
            }
            Role::Answer => {
                let c = agent.accept(cancel_rx, hs.u.clone(), hs.p.clone()).await?;
                let c: Arc<dyn Conn + Send + Sync> = c;
                Ok::<_, IceError>(c)
            }
        }
    });
    tokio::pin!(dial);
    let conn: Arc<dyn Conn + Send + Sync> = loop {
        tokio::select! {
            r = &mut dial => {
                break r.map_err(|_| anyhow!("P2P 连接超时（90 秒），请确认对方也已入房并在线"))??;
            }
            _ = state_rx.changed() => {
                let s = state_rx.borrow().clone();
                if matches!(s, ConnectionState::Failed | ConnectionState::Closed) {
                    let _ = agent.close().await;
                    bail!(
                        "打洞失败（ICE 状态 {s}）：所有候选对都无法连通。\n\
                        常见原因：\n  \
                        ① Windows 防火墙拦截入站 UDP —— 两台机器都要放行本程序（管理员运行）：\n     \
                        netsh advfirewall firewall add rule name=\"p2p-ice-chat\" dir=in action=allow program=\"<本程序exe绝对路径>\"\n  \
                        ② 双方不在同一局域网，且任一方是对称 NAT —— UDP 打洞只能穿透锥形 NAT，\n     \
                        对称型/运营商级 NAT 无中继服务器时无法连通，请改在同一局域网内联机"
                    );
                }
            }
        }
    };
    drop(cancel_tx);

    outln!("\n=== P2P 已建立！输入消息回车发送，/quit 退出 ===\n");

    // 8. 上线问候 + 发送等待期间积累的消息
    let hello = format!("hello，我是 {my_name}，P2P 已打通");
    send_line(&conn, &hello).await?;
    outln!("[我] {hello}");

    // 9. 聊天主循环：stdin -> 发送，conn -> 接收
    let tty = std::io::stdout().is_terminal();
    let mut stdin_open = true;
    let mut buf = vec![0u8; 2048];
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
                    let mut end = l.len().min(MAX_MSG_BYTES);
                    while !l.is_char_boundary(end) {
                        end -= 1;
                    }
                    let msg = &l[..end];
                    send_line(&conn, msg).await?;
                    outln!("[我] {msg}");
                }
                None => stdin_open = false,
            },
            r = conn.recv(&mut buf) => match r {
                Ok(n) if n > 0 => {
                    let msg = String::from_utf8_lossy(&buf[..n]);
                    outln!("\n[对方] {}", msg.trim_end_matches(['\n', '\r']));
                }
                Ok(_) => {}
                Err(e) => {
                    outln!("\n[!] 连接已断开: {e}");
                    break;
                }
            },
            _ = state_rx.changed() => {
                let s = state_rx.borrow().clone();
                if matches!(s, ConnectionState::Failed | ConnectionState::Closed) {
                    outln!("\n[!] ICE 连接异常（{s}），退出");
                    break;
                }
            }
            _ = tokio::signal::ctrl_c() => {
                outln!("\n[退出]");
                break;
            }
        }
    }

    let _ = agent.close().await;
    outln!("已退出。");
    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {
    env_logger::init();
    let opts = parse_args()?;
    let stdin_rx = spawn_stdin_reader();
    let session =
        signaling::connect(&opts.server, &opts.name, opts.room.as_deref().unwrap_or("")).await?;
    outln!("已连接信令服务器: {}", opts.server);
    outln!(
        "房间号: {}    你的角色: {}",
        session.room(),
        session.role().label()
    );
    if opts.room.is_none() {
        outln!("    服务器已随机分配房间号，请让对方执行:");
        outln!(
            "    cargo run -- --server {} --room {}",
            opts.server,
            session.room()
        );
    }
    run(session.role(), &opts, stdin_rx, session).await
}
