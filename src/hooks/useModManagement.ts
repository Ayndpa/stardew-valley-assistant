import { useState, useEffect, useCallback, useMemo } from "react"
import { Mod } from "@/components/mods/ModList"
import { ModStateEntry } from "@/components/mods/ModProfiles"
import type { QueueSmapiDownloadRequest } from "@/hooks/useDownloadManager"

// Helper functions for dynamic imports to ensure web compatibility
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

type UseModManagementOptions = {
  refreshSignal?: number
  isGameRunning?: boolean
  onQueueSmapiDownload?: (request: QueueSmapiDownloadRequest) => { ok: boolean; message: string }
}

export function useModManagement(options?: UseModManagementOptions) {
  const isGameRunning = options?.isGameRunning ?? false
  const [mods, setMods] = useState<Mod[]>([])
  const [isLoadingMods, setIsLoadingMods] = useState(true)
  const [searchTerm, setSearchTerm] = useState("")
  const [selectedCategory, setSelectedCategory] = useState<string>("all")
  const [selectedModId, setSelectedModId] = useState<string>("")
  const [activeDetailTab, setActiveDetailTab] = useState<string>("info")
  const [smapiStatus, setSmapiStatus] = useState<{
    installed: boolean
    version: string | null
    path: string | null
  } | null>(null)

  // Installer and Management States
  const [gameVersion, setGameVersion] = useState<string | null>(null)
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

  // Interactive UI Actions States
  const [isScanning, setIsScanning] = useState(false)
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: "success" | "info" | "warning" } | null>(null)
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)

  // New Mod Form State
  const [newModName, setNewModName] = useState("")
  const [newModEngName, setNewModEngName] = useState("")
  const [newModAuthor, setNewModAuthor] = useState("")
  const [newModDesc, setNewModDesc] = useState("")
  const [newModCategory, setNewModCategory] = useState<"core" | "content" | "utility" | "expansion">("utility")
  const [newModVersion, setNewModVersion] = useState("1.0.0")

  const selectedMod = useMemo(() => mods.find((m) => m.id === selectedModId), [mods, selectedModId])

  const showToast = useCallback((message: string, type: "success" | "info" | "warning") => {
    setToast({ message, type })
  }, [])

  const ensureCanModify = useCallback(() => {
    if (!isGameRunning) return true
    showToast("游戏运行中不能修改模组或 SMAPI，请退出游戏后再试。", "warning")
    return false
  }, [isGameRunning, showToast])

  // Auto Dismiss Toast
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => {
        setToast(null)
      }, 4000)
      return () => clearTimeout(timer)
    }
  }, [toast])

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

  // Load game version on mount / change
  useEffect(() => {
    async function loadVersion() {
      const gameDir = localStorage.getItem("stardewGameDirectory") || ""
      const invoke = await getTauriInvoke()
      if (gameDir && invoke) {
        try {
          const ver = await invoke("get_game_version", { gameDir }) as string
          setGameVersion(ver)
        } catch (err) {
          console.error("Failed to get game version:", err)
        }
      } else {
        setGameVersion("1.6.9")
      }
    }
    loadVersion()
  }, [])

  // Load actual status and mods list from Tauri backend on mount
  useEffect(() => {
    async function initMods() {
      const gameDir = localStorage.getItem("stardewGameDirectory") || ""
      const invoke = await getTauriInvoke()
      if (gameDir && invoke) {
        // Load SMAPI status
        invoke("check_smapi_status", { gameDir })
          .then((status: any) => {
            setSmapiStatus(status)
          })
          .catch((err: any) => {
            console.error("Failed to check SMAPI status:", err)
          })

        // Load installed mods
        setIsScanning(true)
        setIsLoadingMods(true)
        invoke("list_installed_mods", { gameDir })
          .then(async (loadedMods: any) => {
            setMods(loadedMods)
            if (loadedMods.length > 0) {
              setSelectedModId(loadedMods[0].id)
            } else {
              setSelectedModId("")
            }
          })
          .catch((err: any) => {
            console.error("Failed to list installed mods:", err)
            showToast("加载本地模组列表失败", "warning")
          })
          .finally(() => {
            setIsScanning(false)
            setIsLoadingMods(false)
          })
      } else {
        // In Web/Mock environment or if gameDir is empty
        setIsLoadingMods(false)
        setSmapiStatus({
          installed: true,
          version: "4.0.8",
          path: "Mock/StardewModdingAPI"
        })
      }
    }
    initMods()
  }, [showToast])

  useEffect(() => {
    async function refreshMods() {
      const refreshToken = options?.refreshSignal
      if (typeof refreshToken !== "number") {
        return
      }

      const gameDir = localStorage.getItem("stardewGameDirectory") || ""
      const invoke = await getTauriInvoke()
      if (!gameDir || !invoke) {
        return
      }

      setIsScanning(true)
      try {
        const loadedMods = await invoke("list_installed_mods", { gameDir }) as any[]
        setMods(loadedMods)
        setSelectedModId((prevId) => {
          if (!loadedMods.length) return ""
          return loadedMods.some((mod: any) => mod.id === prevId) ? prevId : loadedMods[0].id
        })
      } catch (err: any) {
        console.error("Failed to refresh installed mods:", err)
      } finally {
        setIsScanning(false)
      }
    }
    refreshMods()
  }, [options?.refreshSignal, showToast])

  // Handlers
  const handleToggleMod = useCallback(async (modId: string) => {
    if (!ensureCanModify()) return

    const gameDir = localStorage.getItem("stardewGameDirectory") || ""
    const targetMod = mods.find((m) => m.id === modId)
    if (!targetMod) return

    const newStatus = !targetMod.isEnabled
    const invoke = await getTauriInvoke()

    if (invoke && gameDir) {
      try {
        const newFolderName = await invoke("toggle_mod", {
          gameDir,
          folderName: targetMod.folderName,
          enable: newStatus
        }) as string

        // Update local state
        setMods((prevMods) =>
          prevMods.map((m) => {
            if (m.id === modId) {
              return {
                ...m,
                isEnabled: newStatus,
                folderName: newFolderName,
                localPath: `Mods/${newFolderName}`
              }
            }
            return m
          })
        )
        showToast(`已${newStatus ? "启用" : "禁用"}模组: ${targetMod.name}`, "success")
      } catch (err: any) {
        console.error("Toggle mod error:", err)
        showToast("切换模组状态失败: " + err, "warning")
      }
    } else {
      // Browser Mock
      setMods((prevMods) =>
        prevMods.map((m) => {
          if (m.id === modId) {
            showToast(`（Web 模式模拟）已${newStatus ? "启用" : "禁用"}模组: ${m.name}`, "info")
            return { ...m, isEnabled: newStatus }
          }
          return m
        })
      )
    }
  }, [ensureCanModify, mods, showToast])

  const handleScanDirectory = useCallback(async () => {
    const gameDir = localStorage.getItem("stardewGameDirectory") || ""
    if (!gameDir) {
      showToast("未配置游戏安装目录，请先在设置中配置", "warning")
      return
    }

    setIsScanning(true)
    const invoke = await getTauriInvoke()
    if (invoke) {
      try {
        const status = await invoke("check_smapi_status", { gameDir }) as any
        setSmapiStatus(status)

        const loadedMods = await invoke("list_installed_mods", { gameDir }) as any[]
        setMods(loadedMods)
        if (loadedMods.length > 0) {
          if (!loadedMods.some((m: any) => m.id === selectedModId)) {
            setSelectedModId(loadedMods[0].id)
          }
        } else {
          setSelectedModId("")
        }
        showToast(`扫描成功！已在 [${gameDir}\\Mods] 中检索到 ${loadedMods.length} 个模组文件夹。`, "success")
      } catch (err: any) {
        console.error("Scan error:", err)
        showToast("扫描失败: " + err, "warning")
      } finally {
        setIsScanning(false)
      }
    } else {
      // Browser Mock
      setTimeout(() => {
        setIsScanning(false)
        showToast(`（Web 模式模拟）扫描成功！在 [${gameDir}\\Mods] 中检索到 ${mods.length} 个模组文件夹。`, "success")
      }, 1200)
    }
  }, [mods.length, selectedModId, showToast])

  const handleCheckUpdates = useCallback(async () => {
    setIsCheckingUpdates(true)
    const invoke = await getTauriInvoke()
    if (invoke) {
      try {
        const compatMods = await invoke("fetch_smapi_compatibility_mods") as any[]
        // Build a map: nexusId -> latest compatible version
        const versionMap = new Map<number, string>()
        for (const cm of compatMods) {
          if (cm.nexusId && cm.version) {
            versionMap.set(cm.nexusId, cm.version)
          }
        }
        // Update latestVersion for each installed mod
        setMods((prev) =>
          prev.map((m) => {
            if (m.nexusId && versionMap.has(m.nexusId)) {
              return { ...m, latestVersion: versionMap.get(m.nexusId)! }
            }
            return m
          })
        )
        const updatedMods = mods.map((m) => {
          if (m.nexusId && versionMap.has(m.nexusId)) {
            return { ...m, latestVersion: versionMap.get(m.nexusId)! }
          }
          return m
        })
        const needsUpdateCount = updatedMods.filter((m) => m.version !== m.latestVersion).length
        setIsCheckingUpdates(false)
        if (needsUpdateCount > 0) {
          showToast(`检查完毕！发现 ${needsUpdateCount} 个模组有新版本。请点击黄色卡片升级。`, "warning")
        } else {
          showToast("检查完毕！所有已载入模组均是最新版本。", "success")
        }
      } catch (err: any) {
        setIsCheckingUpdates(false)
        console.error("Failed to check updates:", err)
        showToast("检查更新失败: " + err, "warning")
      }
    } else {
      // Web mock
      setTimeout(() => {
        setIsCheckingUpdates(false)
        const needsUpdateCount = mods.filter((m) => m.version !== m.latestVersion).length
        if (needsUpdateCount > 0) {
          showToast(`检查完毕！发现 ${needsUpdateCount} 个模组有新版本。请点击黄色卡片升级。`, "warning")
        } else {
          showToast("检查完毕！所有已载入模组均是最新版本。", "success")
        }
      }, 1500)
    }
  }, [mods, showToast])

  const handleOpenFolder = useCallback(async () => {
    const gameDir = localStorage.getItem("stardewGameDirectory") || ""
    if (!gameDir) {
      showToast("未配置游戏安装目录", "warning")
      return
    }

    const modsPath = `${gameDir}\\Mods`
    const invoke = await getTauriInvoke()
    if (invoke) {
      try {
        await invoke("open_in_file_manager", { path: modsPath })
        showToast(`已在系统文件管理器中打开 Mods 文件夹`, "success")
      } catch (err: any) {
        console.error("Open folder error:", err)
        showToast("打开文件夹失败: " + err, "warning")
      }
    } else {
      // Browser Mock
      showToast(`（Web 模式模拟）已模拟打开文件夹: ${modsPath}`, "success")
    }
  }, [showToast])

  // Handle configuration changes locally
  const handleConfigChange = useCallback((modId: string, key: string, newValue: any) => {
    if (!ensureCanModify()) return

    setMods((prevMods) =>
      prevMods.map((m) => {
        if (m.id === modId) {
          const updatedConfig = m.config.map((field) => {
            if (field.key === key) {
              return { ...field, value: newValue }
            }
            return field
          })
          return { ...m, config: updatedConfig }
        }
        return m
      })
    )
  }, [ensureCanModify])

  const handleSaveConfig = useCallback(async () => {
    if (!ensureCanModify()) return

    if (!selectedMod) return
    const gameDir = localStorage.getItem("stardewGameDirectory") || ""

    // Build the config object { key: value }
    const configObj: Record<string, any> = {}
    selectedMod.config.forEach((field) => {
      configObj[field.key] = field.value
    })

    const invoke = await getTauriInvoke()
    if (invoke && gameDir) {
      try {
        await invoke("save_mod_config", {
          gameDir,
          folderName: selectedMod.folderName,
          config: configObj
        })
        showToast(`模组 [${selectedMod.name}] 的配置参数已保存至本地 config.json。`, "success")
      } catch (err: any) {
        console.error("Save config error:", err)
        showToast("保存配置失败: " + err, "warning")
      }
    } else {
      // Browser Mock
      showToast(`（Web 模式模拟）模组 [${selectedMod.name}] 的配置参数已保存至本地 config.json。`, "success")
    }
  }, [ensureCanModify, selectedMod, showToast])

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

    if (options?.onQueueSmapiDownload) {
      setInstallStatus("downloading")
      setInstallProgress(10)
      const result = options.onQueueSmapiDownload({
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

          const loadedMods = await invoke("list_installed_mods", { gameDir }) as any[]
          setMods(loadedMods)
          setSelectedModId(loadedMods.length > 0 ? loadedMods[0].id : "")

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
        
        // Scan mods
        const loadedMods = await invoke("list_installed_mods", { gameDir }) as any[]
        setMods(loadedMods)
        if (loadedMods.length > 0) {
          setSelectedModId(loadedMods[0].id)
        } else {
          setSelectedModId("")
        }
        
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
  }, [ensureCanModify, options, smapiDownloadUrl, smapiMirror, smapiLatestVersion, showToast])

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
          setMods([])
          setSelectedModId("")
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
        setMods([])
        setSelectedModId("")
        setIsManagementOpen(false)
      }
    }
  }, [ensureCanModify, showToast])

  const handleAddNewMod = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    if (!ensureCanModify()) return

    if (!newModName || !newModAuthor) {
      showToast("请完整填写模组名称与作者！", "warning")
      return
    }

    const newId = newModName.toLowerCase().replace(/\s+/g, "-")
    const newModObj: Mod = {
      id: newId,
      name: newModName,
      englishName: newModEngName || newModName,
      version: newModVersion,
      latestVersion: newModVersion,
      author: newModAuthor,
      description: newModDesc || "无详细描述。",
      category: newModCategory,
      isEnabled: true,
      localPath: `Mods/${newModEngName.replace(/\s+/g, "") || newModName}`,
      folderName: newModEngName.replace(/\s+/g, "") || newModName,
      dependencies: [],
      config: [
        { key: "Enabled", label: "启用该模组", type: "boolean", value: true, description: "控制此模组是否加载生效" }
      ]
    }

    setMods((prev) => [newModObj, ...prev])
    setSelectedModId(newId)
    setIsAddModalOpen(false)
    showToast(`导入成功！模组 [${newModName}] 已加载至列表。`, "success")

    // Reset Form
    setNewModName("")
    setNewModEngName("")
    setNewModAuthor("")
    setNewModDesc("")
    setNewModCategory("utility")
    setNewModVersion("1.0.0")
  }, [ensureCanModify, newModName, newModAuthor, newModEngName, newModVersion, newModDesc, newModCategory, showToast])

  const handleInstallModFromZip = useCallback(async (zipPath: string) => {
    if (!ensureCanModify()) return

    const gameDir = localStorage.getItem("stardewGameDirectory") || ""
    if (!gameDir) {
      showToast("未配置游戏安装目录，请先在设置中配置", "warning")
      return
    }

    if (!zipPath.toLowerCase().endsWith(".zip")) {
      showToast("仅支持 .zip 模组压缩包", "warning")
      return
    }

    const invoke = await getTauriInvoke()
    if (!invoke) {
      showToast("当前运行环境不支持本地路径安装，请在桌面应用中运行", "warning")
      return
    }

    setIsScanning(true)
    try {
      await invoke("install_mod_from_zip", { gameDir, zipPath })
      const loadedMods = await invoke("list_installed_mods", { gameDir }) as any[]
      setMods(loadedMods)
      if (loadedMods.length > 0) {
        if (!loadedMods.some((m: any) => m.id === selectedModId)) {
          setSelectedModId(loadedMods[0].id)
        }
      } else {
        setSelectedModId("")
      }
      const fileName = zipPath.split("\\").pop()?.split("/").pop() || "模组"
      showToast(`已安装模组包：${fileName}`, "success")
    } catch (err: any) {
      console.error("Install mod from zip failed:", err)
      showToast("安装模组失败: " + err, "warning")
    } finally {
      setIsScanning(false)
    }
  }, [ensureCanModify, selectedModId, showToast])

  const handleDeleteMod = useCallback(async (modId: string) => {
    if (!ensureCanModify()) return

    const modToDelete = mods.find((m) => m.id === modId)
    if (!modToDelete) return
    const gameDir = localStorage.getItem("stardewGameDirectory") || ""
    if (!gameDir) {
      showToast("未配置游戏安装目录", "warning")
      return
    }

    const invoke = await getTauriInvoke()
    if (!invoke) {
      const remaining = mods.filter((m) => m.id !== modId)
      setMods(remaining)
      setSelectedModId(remaining.length > 0 ? remaining[0].id : "")
      showToast(`已成功移除模组：${modToDelete.name}`, "info")
      return
    }

    setIsScanning(true)
    try {
      await invoke("delete_mod", { gameDir, folderName: modToDelete.folderName })
      const loadedMods = await invoke("list_installed_mods", { gameDir }) as any[]
      setMods(loadedMods)
      if (loadedMods.length > 0) {
        if (!loadedMods.some((m: any) => m.id === selectedModId)) {
          setSelectedModId(loadedMods[0].id)
        }
      } else {
        setSelectedModId("")
      }
      showToast(`已成功移除模组：${modToDelete.name}`, "success")
    } catch (err: any) {
      console.error("Delete mod failed:", err)
      showToast("移除模组失败: " + err, "warning")
    } finally {
      setIsScanning(false)
    }
  }, [ensureCanModify, mods, selectedModId, showToast])

  const handleOpenOfficialSite = useCallback(async () => {
    const openUrl = await getTauriOpen()
    if (openUrl) {
      openUrl("https://smapi.io").catch((err: any) => console.error(err));
    } else {
      window.open("https://smapi.io", "_blank");
    }
  }, [])

  // Apply a profile: toggle each mod to match the profile state
  const handleApplyProfile = useCallback(async (modStates: ModStateEntry[]) => {
    if (!ensureCanModify()) return

    const gameDir = localStorage.getItem("stardewGameDirectory") || ""
    const invoke = await getTauriInvoke()

    if (invoke && gameDir) {
      try {
        await invoke("apply_profile", { gameDir, modStates })
        // Update local mod states to match
        const stateMap = new Map(modStates.map((s) => [s.folderName, s.isEnabled]))
        setMods((prev) =>
          prev.map((m) => {
            const cleanFolder = m.folderName.replace(/^\./, "")
            const wantEnabled = stateMap.get(cleanFolder)
            if (wantEnabled !== undefined && m.isEnabled !== wantEnabled) {
              const newFolderName = wantEnabled ? cleanFolder : `.${cleanFolder}`
              return { ...m, isEnabled: wantEnabled, folderName: newFolderName, localPath: `Mods/${newFolderName}` }
            }
            return m
          })
        )
      } catch (err: any) {
        throw err
      }
    } else {
      // Web mock
      const stateMap = new Map(modStates.map((s) => [s.folderName, s.isEnabled]))
      setMods((prev) =>
        prev.map((m) => {
          const cleanFolder = m.folderName.replace(/^\./, "")
          const wantEnabled = stateMap.get(cleanFolder)
          if (wantEnabled !== undefined) {
            return { ...m, isEnabled: wantEnabled }
          }
          return m
        })
      )
    }
  }, [ensureCanModify])

  // Filter and search computation
  const filteredMods = useMemo(() => {
    return mods.filter((m) => {
      const matchesSearch =
        m.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        m.englishName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        m.author.toLowerCase().includes(searchTerm.toLowerCase()) ||
        m.description.toLowerCase().includes(searchTerm.toLowerCase())

      const matchesCategory = selectedCategory === "all" || m.category === selectedCategory
      return matchesSearch && matchesCategory
    })
  }, [mods, searchTerm, selectedCategory])

  // Global Statistics
  const totalInstalled = mods.length
  const activeCount = useMemo(() => mods.filter((m) => m.isEnabled).length, [mods])
  const updateAvailableCount = useMemo(() => mods.filter((m) => m.version !== m.latestVersion).length, [mods])

  return {
    mods,
    isLoadingMods,
    searchTerm,
    setSearchTerm,
    selectedCategory,
    setSelectedCategory,
    selectedModId,
    setSelectedModId,
    activeDetailTab,
    setActiveDetailTab,
    smapiStatus,
    gameVersion,
    smapiLatestVersion,
    smapiDownloadUrl,
    smapiMirror,
    setSmapiMirror: handleSetSmapiMirror,
    isManagementOpen,
    setIsManagementOpen,
    installStatus,
    installProgress,
    installError,
    isScanning,
    isCheckingUpdates,
    toast,
    setToast,
    isAddModalOpen,
    setIsAddModalOpen,
    
    // New Mod form state
    newModName,
    setNewModName,
    newModEngName,
    setNewModEngName,
    newModAuthor,
    setNewModAuthor,
    newModDesc,
    setNewModDesc,
    newModCategory,
    setNewModCategory,
    newModVersion,
    setNewModVersion,

    // Computed values
    selectedMod,
    filteredMods,
    totalInstalled,
    activeCount,
    updateAvailableCount,

    // Operations
    handleToggleMod,
    handleScanDirectory,
    handleCheckUpdates,
    handleOpenFolder,
    handleConfigChange,
    handleSaveConfig,
    handleInstallSmapi,
    handleUninstallSmapi,
    handleAddNewMod,
    handleDeleteMod,
    handleOpenOfficialSite,
    handleApplyProfile,
    handleInstallModFromZip,
    showToast
  }
}
