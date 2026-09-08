//! 与信令方式无关的 ICE 核心（基于 webrtc-ice）。
//!
//! 流程：[`IceEndpoint::gather`] 收集本机候选并生成 [`Handshake`] →
//! 调用方经任意信道（房间 `room.signal`…）与对端交换握手 →
//! [`IceEndpoint::connect`] 按角色 dial / accept，得到可直接收发数据报的 [`IceConn`]。
//!
//! webrtc-ice 的 `Agent` 没有 `Drop` 清理，所以这里保证每条路径（成功、失败、主动关闭）
//! 都会调用 `agent.close()`；中途放弃时请调用 [`IceEndpoint::close`] 或 [`IceCloseHandle::close`]。

use std::future::Future;
use std::net::IpAddr;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::{anyhow, ensure, Context, Result};
use serde::{Deserialize, Serialize};
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;
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

/// 与 ICE 拨号方式对应的角色
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Role {
    /// controlling，调用 dial
    Offer,
    /// controlled，调用 accept
    Answer,
}

impl Role {
    pub fn label(self) -> &'static str {
        match self {
            Role::Offer => "offer（发起方 / controlling）",
            Role::Answer => "answer（应答方 / controlled）",
        }
    }

    /// 协议中的角色字符串："offer" / "answer"
    pub fn as_str(self) -> &'static str {
        match self {
            Role::Offer => "offer",
            Role::Answer => "answer",
        }
    }

    /// 解析协议中的角色字符串
    pub fn from_server(s: &str) -> Result<Role> {
        match s {
            "offer" => Ok(Role::Offer),
            "answer" => Ok(Role::Answer),
            other => Err(anyhow!("未知角色: {other}")),
        }
    }
}

/// 候选地址收集上限
pub const GATHER_TIMEOUT: Duration = Duration::from_secs(20);
/// 默认 STUN 服务器
pub const DEFAULT_STUN_URL: &str = "stun:stun.l.google.com:19302";

/// 本机地址过滤器：返回 `false` 的地址不参与候选收集
pub type IpFilter = Arc<dyn Fn(IpAddr) -> bool + Send + Sync>;
/// 网卡名过滤器：返回 `false` 的网卡不参与候选收集
pub type InterfaceFilter = Arc<dyn Fn(&str) -> bool + Send + Sync>;

/// ICE 收集参数
#[derive(Clone)]
pub struct IceConfig {
    /// STUN 服务器列表；为空则仅收集本机候选地址
    pub stun_urls: Vec<String>,
    /// 防火墙唤醒：开一个空闲 TCP 监听以触发"Windows 安全中心警报"弹窗（见 [`spawn_firewall_probe`]）
    pub firewall_probe: bool,
    /// 只把通过过滤的本机地址作为候选。
    /// webrtc-ice 的 controlling 端会提名"最先验证成功"的候选对且不再回退，
    /// 代理/虚拟网卡（fake-IP TUN、自己的 VLAN 网卡…）上验证通过却走不通的地址会让协商卡死，
    /// 因此建议把这类地址过滤掉。`None` 表示不过滤。
    pub ip_filter: Option<IpFilter>,
    /// 按网卡名过滤（如排除自己的 VLAN 网卡）。`None` 表示不过滤。
    pub interface_filter: Option<InterfaceFilter>,
}

impl Default for IceConfig {
    fn default() -> Self {
        Self {
            stun_urls: vec![DEFAULT_STUN_URL.to_string()],
            firewall_probe: false,
            ip_filter: None,
            interface_filter: None,
        }
    }
}

impl std::fmt::Debug for IceConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("IceConfig")
            .field("stun_urls", &self.stun_urls)
            .field("firewall_probe", &self.firewall_probe)
            .field("ip_filter", &self.ip_filter.is_some())
            .field("interface_filter", &self.interface_filter.is_some())
            .finish()
    }
}

/// 经信令交换的握手信息：ufrag / pwd + 全部候选地址 + 可选显示名。
/// `n` 为后加字段，带 `default` 以兼容旧版客户端发来的握手（旧版可能发空串）。
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Handshake {
    pub u: String,
    pub p: String,
    pub c: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub n: Option<String>,
}

impl Handshake {
    /// 三要素齐全才算一份可用的握手
    pub fn is_complete(&self) -> bool {
        !self.u.is_empty() && !self.p.is_empty() && !self.c.is_empty()
    }

