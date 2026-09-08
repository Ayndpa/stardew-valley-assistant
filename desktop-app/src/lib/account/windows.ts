/**
 * 联机弹窗（好友窗口 / 私聊窗口）的打开与关闭。
 * Tauri 下走 Rust 命令 open_friends_window / open_chat_window（见 src-tauri/src/social_windows.rs）；
 * 浏览器预览下退化为 window.open 同一 hash 路由，便于开发调试。
 */

export function isTauri(): boolean {
  return typeof window !== "undefined" && !!(window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
}

function browserPopup(hash: string, name: string, width: number, height: number) {
  const url = `${window.location.pathname}${window.location.search}#${hash}`
  window.open(url, name, `popup=yes,width=${width},height=${height}`)
}

export async function openFriendsWindow(title?: string): Promise<void> {
  if (!isTauri()) {
    browserPopup("friends", "friends", 380, 680)
    return
  }
  const { invoke } = await import("@tauri-apps/api/core")
  await invoke("open_friends_window", { title })
}

export async function openChatWindow(userId: string, title: string): Promise<void> {
  if (!isTauri()) {
    browserPopup(`chat/${userId}`, `chat-${userId.replace(/-/g, "")}`, 520, 620)
    return
  }
  const { invoke } = await import("@tauri-apps/api/core")
  await invoke("open_chat_window", { userId, title })
}

export async function closeCurrentWindow(): Promise<void> {
  if (!isTauri()) {
    window.close()
    return
  }
  const { getCurrentWindow } = await import("@tauri-apps/api/window")
  await getCurrentWindow().close()
}

export async function minimizeCurrentWindow(): Promise<void> {
  if (!isTauri()) return
  const { getCurrentWindow } = await import("@tauri-apps/api/window")
  await getCurrentWindow().minimize()
}

export async function startDraggingCurrentWindow(): Promise<void> {
  if (!isTauri()) return
  const { getCurrentWindow } = await import("@tauri-apps/api/window")
  await getCurrentWindow().startDragging()
}

export async function setCurrentWindowTitle(title: string): Promise<void> {
  document.title = title
  if (!isTauri()) return
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window")
    await getCurrentWindow().setTitle(title)
  } catch {
    // 权限缺失等情况忽略
  }
}
