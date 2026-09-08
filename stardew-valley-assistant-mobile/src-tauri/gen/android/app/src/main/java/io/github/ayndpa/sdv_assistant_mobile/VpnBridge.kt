package io.github.ayndpa.sdv_assistant_mobile

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.VpnService
import android.os.Build
import android.util.Log

/**
 * 虚拟局域网隧道的 Java 侧入口，Rust 通过 JNI 调用这里的静态方法。
 *
 * Android 把"建一条 VPN"切成了三段而且是异步的：先由用户在系统对话框里授权，
 * 再启动一个 [StardewVpnService]，最后在服务里用 `VpnService.Builder` 建立隧道。
 * 隧道建好后的文件描述符通过 [nativeOnTunReady] 回调给 Rust，由虚拟局域网引擎
 * 直接读写 IP 包。
 */
object VpnBridge {
    private const val TAG = "VpnBridge"

    /** 系统授权对话框的请求码，仅用于区分回调来源。 */
    const val REQUEST_CODE = 0x5644

    init {
        // Rust 侧的本地方法在这个共享库里。Tauri 通常已经加载过，
        // 重复调用是幂等的；单独走 VPN 流程时这行保证符号一定可用。
        try {
            System.loadLibrary("stardew_valley_assistant_mobile_lib")
        } catch (e: UnsatisfiedLinkError) {
            Log.w(TAG, "加载本地库失败，虚拟局域网将不可用", e)
        }
    }

    /** 是否已经拿到 VPN 授权。 */
    @JvmStatic
    fun isPrepared(context: Context): Boolean {
        // prepare() 返回 null 表示已授权；否则返回需要 startActivity 的意图。
        return VpnService.prepare(context) == null
    }

    /**
     * 弹出系统的 VPN 授权对话框。
     *
     * 用户的选择不会同步返回——调用方随后重新查询 [isPrepared] 或直接重试启动。
     * 这样做是因为授权结果走 Activity 回调，而 Rust 侧的调用是同步的，
     * 强行等待会把界面卡住。
     */
    @JvmStatic
    fun requestPermission(context: Context) {
        val intent = VpnService.prepare(context) ?: return
        val activity = context as? Activity
        if (activity != null) {
            activity.startActivityForResult(intent, REQUEST_CODE)
        } else {
            // 兜底：拿不到 Activity 时用新任务拉起，体验略差但不至于完全不能用。
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
        }
    }

    /**
     * 启动隧道服务。
     *
     * [route] / [routePrefixLength] 决定哪些流量进隧道，必须只填虚拟局域网自己的
     * 网段。配成默认路由会把 ICE 打洞用的 UDP 报文也吸进隧道形成回环，
     * 点对点直连就永远协商不出来。
     */
    @JvmStatic
    fun startTunnel(
        context: Context,
        vip: String,
        prefixLength: Int,
        mtu: Int,
        route: String,
        routePrefixLength: Int,
    ) {
        val intent = Intent(context, StardewVpnService::class.java).apply {
            action = StardewVpnService.ACTION_START
            putExtra(StardewVpnService.EXTRA_VIP, vip)
            putExtra(StardewVpnService.EXTRA_PREFIX_LENGTH, prefixLength)
            putExtra(StardewVpnService.EXTRA_MTU, mtu)
            putExtra(StardewVpnService.EXTRA_ROUTE, route)
            putExtra(StardewVpnService.EXTRA_ROUTE_PREFIX_LENGTH, routePrefixLength)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent)
        } else {
            context.startService(intent)
        }
    }

    /** 关闭隧道并停止服务。 */
    @JvmStatic
    fun stopTunnel(context: Context) {
        val intent = Intent(context, StardewVpnService::class.java).apply {
            action = StardewVpnService.ACTION_STOP
        }
        try {
            context.startService(intent)
        } catch (e: IllegalStateException) {
            // 应用已在后台且服务本来就没跑时会抛这个，等价于"已经停了"。
            Log.d(TAG, "隧道服务未在运行，无需停止", e)
        }
    }

    /**
     * 隧道建立结果回调给 Rust。
     *
     * [fd] 为负表示失败，原因在 [error] 里。
     */
    external fun nativeOnTunReady(fd: Int, error: String?)

    /** 用户从系统 VPN 面板断开时回调给 Rust。 */
    external fun nativeOnTunRevoked()
}
