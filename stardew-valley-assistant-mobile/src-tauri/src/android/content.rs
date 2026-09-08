//! 把系统文件选择器返回的 `content://` URI 变成可读的文件。
//!
//! Android 的文件选择器交回来的不是路径而是一个内容 URI，Rust 侧没法直接
//! `File::open`。好在内容提供者能给出一个可定位（seekable）的文件描述符，
//! 把它接管过来就能当普通文件用——对几百 MB 的安装包来说这一点很关键：
//! 直接读描述符可以省掉一次整包复制。

use super::{take_exception_message, with_env, BRIDGE_PACKAGE};
use jni::objects::JValue;
use std::fs::File;
use std::os::fd::{FromRawFd, RawFd};

fn bridge_class() -> String {
    format!("{}/ContentBridge", BRIDGE_PACKAGE)
}

/// 判断一个字符串是不是内容 URI。普通文件路径按原样处理。
pub fn is_content_uri(value: &str) -> bool {
    value.starts_with("content://")
}

/// 以只读方式打开内容 URI，返回接管所有权的文件。
///
/// Kotlin 侧会调用 `detachFd()` 把描述符的所有权转移过来，因此这里包出来的
/// `File` 析构时关闭描述符是正确的，不会重复关闭。
pub fn open_readable(uri: &str) -> Result<File, String> {
    let fd: RawFd = with_env(|env, context| {
        let class = bridge_class();
        let uri_arg = env
            .new_string(uri)
            .map_err(|e| format!("传递文件地址失败: {}", e))?;

        let value = env
            .call_static_method(
                &class,
                "openReadFd",
                "(Landroid/content/Context;Ljava/lang/String;)I",
                &[JValue::Object(context), JValue::Object(&uri_arg)],
            )
            .map_err(|e| {
                take_exception_message(env).unwrap_or_else(|| format!("打开所选文件失败: {}", e))
            })?;

        value.i().map_err(|e| format!("文件描述符返回值异常: {}", e))
    })?;

    if fd < 0 {
        return Err("无法读取所选文件，请重新选择安装包".to_string());
    }

    // SAFETY: 描述符由 Kotlin 侧 detachFd() 交出所有权，此处独占持有。
    Ok(unsafe { File::from_raw_fd(fd) })
}

/// 查询内容 URI 对应的显示文件名，用于展示"从哪个安装包导入的"。
pub fn display_name(uri: &str) -> Option<String> {
    with_env(|env, context| {
        let class = bridge_class();
        let uri_arg = env
            .new_string(uri)
            .map_err(|e| format!("传递文件地址失败: {}", e))?;

        let value = env
            .call_static_method(
                &class,
                "displayName",
                "(Landroid/content/Context;Ljava/lang/String;)Ljava/lang/String;",
                &[JValue::Object(context), JValue::Object(&uri_arg)],
            )
            .map_err(|e| format!("查询文件名失败: {}", e))?;

        let obj = value.l().map_err(|e| format!("文件名返回值异常: {}", e))?;
        if obj.is_null() {
            return Ok(None);
        }
        let text: String = env
            .get_string((&obj).into())
            .map_err(|e| format!("读取文件名失败: {}", e))?
            .into();
        Ok(Some(text))
    })
    .ok()
    .flatten()
}
