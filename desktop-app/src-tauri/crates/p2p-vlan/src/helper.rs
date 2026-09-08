//! 提权辅助进程（REALTIME.md §7.4）：线协议、辅助端主循环 [`serve`] 与应用端客户端 [`HelperClient`]。
//!
//! 管道 `\\.\pipe\stardew-vlan-<随机串>` 由应用创建（单实例、仅当前用户），辅助进程作为客户端连接，
//! 首帧 `{"op":"hello","token":"…"}`；之后应用发 `{ "id": n, "op": …, …参数 }`，
//! 辅助回 `{ "reply": n, "ok": true, "result": … }` / `{ "reply": n, "ok": false, "error": "…" }`，
//! 并异步推送 `{ "event": { "kind": …, … } }`（`signal_out` 对应 `vlan-signal-out`）。全部为 UTF-8 JSON 行。

use std::collections::HashMap;
use std::net::Ipv4Addr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::net::windows::named_pipe::{ClientOptions, NamedPipeServer, ServerOptions};
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;

use crate::elevation::OwnerOnlySecurity;
use crate::engine::{MemberInfo, PeerStatus, VlanEngine, VlanEvent, VlanStatus};
use crate::ice::IceConfig;
use crate::recommended_ice_config;
use crate::tun::{open_tun, TunConfig, TunIo};

/// 管道名前缀
pub const PIPE_PREFIX: &str = r"\\.\pipe\stardew-vlan-";
/// 等待辅助进程连接并发出 hello 的上限（含用户在 UAC 上的犹豫时间）
pub const HELLO_TIMEOUT: Duration = Duration::from_secs(90);
/// 辅助进程连接管道的重试上限
const CONNECT_RETRY: Duration = Duration::from_secs(10);
/// 普通请求超时
const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
/// `start` 可能要安装驱动，给更长时间
const START_TIMEOUT: Duration = Duration::from_secs(120);
/// `shutdown` 后等辅助进程断开的上限
const SHUTDOWN_GRACE: Duration = Duration::from_secs(5);

// ---------- 线协议 ----------

/// 应用 → 辅助的请求，`op` 区分种类；参数与 §7.3 相同（`self_id` 也接受 `selfId`）
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Request {
    Hello {
        token: String,
    },
    Start {
        #[serde(alias = "selfId")]
        self_id: String,
        vip: Ipv4Addr,
        members: Vec<MemberInfo>,
    },
    UpdateMembers {
        members: Vec<MemberInfo>,
    },
    SignalIn {
        from: String,
        data: Value,
    },
    Stop,
    Status,
    Shutdown,
}

/// 请求帧：`hello` 无 `id`，其余都带
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RequestFrame {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<u64>,
    #[serde(flatten)]
    pub req: Request,
}

