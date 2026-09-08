//! P2P 直连（p2p-ice-chat 库）的 Tauri 命令封装。
//!
//! 契约见 cloud-service/REALTIME.md §6：
//! - `p2p_connect { server, room, name }` → 立即返回 sessionId，随后经事件 `p2p-event` 推送进度
//! - `p2p_send { session, text }` / `p2p_close { session }`
//! - 事件 payload：`{ session, kind, text?, role?, room?, peer? }`

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use p2p_ice_chat::{ConnectOptions, P2pEvent, P2pEventKind, Session};
use serde::Serialize;
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::mpsc;

const P2P_EVENT: &str = "p2p-event";

/// 一个会话在状态表里的形态
enum SessionEntry {
    /// 仍在信令/打洞阶段：持有连接任务与事件转发任务，以便中途取消
    Connecting {
        connect: JoinHandle<()>,
        forwarder: JoinHandle<()>,
    },
    /// 已打通
    Connected(Arc<Session>),
}

#[derive(Default)]
pub struct P2pState {
    sessions: Mutex<HashMap<String, SessionEntry>>,
}

/// 推给前端的事件：库事件展平后加上 session 字段
#[derive(Clone, Serialize)]
struct P2pEventPayload {
    session: String,
    #[serde(flatten)]
    event: P2pEvent,
}

static SESSION_COUNTER: AtomicU64 = AtomicU64::new(0);

/// 时间戳 + 进程内计数器拼成的十六进制会话 id
fn new_session_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    let n = SESSION_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{nanos:x}{n:04x}")
}

fn lock_sessions(state: &P2pState) -> Result<MutexGuard<'_, HashMap<String, SessionEntry>>, String> {
    state
        .sessions
        .lock()
        .map_err(|_| "无法锁定 P2P 会话状态".to_string())
}

fn emit_event(app: &AppHandle, session: &str, event: P2pEvent) {
    let payload = P2pEventPayload {
        session: session.to_string(),
        event,
    };
    if let Err(e) = app.emit(P2P_EVENT, payload) {
        log::warn!("推送 p2p-event 失败 (session={session}): {e}");
    }
}

fn remove_entry(app: &AppHandle, session: &str) {
    if let Ok(mut map) = app.state::<P2pState>().sessions.lock() {
        map.remove(session);
    }
}

/// 把库事件逐条转发到前端；转发完 closed 后移除会话并退出
async fn forward_events(app: AppHandle, id: String, mut rx: mpsc::Receiver<P2pEvent>) {
    while let Some(ev) = rx.recv().await {
        let is_closed = ev.kind == P2pEventKind::Closed;
        emit_event(&app, &id, ev);
        if is_closed {
            remove_entry(&app, &id);
            break;
        }
    }
}

/// 执行连接；成功则把状态表里的条目升级为 Connected，失败则发出 error + closed
async fn run_connect(app: AppHandle, id: String, opts: ConnectOptions, tx: mpsc::Sender<P2pEvent>) {
    match p2p_ice_chat::connect(opts, tx.clone()).await {
        Ok(session) => {
            let session = Arc::new(session);
            let stale = match app.state::<P2pState>().sessions.lock() {
                Ok(mut map) => match map.get_mut(&id) {
                    Some(entry) => {
                        *entry = SessionEntry::Connected(Arc::clone(&session));
                        false
                    }
                    // 连接期间已被 p2p_close 移除
                    None => true,
                },
                Err(_) => true,
            };
            if stale {
                session.close().await;
            }
        }
        Err(e) => {
            let _ = tx.send(P2pEvent::error(e.to_string())).await;
            let _ = tx.send(P2pEvent::closed()).await;
        }
    }
}

#[tauri::command]
pub async fn p2p_connect(
    app: AppHandle,
    state: State<'_, P2pState>,
    server: String,
    room: String,
    name: String,
) -> Result<String, String> {
    let id = new_session_id();
    let (tx, rx) = mpsc::channel::<P2pEvent>(64);
    let opts = ConnectOptions {
        server,
        room,
        name,
        ..ConnectOptions::default()
    };

    // 持锁期间 spawn，保证任务首次访问状态表时条目已存在
    let mut map = lock_sessions(&state)?;
    let forwarder = tauri::async_runtime::spawn(forward_events(app.clone(), id.clone(), rx));
    let connect = tauri::async_runtime::spawn(run_connect(app, id.clone(), opts, tx));
    map.insert(id.clone(), SessionEntry::Connecting { connect, forwarder });
    Ok(id)
}

#[tauri::command]
pub async fn p2p_send(
    state: State<'_, P2pState>,
    session: String,
    text: String,
) -> Result<(), String> {
    let sess = {
        let map = lock_sessions(&state)?;
        match map.get(&session) {
            Some(SessionEntry::Connected(s)) => Arc::clone(s),
            Some(SessionEntry::Connecting { .. }) => return Err("未连接".to_string()),
            None => return Err("会话不存在或已关闭".to_string()),
        }
    };
    sess.send(&text).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn p2p_close(
    app: AppHandle,
    state: State<'_, P2pState>,
    session: String,
) -> Result<(), String> {
    let entry = lock_sessions(&state)?.remove(&session);
    match entry {
        // 接收循环退出时会发出 closed
        Some(SessionEntry::Connected(s)) => s.close().await,
        Some(SessionEntry::Connecting { connect, forwarder }) => {
            connect.abort();
            forwarder.abort();
            emit_event(&app, &session, P2pEvent::closed());
        }
        // 已关闭或不存在，视为幂等
        None => {}
    }
    Ok(())
}
