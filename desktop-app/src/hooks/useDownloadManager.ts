import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

export type DownloadTaskStatus = "queued" | "running" | "paused" | "success" | "error"
export type DownloadTaskKind = "nexus-mod" | "smapi"

export interface DownloadTask {
  id: string
  kind: DownloadTaskKind
  title: string
  subtitle: string
  targetKey: string
  status: DownloadTaskStatus
  message: string
  progress: number
  downloadedBytes: number
  totalBytes?: number
  phase?: "queued" | "downloading" | "paused" | "extracting" | "installing" | "finished"
  error?: string
  createdAt: number
  startedAt?: number
  completedAt?: number
}

interface DownloadProgressPayload {
  taskId: string
  phase: "downloading" | "paused" | "extracting" | "installing" | "finished"
  progress: number
  downloadedBytes: number
  totalBytes?: number | null
  message: string
}

export interface QueueNexusDownloadRequest {
  modName: string
  author: string
  downloadUrl: string
}

export interface QueueSmapiDownloadRequest {
  version: string | null
  downloadUrl: string
  mirror: "ghproxy" | "official"
  onSuccess?: () => void | Promise<void>
  onError?: (error: string) => void
}

type DownloadRunner = () => Promise<void>

const MAX_CONCURRENT_DOWNLOADS = 3

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