/// 应答帧
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ReplyFrame {
    pub reply: u64,
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// 事件种类（与 `vlan-event` 的 `kind` 相同，外加 `signal_out`）
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HelperEventKind {
    Started,
    Stopped,
    Peer,
    Error,
    Log,
    SignalOut,
}

/// 辅助 → 应用的事件：形状同 `vlan-event` payload；`signal_out` 带 `to` / `data`
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct HelperEvent {
    pub kind: HelperEventKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub peer: Option<PeerStatus>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

impl HelperEvent {
    fn bare(kind: HelperEventKind) -> Self {
        Self {
            kind,
            peer: None,
            text: None,
            to: None,
            data: None,
        }
    }
}

impl From<VlanEvent> for HelperEvent {
    fn from(ev: VlanEvent) -> Self {
        match ev {
            VlanEvent::Started => Self::bare(HelperEventKind::Started),
            VlanEvent::Stopped => Self::bare(HelperEventKind::Stopped),
            VlanEvent::Peer(p) => Self {
                peer: Some(p),
                ..Self::bare(HelperEventKind::Peer)
            },
            VlanEvent::Error(text) => Self {
                text: Some(text),
                ..Self::bare(HelperEventKind::Error)
            },
            VlanEvent::Log(text) => Self {
                text: Some(text),
                ..Self::bare(HelperEventKind::Log)
            },
            VlanEvent::SignalOut { to, data } => Self {
                to: Some(to),
                data: Some(data),
                ..Self::bare(HelperEventKind::SignalOut)
            },
        }
    }
}

/// 事件帧 `{ "event": … }`
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EventFrame {
    pub event: HelperEvent,
}

/// 辅助 → 应用的任一帧
#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum Incoming {
    Reply(ReplyFrame),
    Event(EventFrame),
}

fn encode_line<T: Serialize>(frame: &T) -> Result<String> {
    let mut s = serde_json::to_string(frame).context("序列化管道帧失败")?;
    s.push('\n');
    Ok(s)
}

/// 写循环：把队列里的行按序写入管道
async fn write_loop<W: AsyncWrite + Unpin>(mut w: W, mut rx: mpsc::UnboundedReceiver<String>) {
    while let Some(line) = rx.recv().await {
        if w.write_all(line.as_bytes()).await.is_err() || w.flush().await.is_err() {
            break;
        }
    }
    let _ = w.shutdown().await;
}

/// 16 位十六进制随机串
pub fn nonce16() -> String {
    crate::engine::new_session()
}

// ---------- 命令行参数 ----------

/// 辅助进程的启动参数
#[derive(Clone, Debug)]
pub struct HelperArgs {
    pub pipe: String,
    pub token: String,
    pub wintun_dll: Option<PathBuf>,
}

impl HelperArgs {
    /// 从进程参数里识别 `--vlan-helper <pipe> [--wintun-dll <path>] --token <nonce>`；不是辅助模式返回 `None`
    pub fn parse<I: IntoIterator<Item = String>>(args: I) -> Option<HelperArgs> {
        let args: Vec<String> = args.into_iter().collect();
        let mut pipe = None;
        let mut token = None;
        let mut wintun_dll = None;
        let mut i = 0;
        while i < args.len() {
            match args[i].as_str() {
                crate::elevation::ARG_HELPER => {
                    pipe = args.get(i + 1).cloned();
                    i += 2;
                }
                crate::elevation::ARG_WINTUN_DLL => {
                    wintun_dll = args.get(i + 1).map(PathBuf::from);
                    i += 2;
                }
                crate::elevation::ARG_TOKEN => {
                    token = args.get(i + 1).cloned();
                    i += 2;
                }
                _ => i += 1,
            }
        }
        Some(HelperArgs {
            pipe: pipe?,
            token: token.unwrap_or_default(),
            wintun_dll,
        })
    }
}

/// 辅助进程入口：建立 tokio 运行时并运行 [`serve`]，返回进程退出码
pub fn run_helper_main(args: HelperArgs) -> i32 {
    let rt = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(rt) => rt,
        Err(e) => {
            log::error!("创建 tokio 运行时失败: {e}");
            return 2;
        }
    };
    match rt.block_on(serve(&args.pipe, &args.token, args.wintun_dll)) {
        Ok(()) => 0,
        Err(e) => {
            log::error!("辅助进程异常退出: {e}");
            1
        }
    }
}

// ---------- 辅助端 ----------

/// 创建 TUN 的工厂（测试可用内存网卡）
pub type TunFactory = Arc<dyn Fn(&TunConfig) -> Result<Box<dyn TunIo>> + Send + Sync>;
/// 生成 ICE 配置的工厂
pub type IceFactory = Arc<dyn Fn(&TunConfig) -> IceConfig + Send + Sync>;

/// [`serve_with`] 的参数
pub struct ServeOptions {
    pub pipe_name: String,
    pub token: String,
    pub wintun_dll: Option<PathBuf>,
    /// `None` 用 [`open_tun`]（真实 Wintun）
    pub tun_factory: Option<TunFactory>,
    /// `None` 用 [`recommended_ice_config`]
    pub ice_factory: Option<IceFactory>,
}

/// 连接应用创建的管道，发送 hello 并服务请求；管道断开或收到 `shutdown` 时返回。
/// 使用真实 Wintun（`wintun_dll` 为其路径）。
pub async fn serve(pipe_name: &str, token: &str, wintun_dll: Option<PathBuf>) -> Result<()> {
    serve_with(ServeOptions {
        pipe_name: pipe_name.to_string(),
        token: token.to_string(),
        wintun_dll,
        tun_factory: None,
        ice_factory: None,
    })
    .await
}

