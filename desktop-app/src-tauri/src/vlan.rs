//! 虚拟局域网（p2p-vlan 库）的 Tauri 命令封装。
//!
//! 契约见 cloud-service/REALTIME.md §7.3 / §7.4。命令名、参数与事件在所有平台上
//! 一致，前端那套状态机可以直接复用；差别只在底下由谁来建 TUN 网卡：
//!
//! - **Windows**：引擎跑在提权辅助进程里（应用自身 exe 以 `--vlan-helper` 启动，
//!   未提权时经 UAC 拉起），本模块只做转发。Wintun 适配器必须由管理员创建，
//!   而让整个 GUI 提权是不可接受的。
//! - **macOS / Linux**：没有 UAC 这种「进程内提权」机制，图形界面弹授权框要走
//!   完全不同的一套（授权服务 / polkit）。这里退一步：引擎跑在应用进程内，
//!   要求整个助手本身以 root 运行（`sudo`），否则创建 utun 会被内核拒绝。
//!
//! 命令一览：
//! - `vlan_start { selfId, vip, members }` → `VlanStatus`
//!   （Windows 下辅助进程未运行时先拉起；用户拒绝 UAC 时 Err 以「未获得管理员权限」开头；
//!   TUN 创建失败 / 权限不足时以「需要以管理员身份运行」开头）
//! - `vlan_update_members` / `vlan_signal_in` / `vlan_stop`（未启动时为空操作）/ `vlan_status`
//! - `vlan_helper_status` → `{ elevated, helperRunning }`
//! - 事件 `vlan-event`：`{ kind, peer?, text? }`；`vlan-signal-out`：`{ to, data }`

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, State};
use tokio::sync::Mutex;

use p2p_vlan::{MemberInfo, VlanStatus};

const VLAN_EVENT: &str = "vlan-event";
const VLAN_SIGNAL_OUT: &str = "vlan-signal-out";

/// `vlan-signal-out` 的 payload：前端原样经 `room.signal` 发给 `to`
#[derive(Clone, Serialize)]
struct SignalOutPayload {
    to: String,
    data: Value,
}

/// `vlan_helper_status` 的返回
///
/// 字段名统一成 camelCase：仓库里其它命令的返回值都是这个约定，唯独这里漏了，
/// 结果手机端同名命令返回 `helperRunning`、桌面端返回 `helper_running`，
/// 两端共用的前端只能同时兼容两种写法。
///
/// `elevated` 在 Windows 上是「进程令牌已提权」，在 macOS / Linux 上是
/// 「以 root 运行」——两者含义一致：够不够权限去建虚拟网卡。
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HelperStatus {
    elevated: bool,
    helper_running: bool,
}

#[derive(Default)]
pub struct VlanState {
    /// Windows：正在运行的辅助进程连接
    #[cfg(windows)]
    helper: Mutex<Option<imp::Helper>>,
    /// 其它平台：进程内引擎
    #[cfg(not(windows))]
    engine: Mutex<Option<std::sync::Arc<p2p_vlan::VlanEngine>>>,
}

// ---------------------------------------------------------------------------
// Windows：提权辅助进程（REALTIME.md §7.4）
// ---------------------------------------------------------------------------

#[cfg(windows)]
mod imp {
    use super::*;

    use std::net::Ipv4Addr;
    use std::path::PathBuf;
    use std::sync::Arc;
    use std::time::Duration;

    use p2p_vlan::elevation::{is_elevated, launch_helper};
    use p2p_vlan::helper::{HelperClient, HelperEvent, HelperEventKind};
    use tauri::async_runtime::JoinHandle;
    use tauri::{Emitter, Manager};
    use tokio::sync::mpsc;

    const WINTUN_DLL: &str = "wintun.dll";

    /// 正在运行的辅助进程连接与它的事件转发任务
    pub struct Helper {
        client: Arc<HelperClient>,
        forwarder: JoinHandle<()>,
    }

    /// `vlan-event` 的 payload
    #[derive(Clone, Serialize)]
    struct VlanEventPayload {
        kind: HelperEventKind,
        #[serde(skip_serializing_if = "Option::is_none")]
        peer: Option<p2p_vlan::PeerStatus>,
        #[serde(skip_serializing_if = "Option::is_none")]
        text: Option<String>,
    }

