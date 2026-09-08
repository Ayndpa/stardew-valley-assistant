package io.github.ayndpa.sdv_assistant_mobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import android.util.Log

/**
 * 承载虚拟局域网隧道的 VPN 服务。
 *
 * 只做两件事：按参数建立隧道，把文件描述符交给 Rust 侧的引擎。隧道上的
 * 数据收发、点对点打洞、成员管理全在 Rust 里，这里不碰任何数据包。
 *
 * 之所以要一个前台服务，是因为隧道必须在玩家切到游戏之后继续存活——联机时
 * 助手本来就是在后台跑的，普通服务会被系统回收。
 */
class StardewVpnService : VpnService() {

    companion object {
        private const val TAG = "StardewVpnService"

        const val ACTION_START = "io.github.ayndpa.sdv_assistant_mobile.VPN_START"
        const val ACTION_STOP = "io.github.ayndpa.sdv_assistant_mobile.VPN_STOP"

        const val EXTRA_VIP = "vip"
        const val EXTRA_PREFIX_LENGTH = "prefixLength"
        const val EXTRA_MTU = "mtu"
        const val EXTRA_ROUTE = "route"
        const val EXTRA_ROUTE_PREFIX_LENGTH = "routePrefixLength"

        private const val CHANNEL_ID = "stardew_vlan"
        private const val NOTIFICATION_ID = 0x5644

        /** 隧道会话名，会显示在系统的 VPN 设置里。 */
        private const val SESSION_NAME = "星露谷联机"
    }

    /**
     * 已建立的隧道。
     *
     * 描述符本身已经 detach 给了 Rust，这里留着 ParcelFileDescriptor 只是为了
     * 在停止时能调用 close()——注意 detach 之后 close() 不会重复关闭描述符。
     */
    private var tunnel: ParcelFileDescriptor? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                shutdown()
                return START_NOT_STICKY
            }
            ACTION_START -> startTunnel(intent)
            else -> {
                // 系统重启服务时不带 action。此时没有隧道参数，直接退出，
                // 由前端重新发起连接，避免建出一条没有对端的空隧道。
                Log.d(TAG, "收到无参数的启动请求，忽略")
                stopSelf()
                return START_NOT_STICKY
            }
        }
        return START_NOT_STICKY
    }

    private fun startTunnel(intent: Intent) {
        // 前台通知必须在建立隧道之前就位：Android 要求 startForegroundService
        // 之后短时间内调用 startForeground，否则进程会被判定为超时而杀掉。
        try {
            startForegroundCompat()
        } catch (e: Exception) {
            Log.w(TAG, "进入前台失败，继续尝试建立隧道", e)
        }

        val vip = intent.getStringExtra(EXTRA_VIP)
        val prefixLength = intent.getIntExtra(EXTRA_PREFIX_LENGTH, 24)
        val mtu = intent.getIntExtra(EXTRA_MTU, 1280)
        val route = intent.getStringExtra(EXTRA_ROUTE)
        val routePrefixLength = intent.getIntExtra(EXTRA_ROUTE_PREFIX_LENGTH, 24)

        if (vip.isNullOrBlank() || route.isNullOrBlank()) {
            fail("缺少虚拟网卡参数")
            return
        }

        // 重复启动时先收掉旧隧道，否则会留下一个没人读的描述符。
        closeTunnel()

        try {
            val builder = Builder()
                .setSession(SESSION_NAME)
                .addAddress(vip, prefixLength)
                // 只路由虚拟局域网网段。绝不能加默认路由：那会把 ICE 打洞用的
                // UDP 报文也吸进隧道，直连永远协商不成功。只路由本网段还有个
                // 好处——不需要对每个套接字调 protect()，而 webrtc-ice 内部
                // 自建的套接字我们本来也拿不到。
                .addRoute(route, routePrefixLength)
                .setMtu(mtu)
                .setBlocking(false)

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                // 让系统知道这条隧道只服务本应用发起的联机，不是全局代理。
                builder.setMetered(false)
            }

            val established = builder.establish()
            if (established == null) {
                fail("系统拒绝建立 VPN 隧道，请确认已授予 VPN 权限")
                return
            }

            tunnel = established
            // 所有权转移给 Rust：引擎持有描述符直到虚拟局域网停止。
            val fd = established.detachFd()
            VpnBridge.nativeOnTunReady(fd, null)
            Log.i(TAG, "虚拟网卡已建立: $vip/$prefixLength mtu=$mtu route=$route/$routePrefixLength")
        } catch (e: Exception) {
            fail("建立 VPN 隧道失败: ${e.message}")
        }
    }

    private fun fail(message: String) {
        Log.w(TAG, message)
        VpnBridge.nativeOnTunReady(-1, message)
        shutdown()
    }

    private fun closeTunnel() {
        try {
            tunnel?.close()
        } catch (e: Exception) {
            Log.d(TAG, "关闭隧道时出错", e)
        }
        tunnel = null
    }

    private fun shutdown() {
        closeTunnel()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
        stopSelf()
    }

    /**
     * 用户在系统的 VPN 面板里断开连接。
     *
     * 这条路径绕过了应用自己的停止流程，必须通知 Rust，否则界面会一直显示
     * "已连接"而实际上包已经发不出去了。
     */
    override fun onRevoke() {
        Log.i(TAG, "VPN 授权被系统撤销")
        VpnBridge.nativeOnTunRevoked()
        shutdown()
        super.onRevoke()
    }

    override fun onDestroy() {
        closeTunnel()
        super.onDestroy()
    }

    private fun startForegroundCompat() {
        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun buildNotification(): Notification {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = getSystemService(NotificationManager::class.java)
            val channel = NotificationChannel(
                CHANNEL_ID,
                "联机连接",
                // 低优先级：这条通知只是系统要求的常驻提示，不该打扰玩家。
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "显示虚拟局域网联机的连接状态"
                setShowBadge(false)
            }
            manager?.createNotificationChannel(channel)
        }

        // 点通知回到助手，方便玩家查看房间状态。
        val launch = packageManager.getLaunchIntentForPackage(packageName)
        val pending = launch?.let {
            PendingIntent.getActivity(
                this,
                0,
                it,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }

        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }

        builder.setContentTitle("星露谷联机进行中")
        builder.setContentText("虚拟局域网已连接，可以在游戏中加入好友的农场")
        // 用应用自己的图标：系统那套 VPN 状态图标不在公开 API 里，引用不到。
        builder.setSmallIcon(R.mipmap.ic_launcher)
        builder.setOngoing(true)
        if (pending != null) {
            builder.setContentIntent(pending)
        }
        return builder.build()
    }
}
