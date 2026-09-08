//! 虚拟局域网引擎（REALTIME.md §7.1 / §7.2）。
//!
//! 每个对端一条"配对任务"：收集候选 → 发握手 → 等对端握手 → dial/accept → 转发循环；
//! 失败后 5 秒重试一次。所有取消都是协作式的（watch 通道），任务自己负责关闭 ICE Agent
//! （webrtc-ice 的 Agent 没有 Drop 清理，不能靠 abort）。每次（重）启动配对都换一个
//! `gen` 代号，旧任务发现代号不符就不再碰共享状态。
//!
//! 数据面：一个 TUN 读取任务按目的地址查 `routes`（vip → 连接）转发；
//! 每个已连通的对端在其配对任务里接收数据报、校验后写回 TUN。

use std::collections::HashMap;
use std::net::Ipv4Addr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, RwLock, RwLockReadGuard, RwLockWriteGuard, Weak};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use p2p_ice_chat::{Handshake, IceConfig, IceConn, IceEndpoint, Role};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;

use crate::packet::{self, Route};
use crate::tun::TunIo;

/// 虚拟局域网网段
pub const SUBNET: &str = "10.77.0.0/24";
/// 网段前缀长度
pub const PREFIX_LEN: u8 = 24;
/// 虚拟网卡 MTU
pub const MTU: u16 = 1280;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(90);
const RETRY_DELAY: Duration = Duration::from_secs(5);
/// 每个对端会话最多尝试次数（首次 + 重试一次）
const MAX_ATTEMPTS: u32 = 2;
/// 来自尚未出现在成员列表里的握手最多暂存多久（等前端随后的 `vlan_update_members`）
const PENDING_TTL: Duration = Duration::from_secs(120);
/// 停止时等待后台任务收尾的上限
const STOP_GRACE: Duration = Duration::from_secs(5);
/// 对端数据报接收缓冲（大于 MAX_PACKET，超长包由校验丢弃）
const RECV_BUF: usize = 2048;

const KIND_HANDSHAKE: &str = "vlan-handshake";
const KIND_BYE: &str = "vlan-bye";

/// 房间成员（来自 `room.members`）
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MemberInfo {
    pub id: String,
    pub vip: Ipv4Addr,
}

/// 对端连接状态；序列化为小写蛇形（"connecting" / …）
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PeerState {
    Connecting,
    Connected,
    Failed,
    Disconnected,
}

/// 对端状态快照
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PeerStatus {
    pub id: String,
    pub vip: Ipv4Addr,
    pub state: PeerState,
    pub tx_bytes: u64,
    pub rx_bytes: u64,
}

/// 引擎状态快照（§7.3 `VlanStatus`）
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct VlanStatus {
    pub running: bool,
    pub vip: Option<Ipv4Addr>,
    pub subnet: String,
    pub mtu: u16,
    pub peers: Vec<PeerStatus>,
    pub error: Option<String>,
}

impl VlanStatus {
    /// 未运行时的状态
    pub fn stopped() -> Self {
        Self {
            running: false,
            vip: None,
            subnet: SUBNET.to_string(),
            mtu: MTU,
            peers: Vec::new(),
            error: None,
        }
    }
}

/// 引擎推给调用方的事件
#[derive(Clone, Debug)]
pub enum VlanEvent {
    Started,
    Stopped,
    /// 对端状态变化（每次变化都会发）
    Peer(PeerStatus),
    /// 引擎级错误（如虚拟网卡读取失败）
    Error(String),
    /// 进度与诊断文本
    Log(String),
    /// 要经房间 `room.signal` 转发给成员 `to` 的信令
    SignalOut { to: String, data: Value },
}

/// 对端握手的身份：(对端 session, ufrag)。同一 session 内每次重新收集 ufrag 都会变。
type HsKey = (String, String);