    /// 非空显示名
    pub fn display_name(&self) -> Option<&str> {
        self.n.as_deref().filter(|n| !n.is_empty())
    }
}

/// webrtc-ice 交出的原始 P2P 连接
pub type IceRawConn = Arc<dyn Conn + Send + Sync>;

type LogFn = Arc<dyn Fn(String) + Send + Sync>;

/// 防火墙唤醒: 防火墙授权弹窗只挂在 TCP listen 上，纯 UDP 应用永远不触发；
/// 这里开一个空闲 TCP 监听让系统弹出"Windows 安全中心警报"，用户点"允许访问"后
/// 生成的规则面向整个 exe（TCP+UDP 一起放行），UDP 打洞的入站包随之解封。
/// 返回的任务在连接关闭时被中止。
async fn spawn_firewall_probe(log: &LogFn) -> Option<JoinHandle<()>> {
    match tokio::net::TcpListener::bind("0.0.0.0:0").await {
        Ok(l) => {
            let addr = l
                .local_addr()
                .map(|a| a.to_string())
                .unwrap_or_else(|_| "0.0.0.0:0".to_string());
            log(format!("    防火墙唤醒: 正在监听 tcp/{addr} —— 若弹出\"Windows 安全中心警报\"，请勾选\"专用网络\"和\"公用网络\"后点\"允许访问\"（已放行过则不会再弹）"));
            Some(tokio::spawn(async move {
                loop {
                    match l.accept().await {
                        Ok((_sock, _)) => {} // 仅用于触发弹窗，连接直接丢弃
                        Err(_) => break,
                    }
                }
            }))
        }
        Err(e) => {
            log(format!("    （防火墙唤醒监听创建失败，跳过: {e}）"));
            None
        }
    }
}

/// 防火墙唤醒任务的共享句柄：端点、连接、关闭句柄三者共用，谁先关闭谁负责中止
type SharedProbe = Arc<Mutex<Option<JoinHandle<()>>>>;

fn abort_probe(probe: &SharedProbe) {
    if let Some(h) = probe.lock().ok().and_then(|mut p| p.take()) {
        h.abort();
    }
}

/// 可在任意任务里关闭 Agent 的句柄：用于放弃一个正在 `connect` 中（已被 move 走）的端点。
#[derive(Clone)]
pub struct IceCloseHandle {
    agent: Arc<Agent>,
    probe: SharedProbe,
}

impl IceCloseHandle {
    pub async fn close(&self) {
        abort_probe(&self.probe);
        let _ = self.agent.close().await;
    }
}

/// 已收集完候选地址、等待与对端握手的 ICE 端点
pub struct IceEndpoint {
    agent: Arc<Agent>,
    state_rx: watch::Receiver<ConnectionState>,
    probe: SharedProbe,
    log: LogFn,
}

impl IceEndpoint {
    /// 创建 Agent 并收集本机候选地址（最多 [`GATHER_TIMEOUT`]），返回端点与本端握手信息。
    /// `log` 会收到收集进度与之后的 ICE 状态变化文本。
    pub async fn gather(
        cfg: &IceConfig,
        log: impl Fn(String) + Send + Sync + 'static,
    ) -> Result<(IceEndpoint, Handshake)> {
        let log: LogFn = Arc::new(log);

        // 1. 创建 ICE Agent
        let mut ac = AgentConfig::default();
        ac.udp_network = UDPNetwork::Ephemeral(Default::default());
        ac.network_types = vec![NetworkType::Udp4, NetworkType::Udp6];
        ac.multicast_dns_mode = MulticastDnsMode::Disabled; // 候选地址用真实 IP，方便直连
        ac.include_loopback = true; // 允许本机双开测试
        if let Some(f) = cfg.ip_filter.clone() {
            ac.ip_filter = Arc::new(Some(Box::new(move |ip: IpAddr| f(ip))));
        }
        if let Some(f) = cfg.interface_filter.clone() {
            ac.interface_filter = Arc::new(Some(Box::new(move |name: &str| f(name))));
        }
        for s in &cfg.stun_urls {
            ac.urls
                .push(Url::parse_url(s).with_context(|| format!("解析 STUN 地址失败: {s}"))?);
        }
        let agent = Arc::new(Agent::new(ac).await.context("创建 ICE Agent 失败")?);
        if cfg.stun_urls.is_empty() {
            log("    未使用 STUN 服务器（仅收集本机候选地址）".to_string());
        } else {
            for u in &cfg.stun_urls {
                log(format!("    STUN 服务器: {u}"));
            }
        }

        let probe = if cfg.firewall_probe {
            spawn_firewall_probe(&log).await
        } else {
            None
        };

        // 2. 连接状态回调
        let (state_tx, state_rx) = watch::channel(ConnectionState::New);
        {
            let log = Arc::clone(&log);
            agent.on_connection_state_change(Box::new(move |s: ConnectionState| {
                let tx = state_tx.clone();
                let log = Arc::clone(&log);
                Box::pin(async move {
                    log(format!("[ICE] 连接状态: {s}"));
                    let _ = tx.send(s);
                })
            }));
        }

        let endpoint = IceEndpoint {
            agent,
            state_rx,
            probe: Arc::new(Mutex::new(probe)),
            log,
        };

        // 3. trickle 收集本地候选地址；失败时关闭 Agent
        match endpoint.gather_local().await {
            Ok(hs) => Ok((endpoint, hs)),
            Err(e) => {
                endpoint.close().await;
                Err(e)
            }
        }
    }

