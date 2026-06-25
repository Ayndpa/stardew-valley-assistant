import { useState, useCallback, useMemo } from "react"
import { Mod } from "@/components/mods/ModList"

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

interface UseModEditorOptions {
  ensureCanModify: () => boolean
  showToast: (message: string, type: "success" | "info" | "warning") => void
  mods: Mod[]
  setMods: React.Dispatch<React.SetStateAction<Mod[]>>
  selectedModId: string
  setSelectedModId: React.Dispatch<React.SetStateAction<string>>
  setIsScanning: React.Dispatch<React.SetStateAction<boolean>>
}

export function useModEditor({
  ensureCanModify,
  showToast,
  mods,
  setMods,
  selectedModId,
  setSelectedModId,
  setIsScanning,
}: UseModEditorOptions) {
  // New Mod Form State
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [newModName, setNewModName] = useState("")
  const [newModEngName, setNewModEngName] = useState("")
  const [newModAuthor, setNewModAuthor] = useState("")
  const [newModDesc, setNewModDesc] = useState("")
  const [newModCategory, setNewModCategory] = useState<"core" | "content" | "utility" | "expansion">("utility")
  const [newModVersion, setNewModVersion] = useState("1.0.0")

  const selectedMod = useMemo(() => mods.find((m) => m.id === selectedModId), [mods, selectedModId])

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
  }, [ensureCanModify, setMods])

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
  }, [ensureCanModify, newModName, newModAuthor, newModEngName, newModVersion, newModDesc, newModCategory, showToast, setMods, setSelectedModId])

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
  }, [ensureCanModify, selectedModId, showToast, setMods, setSelectedModId, setIsScanning])

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
  }, [ensureCanModify, mods, selectedModId, showToast, setMods, setSelectedModId, setIsScanning])

  const handleRenameMod = useCallback(async (modId: string, newName: string) => {
    if (!ensureCanModify()) return
    if (!newName.trim()) {
      showToast("模组名字不能为空", "warning")
      return
    }

    const mod = mods.find((m) => m.id === modId)
    if (!mod) return

    const gameDir = localStorage.getItem("stardewGameDirectory") || ""
    const invoke = await getTauriInvoke()

    if (invoke && gameDir) {
      try {
        await invoke("rename_local_mod", {
          gameDir,
          folderName: mod.folderName,
          newName: newName.trim(),
        })
        // Update local state
        setMods((prevMods) =>
          prevMods.map((m) => {
            if (m.id === modId) {
              return { ...m, name: newName.trim() }
            }
            return m
          })
        )
        showToast("模组重命名成功", "success")
      } catch (err: any) {
        console.error("Rename mod error:", err)
        showToast("重命名模组失败: " + err, "warning")
      }
    } else {
      // Browser Mock
      setMods((prevMods) =>
        prevMods.map((m) => {
          if (m.id === modId) {
            return { ...m, name: newName.trim() }
          }
          return m
        })
      )
      showToast("（Web 模式模拟）模组重命名成功", "success")
    }
  }, [ensureCanModify, mods, setMods, showToast])

  return {
    isAddModalOpen,
    setIsAddModalOpen,
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
    handleConfigChange,
    handleSaveConfig,
    handleAddNewMod,
    handleDeleteMod,
    handleRenameMod,
    handleInstallModFromZip,
    selectedMod,
  }
}
