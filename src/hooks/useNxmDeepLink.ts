import { useCallback, useEffect, useRef } from "react"

interface NexusDownloadMetadata {
  modName: string
  author: string
}

interface UseNxmDeepLinkProps {
  isGameRunning: boolean
  ensureGameDirectoryReady: () => Promise<string | null>
  showGlobalToast: (message: string, type: "success" | "info" | "warning") => void
  queueNexusDownload: (payload: { modName: string; author: string; downloadUrl: string }) => { ok: boolean; message: string }
}

export function useNxmDeepLink({
  isGameRunning,
  ensureGameDirectoryReady,
  showGlobalToast,
  queueNexusDownload,
}: UseNxmDeepLinkProps) {
  const isHandlingNxmRef = useRef(false)
  const lastHandledNxmRef = useRef<{ sig: string; at: number } | null>(null)

  const handleNxmUrl = useCallback(async (downloadUrl: string, source: string) => {
    if (isGameRunning) {
      showGlobalToast("游戏运行中不能下载并安装模组，请退出游戏后再试。", "warning")
      return
    }

    const normalizedUrl = downloadUrl.trim()
    if (!normalizedUrl.toLowerCase().startsWith("nxm://")) {
      return
    }

    const signature = normalizedUrl.toLowerCase()
    const now = Date.now()
    const lastHandled = lastHandledNxmRef.current
    if (isHandlingNxmRef.current) {
      if (!lastHandled || lastHandled.sig !== signature || now - lastHandled.at > 1200) {
        showGlobalToast(`【${source}】已有 Nexus 下载正在处理，请稍后重试`, "warning")
      }
      return
    }
    if (lastHandled && lastHandled.sig === signature && now - lastHandled.at < 1200) {
      return
    }

    const gameDir = await ensureGameDirectoryReady()
    if (!gameDir) {
      return
    }

    if (typeof window === "undefined" || !(window as any).__TAURI_INTERNALS__) {
      showGlobalToast("当前运行环境不支持 NexusMods 协议安装，请在桌面应用中运行", "warning")
      return
    }

    isHandlingNxmRef.current = true
    lastHandledNxmRef.current = { sig: signature, at: now }
    try {
      let metadata: NexusDownloadMetadata | null = null
      try {
        const invokeModule = await import("@tauri-apps/api/core")
        metadata = await invokeModule.invoke<NexusDownloadMetadata>("fetch_nexus_download_metadata", {
          downloadUrl: normalizedUrl,
        })
      } catch (err) {
        console.debug("Failed to resolve Nexus download metadata:", err)
      }

      const result = queueNexusDownload({
        modName: metadata?.modName || "NexusMods 模组",
        author: metadata?.author || "",
        downloadUrl: normalizedUrl,
      })
      if (result.ok) {
        showGlobalToast("NexusMods 下载已加入下载管理", "info")
      } else {
        showGlobalToast(result.message, "warning")
      }
    } finally {
      isHandlingNxmRef.current = false
    }
  }, [ensureGameDirectoryReady, isGameRunning, queueNexusDownload, showGlobalToast])

  const handleNxmUrls = useCallback(async (urls: string[], source: string) => {
    for (const url of urls) {
      await handleNxmUrl(url, source)
    }
  }, [handleNxmUrl])

  useEffect(() => {
    const unlistenFns: Array<() => void> = []

    const setupNxmDeepLink = async () => {
      if (typeof window === "undefined" || !(window as any).__TAURI_INTERNALS__) {
        return
      }

      try {
        const [invokeModule, eventModule] = await Promise.all([
          import("@tauri-apps/api/core"),
          import("@tauri-apps/api/event"),
        ])

        const takePending = async () => {
          const pending = await invokeModule.invoke<string[]>("take_pending_nxm_urls")
          if (pending.length > 0) {
            await handleNxmUrls(pending, "NexusMods 协议")
          }
        }

        await takePending()
        unlistenFns.push(
          await eventModule.listen<string>("nxm-download-url", async () => {
            await takePending()
          })
        )
      } catch (err) {
        console.debug("Unable to setup nxm deep link listener:", err)
      }
    }

    setupNxmDeepLink()

    return () => {
      unlistenFns.forEach((unlisten) => unlisten())
    }
  }, [handleNxmUrls])

  return { handleNxmUrl, handleNxmUrls }
}
