/**
 * 桌面端的平台判定。
 *
 * WebView 里拿不到 Rust 那边的 `target_os`，只能看 UA：Windows 的 WebView2 带
 * "Windows"，macOS 的 WKWebView 带 "Macintosh"。判错的代价只是默认路径不合适，
 * 因此不值得为它多引一个 tauri 插件。
 */
export type DesktopPlatform = "windows" | "macos" | "linux"

export function detectPlatform(): DesktopPlatform {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent
  if (ua.includes("Windows")) return "windows"
  if (ua.includes("Macintosh") || ua.includes("Mac OS X")) return "macos"
  return "linux"
}

/**
 * 「浏览…」对话框的起始目录：优先当前已选目录，否则给出本平台上 Steam 库的常见位置。
 *
 * 返回 undefined 表示不指定（对话框用系统默认位置），比给一个不存在的路径要好。
 */
export async function defaultGameBrowseDir(current?: string): Promise<string | undefined> {
  if (current && current.trim()) return current

  const platform = detectPlatform()
  if (platform === "windows") {
    return "C:\\Program Files (x86)\\Steam\\steamapps\\common"
  }

  try {
    const { homeDir, join } = await import("@tauri-apps/api/path")
    const home = await homeDir()
    return platform === "macos"
      ? await join(home, "Library", "Application Support", "Steam", "steamapps", "common")
      : await join(home, ".steam", "steam", "steamapps", "common")
  } catch (error) {
    console.debug("Failed to resolve default browse directory:", error)
    return undefined
  }
}