    async fn gather_local(&self) -> Result<Handshake> {
        let (cand_tx, mut cand_rx) =
            mpsc::unbounded_channel::<Option<Arc<dyn Candidate + Send + Sync>>>();
        self.agent.on_candidate(Box::new(move |c| {
            let tx = cand_tx.clone();
            Box::pin(async move {
                let _ = tx.send(c);
            })
        }));
        self.agent
            .gather_candidates()
            .context("启动候选地址收集失败")?;

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
            (self.log)(format!("    候选: {}", c.marshal()));
        }

        let (ufrag, pwd) = self.agent.get_local_user_credentials().await;
        Ok(Handshake {
            u: ufrag,
            p: pwd,
            c: local.iter().map(|c| c.marshal()).collect(),
            n: None,
        })
    }

    /// 取得一个可在别处关闭本端点的句柄
    pub fn close_handle(&self) -> IceCloseHandle {
        IceCloseHandle {
            agent: Arc::clone(&self.agent),
            probe: Arc::clone(&self.probe),
        }
    }

    /// 当前 ICE 状态
    pub fn state(&self) -> ConnectionState {
        *self.state_rx.borrow()
    }

    /// 放弃端点：关闭 Agent、停止防火墙唤醒
    pub async fn close(self) {
        abort_probe(&self.probe);
        let _ = self.agent.close().await;
    }

    /// 设置对端凭据与候选地址后按角色 dial（Offer）/ accept（Answer）。
    /// 与状态回调赛跑：ICE 进入 Failed/Closed 时立即返回错误而不等超时。
    /// 无论成功失败，端点的所有权都随之转移：失败时 Agent 已被关闭。
    pub async fn connect(
        mut self,
        role: Role,
        remote: &Handshake,
        timeout: Duration,
    ) -> Result<IceConn> {
        match self.negotiate(role, remote, timeout).await {
            Ok(conn) => Ok(IceConn {
                conn,
                agent: Arc::clone(&self.agent),
                state_rx: self.state_rx.clone(),
                probe: Arc::clone(&self.probe),
                closed_tx: watch::channel(false).0,
            }),
            Err(e) => {
                self.close().await;
                Err(e)
            }
        }
    }

    async fn negotiate(
        &mut self,
        role: Role,
        remote: &Handshake,
        timeout: Duration,
    ) -> Result<IceRawConn> {
        ensure!(remote.is_complete(), "对端握手信息不完整");
        self.agent
            .set_remote_credentials(remote.u.clone(), remote.p.clone())
            .await
            .context("设置对端凭据失败")?;
        for s in &remote.c {
            match unmarshal_candidate(s) {
                Ok(c) => {
                    let c: Arc<dyn Candidate + Send + Sync> = Arc::new(c);
                    let _ = self.agent.add_remote_candidate(&c);
                }
                Err(e) => (self.log)(format!("    跳过无效候选地址: {e}")),
            }
        }

        let (cancel_tx, cancel_rx) = mpsc::channel::<()>(1);
        let agent = Arc::clone(&self.agent);
        let (ufrag, pwd) = (remote.u.clone(), remote.p.clone());
        let secs = timeout.as_secs();
        let dial = tokio::time::timeout(timeout, async move {
            match role {
                Role::Offer => {
                    let c = agent.dial(cancel_rx, ufrag, pwd).await?;
                    let c: IceRawConn = c;
                    Ok::<_, IceError>(c)
                }
                Role::Answer => {
                    let c = agent.accept(cancel_rx, ufrag, pwd).await?;
                    let c: IceRawConn = c;
                    Ok::<_, IceError>(c)
                }
            }
        });
        tokio::pin!(dial);
        let result = loop {
            tokio::select! {
                r = &mut dial => {
                    break r
                        .map_err(|_| anyhow!("P2P 连接超时（{secs} 秒），请确认对方也已入房并在线"))
                        .and_then(|r| r.map_err(|e| anyhow!("ICE 协商失败: {e}")));
                }
                r = self.state_rx.changed() => {
                    if r.is_err() {
                        break Err(anyhow!("ICE Agent 状态通道已关闭"));
                    }
                    let s = *self.state_rx.borrow();
                    if matches!(s, ConnectionState::Failed | ConnectionState::Closed) {
                        break Err(anyhow!(
                            "打洞失败（ICE 状态 {s}）：所有候选对都无法连通。\n\
                            常见原因：\n  \
                            ① Windows 防火墙拦截入站 UDP —— 两台机器都要放行本程序（管理员运行）：\n     \
                            netsh advfirewall firewall add rule name=\"stardew-valley-assistant\" dir=in action=allow program=\"<本程序exe绝对路径>\"\n  \
                            ② 双方不在同一局域网，且任一方是对称 NAT —— UDP 打洞只能穿透锥形 NAT，\n     \
                            对称型/运营商级 NAT 无中继服务器时无法连通，请改在同一局域网内联机"
                        ));
                    }
                }
            }
        };
        drop(cancel_tx);
        result
    }
}

