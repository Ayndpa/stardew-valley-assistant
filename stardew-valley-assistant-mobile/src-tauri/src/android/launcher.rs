//! 安装与启动打好 Mod 的游戏。
//!
//! 这里只是 JNI 转发层，真正的动作在 Kotlin 的 `GameLauncher` 里。

use super::{take_exception_message, with_env, BRIDGE_PACKAGE};
use jni::objects::JValue;

fn bridge_class() -> String {
    format!("{}/GameLauncher", BRIDGE_PACKAGE)
}

/// 查询目标应用已安装的版本名；未安装返回 `None`。
pub fn installed_version(package_name: &str) -> Option<String> {
    with_env(|env, context| {
        let class = bridge_class();
        let package_arg = env
            .new_string(package_name)
            .map_err(|e| format!("传递包名失败: {}", e))?;

        let value = env
            .call_static_method(
                &class,
                "installedVersion",
                "(Landroid/content/Context;Ljava/lang/String;)Ljava/lang/String;",
                &[JValue::Object(context), JValue::Object(&package_arg)],
            )
            .map_err(|e| format!("查询已安装版本失败: {}", e))?;

        let obj = value.l().map_err(|e| format!("版本返回值异常: {}", e))?;
        if obj.is_null() {
            return Ok(None);
        }
        let text: String = env
            .get_string((&obj).into())
            .map_err(|e| format!("读取版本失败: {}", e))?
            .into();
        Ok(Some(text))
    })
    .ok()
    .flatten()
}

/// 把打包好的安装包交给系统安装器。
///
/// 只负责发起，用户还要在系统弹窗里确认。安装可能持续一两分钟，
/// 结果由调用方轮询 [`installed_version`] 得知。
pub fn install_apk(apk_path: &str) -> Result<(), String> {
    with_env(|env, context| {
        let class = bridge_class();
        let path_arg = env
            .new_string(apk_path)
            .map_err(|e| format!("传递安装包路径失败: {}", e))?;

        let value = env
            .call_static_method(
                &class,
                "installApk",
                "(Landroid/content/Context;Ljava/lang/String;)Ljava/lang/String;",
                &[JValue::Object(context), JValue::Object(&path_arg)],
            )
            .map_err(|e| {
                take_exception_message(env).unwrap_or_else(|| format!("发起安装失败: {}", e))
            })?;

        let obj = value.l().map_err(|e| format!("安装返回值异常: {}", e))?;
        if obj.is_null() {
            return Ok(());
        }
        // 非空说明 Kotlin 侧返回了错误描述。
        let message: String = env
            .get_string((&obj).into())
            .map_err(|e| format!("读取安装错误失败: {}", e))?
            .into();
        Err(message)
    })
}

/// 启动已安装的游戏。
pub fn launch(package_name: &str) -> Result<(), String> {
    let launched = with_env(|env, context| {
        let class = bridge_class();
        let package_arg = env
            .new_string(package_name)
            .map_err(|e| format!("传递包名失败: {}", e))?;

        let value = env
            .call_static_method(
                &class,
                "launch",
                "(Landroid/content/Context;Ljava/lang/String;)Z",
                &[JValue::Object(context), JValue::Object(&package_arg)],
            )
            .map_err(|e| {
                take_exception_message(env).unwrap_or_else(|| format!("启动游戏失败: {}", e))
            })?;

        value.z().map_err(|e| format!("启动返回值异常: {}", e))
    })?;

    if launched {
        Ok(())
    } else {
        Err("游戏没有可用的启动入口，可能安装未完成".to_string())
    }
}