    /// 依次查找 wintun.dll：资源目录 resources/、资源目录根、exe 所在目录，调试构建再看源码树 resources/
    fn resolve_wintun_dll(app: &AppHandle) -> Result<PathBuf, String> {
        let mut candidates: Vec<PathBuf> = Vec::new();
        if let Ok(dir) = app.path().resource_dir() {
            candidates.push(dir.join("resources").join(WINTUN_DLL));
            candidates.push(dir.join(WINTUN_DLL));
        }
        if let Some(dir) = std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(|p| p.to_path_buf()))
        {
            candidates.push(dir.join(WINTUN_DLL));
        }
        #[cfg(debug_assertions)]
        candidates.push(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("resources")
                .join(WINTUN_DLL),
        );

        candidates
            .iter()
            .find(|p| p.is_file())
            .cloned()
            .ok_or_else(|| {
                let searched = candidates
                    .iter()
                    .map(|p| p.display().to_string())
                    .collect::<Vec<_>>()
                    .join("；");
                format!("未找到 wintun.dll，已查找: {searched}")
            })
    }

    fn emit_event(app: &AppHandle, kind: HelperEventKind, peer: Option<p2p_vlan::PeerStatus>, text: Option<String>) {
        if let Err(e) = app.emit(VLAN_EVENT, VlanEventPayload { kind, peer, text }) {
            log::warn!("推送 vlan-event 失败: {e}");
        }
    }

    /// 把辅助进程事件逐条转成前端事件；管道断开（辅助进程退出）时清理状态并通知前端
    async fn forward_events(app: AppHandle, client: Arc<HelperClient>, mut rx: mpsc::Receiver<HelperEvent>) {
        while let Some(ev) = rx.recv().await {
            match ev.kind {
                HelperEventKind::SignalOut => {
                    let payload = SignalOutPayload {
                        to: ev.to.unwrap_or_default(),
                        data: ev.data.unwrap_or(Value::Null),
                    };
                    if let Err(e) = app.emit(VLAN_SIGNAL_OUT, payload) {
                        log::warn!("推送 vlan-signal-out 失败: {e}");
                    }
                }
                kind => {
                    match kind {
                        HelperEventKind::Error => log::error!("[vlan] {}", ev.text.as_deref().unwrap_or("")),
                        HelperEventKind::Log => log::debug!("[vlan] {}", ev.text.as_deref().unwrap_or("")),
                        _ => {}
                    }
                    emit_event(&app, kind, ev.peer, ev.text);
                }
            }
        }

        // 辅助进程断开：若状态表里还是这一个连接就移除，并让前端回到停止态
        let mut stale = false;
        if let Ok(mut guard) = app.state::<VlanState>().helper.try_lock() {
            if guard
                .as_ref()
                .is_some_and(|h| Arc::ptr_eq(&h.client, &client))
            {
                guard.take();
                stale = true;
            }
        }
        if stale {
            log::warn!("[vlan] 辅助进程已退出");
            emit_event(&app, HelperEventKind::Error, None, Some("虚拟局域网辅助进程已退出".to_string()));
            emit_event(&app, HelperEventKind::Stopped, None, None);
        }
    }

    /// 拉起辅助进程（必要时经 UAC 提权）并完成握手
    async fn spawn_helper(app: &AppHandle) -> Result<Helper, String> {
        let exe = std::env::current_exe().map_err(|e| format!("无法确定应用路径: {e}"))?;
        let dll = resolve_wintun_dll(app)?;
        let elevate = !is_elevated();
        if elevate {
            emit_event(app, HelperEventKind::Log, None, Some("正在申请管理员权限…".to_string()));
        }
        let pipe = HelperClient::new_pipe_name();
        let token = HelperClient::new_token();
        let (client, events) = HelperClient::spawn(&pipe, &token, move |p, t| {
            launch_helper(&exe, &p, &t, &dll, elevate)
        })
        .await
        .map_err(|e| e.to_string())?;
        let client = Arc::new(client);
        let forwarder = tauri::async_runtime::spawn(forward_events(app.clone(), Arc::clone(&client), events));
        Ok(Helper { client, forwarder })
    }

    /// 取当前连接着的辅助进程（不拉起）
    async fn current_client(state: &VlanState) -> Option<Arc<HelperClient>> {
        state
            .helper
            .lock()
            .await
            .as_ref()
            .filter(|h| h.client.is_alive())
            .map(|h| Arc::clone(&h.client))
    }

    pub async fn start(
        app: AppHandle,
        state: State<'_, VlanState>,
        self_id: String,
        vip: String,
        members: Vec<MemberInfo>,
    ) -> Result<VlanStatus, String> {
        let vip: Ipv4Addr = vip
            .trim()
            .parse()
            .map_err(|_| format!("虚拟 IP 无效: {vip}"))?;
        if self_id.trim().is_empty() {
            return Err("selfId 不能为空".to_string());
        }

        let mut guard = state.helper.lock().await;
        // 辅助进程常驻：已连着就复用；断了（或从未拉起）就（重新）拉起
        let dead = guard.as_ref().is_some_and(|h| !h.client.is_alive());
        if dead {
            if let Some(h) = guard.take() {
                h.forwarder.abort();
            }
        }
        if guard.is_none() {
            *guard = Some(spawn_helper(&app).await?);
        }
        let client = guard
            .as_ref()
            .map(|h| Arc::clone(&h.client))
            .ok_or_else(|| "辅助进程不可用".to_string())?;
        drop(guard);

        client
            .start(self_id, vip, members)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn update_members(
        state: State<'_, VlanState>,
        members: Vec<MemberInfo>,
    ) -> Result<(), String> {
        match current_client(&state).await {
            Some(client) => client.update_members(members).await.map_err(|e| e.to_string()),
            None => Ok(()),
        }
    }

    pub async fn signal_in(
        state: State<'_, VlanState>,
        from: String,
        data: Value,
    ) -> Result<(), String> {
        match current_client(&state).await {
            Some(client) => client.signal_in(from, data).await.map_err(|e| e.to_string()),
            // 未开启 VLAN 时收到的信令直接忽略（对方开了、我没开）
            None => {
                log::debug!("[vlan] 辅助进程未运行，忽略来自 {from} 的信令");
                Ok(())
            }
        }
    }

    pub async fn stop(state: State<'_, VlanState>) -> Result<(), String> {
        match current_client(&state).await {
            Some(client) => client.stop().await.map_err(|e| e.to_string()),
            None => Ok(()),
        }
    }

    pub async fn status(state: State<'_, VlanState>) -> Result<VlanStatus, String> {
        match current_client(&state).await {
            Some(client) => client.status().await.map_err(|e| e.to_string()),
            None => Ok(VlanStatus::stopped()),
        }
    }

    pub async fn helper_status(state: State<'_, VlanState>) -> Result<HelperStatus, String> {
        Ok(HelperStatus {
            elevated: is_elevated(),
            helper_running: current_client(&state).await.is_some(),
        })
    }

    /// 应用退出：让辅助进程退出（发 shutdown 并关闭管道）。在 Tauri 事件循环线程上同步调用。
    pub fn on_app_exit(app: &AppHandle) {
        let Some(state) = app.try_state::<VlanState>() else {
            return;
        };
        let helper = state.helper.try_lock().ok().and_then(|mut g| g.take());
        if let Some(h) = helper {
            h.forwarder.abort();
            tauri::async_runtime::block_on(async move {
                let _ = tokio::time::timeout(Duration::from_secs(3), h.client.shutdown()).await;
            });
        }
    }
}