/// 收到的 `vlan-handshake` 信令
#[derive(Deserialize)]
struct HandshakeSignal {
    #[serde(default)]
    session: String,
    #[serde(flatten)]
    hs: Handshake,
}

/// 路由表条目：已连通对端的连接与发送计数
#[derive(Clone)]
struct Link {
    conn: Arc<IceConn>,
    tx_bytes: Arc<AtomicU64>,
}

impl Link {
    async fn send(&self, pkt: &[u8]) {
        if self.conn.send(pkt).await.is_ok() {
            self.tx_bytes.fetch_add(pkt.len() as u64, Ordering::Relaxed);
        }
    }
}

type Routes = Arc<RwLock<HashMap<Ipv4Addr, Link>>>;

/// 配对任务的控制句柄
struct Driver {
    gen: u64,
    hs_tx: mpsc::UnboundedSender<Handshake>,
    cancel: watch::Sender<bool>,
    handle: JoinHandle<()>,
}

struct Peer {
    info: MemberInfo,
    state: PeerState,
    tx_bytes: Arc<AtomicU64>,
    rx_bytes: Arc<AtomicU64>,
    /// 对端当前 session（来自其握手）；变化即视为对端重启
    remote_session: Option<String>,
    /// 当前尝试已采用（或已投递给任务）的对端握手身份
    remote_key: Option<HsKey>,
    /// 当前对端 session 内已用掉的尝试次数；连通后清零
    attempts: u32,
    driver: Option<Driver>,
}

impl Peer {
    fn new(info: MemberInfo) -> Self {
        Self {
            info,
            state: PeerState::Connecting,
            tx_bytes: Arc::new(AtomicU64::new(0)),
            rx_bytes: Arc::new(AtomicU64::new(0)),
            remote_session: None,
            remote_key: None,
            attempts: 0,
            driver: None,
        }
    }

    fn status(&self) -> PeerStatus {
        PeerStatus {
            id: self.info.id.clone(),
            vip: self.info.vip,
            state: self.state,
            tx_bytes: self.tx_bytes.load(Ordering::Relaxed),
            rx_bytes: self.rx_bytes.load(Ordering::Relaxed),
        }
    }

    /// 取消配对任务（任务会自行关闭连接与 Agent）
    fn cancel_driver(&mut self) -> Option<JoinHandle<()>> {
        let d = self.driver.take()?;
        let _ = d.cancel.send(true);
        Some(d.handle)
    }
}

struct Inner {
    running: bool,
    error: Option<String>,
    tun: Option<Arc<dyn TunIo>>,
    peers: HashMap<String, Peer>,
    /// 来自尚未加入成员列表者的握手，等 `update_members` 时接上
    pending: HashMap<String, (HsKey, Handshake, Instant)>,
    tun_task: Option<JoinHandle<()>>,
    forwarder: Option<JoinHandle<()>>,
    next_gen: u64,
}

impl Inner {
    /// 仅当该对端的当前配对任务代号是 `gen` 时返回它（旧任务不得再改状态）
    fn peer_for_gen(&mut self, id: &str, gen: u64) -> Option<&mut Peer> {
        self.peers
            .get_mut(id)
            .filter(|p| p.driver.as_ref().map(|d| d.gen) == Some(gen))
    }
}

/// 一次配对尝试的结局
enum Outcome {
    /// 被取消（成员离开 / 对端 bye / 重启配对 / 停止），状态由取消方处理
    Cancelled,
    /// 协商失败
    Failed(String),
    /// 连通后中断
    Lost(String),
}

/// 虚拟局域网引擎；用 [`VlanEngine::start`] 创建，[`VlanEngine::stop`] 停止
pub struct VlanEngine {
    self_id: String,
    vip: Ipv4Addr,
    session: String,
    ice: IceConfig,
    routes: Routes,
    events: mpsc::UnboundedSender<VlanEvent>,
    inner: Mutex<Inner>,
    me: Weak<VlanEngine>,
}

