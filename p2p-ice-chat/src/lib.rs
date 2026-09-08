//! p2p-ice-chat 库：基于 webrtc-ice 的双人 P2P 直连会话。
//!
//! 与 stdin/stdout 完全无关：所有进度、诊断、对端消息都通过 [`P2pEvent`] 事件通道推送，
//! 调用方（CLI 的 main.rs、桌面端的 Tauri 命令）各自决定如何呈现。
//!
//! 分层：
//! - [`ice`]：与信令无关的 ICE 核心（收集候选 → 交换 [`Handshake`] → dial/accept → [`IceConn`]），
//!   供本 crate 的聊天会话与 `p2p-vlan` 虚拟局域网共用；
//! - [`signaling`]：WebSocket 信令客户端；
//! - [`connect`]：把两者串起来的双人聊天会话。
//!
//! 流程：连接信令服务器 → `status` → 收集候选地址 → 交换握手 → 向服务器 `bye`
//! → ICE dial/accept → `connected` → 后台接收循环（`message` … `closed`）。
//!
//! 约定：[`connect`] 失败时**只返回 `Err`，不会自行发出 `error`/`closed` 事件**，
//! 由调用方决定如何上报；连接成功后接收循环结束时一定会发出且仅发出一次 `closed`。

pub mod ice;
pub mod signaling;

use std::sync::Arc;
use std::time::Duration;

use anyhow::{bail, Context, Result};
use serde::Serialize;
use tokio::sync::{mpsc, oneshot};

pub use ice::{
    Handshake, IceCloseHandle, IceConfig, IceConn, IceEndpoint, IceRawConn, InterfaceFilter,
    IpFilter, DEFAULT_STUN_URL, GATHER_TIMEOUT,
};
pub use signaling::Role;
use signaling::SigEvent;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(90);
/// 单条消息上限（字节，不含换行）；超出部分按字符边界截断
pub const MAX_MSG_BYTES: usize = 1200;

/// 建立会话所需的参数
#[derive(Clone, Debug)]
pub struct ConnectOptions {
    /// 信令服务器地址，ws:// 或 wss://
    pub server: String,
    /// 房间号；为空时由服务器随机分配
    pub room: String,
    /// 自己的显示名；为空时按角色取"发起方"/"应答方"
    pub name: String,
    /// STUN 服务器列表；为空则仅收集本机候选地址
    pub stun_urls: Vec<String>,
    /// 防火墙唤醒：开一个空闲 TCP 监听以触发"Windows 安全中心警报"弹窗。
    /// 库默认关闭（桌面应用应由安装流程放行），CLI 默认开启。
    pub firewall_probe: bool,
}

impl Default for ConnectOptions {
    fn default() -> Self {
        Self {
            server: String::new(),
            room: String::new(),
            name: String::new(),
            stun_urls: vec![DEFAULT_STUN_URL.to_string()],
            firewall_probe: false,
        }
    }
}

impl ConnectOptions {
    fn ice_config(&self) -> IceConfig {
        IceConfig {
            stun_urls: self.stun_urls.clone(),
            firewall_probe: self.firewall_probe,
            ..IceConfig::default()
        }
    }
}

/// 事件种类；序列化为小写蛇形字符串（"status" / "log" / …）
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum P2pEventKind {
    /// 已入房：携带 role / room / text
    Status,
    /// 进度与诊断文本
    Log,
    /// P2P 已打通：携带 role / peer
    Connected,
    /// 收到对端消息：携带 text / peer
    Message,
    /// 会话结束（正常关闭或异常断开后均会发出一次）
    Closed,
    /// 错误说明文本
    Error,
}

/// 推给调用方的扁平事件对象：`{ kind, text?, role?, room?, peer? }`
#[derive(Clone, Debug, Serialize)]
pub struct P2pEvent {
    pub kind: P2pEventKind,
    /// log / message / error 的正文
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// "offer" | "answer"，status / connected 时携带
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    /// 房间号，status 时携带
    #[serde(skip_serializing_if = "Option::is_none")]
    pub room: Option<String>,
    /// 对端显示名，connected / message 时携带
    #[serde(skip_serializing_if = "Option::is_none")]
    pub peer: Option<String>,
}

impl P2pEvent {
    fn bare(kind: P2pEventKind) -> Self {
        Self {
            kind,
            text: None,
            role: None,
            room: None,
            peer: None,
        }
    }

    pub fn log(text: impl Into<String>) -> Self {
        Self {
            text: Some(text.into()),
            ..Self::bare(P2pEventKind::Log)
        }
    }

    pub fn error(text: impl Into<String>) -> Self {
        Self {
            text: Some(text.into()),
            ..Self::bare(P2pEventKind::Error)
        }
    }

    pub fn closed() -> Self {
        Self::bare(P2pEventKind::Closed)
    }

    pub fn status(role: Role, room: impl Into<String>, text: impl Into<String>) -> Self {
        Self {
            text: Some(text.into()),
            role: Some(role.as_str().to_string()),
            room: Some(room.into()),
            ..Self::bare(P2pEventKind::Status)
        }
    }

