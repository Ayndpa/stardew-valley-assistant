package io.github.ayndpa.sdv_assistant_mobile

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentSender
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import java.io.File

/**
 * 安装并启动打好 Mod 的星露谷物语。
 *
 * 助手本身是 Rust + WebView 应用，没有 .NET 运行时，没办法把游戏加载进自己的进程。
 * 所以走的是「重新打包成一个独立应用」的路线：把 SMAPI 载荷合进游戏安装包、改包名
 * 重新签名（这部分在 Rust 侧完成），再由这里交给系统安装器装成另一个应用。
 * 改包名是必须的——沿用原包名会和玩家已装的正版游戏签名冲突，根本装不上。
 */
object GameLauncher {
    private const val TAG = "GameLauncher"

    /** 安装会话的结果回调标识。 */
    const val ACTION_INSTALL_RESULT =
        "io.github.ayndpa.sdv_assistant_mobile.INSTALL_RESULT"

    /** 目标应用是否已安装。 */
    @JvmStatic
    fun isInstalled(context: Context, packageName: String): Boolean =
        installedVersion(context, packageName) != null

    /** 已安装的版本名；未安装返回 null。 */
    @JvmStatic
    fun installedVersion(context: Context, packageName: String): String? {
        return try {
            val info = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                context.packageManager.getPackageInfo(
                    packageName,
                    PackageManager.PackageInfoFlags.of(0),
                )
            } else {
                @Suppress("DEPRECATION")
                context.packageManager.getPackageInfo(packageName, 0)
            }
            info.versionName ?: ""
        } catch (e: PackageManager.NameNotFoundException) {
            null
        } catch (e: Exception) {
            Log.w(TAG, "查询应用版本失败: $packageName", e)
            null
        }
    }

    /** 启动已安装的游戏；找不到启动入口返回 false。 */
    @JvmStatic
    fun launch(context: Context, packageName: String): Boolean {
        val intent = context.packageManager.getLaunchIntentForPackage(packageName)
        if (intent == null) {
            Log.w(TAG, "找不到启动入口: $packageName")
            return false
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return try {
            context.startActivity(intent)
            true
        } catch (e: Exception) {
            Log.w(TAG, "启动游戏失败: $packageName", e)
            false
        }
    }

    /**
     * 把打包好的安装包交给系统安装器。
     *
     * 用 `PackageInstaller` 会话而不是老的 `ACTION_VIEW` 安装意图：会话方式直接
     * 流式写入字节，不需要把安装包暴露成 `content://`，也就不用为几百 MB 的文件
     * 配 FileProvider 和临时授权。
     *
     * 安装需要用户在系统弹窗里确认，本方法只负责发起，结果由调用方轮询
     * [isInstalled] 得知——安装耗时可能长达一两分钟，同步等待没有意义。
     *
     * @return 发起成功返回 null，失败返回错误描述。
     */
    @JvmStatic
    fun installApk(context: Context, apkPath: String): String? {
        val apk = File(apkPath)
        if (!apk.isFile) {
            return "找不到要安装的文件: $apkPath"
        }

        var session: PackageInstaller.Session? = null
        return try {
            val installer = context.packageManager.packageInstaller
            val params = PackageInstaller.SessionParams(
                PackageInstaller.SessionParams.MODE_FULL_INSTALL
            )
            // 提前告知体积，系统才能在空间不足时立刻失败，而不是写到一半才报错。
            params.setSize(apk.length())

            val sessionId = installer.createSession(params)
            session = installer.openSession(sessionId)

            session.openWrite("game", 0, apk.length()).use { output ->
                apk.inputStream().use { input ->
                    input.copyTo(output, 1 shl 20)
                }
                // 必须 fsync，否则会话提交时可能读到不完整的数据。
                session.fsync(output)
            }

            session.commit(buildStatusSender(context))
            null
        } catch (e: Exception) {
            Log.w(TAG, "发起安装失败", e)
            try {
                session?.abandon()
            } catch (ignored: Exception) {
                // 会话本来就没建起来，忽略。
            }
            "发起安装失败: ${e.message}"
        } finally {
            try {
                session?.close()
            } catch (ignored: Exception) {
            }
        }
    }

    private fun buildStatusSender(context: Context): IntentSender {
        val intent = Intent(ACTION_INSTALL_RESULT).setPackage(context.packageName)
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            android.app.PendingIntent.FLAG_UPDATE_CURRENT or
                android.app.PendingIntent.FLAG_MUTABLE
        } else {
            android.app.PendingIntent.FLAG_UPDATE_CURRENT
        }
        // 必须是 MUTABLE：系统要往这个意图里塞安装状态和确认页意图。
        return android.app.PendingIntent
            .getBroadcast(context, 0, intent, flags)
            .intentSender
    }

    /**
     * 接收安装会话的状态。
     *
     * 系统首次回调时给的是「需要用户确认」，必须由应用把确认页拉起来，
     * 否则安装会一直悬着不动。
     */
    class InstallResultReceiver : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val status = intent.getIntExtra(
                PackageInstaller.EXTRA_STATUS,
                PackageInstaller.STATUS_FAILURE,
            )
            when (status) {
                PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                    val confirm = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
                    } else {
                        @Suppress("DEPRECATION")
                        intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)
                    }
                    confirm?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    try {
                        confirm?.let { context.startActivity(it) }
                    } catch (e: Exception) {
                        Log.w(TAG, "拉起安装确认页失败", e)
                    }
                }
                PackageInstaller.STATUS_SUCCESS -> Log.i(TAG, "游戏安装成功")
                else -> {
                    val message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)
                    Log.w(TAG, "游戏安装失败: status=$status message=$message")
                }
            }
        }
    }
}
