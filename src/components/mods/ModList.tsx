import { useState, useMemo, useCallback, useRef, useEffect } from "react"
import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Search,
  Puzzle,
  FolderOpen,
  FileUp,
  RefreshCw,
  Trash2,
  Loader2,
  X,
  Download,
  PackageOpen,
  ChevronRight,
  ChevronDown,
  Folder,
  FolderHeart,
  Save,
  Upload,
  Play,
  Plus,
  Languages,
  Edit2,
  FileJson
} from "lucide-react"

import { ModTranslateModal } from "./ModTranslateModal"

// ---- Profile types (mirrored from ModProfiles) ----
interface ModStateEntry {
  folderName: string
  isEnabled: boolean
}
interface ModProfile {
  id: string
  name: string
  modStates: ModStateEntry[]
  createdAt: string
  updatedAt: string
}

async function getTauriInvoke() {
  if (typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__) {
    try {
      const mod = await import("@tauri-apps/api/core")
      return mod.invoke
    } catch (err) {
      console.error("Failed to load Tauri core invoke plugin", err)
    }
  }
  return null
}
async function getTauriDialogSave() {
  if (typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__) {
    try {
      const mod = await import("@tauri-apps/plugin-dialog")
      return mod.save
    } catch (err) {
      console.error("Failed to load Tauri dialog plugin", err)
    }
  }
  return null
}
async function getTauriDialogOpen() {
  if (typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__) {
    try {
      const mod = await import("@tauri-apps/plugin-dialog")
      return mod.open
    } catch (err) {
      console.error("Failed to load Tauri dialog plugin", err)
    }
  }
  return null
}

export interface ModConfigField {
  key: string
  label: string
  type: "boolean" | "number" | "string"
  value: any
  description: string
}

export interface Mod {
  id: string
  name: string
  englishName: string
  version: string
  latestVersion: string
  author: string
  description: string
  category: "core" | "content" | "utility" | "expansion"
  isEnabled: boolean
  nexusId?: number
  localPath: string
  folderName: string
  /** Relative parent path from Mods/ (e.g. "美化类"), empty for top-level mods */
  parentPath?: string
  dependencies: string[]
  config: ModConfigField[]
  /** manifest 里残留着旧版写入的 {{i18n:...}} 占位符，游戏内会原样显示，需要重新翻译修复 */
  manifestNeedsRepair?: boolean
}

interface ModListProps {
  mods: Mod[]
  filteredMods: Mod[]
  selectedModId: string
  setSelectedModId: (id: string) => void
  onToggleMod: (id: string) => void
  onDeleteMod: (id: string) => void
  selectedCategory: string
  setSelectedCategory: (cat: string) => void
  categoryMap: Record<string, string>
  searchTerm: string
  setSearchTerm: (term: string) => void
  onScan: () => void
  isScanning: boolean
  onCheckUpdates: () => void
  isCheckingUpdates: boolean
  onOpenFolder: () => void
  onImportMod: () => void
  isLoading?: boolean
  onGoOnline?: () => void
  isGameRunning?: boolean
  onRenameMod: (id: string, newName: string) => void | Promise<void>
  confirm: (options: { title: string; message: string; confirmText?: string; cancelText?: string; variant?: "default" | "destructive" }) => Promise<boolean>
  // Profile props (inlined from ModProfiles)
  currentMods: { folderName: string; isEnabled: boolean; name: string }[]
  onApplyProfile: (modStates: ModStateEntry[]) => Promise<void>
  showToast: (message: string, type: "success" | "info" | "warning") => void
}

/** A node in the mod folder tree */
interface FolderNode {
  name: string
  /** Full relative path from Mods/ */
  fullPath: string
  children: FolderNode[]
  mods: Mod[]
}

