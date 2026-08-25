import { useState, useEffect, useCallback, useRef } from "react"
import { useTranslation } from "react-i18next"

interface UseGameLauncherProps {
  ensureGameDirectoryReady: () => Promise<string | null>
  showGlobalToast: (message: string, type: "success" | "info" | "warning") => void
}

export function useGameLauncher({ ensureGameDirectoryReady, showGlobalToast }: UseGameLauncherProps) {
  const { t } = useTranslation()
  const [isGameRunning, setIsGameRunning] = useState(false)
  // Track whether we launched the game ourselves (fast-path exit detection)
  const launchedByUsRef = useRef(false)
  // 对外部启动的游戏只尝试注入一次，游戏退出后复位
  const attachAttemptedRef = useRef(false)

  const handleLaunchGame = useCallback(async (launchMode?: "default" | "vanilla") => {
    if (isGameRunning) {
      showGlobalToast(t("gameLauncher.alreadyRunning"), "info")
      return
    }

    const gameDir = await ensureGameDirectoryReady()
    if (!gameDir) {
      return
    }

    if (typeof window === "undefined" || !(window as any).__TAURI_INTERNALS__) {
      showGlobalToast(t("gameLauncher.webModeNotSupported"), "warning")
      return
    }

    try {
      const invokeModule = await import("@tauri-apps/api/core")
      await invokeModule.invoke("launch_game", {
        gameDir,
        launchMode: launchMode === "vanilla" ? "vanilla" : undefined,
      })
      launchedByUsRef.current = true
      setIsGameRunning(true)
      showGlobalToast(launchMode === "vanilla" ? t("gameLauncher.launchingVanilla") : t("gameLauncher.launching"), "success")
    } catch (err) {
      console.error("launch_game failed:", err)
      showGlobalToast(t("gameLauncher.launchFailed", { error: String(err) }), "warning")
    }
  }, [ensureGameDirectoryReady, isGameRunning, showGlobalToast, t])

  const handleForceKillGame = useCallback(async () => {
    if (typeof window === "undefined" || !(window as any).__TAURI_INTERNALS__) {
      showGlobalToast(t("gameLauncher.webModeNotSupported"), "warning")
      return
    }

    try {
      const invokeModule = await import("@tauri-apps/api/core")
      const result = await invokeModule.invoke<string>("force_kill_game")
      launchedByUsRef.current = false
      setIsGameRunning(false)
      showGlobalToast(result || t("gameLauncher.forceQuitSuccess"), "success")
    } catch (err) {
      console.error("force_kill_game failed:", err)
      showGlobalToast(t("gameLauncher.forceQuitFailed", { error: String(err) }), "warning")
    }
  }, [showGlobalToast, t])

  // Fast-path: listen for game-exited event when we launched the game ourselves
  useEffect(() => {
    if (typeof window === "undefined" || !(window as any).__TAURI_INTERNALS__) {
      return
    }

    let unlisten: (() => void) | null = null
    const setupGameExitListener = async () => {
      try {
        const eventModule = await import("@tauri-apps/api/event")
        unlisten = await eventModule.listen<number>("game-exited", () => {
          launchedByUsRef.current = false
          setIsGameRunning(false)
          showGlobalToast(t("gameLauncher.gameExited"), "info")
        })
      } catch (err) {
        console.debug("Unable to setup game exit listener:", err)
      }
    }

    setupGameExitListener()
    return () => {
      unlisten?.()
    }
  }, [showGlobalToast, t])

  // Poll for externally-launched games via process detection
  useEffect(() => {
    if (typeof window === "undefined" || !(window as any).__TAURI_INTERNALS__) {
      return
    }

    let intervalId: ReturnType<typeof setInterval> | null = null

    const poll = async () => {
      // Skip polling while we know the game is running from our own launch
      // (the game-exited event will handle that case)
      if (launchedByUsRef.current) return

      try {
        const invokeModule = await import("@tauri-apps/api/core")
        const running = await invokeModule.invoke<boolean>("check_game_process_running")
        setIsGameRunning(running)

        // 助手启动的游戏会通过 DOTNET_STARTUP_HOOKS 自动挂载运行时；这里处理的是
        // 玩家自己从 Steam / 快捷方式启动的情况——检测到新进程后注入一次。
        // 注入本身幂等，但仍按进程只尝试一次，避免被安全软件拦截时反复重试。
        if (running && !attachAttemptedRef.current) {
          attachAttemptedRef.current = true
          try {
            await invokeModule.invoke("attach_runtime")
          } catch (err) {
            // 注入失败不打扰用户：玩家仍可改用「一键启动」，
            // 或在需要实时数据的页面上手动点连接按钮拿到具体错误。
            console.debug("attach_runtime skipped:", err)
          }
        } else if (!running) {
          attachAttemptedRef.current = false
        }
      } catch {
        // silently ignore polling errors
      }
    }

    // Initial check
    poll()
    // Poll every 5 seconds
    intervalId = setInterval(poll, 5000)

    return () => {
      if (intervalId) clearInterval(intervalId)
    }
  }, [])

  return { isGameRunning, handleLaunchGame, handleForceKillGame }
}
