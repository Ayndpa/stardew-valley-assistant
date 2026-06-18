import { useCallback, useEffect, useState } from "react"
import { ScrollText, RefreshCw, FolderOpen, Trash2, Download, LoaderCircle } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useTranslation } from "react-i18next"
import { useConfirm } from "@/hooks/useConfirm"
import {
  readLogFiles,
  getLogDirPath,
  clearLogFiles,
  type LogEntry,
} from "@/lib/logger"

interface LogFileInfo {
  name: string
  content: string
}

function parseLogContent(content: string): LogEntry[] {
  const lines = content.split("\n").filter((l) => l.trim())
  const entries: LogEntry[] = []
  // Match lines like: [14:30:25.123] [INFO ] message
  const pattern = /^\[(\d{2}:\d{2}:\d{2}\.\d{3})\]\s+\[(\w+)\]\s+(.*)$/

  for (const line of lines) {
    const match = line.match(pattern)
    if (match) {
      const level = match[2].trim().toLowerCase()
      entries.push({
        timestamp: 0, // We'll use the string time for display
        level: level === "error" ? "error" : level === "warn" ? "warn" : "info",
        message: match[3],
      })
    }
  }

  return entries
}

function getLevelVariant(level: string): "default" | "secondary" | "destructive" | "outline" {
  switch (level) {
    case "error":
      return "destructive"
    case "warn":
      return "secondary"
    default:
      return "outline"
  }
}

export function LogCard() {
  const { t } = useTranslation()
  const { confirm, ConfirmDialogElement } = useConfirm()
  const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__

  const [logFiles, setLogFiles] = useState<LogFileInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedFile, setSelectedFile] = useState<number>(0)
  const [clearing, setClearing] = useState(false)

  const loadLogs = useCallback(async () => {
    if (!isTauri) return
    setLoading(true)
    try {
      const files = await readLogFiles()
      setLogFiles(files)
      if (selectedFile >= files.length) {
        setSelectedFile(Math.max(0, files.length - 1))
      }
    } catch (err) {
      console.error("Failed to load log files:", err)
    } finally {
      setLoading(false)
    }
  }, [isTauri, selectedFile])

  useEffect(() => {
    loadLogs()
  }, [loadLogs])

  const handleOpenFolder = async () => {
    try {
      const path = await getLogDirPath()
      if (path) {
        const { invoke } = await import("@tauri-apps/api/core")
        await invoke("open_in_file_manager", { path })
      }
    } catch (err) {
      console.error("Failed to open log folder:", err)
    }
  }

  const handleClear = async () => {
    const confirmed = await confirm({
      title: t("settings.log.clearConfirmTitle", "清空日志"),
      message: t("settings.log.clearConfirm"),
      confirmText: t("settings.log.clearConfirmBtn", "清空"),
      variant: "destructive",
    })
    if (!confirmed) return

    setClearing(true)
    try {
      await clearLogFiles()
      setLogFiles([])
      setSelectedFile(0)
    } catch (err) {
      console.error("Failed to clear log files:", err)
    } finally {
      setClearing(false)
    }
  }

  const handleExport = async () => {
    if (logFiles.length === 0) return
    try {
      const content = logFiles
        .map((f) => `=== ${f.name} ===\n${f.content}`)
        .join("\n\n")
      const blob = new Blob([content], { type: "text/plain;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `stardew-assistant-logs-${new Date().toISOString().slice(0, 10)}.txt`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error("Failed to export logs:", err)
    }
  }

  const currentFile = logFiles[selectedFile]
  const parsedEntries = currentFile ? parseLogContent(currentFile.content) : []

  return (
    <>
      {ConfirmDialogElement}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <ScrollText className="h-5 w-5" />
                {t("settings.log.title")}
              </CardTitle>
              <CardDescription>
                {t("settings.log.description")}
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={loadLogs}
                disabled={!isTauri || loading}
              >
                <RefreshCw className={loading ? "animate-spin" : undefined} />
                {t("settings.log.refresh")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleOpenFolder}
                disabled={!isTauri || logFiles.length === 0}
              >
                <FolderOpen className="h-4 w-4" />
                {t("settings.log.openFolder")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExport}
                disabled={logFiles.length === 0}
              >
                <Download className="h-4 w-4" />
                {t("settings.log.export")}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleClear}
                disabled={!isTauri || clearing || logFiles.length === 0}
              >
                {clearing ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                {t("settings.log.clear")}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isTauri ? (
            <p className="text-sm text-muted-foreground">
              {t("settings.log.webModeNotice")}
            </p>
          ) : loading && logFiles.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              {t("settings.log.loading")}
            </div>
          ) : logFiles.length === 0 ? (
            <div className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              {t("settings.log.noLogs")}
            </div>
          ) : (
            <>
              {/* File tabs */}
              {logFiles.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {logFiles.map((file, idx) => (
                    <button
                      key={file.name}
                      onClick={() => setSelectedFile(idx)}
                      className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                        idx === selectedFile
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted hover:bg-muted/80 text-muted-foreground"
                      }`}
                    >
                      {file.name.replace(".log", "")}
                    </button>
                  ))}
                </div>
              )}

              {/* Log entries */}
              <ScrollArea className="h-[400px] rounded-md border bg-muted/30 p-3">
                {parsedEntries.length > 0 ? (
                  <div className="space-y-1 font-mono text-xs">
                    {parsedEntries.map((entry, idx) => (
                      <div key={idx} className="flex items-start gap-2 py-0.5">
                        <Badge
                          variant={getLevelVariant(entry.level)}
                          className="shrink-0 text-[10px] px-1.5 py-0 h-4"
                        >
                          {entry.level.toUpperCase()}
                        </Badge>
                        <span className="text-foreground/80 break-all whitespace-pre-wrap">
                          {entry.message}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground text-center py-4">
                    {currentFile?.content || t("settings.log.noLogs")}
                  </p>
                )}
              </ScrollArea>

              {/* Stats */}
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {t("settings.log.file")}: {currentFile?.name || "-"}
                </span>
                <span>
                  {parsedEntries.length} {t("settings.log.entries")}
                </span>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </>
  )
}
