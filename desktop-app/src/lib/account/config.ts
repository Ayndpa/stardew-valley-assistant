/** 账户 / 联机后端配置（见 cloud-service/REALTIME.md §5） */

// 使用自有域名：workers.dev 在国内网络下被阻断
const DEFAULT_ACCOUNT_BASE_URL = "https://stardew-api.unmod.online"

/** ICE 信令服务器（p2p-ice-chat），见 REALTIME.md §6 */
export const SIGNALING_WS_URL = "wss://stardew-ice.unmod.online/ws"

/** 允许通过 localStorage `accountBaseUrl` 覆盖，便于本地调试 */
export function getAccountBaseUrl(): string {
  try {
    const override = localStorage.getItem("accountBaseUrl")
    if (override && override.trim()) {
      return override.trim().replace(/\/+$/, "")
    }
  } catch {
    // 无法访问 localStorage 时使用默认值
  }
  return DEFAULT_ACCOUNT_BASE_URL
}

/** 默认后端地址（运行时以 getAccountBaseUrl() 为准） */
export const ACCOUNT_BASE_URL = DEFAULT_ACCOUNT_BASE_URL

/** 把 http(s) 后端地址转换成 ws(s) 地址并拼接路径，例如 wsUrl("/ws/hub") */
export function wsUrl(path: string): string {
  const base = getAccountBaseUrl()
  const ws = base.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:")
  return ws + (path.startsWith("/") ? path : "/" + path)
}
