import { useCallback, useEffect, useMemo, useRef, useState } from "react"

export type DownloadTaskStatus = "queued" | "running" | "success" | "error"
export type DownloadTaskKind = "nexus-mod" | "smapi"

export interface DownloadTask {
  id: string
  kind: DownloadTaskKind
  title: string
  subtitle: string
  targetKey: string
  status: DownloadTaskStatus
  message: string
  error?: string
  createdAt: number
  startedAt?: number
  completedAt?: number
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
  const [tasks, setTasks] = useState<DownloadTask[]>([])
  const startedTaskIdsRef = useRef<Set<string>>(new Set())
  const runnersRef = useRef<Map<string, DownloadRunner>>(new Map())

  const stats = useMemo(() => {
    const running = tasks.filter(task => task.status === "running").length
    const queued = tasks.filter(task => task.status === "queued").length
    const failed = tasks.filter(task => task.status === "error").length
    const finished = tasks.filter(task => task.status === "success").length
    return { running, queued, failed, finished, total: tasks.length, maxConcurrent: MAX_CONCURRENT_DOWNLOADS }
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
      message: task.kind === "smapi" ? "正在下载并安装 SMAPI..." : "正在下载并安装...",
      error: undefined,
      startedAt: Date.now(),
    })

    try {
      await runner()
      updateTask(task.id, {
        status: "success",
        message: task.kind === "smapi" ? "SMAPI 安装完成" : "已安装到 Mods 目录",
        completedAt: Date.now(),
      })
      onShowToast?.(task.kind === "smapi" ? "SMAPI 安装成功！" : `${task.title} 已安装到 Mods 目录`, "success")
    } catch (err: any) {
      const error = String(err?.message || err)
      updateTask(task.id, {
        status: "error",
        message: "安装失败",
        error,
        completedAt: Date.now(),
      })
      onShowToast?.(`${task.title} 安装失败: ${error}`, "warning")
    } finally {
      startedTaskIdsRef.current.delete(task.id)
    }
  }, [isGameRunning, onShowToast, updateTask])

  useEffect(() => {
    if (isGameRunning) return

    const runningCount = tasks.filter(task => task.status === "running").length
    const availableSlots = Math.max(0, MAX_CONCURRENT_DOWNLOADS - runningCount)
    if (availableSlots === 0) return

    tasks
      .filter(task => task.status === "queued" && !startedTaskIdsRef.current.has(task.id))
      .slice(0, availableSlots)
      .forEach(runTask)
  }, [tasks, isGameRunning, runTask])

  const enqueueTask = useCallback((task: DownloadTask, runner: DownloadRunner) => {
    const existing = tasks.find(item =>
      item.targetKey === task.targetKey &&
      (item.status === "queued" || item.status === "running")
    )

    if (existing) {
      return { ok: false, message: "该任务已在下载队列中" }
    }

    runnersRef.current.set(task.id, runner)
    setTasks(prev => [...prev, task])
    return { ok: true, message: "已加入下载管理" }
  }, [tasks])

  const queueNexusDownload = useCallback(({ modName, author, downloadUrl }: QueueNexusDownloadRequest) => {
    if (isGameRunning) {
      return { ok: false, message: "游戏运行中不能下载并安装模组，请退出游戏后再试" }
    }

    const normalizedUrl = downloadUrl.trim()
    if (!normalizedUrl) {
      return { ok: false, message: "未解析到可下载链接" }
    }

    const id = makeTaskId()
    const task: DownloadTask = {
      id,
      kind: "nexus-mod",
      title: modName || "NexusMods 模组",
      subtitle: author ? `作者: ${author}` : "NexusMods",
      targetKey: `nexus:${normalizedUrl.toLowerCase()}`,
      status: "queued",
      message: "等待下载",
      createdAt: Date.now(),
    }

    return enqueueTask(task, async () => {
      const gameDir = localStorage.getItem("stardewGameDirectory") || ""
      if (!gameDir) {
        throw new Error("未配置游戏安装目录，请先在设置中配置")
      }

      const invoke = await getTauriInvoke()
      if (!invoke) {
        throw new Error("当前环境不支持直接安装，请在桌面应用中使用下载管理")
      }

      await invoke("install_nexus_mod", { gameDir, downloadUrl: normalizedUrl })
      onModInstalled?.()
    })
  }, [enqueueTask, isGameRunning, onModInstalled])

  const queueSmapiDownload = useCallback(({ version, downloadUrl, mirror, onSuccess, onError }: QueueSmapiDownloadRequest) => {
    if (isGameRunning) {
      return { ok: false, message: "游戏运行中不能安装 SMAPI，请退出游戏后再试" }
    }

    const gameDir = localStorage.getItem("stardewGameDirectory") || ""
    if (!gameDir) {
      return { ok: false, message: "未配置游戏安装目录，请先在设置中配置" }
    }

    const normalizedUrl = downloadUrl.trim()
    if (!normalizedUrl) {
      return { ok: false, message: "未解析到 SMAPI 下载链接" }
    }

    const id = makeTaskId()
    const displayVersion = version ? `v${version.replace(/^v/i, "")}` : "最新版"
    const task: DownloadTask = {
      id,
      kind: "smapi",
      title: `SMAPI ${displayVersion}`,
      subtitle: mirror === "ghproxy" ? "GitHub 加速镜像" : "GitHub 官方源",
      targetKey: "smapi:install",
      status: "queued",
      message: "等待下载",
      createdAt: Date.now(),
    }

    return enqueueTask(task, async () => {
      const invoke = await getTauriInvoke()
      if (!invoke) {
        throw new Error("当前环境不支持直接安装，请在桌面应用中使用下载管理")
      }

      try {
        await invoke("install_smapi", { gameDir, downloadUrl: normalizedUrl })
        await onSuccess?.()
      } catch (err: any) {
        const error = String(err?.message || err)
        onError?.(error)
        throw err
      }
    })
  }, [enqueueTask, isGameRunning])

  const retryTask = useCallback((id: string) => {
    if (isGameRunning) return

    startedTaskIdsRef.current.delete(id)
    updateTask(id, {
      status: "queued",
      message: "等待重试",
      error: undefined,
      startedAt: undefined,
      completedAt: undefined,
    })
  }, [isGameRunning, updateTask])

  const removeTask = useCallback((id: string) => {
    setTasks(prev => prev.filter(task => task.id !== id))
    startedTaskIdsRef.current.delete(id)
    runnersRef.current.delete(id)
  }, [])

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
    removeTask,
    clearCompletedTasks,
  }
}