impl VlanEngine {
    /// 启动引擎：接管 `tun`，为 `members` 中除自己外的每个成员发起协商。
    /// 必须在 tokio 运行时内调用（会 spawn 后台任务）。
    pub fn start(
        self_id: String,
        vip: Ipv4Addr,
        members: Vec<MemberInfo>,
        tun: impl TunIo,
        ice: IceConfig,
        events: mpsc::Sender<VlanEvent>,
    ) -> Arc<VlanEngine> {
        let (utx, urx) = mpsc::unbounded_channel();
        let forwarder = tokio::spawn(forward_events(urx, events));
        let tun: Arc<dyn TunIo> = Arc::new(tun);
        let session = new_session();
        let subnet_bcast = packet::subnet_broadcast(vip, PREFIX_LEN);

        let engine = Arc::new_cyclic(|me| VlanEngine {
            self_id,
            vip,
            session: session.clone(),
            ice,
            routes: Arc::new(RwLock::new(HashMap::new())),
            events: utx,
            inner: Mutex::new(Inner {
                running: true,
                error: None,
                tun: Some(Arc::clone(&tun)),
                peers: HashMap::new(),
                pending: HashMap::new(),
                tun_task: None,
                forwarder: Some(forwarder),
                next_gen: 1,
            }),
            me: me.clone(),
        });

        let tun_task = tokio::spawn(tun_reader(
            Arc::downgrade(&engine),
            tun,
            Arc::clone(&engine.routes),
            subnet_bcast,
        ));
        engine.log(format!(
            "虚拟局域网已启动：本机 {vip}（{SUBNET}，MTU {MTU}），会话 {session}"
        ));
        engine.emit(VlanEvent::Started);
        {
            let mut inner = engine.lock();
            inner.tun_task = Some(tun_task);
            engine.apply_members(&mut inner, members);
        }
        engine
    }

    /// 本机虚拟 IP
    pub fn vip(&self) -> Ipv4Addr {
        self.vip
    }

    /// 本端会话串（16 位十六进制）
    pub fn session(&self) -> &str {
        &self.session
    }

    /// 成员列表变化：新成员发起协商，离开的成员断开并释放
    pub async fn update_members(&self, members: Vec<MemberInfo>) {
        let mut inner = self.lock();
        if !inner.running {
            return;
        }
        self.apply_members(&mut inner, members);
    }

    /// 喂入对端经房间转发来的信令（`kind` 以 `vlan-` 开头）
    pub async fn signal_in(&self, from: &str, data: Value) {
        let kind = data
            .get("kind")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        match kind.as_str() {
            KIND_BYE => self.on_bye(from),
            KIND_HANDSHAKE => match serde_json::from_value::<HandshakeSignal>(data) {
                Ok(sig) => self.on_handshake(from, sig),
                Err(e) => self.log(format!("[{from}] 握手信令无法解析，已忽略: {e}")),
            },
            other => self.log(format!("[{from}] 未知信令 kind={other:?}，已忽略")),
        }
    }

    /// 当前状态快照
    pub async fn status(&self) -> VlanStatus {
        let inner = self.lock();
        if !inner.running {
            return VlanStatus::stopped();
        }
        let mut peers: Vec<PeerStatus> = inner.peers.values().map(Peer::status).collect();
        peers.sort_by(|a, b| a.id.cmp(&b.id));
        VlanStatus {
            running: true,
            vip: Some(self.vip),
            subnet: SUBNET.to_string(),
            mtu: MTU,
            peers,
            error: inner.error.clone(),
        }
    }