    pub fn connected(role: Role, peer: impl Into<String>) -> Self {
        Self {
            role: Some(role.as_str().to_string()),
            peer: Some(peer.into()),
            ..Self::bare(P2pEventKind::Connected)
        }
    }

    pub fn message(text: impl Into<String>, peer: impl Into<String>) -> Self {
        Self {
            text: Some(text.into()),
            peer: Some(peer.into()),
            ..Self::bare(P2pEventKind::Message)
        }
    }
}

/// 内部事件队列的条目：事件本身，或"排空"请求（回执在此前入队的事件都已转发后发出）
enum QueueItem {
    Event(P2pEvent),
    Flush(oneshot::Sender<()>),
}

/// 事件发送端的薄封装。
///
/// 所有事件（含 ICE 核心同步回调里的日志）先进同一条无界队列，再由一个转发任务
/// 按序推入调用方的有界通道，保证顺序且同步回调里也能发事件。接收方已丢弃时静默忽略。
#[derive(Clone)]
struct Events(mpsc::UnboundedSender<QueueItem>);

impl Events {
    fn new(out: mpsc::Sender<P2pEvent>) -> Self {
        let (tx, mut rx) = mpsc::unbounded_channel::<QueueItem>();
        tokio::spawn(async move {
            while let Some(item) = rx.recv().await {
                match item {
                    QueueItem::Event(ev) => {
                        if out.send(ev).await.is_err() {
                            break;
                        }
                    }
                    QueueItem::Flush(ack) => {
                        let _ = ack.send(());
                    }
                }
            }
        });
        Self(tx)
    }

    fn emit(&self, ev: P2pEvent) {
        let _ = self.0.send(QueueItem::Event(ev));
    }

    fn log(&self, text: impl Into<String>) {
        self.emit(P2pEvent::log(text));
    }

    /// 等待此前入队的事件全部转发完毕（最多 3 秒，接收方过慢时不再死等）
    async fn flush(&self) {
        let (tx, rx) = oneshot::channel();
        if self.0.send(QueueItem::Flush(tx)).is_err() {
            return;
        }
        let _ = tokio::time::timeout(Duration::from_secs(3), rx).await;
    }
}

/// 已打通的 P2P 会话句柄。丢弃句柄等同于 [`Session::close`]。
pub struct Session {
    conn: Arc<IceConn>,
    role: Role,
    room: String,
    peer: String,
}

impl Session {
    pub fn role(&self) -> Role {
        self.role
    }

    pub fn room(&self) -> &str {
        &self.room
    }

    /// 对端显示名
    pub fn peer(&self) -> &str {
        &self.peer
    }

    /// 发送一条文本消息：超过 [`MAX_MSG_BYTES`] 的部分按字符边界截断，末尾追加 `\n`
    pub async fn send(&self, text: &str) -> Result<()> {
        send_line(&self.conn, truncate_msg(text)).await
    }

    /// 关闭会话：通知接收循环退出并关闭 ICE Agent；接收循环退出时会发出 `closed`
    pub async fn close(&self) {
        self.conn.close().await;
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        // 接收循环观察到关闭标记后会负责真正关闭 Agent 并发出 closed
        self.conn.signal_close();
    }
}

