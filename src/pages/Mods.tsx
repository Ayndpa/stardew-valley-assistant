import { useState, useEffect } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Sliders, CheckCircle2, AlertTriangle, Info, X } from "lucide-react"
import type { Page } from "@/App"

// Import subcomponents
import { SmapiInstaller } from "@/components/mods/SmapiInstaller"
import { SmapiManager } from "@/components/mods/SmapiManager"
import { ModList, Mod } from "@/components/mods/ModList"
import { ModDetail } from "@/components/mods/ModDetail"
import { AddModModal } from "@/components/mods/AddModModal"
import { ModProfiles, ModStateEntry } from "@/components/mods/ModProfiles"

// Category Translations
const CATEGORY_MAP = {
  all: "全部",
  core: "核心API",
  content: "视觉美化",
  utility: "辅助工具",
  expansion: "大型拓展"
}

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

export function Mods({ onNavigate }: { onNavigate?: (page: Page) => void }) {
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
  const [smapiMirror, setSmapiMirror] = useState<"ghproxy" | "official">(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("stardewSmapiMirror") as "ghproxy" | "official") || "ghproxy"
    }
    return "ghproxy"
  })

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

  // Selected Mod Reference
  const selectedMod = mods.find((m) => m.id === selectedModId)

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
  const fetchLatestSmapi = async () => {
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
  }

  useEffect(() => {
    fetchLatestSmapi()
  }, [])

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
            // Fetch SMAPI compatibility data to resolve latest versions
            try {
              const compatMods = await invoke("fetch_smapi_compatibility_mods") as any[]
              const versionMap = new Map<number, string>()
              for (const cm of compatMods) {
                if (cm.nexusId && cm.version) {
                  versionMap.set(cm.nexusId, cm.version)
                }
              }
              const enriched = loadedMods.map((m: any) => {
                if (m.nexusId && versionMap.has(m.nexusId)) {
                  return { ...m, latestVersion: versionMap.get(m.nexusId)! }
                }
                return m
              })
              setMods(enriched)
              if (enriched.length > 0) {
                setSelectedModId(enriched[0].id)
              } else {
                setSelectedModId("")
              }
            } catch {
              setMods(loadedMods)
              if (loadedMods.length > 0) {
                setSelectedModId(loadedMods[0].id)
              } else {
                setSelectedModId("")
              }
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
  }, [])

  // Handlers
  const handleToggleMod = async (modId: string) => {
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
  }

  const showToast = (message: string, type: "success" | "info" | "warning") => {
    setToast({ message, type })
  }

  const handleScanDirectory = async () => {
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
  }

  const handleCheckUpdates = async () => {
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
  }

  const handleOpenFolder = async () => {
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
  }

  // Handle configuration changes locally
  const handleConfigChange = (modId: string, key: string, newValue: any) => {
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
  }

  const handleSaveConfig = async () => {
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
  }

  const handleInstallSmapi = async () => {
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
  }

  const handleUninstallSmapi = async () => {
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
  }

  const handleAddNewMod = (e: React.FormEvent) => {
    e.preventDefault()
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
  }

  const handleDeleteMod = (modId: string) => {
    const modToDelete = mods.find((m) => m.id === modId)
    if (!modToDelete) return

    setMods((prev) => prev.filter((m) => m.id !== modId))
    showToast(`已成功移除模组：${modToDelete.name}`, "info")
    
    // Select the first remaining mod
    const remaining = mods.filter((m) => m.id !== modId)
    if (remaining.length > 0) {
      setSelectedModId(remaining[0].id)
    } else {
      setSelectedModId("")
    }
  }

  const handleOpenOfficialSite = async () => {
    const openUrl = await getTauriOpen()
    if (openUrl) {
      openUrl("https://smapi.io").catch((err: any) => console.error(err));
    } else {
      window.open("https://smapi.io", "_blank");
    }
  }

  // Apply a profile: toggle each mod to match the profile state
  const handleApplyProfile = async (modStates: ModStateEntry[]) => {
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
  }

  // Filter and search computation
  const filteredMods = mods.filter((m) => {
    const matchesSearch =
      m.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.englishName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.author.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.description.toLowerCase().includes(searchTerm.toLowerCase())

    const matchesCategory = selectedCategory === "all" || m.category === selectedCategory
    return matchesSearch && matchesCategory
  })

  // Global Statistics
  const totalInstalled = mods.length
  const activeCount = mods.filter((m) => m.isEnabled).length
  const updateAvailableCount = mods.filter((m) => m.version !== m.latestVersion).length

  return (
    <div className="p-8 space-y-6 relative">
      {/* Toast Notification */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-4 rounded-xl border shadow-xl animate-in slide-in-from-bottom-5 fade-in duration-300 ${
          toast.type === "success" 
            ? "bg-green-50/90 dark:bg-green-950/80 border-green-200 dark:border-green-800 text-green-800 dark:text-green-200" 
            : toast.type === "warning" 
            ? "bg-amber-50/90 dark:bg-amber-950/80 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200" 
            : "bg-blue-50/90 dark:bg-blue-950/80 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200"
        }`}>
          {toast.type === "success" && <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />}
          {toast.type === "warning" && <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0" />}
          {toast.type === "info" && <Info className="h-5 w-5 text-blue-500 flex-shrink-0" />}
          <div className="text-sm font-medium pr-4">{toast.message}</div>
          <button 
            onClick={() => setToast(null)} 
            className="p-1 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 transition-colors ml-auto"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {smapiStatus !== null && !smapiStatus.installed ? (
        <SmapiInstaller
          smapiLatestVersion={smapiLatestVersion}
          smapiMirror={smapiMirror}
          setSmapiMirror={handleSetSmapiMirror}
          onInstall={handleInstallSmapi}
          onOpenOfficialSite={handleOpenOfficialSite}
          installStatus={installStatus}
          installProgress={installProgress}
          installError={installError}
          gameVersion={gameVersion}
        />
      ) : (
        <>
          {/* Header Panel */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-card border border-border p-6 rounded-2xl shadow-sm bg-gradient-to-r from-card to-accent/20 animate-in fade-in duration-300">
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-primary to-green-600 bg-clip-text text-transparent">模组管理</h2>
                {smapiStatus?.installed && !smapiStatus?.version ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full border transition-all" style={{ backgroundColor: 'rgba(120,120,120,0.15)', color: '#888', borderColor: 'rgba(120,120,120,0.25)' }}>
                    SMAPI: 已安装 (加载中)
                  </span>
                ) : (
                  <Badge 
                    className={`gap-1.5 px-3 py-1 font-semibold rounded-full border transition-all ${
                      smapiStatus?.installed 
                        ? "bg-primary/10 text-primary border-primary/20" 
                        : "bg-red-500/10 text-red-500 border-red-500/20"
                    }`}
                  >
                    {smapiStatus === null ? (
                      "正在检测 SMAPI..."
                    ) : smapiStatus.installed ? (
                      `SMAPI: v${smapiStatus.version}`
                    ) : (
                      "SMAPI: 未安装"
                    )}
                  </Badge>
                )}
                {smapiStatus?.installed && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-lg text-xs gap-1.5 hover:bg-accent border-border font-semibold shadow-sm"
                    onClick={() => setIsManagementOpen(!isManagementOpen)}
                  >
                    <Sliders className="h-3.5 w-3.5 text-primary" />
                    管理 SMAPI
                  </Button>
                )}
              </div>
              <p className="text-muted-foreground mt-2 text-sm max-w-xl">
                对游戏扩展模组的加载进行集中控制。您可以在此处扫描本地模组、进行一键版本查重升级，或者直接对每个模组的本地 <code className="bg-accent/40 px-1 py-0.5 rounded text-xs">config.json</code> 参数进行模拟可视化编辑。
              </p>
            </div>

            {/* Global Statistics Panel */}
            <div className="flex gap-4 self-stretch lg:self-auto">
              <div className="bg-accent/30 dark:bg-accent/10 border border-border/60 rounded-xl px-4 py-3 text-center flex-1 lg:flex-initial min-w-[90px]">
                <p className="text-xs text-muted-foreground font-medium">已安装</p>
                <p className="text-2xl font-bold text-foreground mt-0.5">{totalInstalled}</p>
              </div>
              <div className="bg-green-50/50 dark:bg-green-950/10 border border-green-100 dark:border-green-950 rounded-xl px-4 py-3 text-center flex-1 lg:flex-initial min-w-[90px]">
                <p className="text-xs text-green-700 dark:text-green-400 font-medium">已启用</p>
                <p className="text-2xl font-bold text-green-600 dark:text-green-500 mt-0.5">{activeCount}</p>
              </div>
              <div className={`border rounded-xl px-4 py-3 text-center flex-1 lg:flex-initial min-w-[90px] transition-colors ${
                updateAvailableCount > 0 
                  ? "bg-amber-50/50 dark:bg-amber-950/10 border-amber-200 dark:border-amber-900" 
                  : "bg-accent/30 dark:bg-accent/10 border-border/60"
              }`}>
                <p className={`text-xs font-medium ${updateAvailableCount > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>可更新</p>
                <p className={`text-2xl font-bold mt-0.5 ${updateAvailableCount > 0 ? "text-amber-500" : "text-foreground"}`}>{updateAvailableCount}</p>
              </div>
            </div>
          </div>

          {/* SMAPI Management Panel */}
          <SmapiManager
            isManagementOpen={isManagementOpen}
            setIsManagementOpen={setIsManagementOpen}
            smapiStatus={smapiStatus}
            gameVersion={gameVersion}
            smapiLatestVersion={smapiLatestVersion}
            onUninstall={handleUninstallSmapi}
          />
          {/* Mod Profiles Section */}
          <ModProfiles
            currentMods={mods.map((m) => ({ folderName: m.folderName.replace(/^\./, ""), isEnabled: m.isEnabled, name: m.name }))}
            onApplyProfile={handleApplyProfile}
            showToast={showToast}
          />

          {/* Main Split Layout */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
            {/* Left Area: Filter Tabs & Mod Cards */}
            <div className="xl:col-span-7">
              <ModList
                mods={mods}
                filteredMods={filteredMods}
                selectedModId={selectedModId}
                setSelectedModId={setSelectedModId}
                onToggleMod={handleToggleMod}
                onDeleteMod={handleDeleteMod}
                selectedCategory={selectedCategory}
                setSelectedCategory={setSelectedCategory}
                categoryMap={CATEGORY_MAP}
                searchTerm={searchTerm}
                setSearchTerm={setSearchTerm}
                onScan={handleScanDirectory}
                isScanning={isScanning}
                onCheckUpdates={handleCheckUpdates}
                isCheckingUpdates={isCheckingUpdates}
                onOpenFolder={handleOpenFolder}
                onOpenAddModal={() => setIsAddModalOpen(true)}
                isLoading={isLoadingMods}
                onGoOnline={() => onNavigate?.("onlineMods")}
              />
            </div>

            {/* Right Area: Mod Details & Interactive Configuration */}
            <div className="xl:col-span-5">
              <ModDetail
                selectedMod={selectedMod}
                activeDetailTab={activeDetailTab}
                setActiveDetailTab={setActiveDetailTab}
                onToggleMod={handleToggleMod}
                onOpenFolder={handleOpenFolder}
                onConfigChange={handleConfigChange}
                onSaveConfig={handleSaveConfig}
              />
            </div>
          </div>

          {/* Add Mod Modal Dialog */}
          <AddModModal
            isOpen={isAddModalOpen}
            onClose={() => setIsAddModalOpen(false)}
            onSubmit={handleAddNewMod}
            name={newModName}
            setName={setNewModName}
            engName={newModEngName}
            setEngName={setNewModEngName}
            author={newModAuthor}
            setAuthor={setNewModAuthor}
            desc={newModDesc}
            setDesc={setNewModDesc}
            category={newModCategory}
            setCategory={setNewModCategory}
            version={newModVersion}
            setVersion={setNewModVersion}
            categoryMap={CATEGORY_MAP}
          />
        </>
      )}
    </div>
  )
}