/// 运行中的引擎及其事件转发任务
struct Session {
    engine: Arc<VlanEngine>,
    forwarder: JoinHandle<()>,
}

impl Session {
    async fn stop(self) {
        self.engine.stop().await;
        let _ = tokio::time::timeout(Duration::from_secs(5), self.forwarder).await;
    }
}

/// 同 [`serve`]，但可替换 TUN / ICE 工厂（测试用）
pub async fn serve_with(opts: ServeOptions) -> Result<()> {
    // 应用先建管道再拉起我们，但仍给一点重试余量
    let deadline = tokio::time::Instant::now() + CONNECT_RETRY;
    let client = loop {
        match ClientOptions::new().open(&opts.pipe_name) {
            Ok(c) => break c,
            Err(e) => {
                if tokio::time::Instant::now() >= deadline {
                    return Err(anyhow!("连接管道 {} 失败: {e}", opts.pipe_name));
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        }
    };
    let (rd, wr) = tokio::io::split(client);
    let (out_tx, out_rx) = mpsc::unbounded_channel::<String>();
    let writer = tokio::spawn(write_loop(wr, out_rx));

    let _ = out_tx.send(encode_line(&RequestFrame {
        id: None,
        req: Request::Hello {
            token: opts.token.clone(),
        },
    })?);

    let mut lines = BufReader::new(rd).lines();
    let mut session: Option<Session> = None;
    loop {
        let line = match lines.next_line().await {
            Ok(Some(l)) => l,
            // EOF / 管道断开：应用退出了
            _ => break,
        };
        if line.trim().is_empty() {
            continue;
        }
        let frame: RequestFrame = match serde_json::from_str(&line) {
            Ok(f) => f,
            Err(e) => {
                log::warn!("无法解析请求: {e}: {line}");
                // 尽量把 id 捞出来回一个错误
                if let Some(id) = serde_json::from_str::<Value>(&line)
                    .ok()
                    .and_then(|v| v.get("id").and_then(Value::as_u64))
                {
                    let _ = out_tx.send(encode_line(&ReplyFrame {
                        reply: id,
                        ok: false,
                        result: None,
                        error: Some(format!("无法解析请求: {e}")),
                    })?);
                }
                continue;
            }
        };
        let id = frame.id.unwrap_or(0);
        let shutdown = matches!(frame.req, Request::Shutdown);
        let reply = match handle_request(&opts, &out_tx, &mut session, frame.req).await {
            Ok(result) => ReplyFrame {
                reply: id,
                ok: true,
                result: Some(result),
                error: None,
            },
            Err(e) => ReplyFrame {
                reply: id,
                ok: false,
                result: None,
                error: Some(e.to_string()),
            },
        };
        let _ = out_tx.send(encode_line(&reply)?);
        if shutdown {
            break;
        }
    }

    if let Some(s) = session.take() {
        s.stop().await;
    }
    drop(out_tx);
    let _ = tokio::time::timeout(Duration::from_secs(2), writer).await;
    Ok(())
}

async fn handle_request(
    opts: &ServeOptions,
    out_tx: &mpsc::UnboundedSender<String>,
    session: &mut Option<Session>,
    req: Request,
) -> Result<Value> {
    match req {
        Request::Hello { .. } => bail!("重复的 hello"),
        Request::Start {
            self_id,
            vip,
            members,
        } => {
            if let Some(s) = session.take() {
                s.stop().await;
            }
            let mut cfg = TunConfig::new(vip);
            cfg.wintun_dll = opts.wintun_dll.clone();
            let ice = match &opts.ice_factory {
                Some(f) => f(&cfg),
                None => recommended_ice_config(vip, cfg.prefix_len, &cfg.name),
            };
            // 创建 Wintun 适配器可能要装驱动，放到阻塞线程
            let factory = opts.tun_factory.clone();
            let tun: Box<dyn TunIo> = tokio::task::spawn_blocking(move || match factory {
                Some(f) => f(&cfg),
                None => open_tun(&cfg).map(|t| Box::new(t) as Box<dyn TunIo>),
            })
            .await
            .map_err(|e| anyhow!("创建虚拟网卡任务失败: {e}"))??;

            let (ev_tx, mut ev_rx) = mpsc::channel::<VlanEvent>(256);
            let engine = VlanEngine::start(self_id, vip, members, tun, ice, ev_tx);
            let out = out_tx.clone();
            let forwarder = tokio::spawn(async move {
                while let Some(ev) = ev_rx.recv().await {
                    let frame = EventFrame { event: ev.into() };
                    match encode_line(&frame) {
                        Ok(line) => {
                            if out.send(line).is_err() {
                                break;
                            }
                        }
                        Err(e) => log::warn!("事件序列化失败: {e}"),
                    }
                }
            });
            let status = engine.status().await;
            *session = Some(Session { engine, forwarder });
            Ok(serde_json::to_value(status)?)
        }
        Request::UpdateMembers { members } => {
            if let Some(s) = session.as_ref() {
                s.engine.update_members(members).await;
            }
            Ok(Value::Null)
        }
        Request::SignalIn { from, data } => {
            if let Some(s) = session.as_ref() {
                s.engine.signal_in(&from, data).await;
            }
            Ok(Value::Null)
        }
        Request::Stop | Request::Shutdown => {
            if let Some(s) = session.take() {
                s.stop().await;
            }
            Ok(Value::Null)
        }
        Request::Status => {
            let status = match session.as_ref() {
                Some(s) => s.engine.status().await,
                None => VlanStatus::stopped(),
            };
            Ok(serde_json::to_value(status)?)
        }
    }
}

// ---------- 应用端 ----------

type Pending = Arc<Mutex<HashMap<u64, oneshot::Sender<ReplyFrame>>>>;

/// 应用端的辅助进程句柄：创建管道、拉起辅助进程、校验 hello，然后转发请求与事件。
/// 丢弃句柄即关闭管道，辅助进程随之退出。
pub struct HelperClient {
    out_tx: mpsc::UnboundedSender<String>,
    pending: Pending,
    next_id: AtomicU64,
    alive: Arc<AtomicBool>,
    reader: Mutex<Option<JoinHandle<()>>>,
    writer: Mutex<Option<JoinHandle<()>>>,
}

fn lock_pending(p: &Pending) -> std::sync::MutexGuard<'_, HashMap<u64, oneshot::Sender<ReplyFrame>>> {
    p.lock().unwrap_or_else(|e| e.into_inner())
}

/// 创建单实例、拒绝远程、仅当前用户可访问的管道服务端
fn create_server(pipe_name: &str) -> Result<NamedPipeServer> {
    let mut opts = ServerOptions::new();
    opts.first_pipe_instance(true)
        .reject_remote_clients(true)
        .max_instances(1);
    match OwnerOnlySecurity::new() {
        // SAFETY: 安全属性结构在调用期间有效，且描述符由 OwnerOnlySecurity 拥有
        Ok(mut sec) => unsafe { opts.create_with_security_attributes_raw(pipe_name, sec.attributes_ptr()) },
        Err(e) => {
            log::warn!("无法生成仅当前用户的管道 DACL，退回默认: {e}");
            opts.create(pipe_name)
        }
    }
    .map_err(|e| anyhow!("创建管道 {pipe_name} 失败: {e}"))
}

impl HelperClient {
    /// 新的随机管道名
    pub fn new_pipe_name() -> String {
        format!("{PIPE_PREFIX}{}", nonce16())
    }

    /// 新的随机 token（32 位十六进制）
    pub fn new_token() -> String {
        format!("{}{}", nonce16(), nonce16())
    }

    /// 创建管道 → 调用 `launch(pipe, token)` 拉起辅助进程（阻塞线程里执行，可弹 UAC）→
    /// 等待连接与合法 hello（[`HELLO_TIMEOUT`]）。`launch` 的错误原样返回。
    pub async fn spawn<F>(
        pipe_name: &str,
        token: &str,
        launch: F,
    ) -> Result<(HelperClient, mpsc::Receiver<HelperEvent>)>
    where
        F: FnOnce(String, String) -> Result<()> + Send + 'static,
    {
        let server = create_server(pipe_name)?;
        let (p, t) = (pipe_name.to_string(), token.to_string());
        tokio::task::spawn_blocking(move || launch(p, t))
            .await
            .map_err(|e| anyhow!("启动辅助进程任务失败: {e}"))??;

        tokio::time::timeout(HELLO_TIMEOUT, server.connect())
            .await
            .map_err(|_| {
                anyhow!(
                    "{}：等待辅助进程连接超时（{} 秒）",
                    crate::elevation::ELEVATION_DENIED,
                    HELLO_TIMEOUT.as_secs()
                )
            })?
            .map_err(|e| anyhow!("等待辅助进程连接失败: {e}"))?;

        let (rd, wr) = tokio::io::split(server);
        let mut reader = BufReader::new(rd);
        let mut first = String::new();
        let n = tokio::time::timeout(HELLO_TIMEOUT, reader.read_line(&mut first))
            .await
            .map_err(|_| anyhow!("等待辅助进程 hello 超时"))?
            .map_err(|e| anyhow!("读取辅助进程 hello 失败: {e}"))?;
        if n == 0 {
            bail!("辅助进程未发送 hello 就断开了");
        }
        let hello: RequestFrame =
            serde_json::from_str(&first).map_err(|e| anyhow!("辅助进程 hello 无法解析: {e}"))?;
        match hello.req {
            Request::Hello { token: t } if t == token => {}
            Request::Hello { .. } => bail!("辅助进程 token 不匹配，已断开"),
            _ => bail!("辅助进程首帧不是 hello，已断开"),
        }

        let (out_tx, out_rx) = mpsc::unbounded_channel::<String>();
        let writer = tokio::spawn(write_loop(wr, out_rx));
        let (ev_tx, ev_rx) = mpsc::channel::<HelperEvent>(256);
        let pending: Pending = Arc::default();
        let alive = Arc::new(AtomicBool::new(true));
        let reader_task = {
            let pending = Arc::clone(&pending);
            let alive = Arc::clone(&alive);
            tokio::spawn(async move {
                let mut lines = reader.lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    if line.trim().is_empty() {
                        continue;
                    }
                    match serde_json::from_str::<Incoming>(&line) {
                        Ok(Incoming::Reply(r)) => {
                            if let Some(tx) = lock_pending(&pending).remove(&r.reply) {
                                let _ = tx.send(r);
                            }
                        }
                        Ok(Incoming::Event(e)) => {
                            if ev_tx.send(e.event).await.is_err() {
                                break;
                            }
                        }
                        Err(e) => log::warn!("辅助进程发来无法解析的帧: {e}: {line}"),
                    }
                }
                alive.store(false, Ordering::SeqCst);
                // 未完成的请求全部失败
                lock_pending(&pending).clear();
            })
        };

        Ok((
            HelperClient {
                out_tx,
                pending,
                next_id: AtomicU64::new(1),
                alive,
                reader: Mutex::new(Some(reader_task)),
                writer: Mutex::new(Some(writer)),
            },
            ev_rx,
        ))
    }

    /// 管道仍然连着
    pub fn is_alive(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
    }

    async fn call(&self, req: Request, timeout: Duration) -> Result<Value> {
        if !self.is_alive() {
            bail!("辅助进程已断开");
        }
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        lock_pending(&self.pending).insert(id, tx);
        let line = encode_line(&RequestFrame { id: Some(id), req })?;
        if self.out_tx.send(line).is_err() {
            lock_pending(&self.pending).remove(&id);
            bail!("辅助进程已断开");
        }
        let reply = match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(r)) => r,
            Ok(Err(_)) => bail!("辅助进程已断开"),
            Err(_) => {
                lock_pending(&self.pending).remove(&id);
                bail!("辅助进程无响应（{} 秒）", timeout.as_secs());
            }
        };
        if reply.ok {
            Ok(reply.result.unwrap_or(Value::Null))
        } else {
            Err(anyhow!(
                "{}",
                reply.error.unwrap_or_else(|| "辅助进程返回未知错误".to_string())
            ))
        }
    }

    pub async fn start(
        &self,
        self_id: String,
        vip: Ipv4Addr,
        members: Vec<MemberInfo>,
    ) -> Result<VlanStatus> {
        let v = self
            .call(
                Request::Start {
                    self_id,
                    vip,
                    members,
                },
                START_TIMEOUT,
            )
            .await?;
        serde_json::from_value(v).context("解析 VlanStatus 失败")
    }

    pub async fn update_members(&self, members: Vec<MemberInfo>) -> Result<()> {
        self.call(Request::UpdateMembers { members }, REQUEST_TIMEOUT)
            .await
            .map(|_| ())
    }

    pub async fn signal_in(&self, from: String, data: Value) -> Result<()> {
        self.call(Request::SignalIn { from, data }, REQUEST_TIMEOUT)
            .await
            .map(|_| ())
    }

    pub async fn stop(&self) -> Result<()> {
        self.call(Request::Stop, REQUEST_TIMEOUT).await.map(|_| ())
    }

    pub async fn status(&self) -> Result<VlanStatus> {
        let v = self.call(Request::Status, REQUEST_TIMEOUT).await?;
        serde_json::from_value(v).context("解析 VlanStatus 失败")
    }

    /// 让辅助进程退出：发 `shutdown` 并等待其断开，然后关闭管道
    pub async fn shutdown(&self) {
        if self.is_alive() {
            let _ = self.call(Request::Shutdown, SHUTDOWN_GRACE).await;
        }
        let reader = self.reader.lock().ok().and_then(|mut r| r.take());
        if let Some(r) = reader {
            let _ = tokio::time::timeout(SHUTDOWN_GRACE, r).await;
        }
        self.close_tasks();
    }

    fn close_tasks(&self) {
        self.alive.store(false, Ordering::SeqCst);
        if let Some(r) = self.reader.lock().ok().and_then(|mut r| r.take()) {
            r.abort();
        }
        if let Some(w) = self.writer.lock().ok().and_then(|mut w| w.take()) {
            w.abort();
        }
        lock_pending(&self.pending).clear();
    }
}

