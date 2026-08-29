import { useState, useCallback, useEffect, useRef, type DragEvent } from "react"

interface UseGlobalDragAndDropProps {
  isGameRunning: boolean
  ensureGameDirectoryReady: () => Promise<string | null>
  showGlobalToast: (message: string, type: "success" | "info" | "warning") => void
  setModListRefreshSignal: React.Dispatch<React.SetStateAction<number>>
  setCurrentPage: (page: any) => void
}

export function useGlobalDragAndDrop({
  isGameRunning,
  ensureGameDirectoryReady,
  showGlobalToast,
  setModListRefreshSignal,
  setCurrentPage,
}: UseGlobalDragAndDropProps) {
  const [isGlobalDragOver, setIsGlobalDragOver] = useState(false)
  const globalDragCounterRef = useRef(0)
  const isHandlingGlobalDropRef = useRef(false)
  const lastHandledDropRef = useRef<{ sig: string; at: number } | null>(null)

  const getZipPathFromPayload = useCallback((paths: string[]) => {
    return paths.find((path) => path.toLowerCase().endsWith(".zip")) || null
  }, [])

  const handleGlobalZipDrop = useCallback(async (paths: string[], source: string) => {
    if (isGameRunning) {
      showGlobalToast("游戏运行中不能安装模组，请退出游戏后再试。", "warning")
      return
    }

    const zipPath = getZipPathFromPayload(paths)

    if (!zipPath) {
      if (paths.length > 0) {
        showGlobalToast(`【${source}】未检测到 .zip 文件`, "warning")
      } else {
        showGlobalToast(`【${source}】未检测到拖入文件`, "warning")
      }
      return
    }

    const normalizedZipPath = zipPath.toLowerCase()
    const now = Date.now()
    const lastDrop = lastHandledDropRef.current
    if (isHandlingGlobalDropRef.current) {
      if (!lastDrop || (lastDrop.sig !== normalizedZipPath || now - lastDrop.at > 1200)) {
        // allow a new install
      } else {
        return
      }
    } else if (lastDrop && lastDrop.sig === normalizedZipPath && now - lastDrop.at < 1200) {
      return
    }

    isHandlingGlobalDropRef.current = true
    lastHandledDropRef.current = { sig: normalizedZipPath, at: now }

    const gameDir = await ensureGameDirectoryReady()
    if (!gameDir) {
      isHandlingGlobalDropRef.current = false
      return
    }

    if (!window || !(window as any).__TAURI_INTERNALS__) {
      showGlobalToast("当前运行环境不支持拖拽安装，请在桌面应用中运行", "warning")
      isHandlingGlobalDropRef.current = false
      return
    }

    try {
      const invokeModule = await import("@tauri-apps/api/core")
      await invokeModule.invoke("install_mod_from_zip", { gameDir, zipPath })
      const fileName = zipPath.split("\\").pop()?.split("/").pop() || "模组"
      setCurrentPage("mods")
      setModListRefreshSignal((value) => value + 1)
      showGlobalToast(`已安装模组包：${fileName}`, "success")
    } catch (err) {
      console.error(`install_mod_from_zip failed from ${source}:`, err)
      showGlobalToast("安装模组失败: " + err, "warning")
    } finally {
      isHandlingGlobalDropRef.current = false
    }
  }, [ensureGameDirectoryReady, getZipPathFromPayload, isGameRunning, setCurrentPage, setModListRefreshSignal, showGlobalToast])

  const extractZipPathFromDataTransfer = useCallback((dataTransfer: DataTransfer | null): string | null => {
    if (!dataTransfer) return null
    const files = Array.from(dataTransfer.files || [])
    const zipFile = files.find((file) => file.name.toLowerCase().endsWith(".zip"))
    if (!zipFile) return null
    return (zipFile as File & { path?: string }).path || null
  }, [])

  useEffect(() => {
    const unlistenFns: Array<() => void> = []

    const setupGlobalDrop = async () => {
      if (typeof window === "undefined" || !(window as any).__TAURI_INTERNALS__) {
        return
      }

      try {
        const webviewModule = await import("@tauri-apps/api/webview")
        const webview = webviewModule.getCurrentWebview()

        unlistenFns.push(
          await webview.onDragDropEvent((event) => {
            const payload = event.payload
            if (payload.type === "enter" || payload.type === "over") {
              setIsGlobalDragOver(true)
              return
            }

            if (payload.type === "leave") {
              setIsGlobalDragOver(false)
              globalDragCounterRef.current = 0
              return
            }

            if (payload.type === "drop") {
              setIsGlobalDragOver(false)
              globalDragCounterRef.current = 0
              handleGlobalZipDrop(payload.paths, "window.webview")
            }
          })
        )
      } catch (err) {
        console.debug("Unable to setup global file drop listener:", err)
      }
    }

    setupGlobalDrop()

    return () => {
      unlistenFns.forEach((unlisten) => unlisten())
    }
  }, [handleGlobalZipDrop])

  const handleGlobalDragEnter = (e: DragEvent<HTMLDivElement>) => {
    if (typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__) {
      return
    }
    e.preventDefault()
    globalDragCounterRef.current += 1
    setIsGlobalDragOver(true)
  }

  const handleGlobalDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__) {
      return
    }
    e.preventDefault()
    e.dataTransfer.dropEffect = "copy"
  }

  const handleGlobalDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__) {
      return
    }
    e.preventDefault()
    globalDragCounterRef.current = Math.max(0, globalDragCounterRef.current - 1)
    if (globalDragCounterRef.current === 0) {
      setIsGlobalDragOver(false)
    }
  }

  const handleGlobalDrop = (e: DragEvent<HTMLDivElement>) => {
    if (typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__) {
      return
    }
    e.preventDefault()
    e.stopPropagation()
    globalDragCounterRef.current = 0
    setIsGlobalDragOver(false)

    const zipPath = extractZipPathFromDataTransfer(e.dataTransfer)
    if (!zipPath) {
      const files = Array.from(e.dataTransfer.files || [])
      const zipFile = files.find((file) => file.name.toLowerCase().endsWith(".zip"))
      if (!files.length) {
        showGlobalToast("未检测到拖入文件", "warning")
        return
      }
      if (!zipFile) {
        showGlobalToast("只支持拖入 .zip 模组压缩包", "warning")
        return
      }
      showGlobalToast("当前环境未返回文件绝对路径，请使用“导入新模组”或手动放置可访问路径", "warning")
      return
    }

    handleGlobalZipDrop([zipPath], "页面拖放")
  }

  return {
    isGlobalDragOver,
    handleGlobalDragEnter,
    handleGlobalDragOver,
    handleGlobalDragLeave,
    handleGlobalDrop,
  }
}