    /// 停止：向所有对端发 `vlan-bye`，断开全部连接，释放虚拟网卡；可重复调用
    pub async fn stop(&self) {
        let (drivers, tun_task, forwarder) = {
            let mut inner = self.lock();
            if !inner.running {
                return;
            }
            inner.running = false;
            let mut drivers = Vec::new();
            let ids: Vec<String> = inner.peers.keys().cloned().collect();
            for id in ids {
                self.emit(VlanEvent::SignalOut {
                    to: id.clone(),
                    data: json!({ "kind": KIND_BYE }),
                });
                if let Some(p) = inner.peers.get_mut(&id) {
                    drivers.extend(p.cancel_driver());
                    self.set_state(p, PeerState::Disconnected);
                }
            }
            inner.peers.clear();
            inner.pending.clear();
            write_routes(&self.routes).clear();
            inner.tun = None;
            (drivers, inner.tun_task.take(), inner.forwarder.take())
        };

        // TUN 读取任务可以直接中止：内存网卡/Wintun 的 recv 都是取消安全的
        if let Some(t) = tun_task {
            t.abort();
            let _ = t.await;
        }
        // 配对任务协作式退出（关闭各自的 ICE Agent）；总共最多等 STOP_GRACE
        let deadline = tokio::time::Instant::now() + STOP_GRACE;
        for d in drivers {
            let _ = tokio::time::timeout_at(deadline, d).await;
        }
        self.log("虚拟局域网已停止");
        self.emit(VlanEvent::Stopped);
        if let Some(f) = forwarder {
            let _ = tokio::time::timeout(STOP_GRACE, f).await;
        }
    }

