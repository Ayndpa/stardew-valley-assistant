//! `VpnService` 桥接：申请授权、建立隧道、取回虚拟网卡描述符。
//!
//! Android 上应用无权自己创建网卡。流程被系统切成三段，而且是异步的：
//!
//! 1. `VpnService.prepare()` 判断有没有授权，没有就弹系统对话框（要 Activity）。
//! 2. 授权后启动前台服务，在服务里用 `VpnService.Builder` 建立隧道。
//! 3. 隧道建好后拿到一个文件描述符，交给 Rust 侧的虚拟局域网引擎读写 IP 包。
//!
//! 第 3 步的结果由 Kotlin 主动回调进来（[`Java_io_github_ayndpa_sdv_1assistant_1mobile_VpnBridge_nativeOnTunReady`]），
//! 所以这里用「条件变量 + 槽位」把异步回调转成调用方可以等待的同步结果。

use super::{take_exception_message, with_env, BRIDGE_PACKAGE};
use jni::objects::{JString, JValue};
use jni::sys::{jint, jobject};
use jni::JNIEnv;
use std::os::fd::RawFd;
use std::sync::{Condvar, Mutex, OnceLock};
use std::time::Duration;

/// 等待隧道建立的上限。
///
/// 正常情况下 `establish()` 只要几十毫秒，但用户可能正卡在系统的授权对话框上，
/// 所以给足时间；超时后返回错误而不是一直挂着。
const ESTABLISH_TIMEOUT: Duration = Duration::from_secs(30);

fn bridge_class() -> String {
    format!("{}/VpnBridge", BRIDGE_PACKAGE)
}

/// 隧道建立结果的投递槽。
struct TunSlot {
    /// `None` 表示还没有结果。
    result: Mutex<Option<Result<RawFd, String>>>,
    ready: Condvar,
}

fn tun_slot() -> &'static TunSlot {
    static SLOT: OnceLock<TunSlot> = OnceLock::new();
    SLOT.get_or_init(|| TunSlot {
        result: Mutex::new(None),
        ready: Condvar::new(),
    })
}

/// 用户从系统设置里断开 VPN 时的回调。
///
/// 这条路径绕过了应用自己的停止流程，如果不通知上层，界面会一直显示"已连接"。
type RevokeHandler = Box<dyn Fn() + Send + Sync>;

fn revoke_handler() -> &'static Mutex<Option<RevokeHandler>> {
    static HANDLER: OnceLock<Mutex<Option<RevokeHandler>>> = OnceLock::new();
    HANDLER.get_or_init(|| Mutex::new(None))
}

/// 注册"隧道被系统撤销"的处理器。虚拟局域网模块在启动时装上它。
pub fn set_revoke_handler(handler: RevokeHandler) {
    *revoke_handler().lock().unwrap() = Some(handler);
}

/// 是否已经拿到 VPN 授权。
pub fn is_prepared() -> Result<bool, String> {
    with_env(|env, context| {
        let class = bridge_class();
        let result = env
            .call_static_method(
                &class,
                "isPrepared",
                "(Landroid/content/Context;)Z",
                &[JValue::Object(context)],
            )
            .map_err(|e| {
                take_exception_message(env)
                    .unwrap_or_else(|| format!("查询 VPN 授权状态失败: {}", e))
            })?;
        result
            .z()
            .map_err(|e| format!("VPN 授权状态返回值异常: {}", e))
    })
}

/// 弹出系统的 VPN 授权对话框。
///
/// 只负责把对话框拉起来，用户的选择结果不会同步返回——调用方随后重新调用
/// [`is_prepared`] 或直接重试启动即可。
pub fn request_permission() -> Result<(), String> {
    with_env(|env, context| {
        let class = bridge_class();
        env.call_static_method(
            &class,
            "requestPermission",
            "(Landroid/content/Context;)V",
            &[JValue::Object(context)],
        )
        .map_err(|e| {
            take_exception_message(env).unwrap_or_else(|| format!("拉起 VPN 授权对话框失败: {}", e))
        })?;
        Ok(())
    })
}

