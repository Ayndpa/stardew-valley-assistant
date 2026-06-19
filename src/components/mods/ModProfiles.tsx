import { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
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
  isGameRunning?: boolean
  confirm: (options: { title: string; message: string; confirmText?: string; cancelText?: string; variant?: "default" | "destructive" }) => Promise<boolean>
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

export function ModProfiles({ currentMods, onApplyProfile, showToast, isGameRunning = false, confirm }: ModProfilesProps) {
  const { t } = useTranslation()
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
    if (isGameRunning) {
      showToast(t("mods.profiles.cannotSaveRunning"), "warning")
      return
    }

    if (!newProfileName.trim()) {
      showToast(t("mods.profiles.toastEnterName"), "warning")
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
        showToast(t("mods.profiles.toastSaved", { name: newProfileName.trim() }), "success")
        setNewProfileName("")
        setShowSaveForm(false)
      } catch (err: any) {
        showToast(t("mods.profiles.toastSaveFailed", { error: err }), "warning")
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
      showToast(t("mods.profiles.toastSaved", { name: newProfileName.trim() }), "success")
      setNewProfileName("")
      setShowSaveForm(false)
    }
    setIsSaving(false)
  }

  const handleApplyProfile = async (profile: ModProfile) => {
    if (isGameRunning) {
      showToast(t("mods.profiles.cannotApplyRunning"), "warning")
      return
    }

    setIsApplyingId(profile.id)
    try {
      await onApplyProfile(profile.modStates)
      showToast(t("mods.profiles.toastApplied", { name: profile.name, count: profile.modStates.length }), "success")
    } catch (err: any) {
      showToast(t("mods.profiles.toastApplyFailed", { error: err }), "warning")
    }
    setIsApplyingId(null)
  }

  const handleDeleteProfile = async (profile: ModProfile) => {
    if (isGameRunning) {
      showToast(t("mods.profiles.cannotDeleteRunning"), "warning")
      return
    }

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
          showToast(t("mods.profiles.toastExported", { path: filePath }), "success")
        }
      } catch (err: any) {
        showToast(t("mods.profiles.toastExportFailed", { error: err }), "warning")
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
      showToast(t("mods.profiles.toastExported", { path: `${profile.name}.json` }), "success")
    }
  }

  const handleImportProfile = async () => {
    if (isGameRunning) {
      showToast(t("mods.profiles.cannotImportRunning"), "warning")
      return
    }

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
          showToast(t("mods.profiles.toastImported", { name: profile.name }), "success")
        }
      } catch (err: any) {
        showToast(t("mods.profiles.toastImportFailed", { error: err }), "warning")
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
          showToast(t("mods.profiles.toastImported", { name: profile.name }), "success")
        } catch (err: any) {
          showToast(t("mods.profiles.toastImportFailed", { error: err }), "warning")
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
          <h3 className="text-base font-bold text-foreground">{t("mods.profiles.title")}</h3>
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
            disabled={isGameRunning}
            title={isGameRunning ? t("mods.profiles.cannotImportRunning") : undefined}
          >
            <Upload className="h-3.5 w-3.5 text-sky-500" />
            {t("mods.profiles.import")}
          </Button>
          <Button
            variant="default"
            size="sm"
            className="gap-1.5 h-8 text-xs rounded-lg"
            onClick={() => setShowSaveForm(true)}
            disabled={currentMods.length === 0 || isGameRunning}
            title={isGameRunning ? t("mods.profiles.cannotSaveRunning") : undefined}
          >
            <Save className="h-3.5 w-3.5" />
            {t("mods.profiles.saveCurrent")}
          </Button>
        </div>
      </div>

      {/* Save Form */}
      {showSaveForm && (
        <Card className="border border-primary/30 bg-primary/5 p-4 rounded-xl space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-foreground">{t("mods.profiles.newProfile")}</h4>
            <button onClick={() => { setShowSaveForm(false); setNewProfileName("") }} className="p-1 hover:bg-muted rounded">
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
          <div className="flex gap-2">
            <Input
              placeholder={t("mods.profiles.namePlaceholder")}
              className="flex-1 h-9 text-sm bg-card border-border rounded-lg"
              value={newProfileName}
              onChange={(e) => setNewProfileName(e.currentTarget.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSaveProfile() }}
              disabled={isGameRunning}
              autoFocus
            />
            <Button
              size="sm"
              className="h-9 px-4 rounded-lg text-xs gap-1.5"
              onClick={handleSaveProfile}
              disabled={isSaving || isGameRunning}
            >
              {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              {isSaving ? t("mods.profiles.saving") : t("mods.profiles.confirmSave")}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {t("mods.profiles.saveFormDesc", { total: currentMods.length, enabled: currentMods.filter(m => m.isEnabled).length })}
          </p>
        </Card>
      )}

      {/* Profiles List */}
      {isLoading ? (
        <Card className="border border-dashed border-border py-8 flex flex-col items-center justify-center">
          <Loader2 className="h-6 w-6 text-primary/50 animate-spin mb-2" />
          <p className="text-xs text-muted-foreground">{t("mods.profiles.loading")}</p>
        </Card>
      ) : profiles.length === 0 ? (
        <Card className="border border-dashed border-border py-8 flex flex-col items-center justify-center text-center">
          <FolderOpen className="h-8 w-8 text-muted-foreground/30 mb-2" />
          <p className="text-sm font-semibold text-muted-foreground">{t("mods.profiles.emptyTitle")}</p>
          <p className="text-xs text-muted-foreground/70 mt-1 max-w-xs">
            {t("mods.profiles.emptyDesc")}
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
                        {t("mods.profiles.enabledCount", { enabled, total })}
                      </Badge>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {t("mods.profiles.updatedAt", { time: formatTimestamp(profile.updatedAt), count: total })}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      variant="default"
                      size="sm"
                      className="gap-1 h-7 px-3 text-[11px] rounded-lg"
                      onClick={() => handleApplyProfile(profile)}
                      disabled={isApplying || isGameRunning}
                      title={isGameRunning ? t("mods.profiles.cannotApplyRunning") : undefined}
                    >
                      {isApplying ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Play className="h-3 w-3" />
                      )}
                      {isApplying ? t("mods.profiles.applying") : t("mods.profiles.apply")}
                    </Button>
                    <button
                      onClick={() => handleExportProfile(profile)}
                      className="p-1.5 hover:bg-accent text-muted-foreground hover:text-foreground rounded-lg transition-colors"
                      title={t("mods.profiles.exportProfile")}
                    >
                      <Download className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeleteProfile(profile)}
                      disabled={isGameRunning}
                      className={`p-1.5 rounded-lg transition-colors ${
                        isGameRunning
                          ? "text-muted-foreground/50 cursor-not-allowed"
                          : "hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                      }`}
                      title={isGameRunning ? t("mods.profiles.cannotDeleteRunning") : t("mods.profiles.deleteProfile")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setExpandedProfileId(isExpanded ? null : profile.id)}
                      className="p-1.5 hover:bg-accent text-muted-foreground hover:text-foreground rounded-lg transition-colors"
                      title={t("mods.profiles.viewDetails")}
                    >
                      <FileJson className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Expanded Detail */}
                {isExpanded && (
                  <div className="border-t border-border/60 px-3.5 py-3 bg-accent/10 dark:bg-accent/5 max-h-[200px] overflow-y-auto">
                    <p className="text-[10px] text-muted-foreground font-semibold mb-2">{t("mods.profiles.modStatusList")}</p>
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