    // ---------- 内部 ----------

    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|p| p.into_inner())
    }

    fn emit(&self, ev: VlanEvent) {
        let _ = self.events.send(ev);
    }

    fn log(&self, text: impl Into<String>) {
        self.emit(VlanEvent::Log(text.into()));
    }

    /// 引擎级故障：记录并上报
    fn fail(&self, text: String) {
        {
            let mut inner = self.lock();
            inner.error = Some(text.clone());
        }
        self.log(format!("错误: {text}"));
        self.emit(VlanEvent::Error(text));
    }

    /// 更新对端状态并在变化时上报
    fn set_state(&self, peer: &mut Peer, state: PeerState) {
        if peer.state != state {
            peer.state = state;
            self.emit(VlanEvent::Peer(peer.status()));
        }
    }

    fn role_for(&self, peer_id: &str) -> Role {
        if self.self_id.as_str() < peer_id {
            Role::Offer
        } else {
            Role::Answer
        }
    }

    fn apply_members(&self, inner: &mut Inner, members: Vec<MemberInfo>) {
        let wanted: HashMap<String, MemberInfo> = members
            .into_iter()
            .filter(|m| m.id != self.self_id)
            .map(|m| (m.id.clone(), m))
            .collect();

        // 离开的成员（或 vip 变了的成员：当作离开再加入）
        let gone: Vec<String> = inner
            .peers
            .iter()
            .filter(|(id, p)| wanted.get(*id).map_or(true, |m| m.vip != p.info.vip))
            .map(|(id, _)| id.clone())
            .collect();
        for id in gone {
            if let Some(mut p) = inner.peers.remove(&id) {
                p.cancel_driver();
                write_routes(&self.routes).remove(&p.info.vip);
                self.set_state(&mut p, PeerState::Disconnected);
                self.log(format!("[{id}] 成员已离开，断开并释放"));
            }
        }

        // 新成员
        let mut ids: Vec<&String> = wanted.keys().collect();
        ids.sort();
        for id in ids {
            if inner.peers.contains_key(id) {
                continue;
            }
            let info = wanted[id].clone();
            self.log(format!(
                "[{id}] 新成员 {}，角色 {}",
                info.vip,
                self.role_for(id).as_str()
            ));
            let peer = Peer::new(info);
            // 新成员的初始状态（connecting）也要上报，UI 才能立刻显示它
            self.emit(VlanEvent::Peer(peer.status()));
            inner.peers.insert(id.clone(), peer);
            let presupplied = inner
                .pending
                .remove(id)
                .filter(|(_, _, at)| at.elapsed() < PENDING_TTL)
                .map(|(key, hs, _)| (key, hs));
            if let Some((key, _)) = &presupplied {
                if let Some(p) = inner.peers.get_mut(id) {
                    p.remote_session = Some(key.0.clone());
                }
                self.log(format!("[{id}] 使用此前暂存的握手"));
            }
            self.start_driver(inner, id, presupplied);
        }
    }

    /// （重）启动某对端的配对任务；`presupplied` 为已收到的对端握手
    fn start_driver(&self, inner: &mut Inner, id: &str, presupplied: Option<(HsKey, Handshake)>) {
        let gen = inner.next_gen;
        inner.next_gen += 1;
        let Some(p) = inner.peers.get_mut(id) else {
            return;
        };
        p.cancel_driver();
        write_routes(&self.routes).remove(&p.info.vip);

        let (hs_tx, hs_rx) = mpsc::unbounded_channel();
        let (cancel_tx, cancel_rx) = watch::channel(false);
        let (key, hs) = presupplied.unzip();
        p.remote_key = key;
        self.set_state(p, PeerState::Connecting);
        let handle = tokio::spawn(drive_pair(
            self.me.clone(),
            p.info.clone(),
            gen,
            hs_rx,
            cancel_rx,
            hs,
        ));
        p.driver = Some(Driver {
            gen,
            hs_tx,
            cancel: cancel_tx,
            handle,
        });
    }

    fn on_handshake(&self, from: &str, sig: HandshakeSignal) {
        if !sig.hs.is_complete() {
            self.log(format!("[{from}] 握手不完整，已忽略"));
            return;
        }
        let key: HsKey = (sig.session.clone(), sig.hs.u.clone());
        let mut inner = self.lock();
        if !inner.running {
            return;
        }
        let Some(p) = inner.peers.get_mut(from) else {
            self.log(format!("[{from}] 收到尚未在成员列表中的成员的握手，暂存等待成员列表更新"));
            inner
                .pending
                .insert(from.to_string(), (key, sig.hs, Instant::now()));
            return;
        };

        // 对端 session 变化 = 对端重启：重置尝试计数
        if p.remote_session.as_deref() != Some(key.0.as_str()) {
            match &p.remote_session {
                Some(old) => self.log(format!(
                    "[{from}] 对端会话已变化（{old} → {}），重新协商",
                    key.0
                )),
                None => self.log(format!("[{from}] 对端会话 {}", key.0)),
            }
            p.remote_session = Some(key.0.clone());
            p.attempts = 0;
        }

        match (&p.driver, &p.remote_key) {
            // 当前尝试正等着对端握手：直接投递
            (Some(d), None) => {
                self.log(format!(
                    "[{from}] 收到对端握手（{} 个候选）",
                    sig.hs.c.len()
                ));
                p.remote_key = Some(key);
                let _ = d.hs_tx.send(sig.hs);
                return;
            }
            // 与当前尝试用的是同一份握手：重复投递，忽略
            (Some(_), Some(k)) if *k == key => return,
            _ => {}
        }

        // 其余情况（对端重新收集 / 本端已终止）：重启配对
        if p.attempts >= MAX_ATTEMPTS {
            self.log(format!("[{from}] 收到新握手，但本端对该会话已达尝试上限，忽略"));
            return;
        }
        self.log(format!(
            "[{from}] 收到新的对端握手（{} 个候选），重启配对",
            sig.hs.c.len()
        ));
        self.start_driver(&mut inner, from, Some((key, sig.hs)));
    }

    fn on_bye(&self, from: &str) {
        let mut inner = self.lock();
        if !inner.running {
            return;
        }
        inner.pending.remove(from);
        let Some(p) = inner.peers.get_mut(from) else {
            return;
        };
        p.cancel_driver();
        write_routes(&self.routes).remove(&p.info.vip);
        p.remote_key = None;
        p.remote_session = None;
        p.attempts = 0;
        self.set_state(p, PeerState::Disconnected);
        self.log(format!("[{from}] 对端已退出虚拟局域网"));
    }

    /// 一次配对尝试失败后的处理：置 Failed，返回是否重试
    fn on_attempt_failed(&self, peer: &MemberInfo, gen: u64, reason: &str) -> bool {
        let mut inner = self.lock();
        let Some(p) = inner.peer_for_gen(&peer.id, gen) else {
            return false;
        };
        self.set_state(p, PeerState::Failed);
        let retry = p.attempts < MAX_ATTEMPTS;
        if retry {
            self.log(format!(
                "[{}] 连接失败：{reason}；{} 秒后重试",
                peer.id,
                RETRY_DELAY.as_secs()
            ));
        } else {
            self.log(format!(
                "[{}] 连接失败：{reason}；已放弃（对端重新发起时再协商）",
                peer.id
            ));
        }
        retry
    }

    /// 一次配对尝试：收集 → 握手 → 打洞 → 转发循环
    async fn attempt(
        &self,
        peer: &MemberInfo,
        gen: u64,
        hs_rx: &mut mpsc::UnboundedReceiver<Handshake>,
        cancel: &mut watch::Receiver<bool>,
        presupplied: Option<Handshake>,
    ) -> Outcome {
        let role = self.role_for(&peer.id);
        {
            let mut inner = self.lock();
            let Some(p) = inner.peer_for_gen(&peer.id, gen) else {
                return Outcome::Cancelled;
            };
            p.attempts += 1;
            if presupplied.is_none() {
                p.remote_key = None;
            }
            let n = p.attempts;
            self.set_state(p, PeerState::Connecting);
            self.log(format!(
                "[{}] 第 {n} 次协商（角色 {}）：正在收集候选地址…",
                peer.id,
                role.as_str()
            ));
        }

        // 收集候选。不在这里响应取消：Agent 在 gather 内部创建，中途丢弃会泄漏；
        // 收集有 20 秒上限，之后再检查取消并关闭。
        let log_tx = self.events.clone();
        let log_id = peer.id.clone();
        let (endpoint, local_hs) = match IceEndpoint::gather(&self.ice, move |s| {
            let _ = log_tx.send(VlanEvent::Log(format!("[{log_id}] {s}")));
        })
        .await
        {
            Ok(v) => v,
            Err(e) => return Outcome::Failed(format!("收集候选地址失败: {e}")),
        };
        if is_cancelled(cancel) {
            endpoint.close().await;
            return Outcome::Cancelled;
        }

        // 发出本端握手
        self.send_handshake(&peer.id, &local_hs);
        self.log(format!(
            "[{}] 已发送握手（{} 个候选），等待对端…",
            peer.id,
            local_hs.c.len()
        ));

        // 等对端握手；拿到后再发一次本端握手——对端可能在我们发第一次时还没把我们加进成员列表
        let remote = match presupplied {
            Some(hs) => hs,
            None => {
                let hs = tokio::select! {
                    r = hs_rx.recv() => match r {
                        Some(hs) => hs,
                        None => {
                            endpoint.close().await;
                            return Outcome::Cancelled;
                        }
                    },
                    _ = wait_cancel(cancel) => {
                        endpoint.close().await;
                        return Outcome::Cancelled;
                    }
                };
                self.send_handshake(&peer.id, &local_hs);
                hs
            }
        };

        // 打洞
        self.log(format!("[{}] 正在建立 P2P 连接…", peer.id));
        let closer = endpoint.close_handle();
        let conn = tokio::select! {
            r = endpoint.connect(role, &remote, CONNECT_TIMEOUT) => match r {
                Ok(c) => Arc::new(c),
                Err(e) => return Outcome::Failed(e.to_string()),
            },
            _ = wait_cancel(cancel) => {
                closer.close().await;
                return Outcome::Cancelled;
            }
        };

        // 登记路由
        let registered = {
            let mut inner = self.lock();
            let tun = inner.tun.clone();
            match (inner.peer_for_gen(&peer.id, gen), tun) {
                (Some(p), Some(tun)) => {
                    p.attempts = 0;
                    write_routes(&self.routes).insert(
                        peer.vip,
                        Link {
                            conn: Arc::clone(&conn),
                            tx_bytes: Arc::clone(&p.tx_bytes),
                        },
                    );
                    self.set_state(p, PeerState::Connected);
                    Some((tun, Arc::clone(&p.rx_bytes)))
                }
                _ => None,
            }
        };
        let Some((tun, rx_bytes)) = registered else {
            conn.close().await;
            return Outcome::Cancelled;
        };
        self.log(format!("[{}] P2P 已连通（{}）", peer.id, peer.vip));

        // 转发循环：对端数据报 → 校验 → TUN
        let closed = conn.closed();
        tokio::pin!(closed);
        let mut buf = vec![0u8; RECV_BUF];
        let outcome = loop {
            tokio::select! {
                biased;
                _ = wait_cancel(cancel) => break Outcome::Cancelled,
                _ = &mut closed => break Outcome::Lost(format!("ICE 连接中断（{}）", conn.state())),
                r = conn.recv(&mut buf) => match r {
                    Ok(n) => {
                        let pkt = &buf[..n];
                        if packet::accept_inbound(pkt, peer.vip) && tun.send(pkt).await.is_ok() {
                            rx_bytes.fetch_add(n as u64, Ordering::Relaxed);
                        }
                    }
                    Err(e) => break Outcome::Lost(e.to_string()),
                },
            }
        };

        // 撤销路由（只撤自己登记的那条）
        {
            let mut inner = self.lock();
            if inner.peer_for_gen(&peer.id, gen).is_some() {
                let mut routes = write_routes(&self.routes);
                if routes
                    .get(&peer.vip)
                    .is_some_and(|l| Arc::ptr_eq(&l.conn, &conn))
                {
                    routes.remove(&peer.vip);
                }
            }
        }
        conn.close().await;
        outcome
    }

    fn send_handshake(&self, to: &str, hs: &Handshake) {
        self.emit(VlanEvent::SignalOut {
            to: to.to_string(),
            data: json!({
                "kind": KIND_HANDSHAKE,
                "session": self.session,
                "u": hs.u,
                "p": hs.p,
                "c": hs.c,
            }),
        });
    }
}

