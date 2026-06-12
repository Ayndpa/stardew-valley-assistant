import { useState, useEffect } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  FolderHeart,
  Save,
  Trash2,
  Download,
  Upload,
  Play,
  X,
  Plus,
  Loader2,
  FileJson,
  FolderOpen
} from "lucide-react"

// Helper functions for dynamic imports
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

export interface ModStateEntry {
  folderName: string
  isEnabled: boolean
}

export interface ModProfile {
  id: string
  name: string
  modStates: ModStateEntry[]
  createdAt: string
  updatedAt: string
}

interface ModProfilesProps {
  // Current mod states for saving
  currentMods: { folderName: string; isEnabled: boolean; name: string }[]
  // Callback when a profile is applied (returns the mod_states to apply)
  onApplyProfile: (modStates: ModStateEntry[]) => Promise<void>
  // Toast helper
  showToast: (message: string, type: "success" | "info" | "warning") => void
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

export function ModProfiles({ currentMods, onApplyProfile, showToast }: ModProfilesProps) {
  const [profiles, setProfiles] = useState<ModProfile[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isApplyingId, setIsApplyingId] = useState<string | null>(null)
  const [showSaveForm, setShowSaveForm] = useState(false)
  const [newProfileName, setNewProfileName] = useState("")
  const [expandedProfileId, setExpandedProfileId] = useState<string | null>(null)

  // Load profiles on mount
  useEffect(() => {
    loadProfiles()
  }, [])

  const loadProfiles = async () => {
    setIsLoading(true)
    const invoke = await getTauriInvoke()
    if (invoke) {
      try {
        const result = await invoke("list_profiles") as ModProfile[]
        setProfiles(result)
      } catch (err: any) {
        console.error("Failed to load profiles:", err)
      }
    } else {
      // Web mock: load from localStorage
      const stored = localStorage.getItem("stardewModProfiles")
      if (stored) {
        try {
          setProfiles(JSON.parse(stored))
        } catch {}
      }
    }
    setIsLoading(false)
  }

  const handleSaveProfile = async () => {
    if (!newProfileName.trim()) {
      showToast("请输入档案名称", "warning")
      return
    }

    setIsSaving(true)
    const modStates: ModStateEntry[] = currentMods.map((m) => ({
      folderName: m.folderName,
      isEnabled: m.isEnabled
    }))

    const invoke = await getTauriInvoke()
    if (invoke) {
      try {
        const profile = await invoke("save_profile", { name: newProfileName.trim(), modStates }) as ModProfile
        setProfiles((prev) => {
          const filtered = prev.filter((p) => p.id !== profile.id)
          return [profile, ...filtered]
        })
        showToast(`档案 [${newProfileName.trim()}] 已保存`, "success")
        setNewProfileName("")
        setShowSaveForm(false)
      } catch (err: any) {
        showToast("保存档案失败: " + err, "warning")
      }
    } else {
      // Web mock
      const now = Date.now().toString()
      const profile: ModProfile = {
        id: newProfileName.trim().toLowerCase().replace(/[^a-z0-9-_]/g, "-"),
        name: newProfileName.trim(),
        modStates,
        createdAt: now,
        updatedAt: now
      }
      const newProfiles = [profile, ...profiles.filter((p) => p.id !== profile.id)]
      setProfiles(newProfiles)
      localStorage.setItem("stardewModProfiles", JSON.stringify(newProfiles))
      showToast(`（Web 模式）档案 [${newProfileName.trim()}] 已保存`, "success")
      setNewProfileName("")
      setShowSaveForm(false)
    }
    setIsSaving(false)
  }

  const handleApplyProfile = async (profile: ModProfile) => {
    setIsApplyingId(profile.id)
    try {
      await onApplyProfile(profile.modStates)
      showToast(`已应用档案 [${profile.name}]，共切换 ${profile.modStates.length} 个模组状态`, "success")
    } catch (err: any) {
      showToast("应用档案失败: " + err, "warning")
    }
    setIsApplyingId(null)
  }

  const handleDeleteProfile = async (profile: ModProfile) => {
    if (!confirm(`确定要删除档案 [${profile.name}] 吗？`)) return

    const invoke = await getTauriInvoke()
    if (invoke) {
      try {
        await invoke("delete_profile", { profileId: profile.id })
        setProfiles((prev) => prev.filter((p) => p.id !== profile.id))
        showToast(`档案 [${profile.name}] 已删除`, "info")
      } catch (err: any) {
        showToast("删除档案失败: " + err, "warning")
      }
    } else {
      const newProfiles = profiles.filter((p) => p.id !== profile.id)
      setProfiles(newProfiles)
      localStorage.setItem("stardewModProfiles", JSON.stringify(newProfiles))
      showToast(`（Web 模式）档案 [${profile.name}] 已删除`, "info")
    }
  }

  const handleExportProfile = async (profile: ModProfile) => {
    const invoke = await getTauriInvoke()
    const dialogSave = await getTauriDialogSave()

    if (invoke && dialogSave) {
      try {
        const filePath = await dialogSave({
          filters: [{ name: "Mod Profile", extensions: ["json"] }],
          defaultPath: `${profile.name}.json`
        })
        if (filePath) {
          await invoke("export_profile_to_file", { profile, filePath })
          showToast(`档案已导出至: ${filePath}`, "success")
        }
      } catch (err: any) {
        showToast("导出档案失败: " + err, "warning")
      }
    } else {
      // Web mock: download as file
      const jsonStr = JSON.stringify(profile, null, 2)
      const blob = new Blob([jsonStr], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${profile.name}.json`
      a.click()
      URL.revokeObjectURL(url)
      showToast(`（Web 模式）档案已导出为 ${profile.name}.json`, "success")
    }
  }

  const handleImportProfile = async () => {
    const invoke = await getTauriInvoke()
    const dialogOpen = await getTauriDialogOpen()

    if (invoke && dialogOpen) {
      try {
        const filePath = await dialogOpen({
          filters: [{ name: "Mod Profile", extensions: ["json"] }],
          multiple: false,
          directory: false
        })
        if (filePath) {
          const pathStr = typeof filePath === "string" ? filePath : (filePath as any).path || filePath[0]
          const profile = await invoke("import_profile_from_file", { filePath: pathStr }) as ModProfile
          setProfiles((prev) => {
            const filtered = prev.filter((p) => p.id !== profile.id)
            return [profile, ...filtered]
          })
          showToast(`档案 [${profile.name}] 已成功导入`, "success")
        }
      } catch (err: any) {
        showToast("导入档案失败: " + err, "warning")
      }
    } else {
      // Web mock: use file input
      const input = document.createElement("input")
      input.type = "file"
      input.accept = ".json"
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0]
        if (!file) return
        try {
          const text = await file.text()
          const profileData = JSON.parse(text) as ModProfile
          const now = Date.now().toString()
          const profile: ModProfile = {
            ...profileData,
            id: profileData.id + "-imported-" + now,
            updatedAt: now
          }
          if (!profile.createdAt) profile.createdAt = now
          const newProfiles = [profile, ...profiles]
          setProfiles(newProfiles)
          localStorage.setItem("stardewModProfiles", JSON.stringify(newProfiles))
          showToast(`（Web 模式）档案 [${profile.name}] 已导入`, "success")
        } catch (err: any) {
          showToast("导入档案失败: " + err, "warning")
        }
      }
      input.click()
    }
  }

  const enabledCount = (profile: ModProfile) => profile.modStates.filter((m) => m.isEnabled).length

  return (
    <div className="space-y-4">
      {/* Header with actions */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FolderHeart className="h-5 w-5 text-primary" />
          <h3 className="text-base font-bold text-foreground">模组档案</h3>
          <Badge variant="secondary" className="text-[10px] px-2 py-0 h-5">
            {profiles.length}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 h-8 text-xs rounded-lg border-border"
            onClick={handleImportProfile}
          >
            <Upload className="h-3.5 w-3.5 text-sky-500" />
            导入
          </Button>
          <Button
            variant="default"
            size="sm"
            className="gap-1.5 h-8 text-xs rounded-lg"
            onClick={() => setShowSaveForm(true)}
            disabled={currentMods.length === 0}
          >
            <Save className="h-3.5 w-3.5" />
            保存当前状态
          </Button>
        </div>
      </div>

      {/* Save Form */}
      {showSaveForm && (
        <Card className="border border-primary/30 bg-primary/5 p-4 rounded-xl space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-foreground">新建档案</h4>
            <button onClick={() => { setShowSaveForm(false); setNewProfileName("") }} className="p-1 hover:bg-muted rounded">
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="输入档案名称，例如：纯净原版、大型整合包..."
              className="flex-1 h-9 text-sm bg-card border-border rounded-lg"
              value={newProfileName}
              onChange={(e) => setNewProfileName(e.currentTarget.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSaveProfile() }}
              autoFocus
            />
            <Button
              size="sm"
              className="h-9 px-4 rounded-lg text-xs gap-1.5"
              onClick={handleSaveProfile}
              disabled={isSaving}
            >
              {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              {isSaving ? "保存中..." : "确认保存"}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            将记录当前 {currentMods.length} 个模组的启用/禁用状态（共 {currentMods.filter(m => m.isEnabled).length} 个已启用）
          </p>
        </Card>
      )}

      {/* Profiles List */}
      {isLoading ? (
        <Card className="border border-dashed border-border py-8 flex flex-col items-center justify-center">
          <Loader2 className="h-6 w-6 text-primary/50 animate-spin mb-2" />
          <p className="text-xs text-muted-foreground">正在加载档案列表...</p>
        </Card>
      ) : profiles.length === 0 ? (
        <Card className="border border-dashed border-border py-8 flex flex-col items-center justify-center text-center">
          <FolderOpen className="h-8 w-8 text-muted-foreground/30 mb-2" />
          <p className="text-sm font-semibold text-muted-foreground">暂无保存的档案</p>
          <p className="text-xs text-muted-foreground/70 mt-1 max-w-xs">
            保存当前模组的开关状态为档案，方便日后一键切换不同的模组配置方案。
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {profiles.map((profile) => {
            const isExpanded = expandedProfileId === profile.id
            const isApplying = isApplyingId === profile.id
            const enabled = enabledCount(profile)
            const total = profile.modStates.length

            return (
              <Card
                key={profile.id}
                className={`border border-border rounded-xl overflow-hidden transition-all ${
                  isExpanded ? "ring-1 ring-primary/20 shadow-sm" : "hover:border-border-accent"
                }`}
              >
                {/* Profile Row */}
                <div className="p-3.5 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-bold text-foreground truncate">{profile.name}</h4>
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 shrink-0">
                        {enabled}/{total} 启用
                      </Badge>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      更新于 {formatTimestamp(profile.updatedAt)} · {total} 个模组
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      variant="default"
                      size="sm"
                      className="gap-1 h-7 px-3 text-[11px] rounded-lg"
                      onClick={() => handleApplyProfile(profile)}
                      disabled={isApplying}
                    >
                      {isApplying ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Play className="h-3 w-3" />
                      )}
                      {isApplying ? "应用中..." : "应用"}
                    </Button>
                    <button
                      onClick={() => handleExportProfile(profile)}
                      className="p-1.5 hover:bg-accent text-muted-foreground hover:text-foreground rounded-lg transition-colors"
                      title="导出档案"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeleteProfile(profile)}
                      className="p-1.5 hover:bg-destructive/10 text-muted-foreground hover:text-destructive rounded-lg transition-colors"
                      title="删除档案"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setExpandedProfileId(isExpanded ? null : profile.id)}
                      className="p-1.5 hover:bg-accent text-muted-foreground hover:text-foreground rounded-lg transition-colors"
                      title="查看详情"
                    >
                      <FileJson className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Expanded Detail */}
                {isExpanded && (
                  <div className="border-t border-border/60 px-3.5 py-3 bg-accent/10 dark:bg-accent/5 max-h-[200px] overflow-y-auto">
                    <p className="text-[10px] text-muted-foreground font-semibold mb-2">模组状态列表：</p>
                    <div className="grid grid-cols-2 gap-1">
                      {profile.modStates.map((entry) => (
                        <div
                          key={entry.folderName}
                          className="flex items-center gap-1.5 text-[10px] py-0.5"
                        >
                          <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${entry.isEnabled ? "bg-green-500" : "bg-zinc-400"}`} />
                          <span className={`truncate ${entry.isEnabled ? "text-foreground" : "text-muted-foreground line-through"}`}>
                            {entry.folderName}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
