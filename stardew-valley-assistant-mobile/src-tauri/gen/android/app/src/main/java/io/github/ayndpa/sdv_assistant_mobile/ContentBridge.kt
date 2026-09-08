package io.github.ayndpa.sdv_assistant_mobile

import android.content.Context
import android.database.Cursor
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Log

/**
 * 把系统文件选择器返回的内容 URI 交给 Rust 侧读取。
 *
 * 玩家选安装包时拿到的是 `content://` 而不是文件路径，Rust 没法直接打开。
 * 这里取出内容提供者的文件描述符并**转移所有权**给 Rust——安装包接近 400 MB，
 * 先复制一份到应用目录再解析会白白多花一倍的时间和存储空间。
 */
object ContentBridge {
    private const val TAG = "ContentBridge"

    /**
     * 以只读方式打开内容 URI，返回已 detach 的文件描述符；失败返回 -1。
     *
     * 返回的描述符由调用方（Rust）负责关闭。这里必须用 `detachFd()` 而不是
     * `getFd()`：后者的所有权仍在 ParcelFileDescriptor 上，一旦它被 GC 回收就会
     * 关掉描述符，Rust 侧正在读的文件会突然失效。
     */
    @JvmStatic
    fun openReadFd(context: Context, uri: String): Int {
        return try {
            // "r" 而不是 "rw"：安装包只需要读，而且很多内容提供者不给写权限。
            val descriptor = context.contentResolver.openFileDescriptor(Uri.parse(uri), "r")
            if (descriptor == null) {
                Log.w(TAG, "内容提供者没有返回文件描述符: $uri")
                -1
            } else {
                descriptor.detachFd()
            }
        } catch (e: Exception) {
            Log.w(TAG, "打开内容 URI 失败: $uri", e)
            -1
        }
    }

    /** 查询内容 URI 的显示文件名，用于记录"从哪个安装包导入的"。 */
    @JvmStatic
    fun displayName(context: Context, uri: String): String? {
        return try {
            var cursor: Cursor? = null
            try {
                cursor = context.contentResolver.query(
                    Uri.parse(uri),
                    arrayOf(OpenableColumns.DISPLAY_NAME),
                    null,
                    null,
                    null,
                )
                if (cursor != null && cursor.moveToFirst()) {
                    val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (index >= 0) cursor.getString(index) else null
                } else {
                    null
                }
            } finally {
                cursor?.close()
            }
        } catch (e: Exception) {
            Log.w(TAG, "查询文件名失败: $uri", e)
            null
        }
    }
}