/// 配对任务：循环尝试直到成功后中断且不再重试、或被取消
async fn drive_pair(
    engine: Weak<VlanEngine>,
    peer: MemberInfo,
    gen: u64,
    mut hs_rx: mpsc::UnboundedReceiver<Handshake>,
    mut cancel: watch::Receiver<bool>,
    mut presupplied: Option<Handshake>,
) {
    loop {
        let Some(eng) = engine.upgrade() else {
            return;
        };
        let outcome = eng
            .attempt(&peer, gen, &mut hs_rx, &mut cancel, presupplied.take())
            .await;
        let retry = match outcome {
            Outcome::Cancelled => false,
            Outcome::Failed(reason) | Outcome::Lost(reason) => {
                eng.on_attempt_failed(&peer, gen, &reason)
            }
        };
        drop(eng);
        if !retry {
            return;
        }
        tokio::select! {
            _ = tokio::time::sleep(RETRY_DELAY) => {}
            _ = wait_cancel(&mut cancel) => return,
        }
    }
}

/// TUN 读取任务：按 §7.2 规则转发到对端
async fn tun_reader(
    engine: Weak<VlanEngine>,
    tun: Arc<dyn TunIo>,
    routes: Routes,
    subnet_bcast: Ipv4Addr,
) {
    let mut buf = vec![0u8; 65536];
    loop {
        let n = match tun.recv(&mut buf).await {
            Ok(n) => n,
            Err(e) => {
                if let Some(eng) = engine.upgrade() {
                    eng.fail(format!("虚拟网卡读取失败: {e}"));
                }
                return;
            }
        };
        let pkt = &buf[..n];
        match packet::route(pkt, subnet_bcast) {
            Route::Drop(_) => {}
            Route::Unicast(dst) => {
                let link = read_routes(&routes).get(&dst).cloned();
                if let Some(link) = link {
                    link.send(pkt).await;
                }
            }
            Route::Broadcast => {
                let links: Vec<Link> = read_routes(&routes).values().cloned().collect();
                for link in links {
                    link.send(pkt).await;
                }
            }
        }
    }
}

