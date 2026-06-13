import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { Mod } from "@/components/mods/ModList"
import type { QueueSmapiDownloadRequest } from "@/hooks/useDownloadManager"
import { syncModTranslations } from "@/lib/mod-translation-library"

import { useSmapiInstaller } from "./useSmapiInstaller"
import { useModProfiles } from "./useModProfiles"
import { useModEditor } from "./useModEditor"

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
  const completedTranslationModIdsRef = useRef<Set<string>>(new Set())
  const syncingTranslationModIdsRef = useRef<Set<string>>(new Set())
  const [translationSyncingModIds, setTranslationSyncingModIds] = useState<Set<string>>(new Set())

  // Interactive UI Actions States
  const [isScanning, setIsScanning] = useState(false)
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: "success" | "info" | "warning" } | null>(null)

  // Game version State
  const [gameVersion, setGameVersion] = useState<string | null>(null)

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

  useEffect(() => {
    const pendingMods = mods.filter((mod) => {
      return !completedTranslationModIdsRef.current.has(mod.id) && !syncingTranslationModIdsRef.current.has(mod.id)
    })
    if (pendingMods.length === 0) return

    pendingMods.forEach((mod) => syncingTranslationModIdsRef.current.add(mod.id))
    setTranslationSyncingModIds(new Set(syncingTranslationModIdsRef.current))

    syncModTranslations(pendingMods)
      .then(({ mods: translatedMods }) => {
        pendingMods.forEach((mod) => completedTranslationModIdsRef.current.add(mod.id))

        const translatedById = new Map(translatedMods.map((mod) => [mod.id, mod]))
        setMods((currentMods) =>
          currentMods.map((mod) => {
            const translated = translatedById.get(mod.id)
            if (!translated) return mod
            return {
              ...mod,
              name: translated.name,
              description: translated.description,
            }
          })
        )
      })
      .catch((err) => {
        console.error("Failed to sync mod translations:", err)
      })
      .finally(() => {
        pendingMods.forEach((mod) => syncingTranslationModIdsRef.current.delete(mod.id))
        setTranslationSyncingModIds(new Set(syncingTranslationModIdsRef.current))
      })
  }, [mods])

  // Load game version on mount
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

  // Declaring refresh callback for SMAPI installer success
  const refreshModsOnly = useCallback(async () => {
    const gameDir = localStorage.getItem("stardewGameDirectory") || ""
    const invoke = await getTauriInvoke()
    if (gameDir && invoke) {
      try {
        const loadedMods = await invoke("list_installed_mods", { gameDir }) as any[]
        setMods(loadedMods)
        setSelectedModId((prevId) => {
          if (!loadedMods.length) return ""
          return loadedMods.some((mod: any) => mod.id === prevId) ? prevId : loadedMods[0].id
        })
      } catch (err) {
        console.error("Failed to load mods after installation:", err)
      }
    }
  }, [])

  // Sub-hooks delegation
  const smapi = useSmapiInstaller({
    isGameRunning,
    showToast,
    onQueueSmapiDownload: options?.onQueueSmapiDownload,
    refreshMods: refreshModsOnly,
  })

  const editor = useModEditor({
    ensureCanModify,
    showToast,
    mods,
    setMods,
    selectedModId,
    setSelectedModId,
    setIsScanning,
  })

  const profiles = useModProfiles({
    ensureCanModify,
    setMods,
  })

  // Load actual status and mods list from Tauri backend on mount
  useEffect(() => {
    async function initMods() {
      const gameDir = localStorage.getItem("stardewGameDirectory") || ""
      const invoke = await getTauriInvoke()
      if (gameDir && invoke) {
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
        setIsLoadingMods(false)
      }
    }
    initMods()
  }, [showToast])

  // Watch refreshSignal changes
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
  }, [options?.refreshSignal])

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
        smapi.setSmapiStatus(status)

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
  }, [mods.length, selectedModId, showToast, smapi])

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
    smapiStatus: smapi.smapiStatus,
    gameVersion,
    smapiLatestVersion: smapi.smapiLatestVersion,
    smapiDownloadUrl: smapi.smapiDownloadUrl,
    smapiMirror: smapi.smapiMirror,
    setSmapiMirror: smapi.setSmapiMirror,
    isManagementOpen: smapi.isManagementOpen,
    setIsManagementOpen: smapi.setIsManagementOpen,
    installStatus: smapi.installStatus,
    installProgress: smapi.installProgress,
    installError: smapi.installError,
    isScanning,
    isCheckingUpdates,
    isSyncingModTranslations: translationSyncingModIds.size > 0,
    translationSyncingModIds,
    toast,
    setToast,
    isAddModalOpen: editor.isAddModalOpen,
    setIsAddModalOpen: editor.setIsAddModalOpen,
    
    // New Mod form state
    newModName: editor.newModName,
    setNewModName: editor.setNewModName,
    newModEngName: editor.newModEngName,
    setNewModEngName: editor.setNewModEngName,
    newModAuthor: editor.newModAuthor,
    setNewModAuthor: editor.setNewModAuthor,
    newModDesc: editor.newModDesc,
    setNewModDesc: editor.setNewModDesc,
    newModCategory: editor.newModCategory,
    setNewModCategory: editor.setNewModCategory,
    newModVersion: editor.newModVersion,
    setNewModVersion: editor.setNewModVersion,

    // Computed values
    selectedMod: editor.selectedMod,
    filteredMods,
    totalInstalled,
    activeCount,
    updateAvailableCount,

    // Operations
    handleToggleMod,
    handleScanDirectory,
    handleCheckUpdates,
    handleOpenFolder,
    handleConfigChange: editor.handleConfigChange,
    handleSaveConfig: editor.handleSaveConfig,
    handleInstallSmapi: smapi.handleInstallSmapi,
    handleUninstallSmapi: smapi.handleUninstallSmapi,
    handleAddNewMod: editor.handleAddNewMod,
    handleDeleteMod: editor.handleDeleteMod,
    handleOpenOfficialSite: smapi.handleOpenOfficialSite,
    handleApplyProfile: profiles.handleApplyProfile,
    handleInstallModFromZip: editor.handleInstallModFromZip,
    showToast
  }
}
