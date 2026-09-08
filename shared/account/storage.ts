/**
 * 登录态的本地存储键与安全读写。
 * 桌面端的多窗口同步（window-signals）建立在这两个键之上，手机端只用它们做持久化。
 */

export const TOKEN_KEY = "accountToken"
export const USER_KEY = "accountUser"

export function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function safeSetItem(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // 隐私模式 / WebView 禁用存储时忽略
  }
}