/// 把内部无界队列按序推给调用方的有界通道；转发完 `Stopped` 即退出
async fn forward_events(mut rx: mpsc::UnboundedReceiver<VlanEvent>, out: mpsc::Sender<VlanEvent>) {
    while let Some(ev) = rx.recv().await {
        let last = matches!(ev, VlanEvent::Stopped);
        if out.send(ev).await.is_err() || last {
            break;
        }
    }
}

fn read_routes(routes: &Routes) -> RwLockReadGuard<'_, HashMap<Ipv4Addr, Link>> {
    routes.read().unwrap_or_else(|p| p.into_inner())
}

fn write_routes(routes: &Routes) -> RwLockWriteGuard<'_, HashMap<Ipv4Addr, Link>> {
    routes.write().unwrap_or_else(|p| p.into_inner())
}

fn is_cancelled(rx: &mut watch::Receiver<bool>) -> bool {
    *rx.borrow_and_update()
}

/// 在取消标记置位（或发送端丢弃）时完成；可重复等待
async fn wait_cancel(rx: &mut watch::Receiver<bool>) {
    loop {
        if *rx.borrow_and_update() {
            return;
        }
        if rx.changed().await.is_err() {
            return;
        }
    }
}

static SESSION_COUNTER: AtomicU64 = AtomicU64::new(0);

