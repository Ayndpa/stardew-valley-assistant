import { useCallback, useEffect, useMemo, useState } from "react"
import { Archive, FolderOpen, HardDriveDownload, LoaderCircle, RefreshCw, RotateCcw, Trash2 } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"

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
  new Date(timestamp * 1000).toLocaleString("zh-CN", {
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
      onShowToast("读取存档备份列表失败。", "warning")
    } finally {
      setLoading(false)
    }
  }, [isTauri, onShowToast, selectedSaveId])

  useEffect(() => {
    loadBackups()
  }, [loadBackups])

  const backupCountText = useMemo(() => {
    if (!catalog) return "未加载"
    return `${catalog.backups.length} 组备份`
  }, [catalog])

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
      onShowToast(String(err ?? "操作失败"), "warning")
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
      "已创建新的存档备份。"
    )
  }

  const handleRestoreBackup = async (timestamp: number) => {
    if (!selectedSaveId) return
    const confirmed = window.confirm("恢复备份会覆盖当前存档，并先额外生成一组回滚备份。是否继续？")
    if (!confirmed) return
    const invoke = await getTauriInvoke()
    if (!invoke) return
    await runAction(
      `restore-${timestamp}`,
      () => invoke<SaveBackupCatalog>("restore_save_backup", { id: selectedSaveId, timestamp }),
      "备份已恢复，当前存档已回滚。"
    )
  }

  const handleDeleteBackup = async (timestamp: number) => {
    if (!selectedSaveId) return
    const confirmed = window.confirm("确定删除这组备份吗？删除后不能恢复。")
    if (!confirmed) return
    const invoke = await getTauriInvoke()
    if (!invoke) return
    await runAction(
      `delete-${timestamp}`,
      () => invoke<SaveBackupCatalog>("delete_save_backup", { id: selectedSaveId, timestamp }),
      "备份已删除。"
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
      onShowToast("打开存档目录失败。", "warning")
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Archive className="h-5 w-5" />
              存档备份管理
            </CardTitle>
            <CardDescription>
              为当前选中的本地存档创建、恢复和删除备份。当前：{backupCountText}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={loadBackups} disabled={!selectedSaveId || loading || !!actingKey}>
              <RefreshCw className={loading ? "animate-spin" : undefined} />
              刷新
            </Button>
            <Button variant="outline" size="sm" onClick={handleOpenFolder} disabled={!catalog?.saveFolderPath}>
              <FolderOpen className="h-4 w-4" />
              打开目录
            </Button>
            <Button size="sm" onClick={handleCreateBackup} disabled={!selectedSaveId || !isTauri || !!actingKey}>
              {actingKey === "create" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <HardDriveDownload className="h-4 w-4" />}
              立即备份
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isTauri ? (
          <p className="text-sm text-muted-foreground">Web 模式下不能管理本地存档备份，请在桌面应用中使用。</p>
        ) : !selectedSaveId ? (
          <p className="text-sm text-muted-foreground">请先选择一个本地存档。</p>
        ) : loading && !catalog ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            正在读取备份列表...
          </div>
        ) : (
          <>
            <div className="rounded-lg border bg-accent/20 px-3 py-2 text-xs text-muted-foreground">
              <div className="font-medium text-foreground">存档目录</div>
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
                              主存档 {formatSize(backup.mainFileSize)} · 信息文件 {formatSize(backup.infoFileSize)}
                            </p>
                            {incomplete && (
                              <p className="text-xs text-amber-600 dark:text-amber-300">
                                该备份不完整，缺少：{backup.missingFiles.join("、")}
                              </p>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleRestoreBackup(backup.timestamp)}
                              disabled={incomplete || !!actingKey}
                              title={incomplete ? "备份不完整，无法恢复" : "恢复此备份"}
                            >
                              {actingKey === restoreKey ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                              恢复
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleDeleteBackup(backup.timestamp)}
                              disabled={!!actingKey}
                            >
                              {actingKey === deleteKey ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                              删除
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
                暂无备份。每次通过存档编辑器保存时也会自动生成一组备份。
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