/// 已打通的 P2P 连接：一次 `send` 对应对端一次 `recv`（UDP 数据报语义）。
pub struct IceConn {
    pub conn: IceRawConn,
    agent: Arc<Agent>,
    state_rx: watch::Receiver<ConnectionState>,
    probe: SharedProbe,
    /// 本端主动关闭标记（[`IceConn::closed`] 也会因此结束）
    closed_tx: watch::Sender<bool>,
}

impl IceConn {
    pub async fn send(&self, buf: &[u8]) -> Result<()> {
        self.conn
            .send(buf)
            .await
            .map(|_| ())
            .map_err(|e| anyhow!("发送失败: {e}"))
    }

    pub async fn recv(&self, buf: &mut [u8]) -> Result<usize> {
        self.conn
            .recv(buf)
            .await
            .map_err(|e| anyhow!("接收失败: {e}"))
    }

    /// 当前 ICE 状态
    pub fn state(&self) -> ConnectionState {
        *self.state_rx.borrow()
    }

    /// 本端是否已调用过 [`IceConn::close`] / [`IceConn::signal_close`]
    pub fn is_local_closed(&self) -> bool {
        *self.closed_tx.borrow()
    }

    /// 在 ICE 进入 Failed / Closed、或本端主动关闭时完成
    pub fn closed(&self) -> impl Future<Output = ()> + Send + 'static {
        let mut state_rx = self.state_rx.clone();
        let mut closed_rx = self.closed_tx.subscribe();
        async move {
            loop {
                if *closed_rx.borrow_and_update() {
                    return;
                }
                if matches!(
                    *state_rx.borrow_and_update(),
                    ConnectionState::Failed | ConnectionState::Closed
                ) {
                    return;
                }
                tokio::select! {
                    r = state_rx.changed() => if r.is_err() { return; },
                    r = closed_rx.changed() => if r.is_err() { return; },
                }
            }
        }
    }

    /// 同步地标记关闭（供 `Drop` 等无法 await 的场合）；持有 [`IceConn::closed`] 的接收循环
    /// 会因此退出并负责调用 [`IceConn::close`] 真正关闭 Agent。
    pub fn signal_close(&self) {
        let _ = self.closed_tx.send(true);
    }

    /// 关闭连接：标记关闭、停止防火墙唤醒并关闭 ICE Agent（可重复调用）
    pub async fn close(&self) {
        self.signal_close();
        abort_probe(&self.probe);
        let _ = self.agent.close().await;
    }
}
