//! Android 平台桥接：从 Rust 调用应用自带的 Kotlin 辅助类。
//!
//! 移动端有几件事只能由 Java 层做：申请 VPN 授权、建立 `VpnService` 隧道、
//! 把用户在系统文件选择器里挑的 `content://` URI 变成可读的文件。这些能力
//! 通过 JNI 调进 `io.github.ayndpa.sdv_assistant_mobile` 包下的辅助类。
//!
//! 这里只放通用的 JNI 取环境/调用逻辑，具体功能在子模块里。

pub mod content;
pub mod launcher;
pub mod vpn;

use jni::objects::JObject;
use jni::{JNIEnv, JavaVM};

/// 辅助类所在的包路径。Kotlin 侧文件放在 `gen/android/app/src/main/java/` 下的同名目录。
pub const BRIDGE_PACKAGE: &str = "io/github/ayndpa/sdv_assistant_mobile";

/// 取当前进程的 JavaVM。
///
/// Tauri 启动时会把 VM 与 Activity 注册进 `ndk_context`，所以这里不需要自己保存。
fn java_vm() -> Result<JavaVM, String> {
    let ctx = ndk_context::android_context();
    let ptr: *mut jni::sys::JavaVM = ctx.vm().cast();
    if ptr.is_null() {
        return Err("当前进程没有可用的 Java 虚拟机".to_string());
    }
    // SAFETY: 指针由 ndk_context 提供，在应用整个生命周期内有效。
    unsafe { JavaVM::from_raw(ptr) }.map_err(|e| format!("获取 Java 虚拟机失败: {}", e))
}

/// 在附加到当前线程的 JNI 环境里执行一段逻辑。
///
/// 第二个参数是应用的 `Context`（实际是 Tauri 的 Activity），大部分 Android API
/// 都需要它。线程在闭包返回后自动 detach。
pub fn with_env<T, F>(f: F) -> Result<T, String>
where
    F: FnOnce(&mut JNIEnv, &JObject) -> Result<T, String>,
{
    let vm = java_vm()?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|e| format!("附加到 Java 线程失败: {}", e))?;

    let ctx_ptr = ndk_context::android_context().context().cast();
    // SAFETY: 同上，指针由 ndk_context 提供且在应用生命周期内有效。
    // `JObject` 只是裸指针的包装，不持有引用计数，所以这里借用不会误删全局引用。
    let context = unsafe { JObject::from_raw(ctx_ptr) };

    let result = f(&mut env, &context);

    // 闭包里抛出的 Java 异常必须清掉，否则同线程后续的 JNI 调用全部会失败。
    if env.exception_check().unwrap_or(false) {
        let _ = env.exception_describe();
        let _ = env.exception_clear();
    }

    result
}

/// 把 Java 侧刚抛出的异常转成错误文本并清除。
///
/// JNI 调用失败时 `jni` crate 只会给出"调用出错"这种笼统信息，真正的原因
/// 在挂起的异常里，不取出来排查问题会非常困难。
pub fn take_exception_message(env: &mut JNIEnv) -> Option<String> {
    if !env.exception_check().unwrap_or(false) {
        return None;
    }
    let throwable = env.exception_occurred().ok()?;
    let _ = env.exception_clear();

    let message = env
        .call_method(&throwable, "toString", "()Ljava/lang/String;", &[])
        .ok()?
        .l()
        .ok()?;
    let text: String = env.get_string((&message).into()).ok()?.into();
    Some(text)
}
