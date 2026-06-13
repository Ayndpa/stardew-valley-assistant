import { useState, useEffect, useCallback } from "react"
import type { QueueSmapiDownloadRequest } from "@/hooks/useDownloadManager"

async function getTauriInvoke() {
  if (typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__) {
    try {
      const mod = await import("@tauri-apps/api/core");
      return mod.invoke;
    } catch (err) {
      console.error("Failed to load Tauri core invoke plugin", err);
    }
  }
  return null;
}

async function getTauriOpen() {
  if (typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__) {
    try {
      const mod = await import("@tauri-apps/plugin-opener");
      return mod.openUrl;
    } catch (err) {
      console.error("Failed to load Tauri opener plugin", err);
    }
  }
  return null;
}

interface UseSmapiInstallerOptions {
  isGameRunning: boolean
  showToast: (message: string, type: "success" | "info" | "warning") => void
  onQueueSmapiDownload?: (request: QueueSmapiDownloadRequest) => { ok: boolean; message: string }
  refreshMods: () => Promise<void>
}

export function useSmapiInstaller({
  isGameRunning,
  showToast,
  onQueueSmapiDownload,
  refreshMods,
}: UseSmapiInstallerOptions) {
  const [smapiStatus, setSmapiStatus] = useState<{
    installed: boolean
    version: string | null
    path: string | null
  } | null>(null)

  const [smapiLatestVersion, setSmapiLatestVersion] = useState<string | null>(null)
  const [smapiDownloadUrl, setSmapiDownloadUrl] = useState<string | null>(null)
  const [smapiMirror, setSmapiMirror] = useState<"ghproxy" | "official">(
    (typeof window !== "undefined" && (localStorage.getItem("stardewSmapiMirror") as "ghproxy" | "official")) || "ghproxy"
  )

  const handleSetSmapiMirror = (mirror: "ghproxy" | "official") => {
    setSmapiMirror(mirror)
    localStorage.setItem("stardewSmapiMirror", mirror)
  }

  const [isManagementOpen, setIsManagementOpen] = useState(false)
  const [installStatus, setInstallStatus] = useState<"idle" | "fetching" | "downloading" | "extracting" | "copying" | "success" | "error">("idle")
  const [installProgress, setInstallProgress] = useState(0)
  const [installError, setInstallError] = useState<string | null>(null)

  const ensureCanModify = useCallback(() => {
    if (!isGameRunning) return true
    showToast("游戏运行中不能修改模组或 SMAPI，请退出游戏后再试。", "warning")
    return false
  }, [isGameRunning, showToast])

  // Fetch Latest SMAPI from GitHub
  const fetchLatestSmapi = useCallback(async () => {
    try {
      const res = await fetch("https://api.github.com/repos/Pathoschild/SMAPI/releases/latest")
      const data = await res.json()
      const tagName = data.tag_name
      setSmapiLatestVersion(tagName)
      
      const zipAsset = data.assets.find((asset: any) => 
        asset.name.toLowerCase().includes("installer") && asset.name.endsWith(".zip")
      )
      if (zipAsset) {
        setSmapiDownloadUrl(zipAsset.browser_download_url)
      } else if (data.assets.length > 0) {
        setSmapiDownloadUrl(data.assets[0].browser_download_url)
      }
    } catch (err) {
      console.error("Failed to fetch latest SMAPI version:", err)
      setSmapiLatestVersion("4.5.2")
      setSmapiDownloadUrl("https://github.com/Pathoschild/SMAPI/releases/download/4.5.2/SMAPI-4.5.2-installer-double-zipped.zip")
    }
  }, [])

  useEffect(() => {
    fetchLatestSmapi()
  }, [fetchLatestSmapi])

  // Load SMAPI status on mount
  useEffect(() => {
    async function loadStatus() {
      const gameDir = localStorage.getItem("stardewGameDirectory") || ""
      const invoke = await getTauriInvoke()
      if (gameDir && invoke) {
        invoke("check_smapi_status", { gameDir })
          .then((status: any) => {
            setSmapiStatus(status)
          })
          .catch((err: any) => {
            console.error("Failed to check SMAPI status:", err)
          })
      } else {
        setSmapiStatus({
          installed: true,
          version: "4.0.8",
          path: "Mock/StardewModdingAPI"
        })
      }
    }
    loadStatus()
  }, [])

  const handleInstallSmapi = useCallback(async () => {
    if (!ensureCanModify()) return

    const gameDir = localStorage.getItem("stardewGameDirectory") || ""
    if (!gameDir) {
      showToast("未配置游戏安装目录，请先在设置中配置", "warning")
      return
    }

    setInstallStatus("fetching")
    setInstallProgress(10)
    setInstallError(null)

    let rawUrl = smapiDownloadUrl
    if (!rawUrl) {
      rawUrl = "https://github.com/Pathoschild/SMAPI/releases/download/4.5.2/SMAPI-4.5.2-installer-double-zipped.zip"
    }

    const downloadUrl = smapiMirror === "ghproxy" ? `https://gh-proxy.org/${rawUrl}` : rawUrl

    if (onQueueSmapiDownload) {
      setInstallStatus("downloading")
      setInstallProgress(10)
      const result = onQueueSmapiDownload({
        version: smapiLatestVersion,
        downloadUrl,
        mirror: smapiMirror,
        onSuccess: async () => {
          setInstallStatus("success")
          setInstallProgress(100)
          showToast("SMAPI 安装成功！", "success")

          const invoke = await getTauriInvoke()
          if (!invoke) return

          const status = await invoke("check_smapi_status", { gameDir }) as any
          setSmapiStatus(status)

          await refreshMods()

          setTimeout(() => {
            setInstallStatus("idle")
          }, 1500)
        },
        onError: (error) => {
          setInstallStatus("error")
          setInstallProgress(0)
          setInstallError(error)
        },
      })

      if (result.ok) {
        showToast(result.message, "info")
      } else {
        setInstallStatus("idle")
        showToast(result.message, "warning")
      }
      return
    }

    const invoke = await getTauriInvoke()

    if (invoke) {
      try {
        setInstallStatus("downloading")
        setInstallProgress(35)
        
        await invoke("install_smapi", { gameDir, downloadUrl })
        
        setInstallStatus("extracting")
        setInstallProgress(75)
        await new Promise((resolve) => setTimeout(resolve, 800))
        
        setInstallStatus("copying")
        setInstallProgress(90)
        await new Promise((resolve) => setTimeout(resolve, 500))

        setInstallStatus("success")
        setInstallProgress(100)
        showToast("SMAPI 安装成功！", "success")
        
        // Reload status
        const status = await invoke("check_smapi_status", { gameDir }) as any
        setSmapiStatus(status)
        
        await refreshMods()
        
        setTimeout(() => {
          setInstallStatus("idle")
        }, 1500)
      } catch (err: any) {
        console.error("Install SMAPI error:", err)
        setInstallStatus("error")
        setInstallError(err.toString())
        showToast(`安装失败: ${err}`, "warning")
      }
    } else {
      // Browser Mock
      setInstallStatus("downloading")
      setInstallProgress(35)
      setTimeout(() => {
        setInstallStatus("extracting")
        setInstallProgress(65)
        setTimeout(() => {
          setInstallStatus("copying")
          setInstallProgress(90)
          setTimeout(() => {
            setInstallStatus("success")
            setInstallProgress(100)
            showToast("（Web 模式模拟）SMAPI 安装成功！", "success")
            setSmapiStatus({
              installed: true,
              version: smapiLatestVersion || "4.0.8",
              path: "Mock/StardewModdingAPI"
            })
            setTimeout(() => {
              setInstallStatus("idle")
            }, 1000)
          }, 1000)
        }, 1000)
      }, 1000)
    }
  }, [ensureCanModify, onQueueSmapiDownload, smapiDownloadUrl, smapiMirror, smapiLatestVersion, showToast, refreshMods])

  const handleUninstallSmapi = useCallback(async () => {
    if (!ensureCanModify()) return

    const gameDir = localStorage.getItem("stardewGameDirectory") || ""
    if (!gameDir) return

    if (window.confirm("确定要卸载 SMAPI 吗？此操作会清除 SMAPI 启动核心，但会保留您的 Mods 文件夹和其中的个人模组。")) {
      const invoke = await getTauriInvoke()
      if (invoke) {
        try {
          await invoke("uninstall_smapi", { gameDir })
          showToast("SMAPI 卸载成功！游戏已重回原版状态。", "success")
          
          const status = await invoke("check_smapi_status", { gameDir }) as any
          setSmapiStatus(status)
          await refreshMods()
          setIsManagementOpen(false)
        } catch (err: any) {
          console.error("Uninstall SMAPI error:", err)
          showToast("卸载失败: " + err, "warning")
        }
      } else {
        // Browser Mock
        showToast("（Web 模式模拟）SMAPI 卸载成功！", "success")
        setSmapiStatus({
          installed: false,
          version: null,
          path: null
        })
        await refreshMods()
        setIsManagementOpen(false)
      }
    }
  }, [ensureCanModify, showToast, refreshMods])

  const handleOpenOfficialSite = useCallback(async () => {
    const openUrl = await getTauriOpen()
    if (openUrl) {
      openUrl("https://smapi.io").catch((err: any) => console.error(err));
    } else {
      window.open("https://smapi.io", "_blank");
    }
  }, [])

  return {
    smapiStatus,
    setSmapiStatus,
    smapiLatestVersion,
    smapiDownloadUrl,
    smapiMirror,
    setSmapiMirror: handleSetSmapiMirror,
    isManagementOpen,
    setIsManagementOpen,
    installStatus,
    installProgress,
    installError,
    handleInstallSmapi,
    handleUninstallSmapi,
    handleOpenOfficialSite,
  }
}
