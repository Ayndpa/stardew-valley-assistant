//! WebSocket 信令客户端：与中心服务器配对房间、交换握手信息。
//!
//! 协议见 cloud-service/signaling-server/README.md。
//! 服务器只做配对与信令转发，握手完成后客户端即发送 bye 与服务器告别，聊天数据完全走 P2P。

use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, bail, Result};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};

/// 与 ICE 拨号方式对应的角色（由服务器按入房顺序分配）
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Role {
    Offer,
    Answer,
}

impl Role {
    pub fn label(self) -> &'static str {
        match self {
            Role::Offer => "offer（发起方 / controlling）",
            Role::Answer => "answer（应答方 / controlled）",
        }
    }

    fn from_server(s: &str) -> Result<Role> {
        match s {
            "offer" => Ok(Role::Offer),
            "answer" => Ok(Role::Answer),
            other => Err(anyhow!("服务器分配了未知角色: {other}")),
        }
    }
}

/// welcome 之后服务器推送的事件
pub enum SigEvent {
    /// 对端发来的信令数据（握手信息 JSON）
    Signal(Value),
    /// 对端入房（携带其显示名，可能为空）
    PeerJoined(String),
    /// 对端已离开
    PeerLeft,
    /// 与服务器的连接断开
    ConnLost,
    /// 服务器下发的错误
    ServerError(String),
}

type WsStream = WebSocketStream<MaybeTlsStream<TcpStream>>;
type SharedSink = Arc<Mutex<futures_util::stream::SplitSink<WsStream, Message>>>;

#[derive(Deserialize)]
struct Envelope {
    #[serde(default)]
    r#type: String,
    #[serde(default)]
    room: String,
    #[serde(default)]
    role: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    peer: bool,
    #[serde(default)]
    code: String,
    #[serde(default, rename = "message")]
    text: String,
    #[serde(default)]
    data: Value,
}

pub struct Session {
    room: String,
    role: Role,
    peer_present: bool,
    sink: SharedSink,
    events: mpsc::UnboundedReceiver<SigEvent>,
}

impl Session {
    pub fn room(&self) -> &str {
        &self.room
    }

    pub fn role(&self) -> Role {
        self.role
    }

    /// welcome 时对端是否已在房（含对端握手已缓冲的情况）
    pub fn peer_present(&self) -> bool {
        self.peer_present
    }

    pub async fn send_signal(&self, data: &Value) -> Result<()> {
        let mut sink = self.sink.lock().await;
        sink.send(Message::Text(
            json!({"type": "signal", "data": data}).to_string(),
        ))
        .await
        .map_err(|e| anyhow!("发送信令失败: {e}"))
    }

    pub async fn recv_event(&mut self) -> Option<SigEvent> {
        self.events.recv().await
    }

    /// 握手信息已互换，与服务器礼貌告别（此后聊天数据不经服务器）
    pub async fn bye(&self) {
        let mut sink = self.sink.lock().await;
        let _ = sink
            .send(Message::Text("{\"type\":\"bye\"}".to_string()))
            .await;
        let _ = sink.close().await;
    }
}

/// 连接信令服务器、发送 hello 并等待 welcome。room 为空时由服务器分配房间号。
/// 房间号同时拼进 URL 查询参数，服务器按它路由房间。
pub async fn connect(server: &str, name: &str, room: &str) -> Result<Session> {
    if !(server.starts_with("ws://") || server.starts_with("wss://")) {
        bail!("--server 地址需以 ws:// 或 wss:// 开头，如 ws://192.168.1.10:9877/ws");
    }
    let url = if room.is_empty() {
        server.to_string()
    } else {
        let sep = if server.contains('?') { '&' } else { '?' };
        format!("{server}{sep}room={}", percent_encode_room(room))
    };
    let (ws, _resp) = connect_async(url.as_str())
        .await
        .map_err(|e| anyhow!("连接信令服务器失败: {e}"))?;
    let (sink, mut stream) = ws.split();
    let sink = Arc::new(Mutex::new(sink));

    let hello = json!({"type": "hello", "name": name, "room": room});
    {
        let mut s = sink.lock().await;
        s.send(Message::Text(hello.to_string()))
            .await
            .map_err(|e| anyhow!("发送 hello 失败: {e}"))?;
    }

    let welcome: Envelope = loop {
        let msg = tokio::time::timeout(Duration::from_secs(15), stream.next())
            .await
            .map_err(|_| anyhow!("等待服务器应答超时"))?
            .ok_or_else(|| anyhow!("信令服务器在完成配对前断开了连接"))?
            .map_err(|e| anyhow!("信令连接异常: {e}"))?;
        match msg {
            Message::Text(t) => {
                let env: Envelope =
                    serde_json::from_str(&t).map_err(|e| anyhow!("无法解析服务器消息: {e}"))?;
                match env.r#type.as_str() {
                    "welcome" => break env,
                    "error" => bail!("服务器拒绝: {}（{}）", env.text, env.code),
                    _ => {}
                }
            }
            Message::Ping(p) => {
                let mut s = sink.lock().await;
                let _ = s.send(Message::Pong(p)).await;
            }
            Message::Close(c) => bail!("信令服务器关闭连接: {c:?}"),
            _ => {}
        }
    };

    if welcome.room.is_empty() {
        bail!("服务器未返回房间号");
    }
    let role = Role::from_server(&welcome.role)?;

    // 后台持续读取服务器推送，转发为 SigEvent
    let (tx, rx) = mpsc::unbounded_channel();
    let reader_sink = Arc::clone(&sink);
    tokio::spawn(async move {
        while let Some(Ok(msg)) = stream.next().await {
            let ev = match msg {
                Message::Text(t) => {
                    let Ok(env) = serde_json::from_str::<Envelope>(&t) else {
                        continue;
                    };
                    match env.r#type.as_str() {
                        "signal" => SigEvent::Signal(env.data),
                        "peer-joined" => SigEvent::PeerJoined(env.name),
                        "peer-left" => SigEvent::PeerLeft,
                        "error" => SigEvent::ServerError(env.text),
                        _ => continue,
                    }
                }
                Message::Ping(p) => {
                    let mut s = reader_sink.lock().await;
                    if s.send(Message::Pong(p)).await.is_err() {
                        break;
                    }
                    continue;
                }
                Message::Close(_) => SigEvent::ConnLost,
                _ => continue,
            };
            if tx.send(ev).is_err() {
                break;
            }
        }
        let _ = tx.send(SigEvent::ConnLost);
    });

    Ok(Session {
        room: welcome.room,
        role,
        peer_present: welcome.peer,
        sink,
        events: rx,
    })
}

/// 房间号百分号编码：仅放行 URL 安全字符，其余转 %XX
fn percent_encode_room(room: &str) -> String {
    let mut out = String::with_capacity(room.len());
    for b in room.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}
