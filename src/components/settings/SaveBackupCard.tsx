import { useCallback, useEffect, useMemo, useState } from "react"
import { Archive, FolderOpen, HardDriveDownload, LoaderCircle, RefreshCw, RotateCcw, Trash2 } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useTranslation } from "react-i18next"
import { useConfirm } from "@/hooks/useConfirm"

interface SaveBackupEntry {
  timestamp: number
  createdAt: number
  infoFileSize: number
  mainFileSize: number
  missingFiles: string[]
}

interface SaveBackupCatalog {
  saveId: string
  saveFolderPath: string
  backups: SaveBackupEntry[]
}

async function getTauriInvoke() {
  if (typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__) {
    const mod = await import("@tauri-apps/api/core")
    return mod.invoke
  }
  return null
}

const formatDateTime = (timestamp: number) =>
  new Date(timestamp * 1000).toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })

const formatSize = (bytes: number) => {
  if (bytes <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`
}

export function SaveBackupCard({
  selectedSaveId,
  onShowToast,
  onChanged,
}: {
  selectedSaveId: string
  onShowToast: (message: string, type: "success" | "info" | "warning") => void
  onChanged?: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  const { confirm, ConfirmDialogElement } = useConfirm()
  const [catalog, setCatalog] = useState<SaveBackupCatalog | null>(null)
  const [loading, setLoading] = useState(false)
  const [actingKey, setActingKey] = useState<string | null>(null)

  const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__

  const loadBackups = useCallback(async () => {
    if (!selectedSaveId || !isTauri) {
      setCatalog(null)
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const invoke = await getTauriInvoke()
      if (!invoke) return
      const nextCatalog = await invoke<SaveBackupCatalog>("list_save_backups", { id: selectedSaveId })
      setCatalog(nextCatalog)
    } catch (err) {
      console.error("Failed to list save backups:", err)
      setCatalog(null)
      onShowToast(t("saveBackups.card.toastLoadError"), "warning")
    } finally {
      setLoading(false)
    }
  }, [isTauri, onShowToast, selectedSaveId, t])

  useEffect(() => {
    loadBackups()
  }, [loadBackups])

  const backupCountText = useMemo(() => {
    if (!catalog) return t("saveBackups.card.notLoaded")
    return t("saveBackups.card.countText", { count: catalog.backups.length })
  }, [catalog, t])

  const runAction = async (
    actionKey: string,
    action: () => Promise<SaveBackupCatalog>,
    successMessage: string,
  ) => {
    setActingKey(actionKey)
    try {
      const nextCatalog = await action()
      setCatalog(nextCatalog)
      await onChanged?.()
      onShowToast(successMessage, "success")
    } catch (err) {
      console.error(`Backup action failed: ${actionKey}`, err)
      onShowToast(`${t("saveBackups.card.toastActionError")}: ${String(err ?? "")}`, "warning")
    } finally {
      setActingKey(null)
    }
  }

  const handleCreateBackup = async () => {
    const invoke = await getTauriInvoke()
    if (!invoke || !selectedSaveId) return
    await runAction(
      "create",
      () => invoke<SaveBackupCatalog>("create_save_backup", { id: selectedSaveId }),
      t("saveBackups.card.toastCreated")
    )
  }

  const handleRestoreBackup = async (timestamp: number) => {
    if (!selectedSaveId) return
    const confirmed = await confirm({
      title: t("saveBackups.card.restoreTitle", "恢复存档备份"),
      message: t("saveBackups.card.confirmRestore"),
      confirmText: t("saveBackups.card.restoreConfirm", "恢复"),
      variant: "destructive",
    })
    if (!confirmed) return
    const invoke = await getTauriInvoke()
    if (!invoke) return
    await runAction(
      `restore-${timestamp}`,
      () => invoke<SaveBackupCatalog>("restore_save_backup", { id: selectedSaveId, timestamp }),
      t("saveBackups.card.toastRestored")
    )
  }

  const handleDeleteBackup = async (timestamp: number) => {
    if (!selectedSaveId) return
    const confirmed = await confirm({
      title: t("saveBackups.card.deleteTitle", "删除存档备份"),
      message: t("saveBackups.card.confirmDelete"),
      confirmText: t("saveBackups.card.deleteConfirm", "删除"),
      variant: "destructive",
    })
    if (!confirmed) return
    const invoke = await getTauriInvoke()
    if (!invoke) return
    await runAction(
      `delete-${timestamp}`,
      () => invoke<SaveBackupCatalog>("delete_save_backup", { id: selectedSaveId, timestamp }),
      t("saveBackups.card.toastDeleted")
    )
  }

  const handleOpenFolder = async () => {
    if (!catalog?.saveFolderPath) return
    const invoke = await getTauriInvoke()
    if (!invoke) return
    try {
      await invoke("open_in_file_manager", { path: catalog.saveFolderPath })
    } catch (err) {
      console.error("Failed to open save folder:", err)
      onShowToast(t("saveBackups.card.toastOpenFolderError"), "warning")
    }
  }

  return (
    <>
    {ConfirmDialogElement}
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Archive className="h-5 w-5" />
              {t("saveBackups.card.title")}
            </CardTitle>
            <CardDescription>
              {t("saveBackups.card.description", { count: backupCountText })}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={loadBackups} disabled={!selectedSaveId || loading || !!actingKey}>
              <RefreshCw className={loading ? "animate-spin" : undefined} />
              {t("saveBackups.card.refresh")}
            </Button>
            <Button variant="outline" size="sm" onClick={handleOpenFolder} disabled={!catalog?.saveFolderPath}>
              <FolderOpen className="h-4 w-4" />
              {t("saveBackups.card.openFolder")}
            </Button>
            <Button size="sm" onClick={handleCreateBackup} disabled={!selectedSaveId || !isTauri || !!actingKey}>
              {actingKey === "create" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <HardDriveDownload className="h-4 w-4" />}
              {t("saveBackups.card.backupNow")}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isTauri ? (
          <p className="text-sm text-muted-foreground">{t("saveBackups.card.webModeNotice")}</p>
        ) : !selectedSaveId ? (
          <p className="text-sm text-muted-foreground">{t("saveBackups.card.noSaveSelected")}</p>
        ) : loading && !catalog ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            {t("saveBackups.card.loading")}
          </div>
        ) : (
          <>
            <div className="rounded-lg border bg-accent/20 px-3 py-2 text-xs text-muted-foreground">
              <div className="font-medium text-foreground">{t("saveBackups.card.saveDirectory")}</div>
              <div className="truncate">{catalog?.saveFolderPath || "-"}</div>
            </div>

            {catalog && catalog.backups.length > 0 ? (
              <ScrollArea className="h-[360px] pr-3">
                <div className="space-y-3">
                  {catalog.backups.map((backup) => {
                    const incomplete = backup.missingFiles.length > 0
                    const restoreKey = `restore-${backup.timestamp}`
                    const deleteKey = `delete-${backup.timestamp}`
                    return (
                      <div key={backup.timestamp} className="rounded-lg border p-3 space-y-3">
                        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                          <div className="min-w-0">
                            <p className="text-sm font-medium">{formatDateTime(backup.createdAt)}</p>
                            <p className="text-xs text-muted-foreground">
                              {t("saveBackups.card.mainFile")} {formatSize(backup.mainFileSize)} · {t("saveBackups.card.infoFile")} {formatSize(backup.infoFileSize)}
                            </p>
                            {incomplete && (
                              <p className="text-xs text-amber-600 dark:text-amber-300">
                                {t("saveBackups.card.incomplete", { files: backup.missingFiles.join("、") })}
                              </p>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleRestoreBackup(backup.timestamp)}
                              disabled={incomplete || !!actingKey}
                              title={incomplete ? t("saveBackups.card.incompleteTooltip") : t("saveBackups.card.restoreTooltip")}
                            >
                              {actingKey === restoreKey ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                              {t("saveBackups.card.restore")}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleDeleteBackup(backup.timestamp)}
                              disabled={!!actingKey}
                            >
                              {actingKey === deleteKey ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                              {t("saveBackups.card.delete")}
                            </Button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </ScrollArea>
            ) : (
              <div className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                {t("saveBackups.card.noBackups")}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
    </>
  )
}
