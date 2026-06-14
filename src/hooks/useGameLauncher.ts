import { useState, useEffect, useCallback } from "react"
import { useTranslation } from "react-i18next"

interface UseGameLauncherProps {
  ensureGameDirectoryReady: () => Promise<string | null>
  showGlobalToast: (message: string, type: "success" | "info" | "warning") => void
}

export function useGameLauncher({ ensureGameDirectoryReady, showGlobalToast }: UseGameLauncherProps) {
  const { t } = useTranslation()
  const [isGameRunning, setIsGameRunning] = useState(false)

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
      setIsGameRunning(true)
      showGlobalToast(launchMode === "vanilla" ? t("gameLauncher.launchingVanilla") : t("gameLauncher.launching"), "success")
    } catch (err) {
      console.error("launch_game failed:", err)
      showGlobalToast(t("gameLauncher.launchFailed", { error: String(err) }), "warning")
    }
  }, [ensureGameDirectoryReady, isGameRunning, showGlobalToast, t])

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

  return { isGameRunning, handleLaunchGame }
}
