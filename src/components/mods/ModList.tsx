import { useState, useMemo, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { Card } from "@/components/ui/card"
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
} from "lucide-react"

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
  translationSyncingModIds?: Set<string>
  confirm: (options: { title: string; message: string; confirmText?: string; cancelText?: string; variant?: "default" | "destructive" }) => Promise<boolean>
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

  // If root has top-level mods, return only root (children will be rendered recursively inside it)
  if (root.mods.length > 0) {
    return [root]
  }
  // If root has no mods, return children directly (skip the empty root wrapper)
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
  translationSyncingModIds = new Set(),
  confirm,
}: ModListProps) {
  const { t } = useTranslation()
  const lockedTitle = isGameRunning ? t("mods.toast.gameRunningNoModify") : undefined

  // Track which folder paths are expanded (default: all expanded)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => {
    // Initialize with all folder paths expanded
    const paths = new Set<string>()
    for (const mod of filteredMods) {
      if (mod.parentPath) paths.add(mod.parentPath)
    }
    return paths
  })

  // Build tree structure from filtered mods
  const modTree = useMemo(() => buildModTree(filteredMods), [filteredMods])

  // Auto-expand new folders when tree changes
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

  /** Render a single mod card */
  const renderModCard = useCallback((mod: Mod) => {
    const hasUpdate = !!mod.latestVersion && mod.version !== mod.latestVersion
    const isSelected = mod.id === selectedModId
    const isSyncingTranslation = translationSyncingModIds.has(mod.id)
    return (
      <div
        key={mod.id}
        className={`group relative p-4 rounded-xl border transition-all duration-200 cursor-pointer ${
          isSelected
            ? "bg-accent/40 dark:bg-accent/20 border-primary shadow-md ring-1 ring-primary/20"
            : "bg-card hover:bg-accent/30 dark:hover:bg-accent/10 border-border hover:border-border-accent shadow-sm"
        } ${!mod.isEnabled ? "opacity-65 hover:opacity-85" : ""}`}
        onClick={() => setSelectedModId(mod.id)}
      >
        {/* Update Indicator Side-Border */}
        {hasUpdate && mod.isEnabled && (
          <div className="absolute left-0 top-0 bottom-0 w-1 bg-amber-500 rounded-l-xl" />
        )}

        <div className="flex items-start justify-between gap-4">
          {/* Left: Checkbox & Meta */}
          <div className="flex items-start gap-3 flex-1 min-w-0">
            {/* Status Toggle Switch (Small) */}
            <div
              className="mt-1 flex-shrink-0"
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
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                  mod.isEnabled ? "bg-primary" : "bg-muted-foreground/30"
                } ${isGameRunning ? "cursor-not-allowed opacity-60" : ""}`}
              >
                <span
                  className={`pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform ${
                    mod.isEnabled ? "translate-x-4.5" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>

            {/* Mod Names */}
            <div className="min-w-0">
              <div className="flex items-center flex-wrap gap-x-2 gap-y-1">
                <h4 className="font-bold text-base truncate group-hover:text-primary transition-colors">
                  {mod.name}
                </h4>
                {isSyncingTranslation && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-sky-600 dark:text-sky-400 bg-sky-500/10 border border-sky-500/20 rounded-md px-1.5 py-0.5">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {t("mods.translationLibrary")}
                  </span>
                )}
                <span className="text-xs text-muted-foreground font-mono truncate max-w-[140px] lg:max-w-xs">
                  {mod.englishName}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1 font-medium">
                {t("mods.list.authorVersion", { author: mod.author, version: mod.version })}
                {hasUpdate && (
                  <span className="text-amber-600 dark:text-amber-400"> → v{mod.latestVersion}</span>
                )}
              </p>
              <p className="text-xs text-muted-foreground/80 mt-1 line-clamp-1">
                {mod.description}
              </p>
            </div>
          </div>

          {/* Right: Badges & Trash */}
          <div className="flex flex-col items-end gap-2 flex-shrink-0">
            <Badge
              variant="secondary"
              className={`text-[10px] font-bold py-0.5 px-2 rounded-md ${
                mod.category === "core"
                  ? "bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300 border border-purple-200/50 dark:border-purple-900/40"
                  : mod.category === "content"
                  ? "bg-pink-100 text-pink-700 dark:bg-pink-950/40 dark:text-pink-300 border border-pink-200/50 dark:border-pink-900/40"
                  : mod.category === "expansion"
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200/50 dark:border-emerald-900/40"
                  : "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border border-blue-200/50 dark:border-blue-900/40"
              }`}
            >
              {categoryMap[mod.category] || mod.category}
            </Badge>

            {/* Has Update Badge */}
            {hasUpdate ? (
              <Badge className="bg-amber-500 hover:bg-amber-600 text-white border-none text-[10px] font-bold flex items-center gap-0.5 py-0.5 px-1.5 animate-pulse rounded-md">
                {t("mods.list.upgradable", { version: mod.latestVersion })}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] text-green-600 dark:text-green-400 border-green-200 dark:border-green-900/40 bg-green-500/5 dark:bg-green-500/2 py-0.5 px-1.5 rounded-md">
                {mod.latestVersion ? t("mods.list.latestVersion", { version: mod.latestVersion }) : t("mods.list.latestVersionShort")}
              </Badge>
            )}

            {/* Delete Button (Only displays on hover/select) */}
            <button
              onClick={async (e) => {
                e.stopPropagation()
                if (isGameRunning) return
                if (await confirm({ title: t("mods.list.removeMod"), message: t("mods.list.confirmRemove", { name: mod.name }), variant: "destructive" })) {
                  onDeleteMod(mod.id)
                }
              }}
              className={`opacity-0 group-hover:opacity-100 p-1 rounded transition-all mt-1 ${
                isGameRunning
                  ? "text-muted-foreground/50 cursor-not-allowed"
                  : "hover:bg-destructive/15 text-muted-foreground hover:text-destructive"
              }`}
              disabled={isGameRunning}
              title={isGameRunning ? t("mods.list.cannotRemoveRunning") : t("mods.list.removeMod")}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    )
  }, [selectedModId, setSelectedModId, onToggleMod, onDeleteMod, categoryMap, isGameRunning, lockedTitle, t, translationSyncingModIds])

  /** Render a folder node and its children recursively */
  const renderFolderNode = useCallback((node: FolderNode, depth: number): React.ReactNode => {
    const isRoot = !node.fullPath // top-level mods (no parent folder)
    const isExpanded = isRoot || expandedFolders.has(node.fullPath)
    const modCount = countModsInNode(node)

    // Collect all direct mod items for this node
    const modCards = node.mods.map((mod) => renderModCard(mod))

    // If this is the root node (top-level mods), render without folder header
    if (isRoot) {
      return (
        <div key="__root" className="space-y-3">
          {modCards}
          {node.children.map((child) => renderFolderNode(child, depth))}
        </div>
      )
    }

    return (
      <div key={node.fullPath} className="space-y-2">
        {/* Folder Header */}
        <button
          onClick={() => toggleFolder(node.fullPath)}
          className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg bg-accent/50 dark:bg-accent/20 border border-border/60 hover:bg-accent/70 dark:hover:bg-accent/30 transition-colors text-left group"
          style={{ paddingLeft: `${depth * 16 + 12}px` }}
        >
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0 transition-transform" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0 transition-transform" />
          )}
          <Folder className="h-4 w-4 text-amber-500 flex-shrink-0" />
          <span className="font-bold text-sm text-foreground truncate">{node.name}</span>
          <span className="text-[11px] text-muted-foreground ml-auto flex-shrink-0">
            {modCount} {modCount === 1 ? "mod" : "mods"}
          </span>
        </button>

        {/* Folder Contents */}
        {isExpanded && (
          <div className="space-y-2" style={{ paddingLeft: `${(depth + 1) * 16}px` }}>
            {modCards}
            {node.children.map((child) => renderFolderNode(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }, [expandedFolders, toggleFolder, renderModCard])

  return (
    <div className="space-y-4">
      {/* Toolbar / Actions Bar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
        {/* Left Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4.5 w-4.5 text-muted-foreground" />
          <Input
            placeholder={t("mods.list.searchPlaceholder")}
            className="pl-11 h-10 bg-card border border-border shadow-sm rounded-xl focus-visible:ring-primary focus-visible:ring-primary transition-all text-xs"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.currentTarget.value)}
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground hover:text-foreground rounded"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Right Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-2 h-10 border-border bg-card hover:bg-accent text-sm rounded-xl px-4 font-semibold"
            onClick={onScan}
            disabled={isScanning}
          >
            {isScanning ? (
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            ) : (
              <FolderOpen className="h-4 w-4 text-emerald-500" />
            )}
            {isScanning ? t("mods.list.scanning") : t("mods.list.scanDirectory")}
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="gap-2 h-10 border-border bg-card hover:bg-accent text-sm rounded-xl px-4 font-semibold"
            onClick={onCheckUpdates}
            disabled={isCheckingUpdates}
          >
            <RefreshCw className={`h-4 w-4 text-sky-500 ${isCheckingUpdates ? "animate-spin" : ""}`} />
            {isCheckingUpdates ? t("mods.list.checkingUpdates") : t("mods.list.checkUpdates")}
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="gap-2 h-10 border-border bg-card hover:bg-accent text-sm rounded-xl px-4 font-semibold"
            onClick={onOpenFolder}
          >
            <FolderOpen className="h-4 w-4 text-amber-500" />
            {t("mods.list.openModsDir")}
          </Button>

          <Button
            variant="default"
            size="sm"
            className="gap-2 h-10 bg-primary hover:bg-primary/95 text-primary-foreground text-sm font-semibold rounded-xl px-4 shadow-sm"
            onClick={onImportMod}
            disabled={isGameRunning}
            title={lockedTitle}
          >
            <FileUp className="h-4 w-4" />
            {t("mods.list.importMod")}
          </Button>

        </div>
      </div>

      {/* Category Tabs */}
      <div className="flex gap-1.5 p-1 bg-accent/30 dark:bg-accent/10 border border-border/80 rounded-xl overflow-x-auto max-w-full">
        {(Object.keys(categoryMap) as Array<keyof typeof categoryMap>).map((catKey) => (
          <button
            key={catKey}
            onClick={() => setSelectedCategory(catKey)}
            className={`px-4 py-2 text-xs font-semibold rounded-lg whitespace-nowrap transition-all ${
              selectedCategory === catKey
                ? "bg-card text-primary shadow-sm border border-border/50"
                : "text-muted-foreground hover:text-foreground hover:bg-card/40"
            }`}
          >
            {categoryMap[catKey]}
            {catKey !== "all" && (
              <span className="ml-1.5 px-1.5 py-0.25 bg-muted dark:bg-muted/30 text-muted-foreground text-[10px] rounded-full">
                {mods.filter(m => m.category === catKey).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* List of Mod Cards */}
      <div className="space-y-3 max-h-[640px] overflow-y-auto pr-1">
        {isLoading ? (
          <Card className="border border-dashed border-border py-16 flex flex-col items-center justify-center text-center">
            <Loader2 className="h-10 w-10 text-primary/50 animate-spin mb-4" />
            <h3 className="text-lg font-bold text-muted-foreground">{t("mods.list.scanningTitle")}</h3>
            <p className="text-sm text-muted-foreground/70 max-w-xs mt-1">
              {t("mods.list.scanningDesc")}
            </p>
          </Card>
        ) : mods.length === 0 ? (
          <Card className="border border-dashed border-border py-16 flex flex-col items-center justify-center text-center">
            <PackageOpen className="h-12 w-12 text-muted-foreground/40 mb-3" />
            <h3 className="text-lg font-bold text-muted-foreground">{t("mods.list.noModsTitle")}</h3>
            <p className="text-sm text-muted-foreground/70 max-w-xs mt-1">
              {t("mods.list.noModsDesc")}
            </p>
            <div className="flex gap-2 mt-4">
              {onGoOnline && (
                <Button
                  variant="default"
                  size="sm"
                  className="gap-2 rounded-xl"
                  onClick={onGoOnline}
                >
                  <Download className="h-4 w-4" />
                  {t("mods.list.goNexusDownload")}
                </Button>
              )}
            </div>
          </Card>
        ) : filteredMods.length === 0 ? (
          <Card className="border border-dashed border-border py-16 flex flex-col items-center justify-center text-center">
            <Puzzle className="h-12 w-12 text-muted-foreground/40 mb-3" />
            <h3 className="text-lg font-bold text-muted-foreground">{t("mods.list.noResultsTitle")}</h3>
            <p className="text-sm text-muted-foreground/70 max-w-xs mt-1">
              {t("mods.list.noResultsDesc")}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4 rounded-xl"
              onClick={() => { setSearchTerm(""); setSelectedCategory("all"); }}
            >
              {t("mods.list.clearFilters")}
            </Button>
          </Card>
        ) : (
          modTree.map((rootNode) => renderFolderNode(rootNode, 0))
        )}
      </div>
    </div>
  )
}
