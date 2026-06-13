import { useState, useEffect, useCallback } from "react"

interface UseGameLauncherProps {
  ensureGameDirectoryReady: () => Promise<string | null>
  showGlobalToast: (message: string, type: "success" | "info" | "warning") => void
}

export function useGameLauncher({ ensureGameDirectoryReady, showGlobalToast }: UseGameLauncherProps) {
  const [isGameRunning, setIsGameRunning] = useState(false)

  const handleLaunchGame = useCallback(async (launchMode?: "default" | "vanilla") => {
    if (isGameRunning) {
      showGlobalToast("游戏正在运行中，暂时不能重复启动。", "info")
      return
    }

    const gameDir = await ensureGameDirectoryReady()
    if (!gameDir) {
      return
    }

    if (typeof window === "undefined" || !(window as any).__TAURI_INTERNALS__) {
      showGlobalToast("当前为 Web 模式，暂不支持直接启动游戏。", "warning")
      return
    }

    try {
      const invokeModule = await import("@tauri-apps/api/core")
      await invokeModule.invoke("launch_game", {
        gameDir,
        launchMode: launchMode === "vanilla" ? "vanilla" : undefined,
      })
      setIsGameRunning(true)
      showGlobalToast(launchMode === "vanilla" ? "原版游戏启动中…" : "游戏启动中…", "success")
    } catch (err) {
      console.error("launch_game failed:", err)
      showGlobalToast("启动游戏失败: " + err, "warning")
    }
  }, [ensureGameDirectoryReady, isGameRunning, showGlobalToast])

  useEffect(() => {
    if (typeof window === "undefined" || !(window as any).__TAURI_INTERNALS__) {
      return
    }

    let unlisten: (() => void) | null = null
    const setupGameExitListener = async () => {
      try {
        const eventModule = await import("@tauri-apps/api/event")
        unlisten = await eventModule.listen<number>("game-exited", () => {
          setIsGameRunning(false)
          showGlobalToast("游戏已退出，模组管理已恢复可修改。", "info")
        })
      } catch (err) {
        console.debug("Unable to setup game exit listener:", err)
      }
    }

    setupGameExitListener()
    return () => {
      unlisten?.()
    }
  }, [showGlobalToast])

  return { isGameRunning, handleLaunchGame }
}