// ---------------------------------------------------------------------------
// macOS / Linux：进程内引擎，要求助手本身以 root 运行
// ---------------------------------------------------------------------------

#[cfg(not(windows))]
mod imp {
    use super::*;

    use std::net::Ipv4Addr;
    use std::sync::Arc;

    use p2p_vlan::engine::PREFIX_LEN;
    use p2p_vlan::{
        open_tun, recommended_ice_config, TunConfig, VlanEngine, VlanEvent, PERMISSION_HINT,
    };
    use tauri::{Emitter, Manager};
    use tokio::sync::mpsc;

    /// 引擎事件队列容量。事件是诊断信息，堆积时宁可丢也不该拖慢转发循环。
    const EVENT_CHANNEL: usize = 64;

    /// `vlan-event` 的 kind 取值，序列化形式与 Windows 侧的
    /// `p2p_vlan::helper::HelperEventKind` 完全一致，前端只认这一套。
    #[derive(Clone, Copy, Serialize)]
    #[serde(rename_all = "snake_case")]
    enum VlanEventKind {
        Started,
        Stopped,
        Peer,
        Error,
        Log,
    }

    #[derive(Clone, Serialize)]
    struct VlanEventPayload {
        kind: VlanEventKind,
        #[serde(skip_serializing_if = "Option::is_none")]
        peer: Option<p2p_vlan::PeerStatus>,
        #[serde(skip_serializing_if = "Option::is_none")]
        text: Option<String>,
    }

