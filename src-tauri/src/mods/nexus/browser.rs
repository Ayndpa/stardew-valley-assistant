use log::warn;
use std::fs;
use tauri::Manager;

pub fn create_nexus_webview(
    app: &tauri::AppHandle,
    label: &str,
    title: &str,
    url: tauri::Url,
    always_visible: bool,
    allow_dev_visible: bool,
) -> Result<tauri::WebviewWindow, String> {
    // Destroy old window with same label if it exists, then wait briefly
    // so the label is fully released before we rebuild.
    if let Some(old_window) = app.get_webview_window(label) {
        let _ = old_window.destroy();
        std::thread::sleep(std::time::Duration::from_millis(150));
    }
    // Double-check: if a stale handle still lingers, try once more.
    if let Some(old_window) = app.get_webview_window(label) {
        let _ = old_window.destroy();
        std::thread::sleep(std::time::Duration::from_millis(150));
    }

    let data_dir = app
        .path()
        .app_data_dir()
        .ok()
        .map(|p| p.join("webview_data"));
    if let Some(ref dir) = data_dir {
        let _ = fs::create_dir_all(dir);
    }

    let is_dev = cfg!(debug_assertions) && allow_dev_visible;
    let initially_visible = is_dev || always_visible;

    let mut builder =
        tauri::WebviewWindowBuilder::new(app, label, tauri::WebviewUrl::External(url))
            .title(title)
            .inner_size(960.0, 720.0)
            .min_inner_size(760.0, 560.0)
            .visible(initially_visible);

    if let Some(dir) = data_dir {
        builder = builder.data_directory(dir);
    }

    let window = builder
        .build()
        .map_err(|e| format!("Failed to build WebView window ({}): {:?}", label, e))?;

    if !initially_visible {
        let _ = window.minimize();
    }

    let center_over_main = |win: &tauri::WebviewWindow, app_handle: &tauri::AppHandle| {
        if let Some(main_window) = app_handle.get_webview_window("main") {
            if let (Ok(main_pos), Ok(main_size), Ok(win_size)) = (
                main_window.outer_position(),
                main_window.inner_size(),
                win.inner_size(),
            ) {
                let x = main_pos.x + ((main_size.width as i32 - win_size.width as i32) / 2);
                let y = main_pos.y + ((main_size.height as i32 - win_size.height as i32) / 2);
                let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
                return;
            }
        }
        let _ = win.center();
    };

    center_over_main(&window, app);

    Ok(window)
}

pub fn eval_js_timeout(win: &tauri::WebviewWindow, js: &str, timeout_secs: u64) -> Option<String> {
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    if let Err(e) = win.eval_with_callback(js, move |result| {
        let _ = tx.send(result);
    }) {
        warn!(
            "[eval_js_timeout] ({}) eval_with_callback error: {:?}",
            win.label(),
            e
        );
        return None;
    }
    match rx.recv_timeout(std::time::Duration::from_secs(timeout_secs)) {
        Ok(res) => Some(res),
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
            warn!(
                "[eval_js_timeout] ({}) JS evaluation timed out after {} seconds",
                win.label(),
                timeout_secs
            );
            None
        }
        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
            // Channel disconnected, usually because the window was closed/destroyed.
            // No need to spam error logs for this normal shutdown scenario.
            None
        }
    }
}

pub fn check_cloudflare_challenge(win: &tauri::WebviewWindow) -> bool {
    let cf_check_js = r##"
        (() => {
            try {
                const t = (document.title||'').toLowerCase();
                const h = location.href.toLowerCase();
                const html = document.documentElement ? document.documentElement.outerHTML : '';
                const x = document.body ? document.body.innerText : '';
                const hasNormalContent = !!document.querySelector("a[href*='/users/login'], a[href*='/auth/sign_in'], [class*='login-btn'], [class*='sign-in'], a[href*='sign_out'], a[href*='logout'], a[href*='sign-out'], #section-mod-description, #pagetitle, .header-user, .logo, .nav-item");
                const cf = t.includes('just a moment') || 
                           t.includes('checking your browser') || 
                           t.includes('attention required') || 
                           h.includes('captcha') || 
                           h.includes('challenge') || 
                           x.includes('checking if the site connection is secure') || 
                           x.includes('verify you are human') ||
                           (!hasNormalContent && (
                               html.includes('cf-turnstile') || 
                               html.includes('challenges.cloudflare.com') || 
                               html.includes('/cdn-cgi/challenge-platform/')
                           ));
                return cf;
            } catch(e) { return false; }
        })()
    "##;
    eval_js_timeout(win, cf_check_js, 2)
        .and_then(|res| res.parse::<bool>().ok())
        .unwrap_or(false)
}

pub fn update_window_visibility_for_cf(
    win: &tauri::WebviewWindow,
    app: &tauri::AppHandle,
    is_cf: bool,
    cf_shown: &mut bool,
    always_visible: bool,
    show_on_cf: bool,
    title_on_cf: &str,
    title_on_clear: &str,
) {
    use tauri::Manager;
    let is_dev = cfg!(debug_assertions);
    if is_cf {
        if !*cf_shown {
            *cf_shown = true;
            let _ = win.set_title(title_on_cf);

            if show_on_cf {
                let center_over_main = |w: &tauri::WebviewWindow, app_handle: &tauri::AppHandle| {
                    if let Some(main_window) = app_handle.get_webview_window("main") {
                        if let (Ok(main_pos), Ok(main_size), Ok(win_size)) = (
                            main_window.outer_position(),
                            main_window.inner_size(),
                            w.inner_size(),
                        ) {
                            let x =
                                main_pos.x + ((main_size.width as i32 - win_size.width as i32) / 2);
                            let y = main_pos.y
                                + ((main_size.height as i32 - win_size.height as i32) / 2);
                            let _ = w.set_position(tauri::PhysicalPosition::new(x, y));
                            return;
                        }
                    }
                    let _ = w.center();
                };
                center_over_main(win, app);
                let _ = win.show();
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }
    } else {
        if *cf_shown {
            *cf_shown = false;
            let _ = win.set_title(title_on_clear);
            if !is_dev && !always_visible {
                let _ = win.hide();
            }
        }
    }
}
