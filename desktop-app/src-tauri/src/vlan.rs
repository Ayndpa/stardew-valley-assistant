//! 虚拟局域网（p2p-vlan 库）的 Tauri 命令封装。
//!
//! 契约见 cloud-service/REALTIME.md §7.3 / §7.4：引擎始终运行在提权辅助进程里
//! （应用自身 exe 以 `--vlan-helper` 启动，未提权时经 UAC 拉起），本模块只做转发：
//! - `vlan_start { selfId, vip, members }` → `VlanStatus`（辅助进程未运行时先拉起；
//!   用户拒绝 UAC 时 Err 以「未获得管理员权限」开头；TUN 创建失败时以「需要以管理员身份运行」开头）
//! - `vlan_update_members` / `vlan_signal_in` / `vlan_stop`（无辅助进程时为空操作）/ `vlan_status`
//! - `vlan_helper_status` → `{ elevated, helper_running }`
//! - 事件 `vlan-event`：`{ kind, peer?, text? }`；`vlan-signal-out`：`{ to, data }`

use std::net::Ipv4Addr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use p2p_vlan::elevation::{is_elevated, launch_helper};
use p2p_vlan::helper::{HelperClient, HelperEvent, HelperEventKind};
use p2p_vlan::{MemberInfo, VlanStatus};
use serde::Serialize;
use serde_json::Value;
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::{mpsc, Mutex};

const VLAN_EVENT: &str = "vlan-event";
const VLAN_SIGNAL_OUT: &str = "vlan-signal-out";
const WINTUN_DLL: &str = "wintun.dll";

/// 正在运行的辅助进程连接与它的事件转发任务
struct Helper {
    client: Arc<HelperClient>,
    forwarder: JoinHandle<()>,
}

#[derive(Default)]
pub struct VlanState {
    helper: Mutex<Option<Helper>>,
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

/// `vlan-signal-out` 的 payload：前端原样经 `room.signal` 发给 `to`
#[derive(Clone, Serialize)]
struct SignalOutPayload {
    to: String,
    data: Value,
}

/// `vlan_helper_status` 的返回
#[derive(Clone, Serialize)]
pub struct HelperStatus {
    elevated: bool,
    helper_running: bool,
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

#[tauri::command]
pub async fn vlan_start(
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

#[tauri::command]
pub async fn vlan_update_members(
    state: State<'_, VlanState>,
    members: Vec<MemberInfo>,
) -> Result<(), String> {
    match current_client(&state).await {
        Some(client) => client.update_members(members).await.map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

#[tauri::command]
pub async fn vlan_signal_in(
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

#[tauri::command]
pub async fn vlan_stop(state: State<'_, VlanState>) -> Result<(), String> {
    match current_client(&state).await {
        Some(client) => client.stop().await.map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

#[tauri::command]
pub async fn vlan_status(state: State<'_, VlanState>) -> Result<VlanStatus, String> {
    match current_client(&state).await {
        Some(client) => client.status().await.map_err(|e| e.to_string()),
        None => Ok(VlanStatus::stopped()),
    }
}

#[tauri::command]
pub async fn vlan_helper_status(state: State<'_, VlanState>) -> Result<HelperStatus, String> {
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