    /// 是否以 root 运行。macOS / Linux 上创建 TUN 设备（utun / /dev/net/tun）
    /// 需要 root，普通用户下 `open_tun` 必然是 EPERM。
    fn is_root() -> bool {
        // SAFETY: geteuid 无参数、无副作用，总是成功
        unsafe { libc::geteuid() == 0 }
    }

    fn emit_event(
        app: &AppHandle,
        kind: VlanEventKind,
        peer: Option<p2p_vlan::PeerStatus>,
        text: Option<String>,
    ) {
        if let Err(e) = app.emit(VLAN_EVENT, VlanEventPayload { kind, peer, text }) {
            log::warn!("推送 vlan-event 失败: {e}");
        }
    }

    /// 把引擎事件转成前端事件。`SignalOut` 走另一个通道：它不是状态通知，
    /// 而是必须由前端经房间 `room.signal` 转发给对端的信令。
    async fn forward_events(app: AppHandle, mut rx: mpsc::Receiver<VlanEvent>) {
        while let Some(event) = rx.recv().await {
            match event {
                VlanEvent::Started => emit_event(&app, VlanEventKind::Started, None, None),
                VlanEvent::Stopped => emit_event(&app, VlanEventKind::Stopped, None, None),
                VlanEvent::Peer(peer) => emit_event(&app, VlanEventKind::Peer, Some(peer), None),
                VlanEvent::Error(text) => {
                    log::error!("[vlan] {text}");
                    emit_event(&app, VlanEventKind::Error, None, Some(text));
                }
                VlanEvent::Log(text) => {
                    log::debug!("[vlan] {text}");
                    emit_event(&app, VlanEventKind::Log, None, Some(text));
                }
                VlanEvent::SignalOut { to, data } => {
                    if let Err(e) = app.emit(VLAN_SIGNAL_OUT, SignalOutPayload { to, data }) {
                        log::warn!("推送 vlan-signal-out 失败: {e}");
                    }
                }
            }
        }
    }

    pub async fn start(
        app: AppHandle,
        state: State<'_, VlanState>,
        self_id: String,
        vip: String,
        members: Vec<MemberInfo>,
    ) -> Result<VlanStatus, String> {
        let vip: Ipv4Addr = vip
            .trim()
            .parse()
            .map_err(|_| format!("虚拟 IP 无效: {vip}"))?;
        if self_id.trim().is_empty() {
            return Err("selfId 不能为空".to_string());
        }

        let mut guard = state.engine.lock().await;
        // 已经在跑就只同步成员，避免重复建网卡
        if let Some(existing) = guard.as_ref() {
            existing.update_members(members).await;
            return Ok(existing.status().await);
        }

        if !is_root() {
            return Err(format!(
                "{PERMISSION_HINT}：创建虚拟网卡需要 root 权限，请用 sudo 启动助手后再开启虚拟局域网。"
            ));
        }

        // 网卡名在 macOS 上不可自定义（内核只接受 utunN，由它分配），
        // 因此这里不按网卡名做 ICE 过滤，交给网段过滤兜底。
        let tun = open_tun(&TunConfig::new(vip)).map_err(|e| e.to_string())?;
        let adapter = if cfg!(target_os = "macos") {
            ""
        } else {
            TunConfig::DEFAULT_NAME
        };
        let ice = recommended_ice_config(vip, PREFIX_LEN, adapter);

        let (tx, rx) = mpsc::channel(EVENT_CHANNEL);
        tauri::async_runtime::spawn(forward_events(app.clone(), rx));

        let engine = VlanEngine::start(self_id, vip, members, tun, ice, tx);
        let status = engine.status().await;
        *guard = Some(engine);
        Ok(status)
    }

