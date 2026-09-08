//! 虚拟局域网的 Tauri 命令层。
//!
//! 对外的命令名、参数和事件与桌面端保持一致，前端那套状态机可以直接复用。
//! 差别全在底下：桌面端要拉起一个提权辅助进程去建 Wintun 网卡，手机端不需要——
//! `VpnService` 建好的隧道描述符可以直接交给同进程的引擎，所以这里持有的是
//! [`VlanEngine`] 本身而不是一个管道客户端。

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, State};
use tokio::sync::Mutex;

#[cfg(target_os = "android")]
use p2p_vlan::{MemberInfo, VlanEngine, VlanStatus};
#[cfg(target_os = "android")]
use std::sync::Arc;

#[cfg(not(target_os = "android"))]
use p2p_vlan::{MemberInfo, VlanStatus};

/// 未授权时错误文本的固定前缀。
///
/// 前端靠这个前缀把"要用户去点系统授权对话框"和普通失败区分开，
/// 与桌面端用 `需要以管理员身份运行` 前缀是同一套做法。
pub const VPN_PERMISSION_HINT: &str = "未获得 VPN 授权";

/// 引擎事件的种类，与桌面端 `vlan-event` 的 `kind` 取值一致。
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VlanEventKind {
    Started,
    Stopped,
    Peer,
    Error,
    Log,
}

/// 手机端的"能不能联机"状态。
///
/// 字段名沿用桌面端的 `vlan_helper_status`，只是含义换成了移动端的对应物：
/// `elevated` 表示已拿到 VPN 授权，`helper_running` 表示引擎正在跑。
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VlanHelperStatus {
    pub elevated: bool,
    pub helper_running: bool,
    /// 当前平台是否支持虚拟局域网。桌面预览窗口里为 false。
    pub available: bool,
}

#[derive(Default)]
pub struct VlanState {
    #[cfg(target_os = "android")]
    engine: Mutex<Option<Arc<VlanEngine>>>,
    #[cfg(not(target_os = "android"))]
    _unused: Mutex<()>,
}

// ---------------------------------------------------------------------------
// Android 实现
// ---------------------------------------------------------------------------

#[cfg(target_os = "android")]
mod imp {
    use super::*;
    use p2p_vlan::engine::{MTU, PREFIX_LEN};
    use p2p_vlan::VlanEvent;
    use std::net::Ipv4Addr;
    use tauri::{Emitter, Manager};

    /// 引擎事件队列容量。事件是诊断信息，堆积时宁可丢也不该拖慢转发循环。
    const EVENT_CHANNEL: usize = 64;

    /// 引擎状态事件。
    const VLAN_EVENT: &str = "vlan-event";
    /// 需要经房间转发给某个成员的信令。
    const VLAN_SIGNAL_OUT: &str = "vlan-signal-out";

    #[derive(Clone, Serialize)]
    struct VlanEventPayload {
        kind: VlanEventKind,
        #[serde(skip_serializing_if = "Option::is_none")]
        peer: Option<p2p_vlan::PeerStatus>,
        #[serde(skip_serializing_if = "Option::is_none")]
        text: Option<String>,
    }

    #[derive(Clone, Serialize)]
    struct SignalOutPayload {
        to: String,
        data: Value,
    }

    fn emit_event(app: &AppHandle, kind: VlanEventKind, peer: Option<p2p_vlan::PeerStatus>, text: Option<String>) {
        let _ = app.emit(VLAN_EVENT, VlanEventPayload { kind, peer, text });
    }