/** Build a tree of FolderNode from a flat list of mods. */
function buildModTree(mods: Mod[]): FolderNode[] {
  const root: FolderNode = { name: "", fullPath: "", children: [], mods: [] }

  for (const mod of mods) {
    const parentPath = mod.parentPath || ""
    if (!parentPath) {
      root.mods.push(mod)
      continue
    }

    const segments = parentPath.split("/").filter(Boolean)
    let current = root
    let builtPath = ""
    for (const seg of segments) {
      builtPath = builtPath ? `${builtPath}/${seg}` : seg
      let child = current.children.find((c) => c.name === seg)
      if (!child) {
        child = { name: seg, fullPath: builtPath, children: [], mods: [] }
        current.children.push(child)
      }
      current = child
    }
    current.mods.push(mod)
  }

  if (root.mods.length > 0) {
    return [root]
  }
  return root.children
}

/** Count total mods in a folder node (including nested children). */
function countModsInNode(node: FolderNode): number {
  let count = node.mods.length
  for (const child of node.children) {
    count += countModsInNode(child)
  }
  return count
}

function formatTimestamp(ts: string): string {
  const num = parseInt(ts)
  if (isNaN(num)) return ts
  const date = new Date(num)
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  })
}

export function ModList({
  mods,
  filteredMods,
  selectedModId,
  setSelectedModId,
  onToggleMod,
  onDeleteMod,
  selectedCategory,
  setSelectedCategory,
  categoryMap,
  searchTerm,
  setSearchTerm,
  onScan,
  isScanning,
  onCheckUpdates,
  isCheckingUpdates,
  onOpenFolder,
  onImportMod,
  isLoading = false,
  onGoOnline,
  isGameRunning = false,
  onRenameMod,
  confirm,
  currentMods,
  onApplyProfile,
  showToast,
}: ModListProps) {
  const { t } = useTranslation()
  const lockedTitle = isGameRunning ? t("mods.toast.gameRunningNoModify") : undefined
  const [showTranslateModal, setShowTranslateModal] = useState(false)

  // ---- Folder expand state ----
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => {
    const paths = new Set<string>()
    for (const mod of filteredMods) {
      if (mod.parentPath) paths.add(mod.parentPath)
    }
    return paths
  })

  const modTree = useMemo(() => buildModTree(filteredMods), [filteredMods])

  useMemo(() => {
    const allPaths = new Set<string>()
    const collectPaths = (nodes: FolderNode[]) => {
      for (const node of nodes) {
        if (node.fullPath) allPaths.add(node.fullPath)
        collectPaths(node.children)
      }
    }
    collectPaths(modTree)
    setExpandedFolders((prev) => {
      const merged = new Set(prev)
      let changed = false
      for (const p of allPaths) {
        if (!merged.has(p)) {
          merged.add(p)
          changed = true
        }
      }
      return changed ? merged : prev
    })
  }, [modTree])

  const toggleFolder = useCallback((path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }, [])

  // ---- Profile dropdown state ----
  const [profileOpen, setProfileOpen] = useState(false)
  const [profiles, setProfiles] = useState<ModProfile[]>([])
  const [profilesLoading, setProfilesLoading] = useState(false)
  const [showSaveForm, setShowSaveForm] = useState(false)
  const [newProfileName, setNewProfileName] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [isApplyingId, setIsApplyingId] = useState<string | null>(null)
  const [expandedProfileId, setExpandedProfileId] = useState<string | null>(null)
  const profileRef = useRef<HTMLDivElement>(null)

  // Close profile dropdown on outside click
  useEffect(() => {
    if (!profileOpen) return
    const handler = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false)
        setShowSaveForm(false)
        setExpandedProfileId(null)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [profileOpen])

  const loadProfiles = useCallback(async () => {
    setProfilesLoading(true)
    const invoke = await getTauriInvoke()
    if (invoke) {
      try {
        const result = await invoke("list_profiles") as ModProfile[]
        setProfiles(result)
      } catch (err: any) {
        console.error("Failed to load profiles:", err)
      }
    } else {
      const stored = localStorage.getItem("stardewModProfiles")
      if (stored) {
        try { setProfiles(JSON.parse(stored)) } catch {}
      }
    }
    setProfilesLoading(false)
  }, [])

  const handleProfileToggle = useCallback(() => {
    const next = !profileOpen
    setProfileOpen(next)
    if (!next) setExpandedProfileId(null)
    if (next && profiles.length === 0) loadProfiles()
  }, [profileOpen, profiles.length, loadProfiles])

  const handleSaveProfile = useCallback(async () => {
    if (isGameRunning) { showToast(t("mods.profiles.cannotSaveRunning"), "warning"); return }
    if (!newProfileName.trim()) { showToast(t("mods.profiles.toastEnterName"), "warning"); return }
    setIsSaving(true)
    const modStates: ModStateEntry[] = currentMods.map((m) => ({ folderName: m.folderName, isEnabled: m.isEnabled }))
    const invoke = await getTauriInvoke()
    if (invoke) {
      try {
        const profile = await invoke("save_profile", { name: newProfileName.trim(), modStates }) as ModProfile
        setProfiles((prev) => [profile, ...prev.filter((p) => p.id !== profile.id)])
        showToast(t("mods.profiles.toastSaved", { name: newProfileName.trim() }), "success")
        setNewProfileName(""); setShowSaveForm(false)
      } catch (err: any) {
        showToast(t("mods.profiles.toastSaveFailed", { error: err }), "warning")
      }
    } else {
      const now = Date.now().toString()
      const profile: ModProfile = {
        id: newProfileName.trim().toLowerCase().replace(/[^a-z0-9-_]/g, "-"),
        name: newProfileName.trim(), modStates, createdAt: now, updatedAt: now
      }
      const newProfiles = [profile, ...profiles.filter((p) => p.id !== profile.id)]
      setProfiles(newProfiles)
      localStorage.setItem("stardewModProfiles", JSON.stringify(newProfiles))
      showToast(t("mods.profiles.toastSaved", { name: newProfileName.trim() }), "success")
      setNewProfileName(""); setShowSaveForm(false)
    }
    setIsSaving(false)
  }, [isGameRunning, newProfileName, currentMods, profiles, showToast, t])

  const handleApplyProfile = useCallback(async (profile: ModProfile) => {
    if (isGameRunning) { showToast(t("mods.profiles.cannotApplyRunning"), "warning"); return }
    setIsApplyingId(profile.id)
    try {
      await onApplyProfile(profile.modStates)
      showToast(t("mods.profiles.toastApplied", { name: profile.name, count: profile.modStates.length }), "success")
    } catch (err: any) {
      showToast(t("mods.profiles.toastApplyFailed", { error: err }), "warning")
    }
    setIsApplyingId(null)
    setProfileOpen(false)
  }, [isGameRunning, onApplyProfile, showToast, t])

  const handleDeleteProfile = useCallback(async (profile: ModProfile) => {
    if (isGameRunning) { showToast(t("mods.profiles.cannotDeleteRunning"), "warning"); return }
    if (!await confirm({ title: t("mods.profiles.deleteProfile", "删除模组配置"), message: t("mods.profiles.confirmDelete", { name: profile.name }), variant: "destructive" })) return
    const invoke = await getTauriInvoke()
    if (invoke) {
      try {
        await invoke("delete_profile", { profileId: profile.id })
        setProfiles((prev) => prev.filter((p) => p.id !== profile.id))
        showToast(t("mods.profiles.toastDeleted", { name: profile.name }), "info")
      } catch (err: any) {
        showToast(t("mods.profiles.toastDeleteFailed", { error: err }), "warning")
      }
    } else {
      const newProfiles = profiles.filter((p) => p.id !== profile.id)
      setProfiles(newProfiles)
      localStorage.setItem("stardewModProfiles", JSON.stringify(newProfiles))
      showToast(t("mods.profiles.toastDeleted", { name: profile.name }), "info")
    }
  }, [isGameRunning, profiles, confirm, showToast, t])

  const handleExportProfile = useCallback(async (profile: ModProfile) => {
    const invoke = await getTauriInvoke()
    const dialogSave = await getTauriDialogSave()
    if (invoke && dialogSave) {
      try {
        const filePath = await dialogSave({ filters: [{ name: "Mod Profile", extensions: ["json"] }], defaultPath: `${profile.name}.json` })
        if (filePath) {
          await invoke("export_profile_to_file", { profile, filePath })
          showToast(t("mods.profiles.toastExported", { path: filePath }), "success")
        }
      } catch (err: any) {
        showToast(t("mods.profiles.toastExportFailed", { error: err }), "warning")
      }
    } else {
      const jsonStr = JSON.stringify(profile, null, 2)
      const blob = new Blob([jsonStr], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a"); a.href = url; a.download = `${profile.name}.json`; a.click()
      URL.revokeObjectURL(url)
      showToast(t("mods.profiles.toastExported", { path: `${profile.name}.json` }), "success")
    }
  }, [showToast, t])

  const handleImportProfile = useCallback(async () => {
    if (isGameRunning) { showToast(t("mods.profiles.cannotImportRunning"), "warning"); return }
    const invoke = await getTauriInvoke()
    const dialogOpen = await getTauriDialogOpen()
    if (invoke && dialogOpen) {
      try {
        const filePath = await dialogOpen({ filters: [{ name: "Mod Profile", extensions: ["json"] }], multiple: false, directory: false })
        if (filePath) {
          const pathStr = typeof filePath === "string" ? filePath : (filePath as any).path || filePath[0]
          const profile = await invoke("import_profile_from_file", { filePath: pathStr }) as ModProfile
          setProfiles((prev) => [profile, ...prev.filter((p) => p.id !== profile.id)])
          showToast(t("mods.profiles.toastImported", { name: profile.name }), "success")
        }
      } catch (err: any) {
        showToast(t("mods.profiles.toastImportFailed", { error: err }), "warning")
      }
    } else {
      const input = document.createElement("input")
      input.type = "file"; input.accept = ".json"
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0]
        if (!file) return
        try {
          const text = await file.text()
          const profileData = JSON.parse(text) as ModProfile
          const now = Date.now().toString()
          const profile: ModProfile = { ...profileData, id: profileData.id + "-imported-" + now, updatedAt: now }
          if (!profile.createdAt) profile.createdAt = now
          setProfiles((prev) => [profile, ...prev])
          showToast(t("mods.profiles.toastImported", { name: profile.name }), "success")
        } catch (err: any) {
          showToast(t("mods.profiles.toastImportFailed", { error: err }), "warning")
        }
      }
      input.click()
    }
  }, [isGameRunning, showToast, t])

  const [editingModId, setEditingModId] = useState<string | null>(null)
  const [editName, setEditName] = useState("")

  const handleStartRename = (e: React.MouseEvent, modId: string, currentName: string) => {
    e.stopPropagation()
    if (isGameRunning) return
    setEditingModId(modId)
    setEditName(currentName)
  }

  const handleFinishRename = async (modId: string) => {
    if (!editName.trim()) {
      setEditingModId(null)
      return
    }
    await onRenameMod(modId, editName.trim())
    setEditingModId(null)
  }

  /** Render a single mod row (compact) */
  const renderModRow = useCallback((mod: Mod) => {
    const hasUpdate = !!mod.latestVersion && mod.version !== mod.latestVersion
    const isSelected = mod.id === selectedModId
    return (
      <div
        key={mod.id}
        className={`group flex items-center gap-2 px-3 py-2 border-b border-border/40 cursor-pointer transition-colors ${
          isSelected
            ? "bg-accent/50 dark:bg-accent/25 border-l-2 border-l-primary"
            : "hover:bg-accent/30 dark:hover:bg-accent/10 border-l-2 border-l-transparent"
        } ${!mod.isEnabled ? "opacity-55" : ""}`}
        onClick={() => setSelectedModId(mod.id)}
      >
        {/* Toggle */}
        <div
          className="flex-shrink-0"
          onClick={(e) => {
            e.stopPropagation()
            if (isGameRunning) return
            onToggleMod(mod.id)
          }}
        >
          <button
            type="button"
            disabled={isGameRunning}
            title={lockedTitle}
            className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
              mod.isEnabled ? "bg-primary" : "bg-muted-foreground/30"
            } ${isGameRunning ? "cursor-not-allowed opacity-60" : ""}`}
          >
            <span
              className={`pointer-events-none block h-3 w-3 rounded-full bg-background shadow-sm ring-0 transition-transform ${
                mod.isEnabled ? "translate-x-3.5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>

        {/* Name */}
        <div className="flex-1 min-w-0" onClick={(e) => { if (editingModId === mod.id) e.stopPropagation(); }}>
          {editingModId === mod.id ? (
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="text-xs h-6 bg-card border-border px-1.5 py-0.5 rounded font-semibold w-full focus-visible:ring-1"
              autoFocus
              onBlur={() => handleFinishRename(mod.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  void handleFinishRename(mod.id)
                } else if (e.key === "Escape") {
                  setEditingModId(null)
                }
              }}
            />
          ) : (
            <div className="flex items-center gap-1.5 group/name">
              <span className="text-sm font-semibold truncate group-hover:text-primary transition-colors">
                {mod.name}
              </span>
              {!isGameRunning && (
                <button
                  type="button"
                  onClick={(e) => handleStartRename(e, mod.id, mod.name)}
                  className="opacity-0 group-hover/name:opacity-100 p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-all shrink-0"
                  title="重命名"
                >
                  <Edit2 className="h-3 w-3" />
                </button>
              )}
              {hasUpdate && mod.isEnabled && (
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
              )}
            </div>
          )}
        </div>

        {/* Version */}
        <span className="text-[10px] text-muted-foreground font-mono flex-shrink-0 hidden sm:inline">
          v{mod.version}
        </span>

        {/* Category Badge */}
        <Badge
          variant="secondary"
          className={`text-[9px] font-bold py-0 px-1.5 rounded flex-shrink-0 ${
            mod.category === "core"
              ? "bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300"
              : mod.category === "content"
              ? "bg-pink-100 text-pink-700 dark:bg-pink-950/40 dark:text-pink-300"
              : mod.category === "expansion"
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
              : "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
          }`}
        >
          {categoryMap[mod.category] || mod.category}
        </Badge>

        {/* Delete (hover) */}
        <button
          onClick={async (e) => {
            e.stopPropagation()
            if (isGameRunning) return
            if (await confirm({ title: t("mods.list.removeMod"), message: t("mods.list.confirmRemove", { name: mod.name }), variant: "destructive" })) {
              onDeleteMod(mod.id)
            }
          }}
          className={`opacity-0 group-hover:opacity-100 p-1 rounded transition-all ${
            isGameRunning
              ? "text-muted-foreground/50 cursor-not-allowed"
              : "hover:bg-destructive/15 text-muted-foreground hover:text-destructive"
          }`}
          disabled={isGameRunning}
          title={isGameRunning ? t("mods.list.cannotRemoveRunning") : t("mods.list.removeMod")}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    )
  }, [selectedModId, setSelectedModId, onToggleMod, onDeleteMod, categoryMap, isGameRunning, lockedTitle, t, confirm, editingModId, editName, onRenameMod])

  /** Render a folder node and its children recursively */
  const renderFolderNode = useCallback((node: FolderNode, depth: number): React.ReactNode => {
    const isRoot = !node.fullPath
    const isExpanded = isRoot || expandedFolders.has(node.fullPath)
    const modCount = countModsInNode(node)

    const modRows = node.mods.map((mod) => renderModRow(mod))

    if (isRoot) {
      return (
        <div key="__root">
          {modRows}
          {node.children.map((child) => renderFolderNode(child, depth))}
        </div>
      )
    }

    return (
      <div key={node.fullPath}>
        {/* Folder Header */}
        <button
          onClick={() => toggleFolder(node.fullPath)}
          className="w-full flex items-center gap-1.5 px-3 py-1.5 bg-accent/30 dark:bg-accent/10 border-b border-border/30 hover:bg-accent/50 dark:hover:bg-accent/20 transition-colors text-left group"
          style={{ paddingLeft: `${depth * 12 + 12}px` }}
        >
          {isExpanded ? (
            <ChevronDown className="h-3 w-3 text-muted-foreground flex-shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
          )}
          <Folder className="h-3 w-3 text-amber-500 flex-shrink-0" />
          <span className="font-semibold text-xs text-foreground truncate">{node.name}</span>
          <span className="text-[10px] text-muted-foreground ml-auto flex-shrink-0">
            {modCount}
          </span>
        </button>

        {/* Folder Contents */}
        {isExpanded && (
          <div style={{ paddingLeft: `${(depth + 1) * 12}px` }}>
            {modRows}
            {node.children.map((child) => renderFolderNode(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }, [expandedFolders, toggleFolder, renderModRow])

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex-shrink-0 px-3 py-2 border-b border-border/60 space-y-2">
        {/* Row 1: Search + Actions */}
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder={t("mods.list.searchPlaceholder")}
              className="pl-8 h-8 bg-card border border-border text-xs rounded-lg"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.currentTarget.value)}
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground hover:text-foreground rounded"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Icon action buttons */}
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 hover:bg-accent"
            onClick={onScan}
            disabled={isScanning}
            title={isScanning ? t("mods.list.scanning") : t("mods.list.scanDirectory")}
          >
            {isScanning ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> : <FolderOpen className="h-3.5 w-3.5 text-emerald-500" />}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 hover:bg-accent"
            onClick={onCheckUpdates}
            disabled={isCheckingUpdates}
            title={isCheckingUpdates ? t("mods.list.checkingUpdates") : t("mods.list.checkUpdates")}
          >
            <RefreshCw className={`h-3.5 w-3.5 text-sky-500 ${isCheckingUpdates ? "animate-spin" : ""}`} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 hover:bg-accent"
            onClick={onOpenFolder}
            title={t("mods.list.openModsDir")}
          >
            <FolderOpen className="h-3.5 w-3.5 text-amber-500" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 hover:bg-accent"
            onClick={onImportMod}
            disabled={isGameRunning}
            title={t("mods.list.importMod")}
          >
            <FileUp className="h-3.5 w-3.5 text-primary" />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 hover:bg-accent"
            onClick={() => setShowTranslateModal(true)}
            disabled={isGameRunning}
            title="一键翻译模组"
          >
            <Languages className="h-3.5 w-3.5 text-indigo-500" />
          </Button>

          {/* Profile dropdown trigger */}
          <div className="relative" ref={profileRef}>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 hover:bg-accent"
              onClick={handleProfileToggle}
              title={t("mods.profiles.title")}
            >
              <FolderHeart className="h-3.5 w-3.5 text-primary" />
            </Button>

            {/* Profile dropdown panel */}
            {profileOpen && (
              <div className="absolute right-0 top-full mt-1 w-72 bg-card border border-border rounded-xl shadow-xl z-50 animate-in fade-in slide-in-from-top-2 duration-150">
                {/* Header */}
                <div className="flex items-center justify-between px-3 py-2 border-b border-border/60">
                  <div className="flex items-center gap-1.5">
                    <FolderHeart className="h-3.5 w-3.5 text-primary" />
                    <span className="text-xs font-bold">{t("mods.profiles.title")}</span>
                    <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">{profiles.length}</Badge>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={handleImportProfile}
                      disabled={isGameRunning}
                      className="p-1 hover:bg-accent rounded text-muted-foreground hover:text-foreground transition-colors"
                      title={t("mods.profiles.import")}
                    >
                      <Upload className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => setShowSaveForm(!showSaveForm)}
                      disabled={currentMods.length === 0 || isGameRunning}
                      className="p-1 hover:bg-accent rounded text-muted-foreground hover:text-foreground transition-colors"
                      title={t("mods.profiles.saveCurrent")}
                    >
                      <Save className="h-3 w-3" />
                    </button>
                  </div>
                </div>

                {/* Save form */}
                {showSaveForm && (
                  <div className="px-3 py-2 border-b border-border/60 bg-primary/5">
                    <div className="flex gap-1.5">
                      <Input
                        placeholder={t("mods.profiles.namePlaceholder")}
                        className="flex-1 h-7 text-xs bg-card border-border rounded-md"
                        value={newProfileName}
                        onChange={(e) => setNewProfileName(e.currentTarget.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") handleSaveProfile() }}
                        disabled={isGameRunning}
                        autoFocus
                      />
                      <Button
                        size="sm"
                        className="h-7 px-2 rounded-md text-[10px] gap-1"
                        onClick={handleSaveProfile}
                        disabled={isSaving || isGameRunning}
                      >
                        {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                        {isSaving ? t("mods.profiles.saving") : t("mods.profiles.confirmSave")}
                      </Button>
                    </div>
                    <p className="text-[9px] text-muted-foreground mt-1">
                      {t("mods.profiles.saveFormDesc", { total: currentMods.length, enabled: currentMods.filter(m => m.isEnabled).length })}
                    </p>
                  </div>
                )}

                {/* Profile list */}
                <div className="max-h-[280px] overflow-y-auto">
                  {profilesLoading ? (
                    <div className="py-6 flex flex-col items-center">
                      <Loader2 className="h-5 w-5 text-primary/50 animate-spin mb-1" />
                      <p className="text-[10px] text-muted-foreground">{t("mods.profiles.loading")}</p>
                    </div>
                  ) : profiles.length === 0 ? (
                    <div className="py-6 flex flex-col items-center text-center">
                      <FolderOpen className="h-6 w-6 text-muted-foreground/30 mb-1" />
                      <p className="text-[10px] font-semibold text-muted-foreground">{t("mods.profiles.emptyTitle")}</p>
                      <p className="text-[9px] text-muted-foreground/70 mt-0.5 max-w-[200px]">{t("mods.profiles.emptyDesc")}</p>
                    </div>
                  ) : (
                    profiles.map((profile) => {
                      const isApplying = isApplyingId === profile.id
                      const enabled = profile.modStates.filter((m) => m.isEnabled).length
                      const isExpanded = expandedProfileId === profile.id
                      return (
                        <div key={profile.id} className="border-b border-border/30 last:border-0">
                          {/* Profile Row */}
                          <div className="flex items-center gap-2 px-3 py-2 hover:bg-accent/30 transition-colors group">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-semibold truncate">{profile.name}</span>
                                <Badge variant="secondary" className="text-[9px] px-1 py-0 h-3.5 shrink-0">
                                  {enabled}/{profile.modStates.length}
                                </Badge>
                              </div>
                              <p className="text-[9px] text-muted-foreground truncate">
                                {formatTimestamp(profile.updatedAt)}
                              </p>
                            </div>
                            <div className="flex items-center gap-0.5 shrink-0">
                              <button
                                onClick={() => handleApplyProfile(profile)}
                                disabled={isApplying || isGameRunning}
                                className="p-1 hover:bg-primary/10 text-primary rounded transition-colors"
                                title={t("mods.profiles.apply")}
                              >
                                {isApplying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                              </button>
                              <button
                                onClick={() => handleExportProfile(profile)}
                                className="p-1 hover:bg-accent text-muted-foreground hover:text-foreground rounded transition-colors opacity-0 group-hover:opacity-100"
                                title={t("mods.profiles.exportProfile")}
                              >
                                <Download className="h-3 w-3" />
                              </button>
                              <button
                                onClick={() => handleDeleteProfile(profile)}
                                disabled={isGameRunning}
                                className="p-1 hover:bg-destructive/10 text-muted-foreground hover:text-destructive rounded transition-colors opacity-0 group-hover:opacity-100"
                                title={t("mods.profiles.deleteProfile")}
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                              <button
                                onClick={() => setExpandedProfileId(isExpanded ? null : profile.id)}
                                className="p-1 hover:bg-accent text-muted-foreground hover:text-foreground rounded transition-colors"
                                title={t("mods.profiles.viewDetails")}
                              >
                                <FileJson className="h-3 w-3" />
                              </button>
                            </div>
                          </div>

                          {/* Expanded Detail */}
                          {isExpanded && (
                            <div className="px-3 pb-2.5 pt-1.5 bg-accent/15 dark:bg-accent/5 max-h-[150px] overflow-y-auto border-t border-border/20">
                              <p className="text-[9px] text-muted-foreground font-semibold mb-1.5">{t("mods.profiles.modStatusList")}</p>
                              <div className="flex flex-col gap-1">
                                {profile.modStates.map((entry) => {
                                  const cleanFolderName = entry.folderName.replace(/(^|\/)\./g, "$1")
                                  const exists = currentMods.some((m) => m.folderName === cleanFolderName)
                                  return (
                                    <div
                                      key={entry.folderName}
                                      className="flex items-center gap-1.5 text-[9px] py-0.5"
                                    >
                                      <div className={`w-1 h-1 rounded-full shrink-0 ${!exists ? "bg-destructive/60" : entry.isEnabled ? "bg-green-500" : "bg-zinc-400"}`} />
                                      <span className={`truncate ${
                                        !exists
                                          ? "text-destructive/70 dark:text-destructive/60"
                                          : entry.isEnabled
                                          ? "text-foreground"
                                          : "text-muted-foreground line-through"
                                      }`}>
                                        {entry.folderName} {!exists && `(${t("mods.profiles.notInstalled")})`}
                                      </span>
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Row 2: Category Chips */}
        <div className="flex gap-1 overflow-x-auto">
          {(Object.keys(categoryMap) as Array<keyof typeof categoryMap>).map((catKey) => (
            <button
              key={catKey}
              onClick={() => setSelectedCategory(catKey)}
              className={`px-2.5 py-1 text-[10px] font-semibold rounded-md whitespace-nowrap transition-all ${
                selectedCategory === catKey
                  ? "bg-primary/10 text-primary border border-primary/20"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/40 border border-transparent"
              }`}
            >
              {categoryMap[catKey]}
              {catKey !== "all" && (
                <span className="ml-1 px-1 py-0 bg-muted dark:bg-muted/30 text-muted-foreground text-[9px] rounded-full">
                  {mods.filter(m => m.category === catKey).length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Mod List (fills remaining space) */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="py-16 flex flex-col items-center justify-center text-center">
            <Loader2 className="h-8 w-8 text-primary/50 animate-spin mb-3" />
            <h3 className="text-sm font-bold text-muted-foreground">{t("mods.list.scanningTitle")}</h3>
            <p className="text-xs text-muted-foreground/70 max-w-xs mt-1">{t("mods.list.scanningDesc")}</p>
          </div>
        ) : mods.length === 0 ? (
          <div className="py-16 flex flex-col items-center justify-center text-center">
            <PackageOpen className="h-10 w-10 text-muted-foreground/40 mb-2" />
            <h3 className="text-sm font-bold text-muted-foreground">{t("mods.list.noModsTitle")}</h3>
            <p className="text-xs text-muted-foreground/70 max-w-xs mt-1">{t("mods.list.noModsDesc")}</p>
            {onGoOnline && (
              <Button variant="default" size="sm" className="gap-1.5 rounded-lg mt-3 text-xs" onClick={onGoOnline}>
                <Download className="h-3.5 w-3.5" />
                {t("mods.list.goNexusDownload")}
              </Button>
            )}
          </div>
        ) : filteredMods.length === 0 ? (
          <div className="py-16 flex flex-col items-center justify-center text-center">
            <Puzzle className="h-10 w-10 text-muted-foreground/40 mb-2" />
            <h3 className="text-sm font-bold text-muted-foreground">{t("mods.list.noResultsTitle")}</h3>
            <p className="text-xs text-muted-foreground/70 max-w-xs mt-1">{t("mods.list.noResultsDesc")}</p>
            <Button variant="outline" size="sm" className="mt-3 rounded-lg text-xs" onClick={() => { setSearchTerm(""); setSelectedCategory("all"); }}>
              {t("mods.list.clearFilters")}
            </Button>
          </div>
        ) : (
          modTree.map((rootNode) => renderFolderNode(rootNode, 0))
        )}
      </div>

      <ModTranslateModal
        isOpen={showTranslateModal}
        onClose={() => setShowTranslateModal(false)}
        mods={mods}
        onScan={onScan}
      />
    </div>
  )
}