impl Drop for HelperClient {
    fn drop(&mut self) {
        // 中止读写任务即释放管道句柄；辅助进程读到 EOF 后自行退出
        self.close_tasks();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_frames_roundtrip() {
        let hello = encode_line(&RequestFrame {
            id: None,
            req: Request::Hello {
                token: "abc".into(),
            },
        })
        .expect("encode");
        assert_eq!(hello.trim(), r#"{"op":"hello","token":"abc"}"#);

        let start: RequestFrame = serde_json::from_str(
            r#"{"id":3,"op":"start","selfId":"me","vip":"10.77.0.2","members":[{"id":"me","vip":"10.77.0.2"}]}"#,
        )
        .expect("parse");
        assert_eq!(start.id, Some(3));
        assert!(matches!(start.req, Request::Start { ref self_id, .. } if self_id == "me"));

        let stop = encode_line(&RequestFrame {
            id: Some(7),
            req: Request::Stop,
        })
        .expect("encode");
        assert_eq!(stop.trim(), r#"{"id":7,"op":"stop"}"#);
    }

    #[test]
    fn event_and_reply_frames() {
        let ev = EventFrame {
            event: VlanEvent::SignalOut {
                to: "b".into(),
                data: serde_json::json!({"kind": "vlan-bye"}),
            }
            .into(),
        };
        let line = encode_line(&ev).expect("encode");
        assert!(line.contains(r#""kind":"signal_out""#) && line.contains(r#""to":"b""#));
        match serde_json::from_str::<Incoming>(&line).expect("parse") {
            Incoming::Event(e) => assert_eq!(e.event.kind, HelperEventKind::SignalOut),
            other => panic!("应解析为事件: {other:?}"),
        }
        let reply = r#"{"reply":5,"ok":false,"error":"boom"}"#;
        match serde_json::from_str::<Incoming>(reply).expect("parse") {
            Incoming::Reply(r) => assert_eq!((r.reply, r.ok, r.error.as_deref()), (5, false, Some("boom"))),
            other => panic!("应解析为应答: {other:?}"),
        }
    }

    #[test]
    fn helper_args_parse() {
        let a = HelperArgs::parse(
            ["app.exe", "--vlan-helper", r"\\.\pipe\x", "--wintun-dll", r"C:\w\wintun.dll", "--token", "t1"]
                .map(String::from),
        )
        .expect("helper mode");
        assert_eq!((a.pipe.as_str(), a.token.as_str()), (r"\\.\pipe\x", "t1"));
        assert_eq!(a.wintun_dll.as_deref(), Some(std::path::Path::new(r"C:\w\wintun.dll")));
        assert!(HelperArgs::parse(["app.exe", "--other"].map(String::from)).is_none());
    }
}