    /// 把引擎事件转成前端事件。
    ///
    /// `SignalOut` 要走另一个事件通道：它不是状态通知，而是必须由前端经房间
    /// `room.signal` 转发给对端的信令，混在一起会让前端难以分辨。
    async fn forward_events(app: AppHandle, mut rx: tokio::sync::mpsc::Receiver<VlanEvent>) {
        while let Some(event) = rx.recv().await {
            match event {
                VlanEvent::Started => emit_event(&app, VlanEventKind::Started, None, None),
                VlanEvent::Stopped => emit_event(&app, VlanEventKind::Stopped, None, None),
                VlanEvent::Peer(peer) => {
                    emit_event(&app, VlanEventKind::Peer, Some(peer), None)
                }
                VlanEvent::Error(text) => {
                    emit_event(&app, VlanEventKind::Error, None, Some(text))
                }
                VlanEvent::Log(text) => emit_event(&app, VlanEventKind::Log, None, Some(text)),
                VlanEvent::SignalOut { to, data } => {
                    let _ = app.emit(VLAN_SIGNAL_OUT, SignalOutPayload { to, data });
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
        stun_urls: Option<Vec<String>>,
    ) -> Result<VlanStatus, String> {
        let vip: Ipv4Addr = vip
            .parse()
            .map_err(|_| format!("服务器分配的虚拟 IP 不合法: {}", vip))?;

        // 已经在跑就只同步成员，避免重复建隧道。
        // 这段临界区要尽量短：下面建立隧道要等用户点系统授权，最长 30 秒，
        // 期间前端还在每几秒轮询一次 vlan_status，握着锁不放会让界面像卡死一样。
        if let Some(existing) = state.engine.lock().await.as_ref() {
            existing.update_members(members).await;
            return Ok(existing.status().await);
        }

        if !crate::android::vpn::is_prepared()? {
            // 授权对话框必须由用户点，这里只负责拉起来，让前端提示重试。
            crate::android::vpn::request_permission()?;
            return Err(format!(
                "{VPN_PERMISSION_HINT}：请在系统弹出的对话框中允许创建 VPN 连接，然后重新加入房间。"
            ));
        }

        // 只路由虚拟局域网自己的网段。配成默认路由会把 ICE 打洞用的 UDP 报文
        // 也吸进隧道形成回环，直连就再也协商不出来了。
        let subnet = p2p_vlan::SUBNET
            .split('/')
            .next()
            .unwrap_or("10.77.0.0")
            .to_string();

        let fd = tokio::task::spawn_blocking(move || {
            crate::android::vpn::start_tunnel(&vip.to_string(), PREFIX_LEN, MTU, &subnet, PREFIX_LEN)
        })
        .await
        .map_err(|e| format!("建立虚拟网卡任务失败: {}", e))??;

        // SAFETY: 描述符由 Kotlin 侧 detachFd() 转移所有权，此处独占。
        let tun = unsafe { p2p_vlan::tun_from_fd(fd) }.map_err(|e| e.to_string())?;

        // 重新取锁装配。刚才没持锁，期间可能有另一次调用已经把引擎建起来了；
        // 这时放弃自己这条隧道（`tun` 离开作用域会关掉描述符），转为同步成员。
        let mut guard = state.engine.lock().await;
        if let Some(existing) = guard.as_ref() {
            drop(tun);
            existing.update_members(members).await;
            return Ok(existing.status().await);
        }

        let ice = p2p_vlan::android_ice_config(vip, PREFIX_LEN, stun_urls.unwrap_or_default());
        let (tx, rx) = tokio::sync::mpsc::channel(EVENT_CHANNEL);
        tauri::async_runtime::spawn(forward_events(app.clone(), rx));

        let engine = VlanEngine::start(self_id, vip, members, tun, ice, tx);

        // 用户可能从系统的 VPN 面板直接断开，那条路径绕过了应用自己的停止流程。
        // 不补发事件的话界面会一直停在"已连接"。
        let revoke_app = app.clone();
        crate::android::vpn::set_revoke_handler(Box::new(move || {
            let app = revoke_app.clone();
            tauri::async_runtime::spawn(async move {
                if let Some(state) = app.try_state::<VlanState>() {
                    let mut guard = state.engine.lock().await;
                    if let Some(engine) = guard.take() {
                        engine.stop().await;
                    }
                }
                emit_event(
                    &app,
                    VlanEventKind::Error,
                    None,
                    Some("虚拟局域网已被系统断开".to_string()),
                );
                emit_event(&app, VlanEventKind::Stopped, None, None);
            });
        }));

        let status = engine.status().await;
        *guard = Some(engine);
        Ok(status)
    }

    pub async fn update_members(
        state: State<'_, VlanState>,
        members: Vec<MemberInfo>,
    ) -> Result<(), String> {
        if let Some(engine) = state.engine.lock().await.as_ref() {
            engine.update_members(members).await;
        }
        Ok(())
    }

    pub async fn signal_in(
        state: State<'_, VlanState>,
        from: String,
        data: Value,
    ) -> Result<(), String> {
        // 引擎没跑时静默忽略：房间里其他人可能比自己先启动虚拟局域网，
        // 这时收到的握手不是错误，丢掉即可，对方会重试。
        if let Some(engine) = state.engine.lock().await.as_ref() {
            engine.signal_in(&from, data).await;
        }
        Ok(())
    }

    pub async fn stop(state: State<'_, VlanState>) -> Result<(), String> {
        let engine = state.engine.lock().await.take();
        if let Some(engine) = engine {
            engine.stop().await;
        }
        // 引擎停了也要收隧道，否则系统状态栏的 VPN 图标会一直挂着。
        tokio::task::spawn_blocking(crate::android::vpn::stop_tunnel)
            .await
            .map_err(|e| format!("停止虚拟网卡任务失败: {}", e))?
    }

    pub async fn status(state: State<'_, VlanState>) -> Result<VlanStatus, String> {
        match state.engine.lock().await.as_ref() {
            Some(engine) => Ok(engine.status().await),
            None => Ok(VlanStatus::stopped()),
        }
    }

    pub async fn helper_status(state: State<'_, VlanState>) -> Result<VlanHelperStatus, String> {
        Ok(VlanHelperStatus {
            elevated: crate::android::vpn::is_prepared().unwrap_or(false),
            helper_running: state.engine.lock().await.is_some(),
            available: true,
        })
    }

    pub fn prepare() -> Result<bool, String> {
        if crate::android::vpn::is_prepared()? {
            return Ok(true);
        }
        crate::android::vpn::request_permission()?;
        Ok(false)
    }
}

// ---------------------------------------------------------------------------
// 其它平台：桌面预览窗口里编译得过，但不提供功能
// ---------------------------------------------------------------------------

#[cfg(not(target_os = "android"))]
mod imp {
    use super::*;

    const UNSUPPORTED: &str = "当前平台不支持虚拟局域网联机，请在 Android 设备上使用。";

    pub async fn start(
        _app: AppHandle,
        _state: State<'_, VlanState>,
        _self_id: String,
        _vip: String,
        _members: Vec<MemberInfo>,
        _stun_urls: Option<Vec<String>>,
    ) -> Result<VlanStatus, String> {
        Err(UNSUPPORTED.to_string())
    }

    pub async fn update_members(
        _state: State<'_, VlanState>,
        _members: Vec<MemberInfo>,
    ) -> Result<(), String> {
        Ok(())
    }

    pub async fn signal_in(
        _state: State<'_, VlanState>,
        _from: String,
        _data: Value,
    ) -> Result<(), String> {
        Ok(())
    }

    pub async fn stop(_state: State<'_, VlanState>) -> Result<(), String> {
        Ok(())
    }

    pub async fn status(_state: State<'_, VlanState>) -> Result<VlanStatus, String> {
        Ok(VlanStatus::stopped())
    }

    pub async fn helper_status(_state: State<'_, VlanState>) -> Result<VlanHelperStatus, String> {
        Ok(VlanHelperStatus {
            elevated: false,
            helper_running: false,
            available: false,
        })
    }

    pub fn prepare() -> Result<bool, String> {
        Err(UNSUPPORTED.to_string())
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
    stun_urls: Option<Vec<String>>,
) -> Result<VlanStatus, String> {
    imp::start(app, state, self_id, vip, members, stun_urls).await
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
pub async fn vlan_helper_status(
    state: State<'_, VlanState>,
) -> Result<VlanHelperStatus, String> {
    imp::helper_status(state).await
}

/// 主动申请 VPN 授权。返回 `true` 表示已经授权、不需要用户操作。
#[tauri::command]
pub async fn vlan_prepare() -> Result<bool, String> {
    imp::prepare()
}