    /// 取当前运行中的引擎
    async fn current_engine(state: &VlanState) -> Option<Arc<VlanEngine>> {
        state.engine.lock().await.as_ref().map(Arc::clone)
    }

    pub async fn update_members(
        state: State<'_, VlanState>,
        members: Vec<MemberInfo>,
    ) -> Result<(), String> {
        if let Some(engine) = current_engine(&state).await {
            engine.update_members(members).await;
        }
        Ok(())
    }

    pub async fn signal_in(
        state: State<'_, VlanState>,
        from: String,
        data: Value,
    ) -> Result<(), String> {
        match current_engine(&state).await {
            Some(engine) => engine.signal_in(&from, data).await,
            // 未开启 VLAN 时收到的信令直接忽略（对方开了、我没开）
            None => log::debug!("[vlan] 引擎未运行，忽略来自 {from} 的信令"),
        }
        Ok(())
    }

    pub async fn stop(state: State<'_, VlanState>) -> Result<(), String> {
        let engine = state.engine.lock().await.take();
        if let Some(engine) = engine {
            engine.stop().await;
        }
        Ok(())
    }

    pub async fn status(state: State<'_, VlanState>) -> Result<VlanStatus, String> {
        match current_engine(&state).await {
            Some(engine) => Ok(engine.status().await),
            None => Ok(VlanStatus::stopped()),
        }
    }

    pub async fn helper_status(state: State<'_, VlanState>) -> Result<HelperStatus, String> {
        Ok(HelperStatus {
            elevated: is_root(),
            helper_running: current_engine(&state).await.is_some(),
        })
    }

    /// 应用退出：停引擎、收网卡。在 Tauri 事件循环线程上同步调用。
    pub fn on_app_exit(app: &AppHandle) {
        let Some(state) = app.try_state::<VlanState>() else {
            return;
        };
        let engine = state.engine.try_lock().ok().and_then(|mut g| g.take());
        if let Some(engine) = engine {
            tauri::async_runtime::block_on(async move {
                let _ = tokio::time::timeout(
                    std::time::Duration::from_secs(3),
                    engine.stop(),
                )
                .await;
            });
        }
    }
}

// ---------------------------------------------------------------------------
// 命令
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn vlan_start(
    app: AppHandle,
    state: State<'_, VlanState>,
    self_id: String,
    vip: String,
    members: Vec<MemberInfo>,
) -> Result<VlanStatus, String> {
    imp::start(app, state, self_id, vip, members).await
}

#[tauri::command]
pub async fn vlan_update_members(
    state: State<'_, VlanState>,
    members: Vec<MemberInfo>,
) -> Result<(), String> {
    imp::update_members(state, members).await
}

#[tauri::command]
pub async fn vlan_signal_in(
    state: State<'_, VlanState>,
    from: String,
    data: Value,
) -> Result<(), String> {
    imp::signal_in(state, from, data).await
}

#[tauri::command]
pub async fn vlan_stop(state: State<'_, VlanState>) -> Result<(), String> {
    imp::stop(state).await
}

#[tauri::command]
pub async fn vlan_status(state: State<'_, VlanState>) -> Result<VlanStatus, String> {
    imp::status(state).await
}

#[tauri::command]
pub async fn vlan_helper_status(state: State<'_, VlanState>) -> Result<HelperStatus, String> {
    imp::helper_status(state).await
}

/// 应用退出时收尾（REALTIME.md §7.4）
pub fn on_app_exit(app: &AppHandle) {
    imp::on_app_exit(app)
}