function makeTaskId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function useDownloadManager({
  isGameRunning,
  onModInstalled,
  onShowToast,
}: {
  isGameRunning: boolean
  onModInstalled?: () => void
  onShowToast?: (message: string, type: "success" | "info" | "warning") => void
}) {
  const { t } = useTranslation()
  const [tasks, setTasks] = useState<DownloadTask[]>([])
  const startedTaskIdsRef = useRef<Set<string>>(new Set())
  const runnersRef = useRef<Map<string, DownloadRunner>>(new Map())

  const stats = useMemo(() => {
    const running = tasks.filter(task => task.status === "running").length
    const queued = tasks.filter(task => task.status === "queued").length
    const paused = tasks.filter(task => task.status === "paused").length
    const failed = tasks.filter(task => task.status === "error").length
    const finished = tasks.filter(task => task.status === "success").length
    return { running, queued, paused, failed, finished, total: tasks.length, maxConcurrent: MAX_CONCURRENT_DOWNLOADS }
  }, [tasks])

  const updateTask = useCallback((id: string, patch: Partial<DownloadTask>) => {
    setTasks(prev => prev.map(task => task.id === id ? { ...task, ...patch } : task))
  }, [])

  const runTask = useCallback(async (task: DownloadTask) => {
    if (startedTaskIdsRef.current.has(task.id) || isGameRunning) return

    const runner = runnersRef.current.get(task.id)
    if (!runner) return

    startedTaskIdsRef.current.add(task.id)
    updateTask(task.id, {
      status: "running",
      message: task.kind === "smapi" ? t("downloads.hook.downloadingSmapi") : t("downloads.hook.downloadingMod"),
      phase: "downloading",
      error: undefined,
      startedAt: Date.now(),
    })

    try {
      await runner()
      updateTask(task.id, {
        status: "success",
        progress: 100,
        phase: "finished",
        message: task.kind === "smapi" ? t("downloads.hook.smapiInstallComplete") : t("downloads.hook.modInstallComplete"),
        completedAt: Date.now(),
      })
      onShowToast?.(task.kind === "smapi" ? t("downloads.hook.smapiInstallSuccess") : t("downloads.hook.modInstallSuccess", { title: task.title }), "success")
    } catch (err: any) {
      const error = String(err?.message || err)
      updateTask(task.id, {
        status: "error",
        message: t("downloads.hook.installFailed"),
        error,
        completedAt: Date.now(),
      })
      onShowToast?.(t("downloads.hook.installFailedDetail", { title: task.title, error }), "warning")
    } finally {
      startedTaskIdsRef.current.delete(task.id)
    }
  }, [isGameRunning, onShowToast, updateTask, t])

  useEffect(() => {
    if (isGameRunning) return

    const runningCount = tasks.filter(task => task.status === "running" || (task.status === "paused" && task.startedAt != null)).length
    const availableSlots = Math.max(0, MAX_CONCURRENT_DOWNLOADS - runningCount)
    if (availableSlots === 0) return

    tasks
      .filter(task => task.status === "queued" && !startedTaskIdsRef.current.has(task.id))
      .slice(0, availableSlots)
      .forEach(runTask)
  }, [tasks, isGameRunning, runTask])

  useEffect(() => {
    if (typeof window === "undefined" || !(window as any).__TAURI_INTERNALS__) {
      return
    }

    let unlisten: (() => void) | null = null

    const setupProgressListener = async () => {
      try {
        const eventModule = await import("@tauri-apps/api/event")
        unlisten = await eventModule.listen<DownloadProgressPayload>("download-progress", (event) => {
          const payload = event.payload
          setTasks(prev => prev.map(task => {
            if (task.id !== payload.taskId) return task

            const status: DownloadTaskStatus =
              payload.phase === "paused"
                ? "paused"
                : payload.phase === "finished"
                  ? "success"
                  : "running"

            return {
              ...task,
              status,
              phase: payload.phase,
              progress: Math.max(task.progress, Math.round(payload.progress)),
              downloadedBytes: payload.downloadedBytes,
              totalBytes: payload.totalBytes ?? undefined,
              message: payload.message || task.message,
            }
          }))
        })
      } catch (err) {
        console.debug("Unable to setup download progress listener:", err)
      }
    }

    setupProgressListener()
    return () => {
      unlisten?.()
    }
  }, [])

  const enqueueTask = useCallback((task: DownloadTask, runner: DownloadRunner) => {
    const existing = tasks.find(item =>
      item.targetKey === task.targetKey &&
      (item.status === "queued" || item.status === "running")
    )

    if (existing) {
      return { ok: false, message: t("downloads.hook.taskAlreadyQueued") }
    }

    runnersRef.current.set(task.id, runner)
    setTasks(prev => [...prev, task])
    return { ok: true, message: t("downloads.hook.addedToQueue") }
  }, [tasks, t])

  const queueNexusDownload = useCallback(({ modName, author, downloadUrl }: QueueNexusDownloadRequest) => {
    if (isGameRunning) {
      return { ok: false, message: t("downloads.hook.gameRunningNoModDownload") }
    }

    const normalizedUrl = downloadUrl.trim()
    if (!normalizedUrl) {
      return { ok: false, message: t("downloads.hook.noDownloadUrl") }
    }

    const id = makeTaskId()
    const task: DownloadTask = {
      id,
      kind: "nexus-mod",
      title: modName || t("downloads.hook.nexusModDefault"),
      subtitle: author ? t("downloads.hook.authorPrefix", { author }) : "NexusMods",
      targetKey: `nexus:${normalizedUrl.toLowerCase()}`,
      status: "queued",
      message: t("downloads.hook.waitingDownload"),
      progress: 0,
      downloadedBytes: 0,
      phase: "queued",
      createdAt: Date.now(),
    }

    return enqueueTask(task, async () => {
      const gameDir = localStorage.getItem("stardewGameDirectory") || ""
      if (!gameDir) {
        throw new Error(t("downloads.hook.gameDirNotConfigured"))
      }

      const invoke = await getTauriInvoke()
      if (!invoke) {
        throw new Error(t("downloads.hook.tauriOnlyInstall"))
      }

      await invoke("install_nexus_mod", { gameDir, downloadUrl: normalizedUrl, taskId: id })
      onModInstalled?.()
    })
  }, [enqueueTask, isGameRunning, onModInstalled, t])

  const queueSmapiDownload = useCallback(({ version, downloadUrl, mirror, onSuccess, onError }: QueueSmapiDownloadRequest) => {
    if (isGameRunning) {
      return { ok: false, message: t("downloads.hook.gameRunningNoSmapi") }
    }

    const gameDir = localStorage.getItem("stardewGameDirectory") || ""
    if (!gameDir) {
      return { ok: false, message: t("downloads.hook.gameDirNotConfigured") }
    }

    const normalizedUrl = downloadUrl.trim()
    if (!normalizedUrl) {
      return { ok: false, message: t("downloads.hook.noSmapiUrl") }
    }

    const id = makeTaskId()
    const displayVersion = version ? `v${version.replace(/^v/i, "")}` : t("downloads.hook.latestVersion")
    const task: DownloadTask = {
      id,
      kind: "smapi",
      title: `SMAPI ${displayVersion}`,
      subtitle: mirror === "ghproxy" ? t("downloads.hook.mirrorGhproxy") : t("downloads.hook.mirrorOfficial"),
      targetKey: "smapi:install",
      status: "queued",
      message: t("downloads.hook.waitingDownload"),
      progress: 0,
      downloadedBytes: 0,
      phase: "queued",
      createdAt: Date.now(),
    }

    return enqueueTask(task, async () => {
      const invoke = await getTauriInvoke()
      if (!invoke) {
        throw new Error(t("downloads.hook.tauriOnlyInstall"))
      }

      try {
        await invoke("install_smapi", { gameDir, downloadUrl: normalizedUrl, taskId: id })
        await onSuccess?.()
      } catch (err: any) {
        const error = String(err?.message || err)
        onError?.(error)
        throw err
      }
    })
  }, [enqueueTask, isGameRunning, t])

  const retryTask = useCallback((id: string) => {
    if (isGameRunning) return

    startedTaskIdsRef.current.delete(id)
    updateTask(id, {
      status: "queued",
      message: t("downloads.hook.waitingRetry"),
      progress: 0,
      downloadedBytes: 0,
      totalBytes: undefined,
      phase: "queued",
      error: undefined,
      startedAt: undefined,
      completedAt: undefined,
    })
  }, [isGameRunning, updateTask, t])

  const removeTask = useCallback((id: string) => {
    setTasks(prev => prev.filter(task => task.id !== id))
    startedTaskIdsRef.current.delete(id)
    runnersRef.current.delete(id)
  }, [])

  const pauseTask = useCallback(async (id: string) => {
    const task = tasks.find(item => item.id === id)
    if (!task) return

    if (task.status === "queued") {
      updateTask(id, {
        status: "paused",
        phase: "paused",
        message: t("downloads.hook.queuePaused"),
      })
      return
    }

    if (task.status !== "running") return

    const invoke = await getTauriInvoke()
    if (!invoke) return
    await invoke("pause_download_task", { taskId: id })
    updateTask(id, {
      status: "paused",
      phase: "paused",
      message: t("downloads.hook.pausing"),
    })
  }, [tasks, updateTask, t])

  const resumeTask = useCallback(async (id: string) => {
    const task = tasks.find(item => item.id === id)
    if (!task) return

    if (task.status === "paused" && task.startedAt == null) {
      updateTask(id, {
        status: "queued",
        phase: "queued",
        message: t("downloads.hook.waitingDownload"),
      })
      return
    }

    if (task.status !== "paused") return

    const invoke = await getTauriInvoke()
    if (!invoke) return
    await invoke("resume_download_task", { taskId: id })
    updateTask(id, {
      status: "running",
      phase: "downloading",
      message: t("downloads.hook.resuming"),
    })
  }, [tasks, updateTask, t])

  const clearCompletedTasks = useCallback(() => {
    const removable = new Set(
      tasks
        .filter(task => task.status === "success" || task.status === "error")
        .map(task => task.id)
    )
    removable.forEach(id => {
      startedTaskIdsRef.current.delete(id)
      runnersRef.current.delete(id)
    })
    setTasks(prev => prev.filter(task => task.status === "queued" || task.status === "running"))
  }, [tasks])

  return {
    tasks,
    stats,
    queueNexusDownload,
    queueSmapiDownload,
    retryTask,
    pauseTask,
    resumeTask,
    removeTask,
    clearCompletedTasks,
  }
}