/// 生成 16 位十六进制会话串：时间戳、进程内计数与栈地址混合后过几轮 xorshift
pub(crate) fn new_session() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0x9E37_79B9_7F4A_7C15);
    let counter = SESSION_COUNTER.fetch_add(1, Ordering::Relaxed);
    let stack_probe = 0u8;
    let addr = &stack_probe as *const u8 as usize as u64;
    let mut x = nanos ^ addr.rotate_left(32) ^ counter.wrapping_mul(0x9E37_79B9_7F4A_7C15);
    if x == 0 {
        x = 0x2545_F491_4F6C_DD1D;
    }
    for _ in 0..4 {
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
    }
    format!("{:016x}", x.wrapping_mul(0x2545_F491_4F6C_DD1D))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_is_16_hex_and_unique() {
        let a = new_session();
        let b = new_session();
        assert_eq!(a.len(), 16);
        assert!(a.bytes().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }

    #[test]
    fn peer_state_serializes_snake_case() {
        assert_eq!(
            serde_json::to_string(&PeerState::Connecting).ok().as_deref(),
            Some("\"connecting\"")
        );
        let m: MemberInfo = serde_json::from_value(json!({"id": "u1", "vip": "10.77.0.3"}))
            .expect("member parses");
        assert_eq!(m.vip, Ipv4Addr::new(10, 77, 0, 3));
    }

    #[test]
    fn handshake_signal_parses_with_flatten() {
        let sig: HandshakeSignal = serde_json::from_value(json!({
            "kind": "vlan-handshake", "session": "abc", "u": "u", "p": "p", "c": ["cand"]
        }))
        .expect("signal parses");
        assert_eq!(sig.session, "abc");
        assert!(sig.hs.is_complete());
        assert_eq!(sig.hs.n, None);
    }
}