/// 启动前台服务并建立隧道，返回虚拟网卡的文件描述符。
///
/// `route_prefix_len` 决定哪些流量会被引进隧道。这里必须只路由虚拟局域网自己的
/// 网段：一旦配成默认路由，ICE 打洞用的 UDP 报文会被自己的隧道捕获形成回环，
/// 直连永远协商不出来。
pub fn start_tunnel(
    vip: &str,
    prefix_len: u8,
    mtu: u16,
    route: &str,
    route_prefix_len: u8,
) -> Result<RawFd, String> {
    // 先清空上一轮可能残留的结果，避免拿到过期的描述符。
    {
        let mut slot = tun_slot().result.lock().unwrap();
        *slot = None;
    }

    with_env(|env, context| {
        let class = bridge_class();
        let vip_arg = env
            .new_string(vip)
            .map_err(|e| format!("传递虚拟 IP 失败: {}", e))?;
        let route_arg = env
            .new_string(route)
            .map_err(|e| format!("传递路由网段失败: {}", e))?;

        env.call_static_method(
            &class,
            "startTunnel",
            "(Landroid/content/Context;Ljava/lang/String;IILjava/lang/String;I)V",
            &[
                JValue::Object(context),
                JValue::Object(&vip_arg),
                JValue::Int(prefix_len as i32),
                JValue::Int(mtu as i32),
                JValue::Object(&route_arg),
                JValue::Int(route_prefix_len as i32),
            ],
        )
        .map_err(|e| {
            take_exception_message(env).unwrap_or_else(|| format!("启动虚拟网卡服务失败: {}", e))
        })?;
        Ok(())
    })?;

    // 等 Kotlin 侧把结果投递进来。
    let slot = tun_slot();
    let mut guard = slot.result.lock().unwrap();
    loop {
        if let Some(result) = guard.take() {
            return result;
        }
        let (next, timeout) = slot
            .ready
            .wait_timeout(guard, ESTABLISH_TIMEOUT)
            .map_err(|_| "等待虚拟网卡时内部状态损坏".to_string())?;
        guard = next;
        if timeout.timed_out() && guard.is_none() {
            return Err("建立虚拟网卡超时，请确认已授予 VPN 权限".to_string());
        }
    }
}

/// 停止前台服务并关闭隧道。
pub fn stop_tunnel() -> Result<(), String> {
    with_env(|env, context| {
        let class = bridge_class();
        env.call_static_method(
            &class,
            "stopTunnel",
            "(Landroid/content/Context;)V",
            &[JValue::Object(context)],
        )
        .map_err(|e| {
            take_exception_message(env).unwrap_or_else(|| format!("停止虚拟网卡服务失败: {}", e))
        })?;
        Ok(())
    })
}

fn deliver(result: Result<RawFd, String>) {
    let slot = tun_slot();
    let mut guard = slot.result.lock().unwrap();
    *guard = Some(result);
    slot.ready.notify_all();
}

/// Kotlin 侧在 `establish()` 之后回调这里投递结果。
///
/// `fd` 为负表示失败，具体原因在 `error` 里。
///
/// # Safety
///
/// 由 JVM 按 JNI 约定调用，参数均为有效的 JNI 引用。
#[no_mangle]
pub unsafe extern "system" fn Java_io_github_ayndpa_sdv_1assistant_1mobile_VpnBridge_nativeOnTunReady(
    mut env: JNIEnv,
    _this: jobject,
    fd: jint,
    error: JString,
) {
    let message = if error.is_null() {
        None
    } else {
        env.get_string(&error).ok().map(|s| s.into())
    };

    match message {
        Some(text) => deliver(Err(text)),
        None if fd >= 0 => deliver(Ok(fd as RawFd)),
        None => deliver(Err("虚拟网卡返回了无效的描述符".to_string())),
    }
}

/// Kotlin 侧在 `VpnService.onRevoke()` 里回调这里。
///
/// # Safety
///
/// 由 JVM 按 JNI 约定调用。
#[no_mangle]
pub unsafe extern "system" fn Java_io_github_ayndpa_sdv_1assistant_1mobile_VpnBridge_nativeOnTunRevoked(
    _env: JNIEnv,
    _this: jobject,
) {
    // 隧道有可能是在建立过程中被撤销的，这时还有调用方在等结果，要把它唤醒。
    {
        let slot = tun_slot();
        let mut guard = slot.result.lock().unwrap();
        if guard.is_none() {
            *guard = Some(Err("虚拟网卡授权已被系统撤销".to_string()));
            slot.ready.notify_all();
        }
    }

    // 处理器可能会去停止引擎，不能持锁调用，先取出来再执行。
    let handler = revoke_handler().lock().unwrap().take();
    if let Some(handler) = handler {
        handler();
    }
}

