//! Steam 风格的联机弹窗：好友窗口 + 每个私聊一个窗口。
//! 前端通过 hash 路由区分入口：`index.html#friends`、`index.html#chat/<user_id>`。

use tauri::{AppHandle, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub const FRIENDS_WINDOW_LABEL: &str = "friends";
const CHAT_WINDOW_LABEL_PREFIX: &str = "chat-";

/// 若同 label 的窗口已存在则前置它并返回 true。
fn focus_existing(app: &AppHandle, label: &str) -> bool {
    if let Some(win) = app.get_webview_window(label) {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
        return true;
    }
    false
}

/// 把弹窗放到主窗口右上角附近（同 Steam 好友列表贴在主窗口旁的习惯）；
/// 取不到主窗口位置时退回居中。`stack` 用于让多个聊天窗口错开。
fn place_near_main(app: &AppHandle, win: &WebviewWindow, stack: i32) {
    if let Some(main) = app.get_webview_window("main") {
        if let (Ok(pos), Ok(size), Ok(win_size)) =
            (main.outer_position(), main.outer_size(), win.outer_size())
        {
            let margin = 24 + stack * 32;
            let x = pos.x + size.width as i32 - win_size.width as i32 - margin;
            let y = pos.y + 56 + stack * 32;
            let _ = win.set_position(PhysicalPosition::new(x.max(0), y.max(0)));
            return;
        }
    }
    let _ = win.center();
}

fn build_popup(
    app: &AppHandle,
    label: &str,
    page: String,
    title: &str,
    size: (f64, f64),
    min_size: (f64, f64),
) -> Result<WebviewWindow, String> {
    WebviewWindowBuilder::new(app, label, WebviewUrl::App(page.into()))
        .title(title)
        .inner_size(size.0, size.1)
        .min_inner_size(min_size.0, min_size.1)
        .decorations(false)
        .resizable(true)
        .build()
        .map_err(|e| format!("Failed to create window {}: {:?}", label, e))
}

/// 打开（或前置）好友窗口。
///
/// 必须是 async 命令：同步命令在主线程执行，而 Windows 上 `WebviewWindowBuilder::build`
/// 需要主线程事件循环配合，会导致死锁（invoke 永不返回、窗口空白）。
#[tauri::command]
pub async fn open_friends_window(app: AppHandle, title: Option<String>) -> Result<(), String> {
    if focus_existing(&app, FRIENDS_WINDOW_LABEL) {
        return Ok(());
    }
    let title = title.unwrap_or_else(|| "Friends".to_string());
    let win = build_popup(
        &app,
        FRIENDS_WINDOW_LABEL,
        "index.html#friends".to_string(),
        &title,
        (380.0, 680.0),
        (320.0, 480.0),
    )?;
    place_near_main(&app, &win, 0);
    let _ = win.set_focus();
    Ok(())
}

/// 打开（或前置）与某位好友的私聊窗口。label 为 `chat-<去掉连字符的 user_id>`。
#[tauri::command]
pub async fn open_chat_window(app: AppHandle, user_id: String, title: String) -> Result<(), String> {
    let compact: String = user_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect();
    if compact.is_empty() || compact.len() > 64 {
        return Err("invalid user_id".to_string());
    }
    let label = format!("{}{}", CHAT_WINDOW_LABEL_PREFIX, compact);
    if focus_existing(&app, &label) {
        return Ok(());
    }

    // 已有的聊天窗口数量，用来错开新窗口的位置
    let open_chats = app
        .webview_windows()
        .keys()
        .filter(|l| l.starts_with(CHAT_WINDOW_LABEL_PREFIX))
        .count() as i32;

    let title = if title.trim().is_empty() { "Chat".to_string() } else { title };
    let win = build_popup(
        &app,
        &label,
        format!("index.html#chat/{}", user_id),
        &title,
        (520.0, 620.0),
        (400.0, 420.0),
    )?;
    place_near_main(&app, &win, 1 + open_chats);
    let _ = win.set_focus();
    Ok(())
}
