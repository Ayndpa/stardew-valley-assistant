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
  PackageOpen
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
}: ModListProps) {
  const lockedTitle = isGameRunning ? "游戏运行中，不能修改模组" : undefined

  return (
    <div className="space-y-4">
      {/* Toolbar / Actions Bar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
        {/* Left Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4.5 w-4.5 text-muted-foreground" />
          <Input
            placeholder="搜索模组名称、英文名、作者或描述..."
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
            {isScanning ? "正在扫描..." : "扫描模组目录"}
          </Button>

          <Button 
            variant="outline" 
            size="sm" 
            className="gap-2 h-10 border-border bg-card hover:bg-accent text-sm rounded-xl px-4 font-semibold"
            onClick={onCheckUpdates}
            disabled={isCheckingUpdates}
          >
            <RefreshCw className={`h-4 w-4 text-sky-500 ${isCheckingUpdates ? "animate-spin" : ""}`} />
            {isCheckingUpdates ? "正在检测更新..." : "检查更新"}
          </Button>

          <Button 
            variant="outline" 
            size="sm" 
            className="gap-2 h-10 border-border bg-card hover:bg-accent text-sm rounded-xl px-4 font-semibold"
            onClick={onOpenFolder}
          >
            <FolderOpen className="h-4 w-4 text-amber-500" />
            打开 Mods 目录
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
            导入新模组
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
            <h3 className="text-lg font-bold text-muted-foreground">正在扫描模组目录...</h3>
            <p className="text-sm text-muted-foreground/70 max-w-xs mt-1">
              正在读取本地 Mods 文件夹中的模组信息，请稍候。
            </p>
          </Card>
        ) : mods.length === 0 ? (
          <Card className="border border-dashed border-border py-16 flex flex-col items-center justify-center text-center">
            <PackageOpen className="h-12 w-12 text-muted-foreground/40 mb-3" />
            <h3 className="text-lg font-bold text-muted-foreground">尚未安装任何模组</h3>
            <p className="text-sm text-muted-foreground/70 max-w-xs mt-1">
              您的 Mods 目录目前是空的。您可以前往 Nexus Mods 浏览并下载热门的星露谷物语模组，或者手动导入本地模组文件。
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
                  前往 Nexus 下载模组
                </Button>
              )}
            </div>
          </Card>
        ) : filteredMods.length === 0 ? (
          <Card className="border border-dashed border-border py-16 flex flex-col items-center justify-center text-center">
            <Puzzle className="h-12 w-12 text-muted-foreground/40 mb-3" />
            <h3 className="text-lg font-bold text-muted-foreground">没有检索到模组</h3>
            <p className="text-sm text-muted-foreground/70 max-w-xs mt-1">
              尝试更改您的搜索词，或者选择其他的分类筛选。
            </p>
            <Button 
              variant="outline" 
              size="sm" 
              className="mt-4 rounded-xl"
              onClick={() => { setSearchTerm(""); setSelectedCategory("all"); }}
            >
              清除所有筛选条件
            </Button>
          </Card>
        ) : (
          filteredMods.map((mod) => {
            const hasUpdate = mod.version !== mod.latestVersion
            const isSelected = mod.id === selectedModId
            return (
              <div
                key={mod.id}
                className={`group relative p-4 rounded-xl border transition-all duration-200 cursor-pointer ${
                  isSelected
                    ? "bg-accent/40 dark:bg-accent/20 border-primary shadow-md ring-1 ring-primary/20"
                    : "bg-card hover:bg-accent/30 dark:hover:bg-accent/10 border-border hover:border-border-accent shadow-sm"
                } ${!mod.isEnabled ? "opacity-65 hover:opacity-85" : ""}`}
                onClick={() => {
                  setSelectedModId(mod.id)
                }}
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
                        e.stopPropagation() // Don't trigger selection
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
                        <span className="text-xs text-muted-foreground font-mono truncate max-w-[140px] lg:max-w-xs">
                          {mod.englishName}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 font-medium">
                        作者: {mod.author} · 本地版本: v{mod.version}
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
                        可升级 v{mod.latestVersion}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] text-green-600 dark:text-green-400 border-green-200 dark:border-green-900/40 bg-green-500/5 dark:bg-green-500/2 py-0.5 px-1.5 rounded-md">
                        最新版
                      </Badge>
                    )}

                    {/* Delete Button (Only displays on hover/select) */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        if (isGameRunning) return
                        if(confirm(`确定要从列表中移除模组 [${mod.name}] 吗？`)) {
                          onDeleteMod(mod.id)
                        }
                      }}
                      className={`opacity-0 group-hover:opacity-100 p-1 rounded transition-all mt-1 ${
                        isGameRunning
                          ? "text-muted-foreground/50 cursor-not-allowed"
                          : "hover:bg-destructive/15 text-muted-foreground hover:text-destructive"
                      }`}
                      disabled={isGameRunning}
                      title={isGameRunning ? "游戏运行中，不能移除模组" : "移除该模组"}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