/// 按 [`MAX_MSG_BYTES`] 截断到字符边界
pub fn truncate_msg(text: &str) -> &str {
    let mut end = text.len().min(MAX_MSG_BYTES);
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

async fn send_line(conn: &IceConn, msg: &str) -> Result<()> {
    let mut data = msg.as_bytes().to_vec();
    data.push(b'\n');
    conn.send(&data).await
}

/// 等待对端握手信息：过滤 peer-joined 等通知，收到合法 Handshake 即返回。
/// 拿到后立即与服务器告别——后续 ICE 协商与聊天不再需要中心服务器。
/// 同时返回 peer-joined 携带的对端显示名（可能为空）。
async fn wait_peer_handshake(
    mut sess: signaling::Session,
    events: &Events,
) -> Result<(Handshake, String)> {
    let mut joined_name = String::new();
    let hs = loop {
        match sess.recv_event().await {
            Some(SigEvent::Signal(v)) => match serde_json::from_value::<Handshake>(v) {
                Ok(h) if h.is_complete() => break h,
                Ok(_) => events.log("    （收到不完整的信令数据，继续等待…）"),
                Err(e) => events.log(format!("    （对方信令数据无法解析，继续等待…: {e}）")),
            },
            Some(SigEvent::PeerJoined(name)) => {
                if name.is_empty() {
                    events.log("    对方已加入房间");
                } else {
                    events.log(format!("    对方已加入房间: {name}"));
                    joined_name = name;
                }
            }
            Some(SigEvent::PeerLeft) => bail!("对方已离开房间，未完成握手"),
            Some(SigEvent::ConnLost) => bail!("与信令服务器的连接已断开，未完成握手"),
            Some(SigEvent::ServerError(text)) => bail!("信令服务器错误: {text}"),
            None => bail!("信令连接已关闭，未收到对方的握手信息"),
        }
    };
    sess.bye().await;
    Ok((hs, joined_name))
}

/// 后台接收循环：每个数据报发一条 `message`；连接断开 / ICE 异常 / [`Session::close`] 后
/// 关闭 Agent 并发出 `closed`。
fn spawn_recv_loop(conn: Arc<IceConn>, peer: String, events: Events) {
    tokio::spawn(async move {
        let closed = conn.closed();
        tokio::pin!(closed);
        let mut buf = vec![0u8; 2048];
        loop {
            tokio::select! {
                biased;
                _ = &mut closed => {
                    // 本端主动关闭不算异常；ICE Failed/Closed 才报错
                    if !conn.is_local_closed() {
                        events.emit(P2pEvent::error(format!("ICE 连接异常（{}），会话结束", conn.state())));
                    }
                    break;
                }
                r = conn.recv(&mut buf) => match r {
                    Ok(n) if n > 0 => {
                        let msg = String::from_utf8_lossy(&buf[..n]);
                        events.emit(P2pEvent::message(msg.trim_end_matches(['\n', '\r']), peer.clone()));
                    }
                    Ok(_) => {}
                    Err(e) => {
                        if !conn.is_local_closed() {
                            events.emit(P2pEvent::error(format!("连接已断开: {e}")));
                        }
                        break;
                    }
                },
            }
        }
        conn.close().await;
        events.emit(P2pEvent::closed());
    });
}

/// 连接信令服务器、交换握手并完成 ICE 打洞，成功后返回会话句柄。
///
/// 进度通过 `events` 推送；失败时只返回 `Err`（错误文本含中文诊断），不发出事件。
pub async fn connect(opts: ConnectOptions, events: mpsc::Sender<P2pEvent>) -> Result<Session> {
    let events = Events::new(events);
    match connect_inner(opts, &events).await {
        Ok(session) => Ok(session),
        Err(e) => {
            // 让此前的日志先送达，再由调用方补发 error/closed
            events.flush().await;
            Err(e)
        }
    }
}

async fn connect_inner(opts: ConnectOptions, events: &Events) -> Result<Session> {
    // 0. 信令入房
    let session = signaling::connect(&opts.server, &opts.name, &opts.room).await?;
    let role = session.role();
    let room = session.room().to_string();
    events.log(format!("已连接信令服务器: {}", opts.server));
    events.emit(P2pEvent::status(
        role,
        room.clone(),
        if session.peer_present() {
            "已入房，对端已在房"
        } else {
            "已入房，等待对端"
        },
    ));

    let my_name = if opts.name.is_empty() {
        match role {
            Role::Offer => "发起方",
            Role::Answer => "应答方",
        }
        .to_string()
    } else {
        opts.name.clone()
    };

    events.log("=== P2P ICE 双人聊天（webrtc-ice）===");
    events.log(format!("角色: {}", role.label()));

    // 1. 创建 ICE Agent 并收集本机候选地址
    events.log("[1/3] 正在收集本机候选地址…");
    let log_events = events.clone();
    let (endpoint, mut my_handshake) =
        IceEndpoint::gather(&opts.ice_config(), move |s| log_events.log(s)).await?;
    my_handshake.n = Some(my_name.clone());

    // 2. 经信令服务器交换握手信息（此后不再需要服务器）
    events.log("[2/3] 正在通过信令服务器交换握手信息…");
    if session.peer_present() {
        events.log("    对方已在房间，直接交换…");
    } else {
        events.log(format!(
            "    等待对方加入房间 {room}…（把房间号告诉对方即可）"
        ));
    }
    let exchange = async {
        session
            .send_signal(&serde_json::to_value(&my_handshake).context("序列化握手信息失败")?)
            .await?;
        wait_peer_handshake(session, events).await
    };
    let (hs, joined_name) = match exchange.await {
        Ok(v) => v,
        Err(e) => {
            endpoint.close().await;
            return Err(e);
        }
    };
    events.log(format!(
        "    已获取对方连接信息（{} 个候选地址）",
        hs.c.len()
    ));

    // 对端显示名：握手自带 > peer-joined 通知 > 按角色兜底
    let peer_name = if let Some(n) = hs.display_name() {
        n.to_string()
    } else if !joined_name.is_empty() {
        joined_name
    } else {
        match role {
            Role::Offer => "应答方",
            Role::Answer => "发起方",
        }
        .to_string()
    };

    // 3. dial（发起方）/ accept（应答方），返回可直接读写的 P2P 连接
    events.log("[3/3] 正在建立 P2P 连接…");
    let conn = Arc::new(endpoint.connect(role, &hs, CONNECT_TIMEOUT).await?);

    events.emit(P2pEvent::connected(role, peer_name.clone()));

    // 4. 上线问候
    let hello = format!("hello，我是 {my_name}，P2P 已打通");
    if let Err(e) = send_line(&conn, &hello).await {
        conn.close().await;
        return Err(e);
    }
    events.log(format!("[我] {hello}"));

    // 5. 后台接收循环
    spawn_recv_loop(Arc::clone(&conn), peer_name.clone(), events.clone());

    Ok(Session {
        conn,
        role,
        room,
        peer: peer_name,
    })
}
