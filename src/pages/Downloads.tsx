import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
  RotateCcw,
  Trash2,
  XCircle,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { DownloadTask, DownloadTaskStatus } from "@/hooks/useDownloadManager"

interface DownloadsProps {
  tasks: DownloadTask[]
  stats: {
    running: number
    queued: number
    failed: number
    finished: number
    total: number
    maxConcurrent: number
  }
  isGameRunning: boolean
  onRetry: (id: string) => void
  onRemove: (id: string) => void
  onClearCompleted: () => void
}

function StatusBadge({ status }: { status: DownloadTaskStatus }) {
  const base = "whitespace-nowrap shrink-0 font-semibold px-2 py-0.5 text-[10px] rounded-full border"
  switch (status) {
    case "queued":
      return <Badge className={`bg-slate-500/10 text-slate-500 border-slate-500/20 ${base}`}>排队中</Badge>
    case "running":
      return <Badge className={`bg-blue-500/10 text-blue-500 border-blue-500/20 ${base}`}>下载中</Badge>
    case "success":
      return <Badge className={`bg-green-500/10 text-green-500 border-green-500/20 ${base}`}>已完成</Badge>
    case "error":
      return <Badge className={`bg-red-500/10 text-red-500 border-red-500/20 ${base}`}>失败</Badge>
  }
}

function TaskIcon({ status }: { status: DownloadTaskStatus }) {
  if (status === "running") return <Loader2 className="h-4 w-4 animate-spin text-blue-500 shrink-0" />
  if (status === "success") return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
  if (status === "error") return <XCircle className="h-4 w-4 text-red-500 shrink-0" />
  return <Download className="h-4 w-4 text-muted-foreground shrink-0" />
}

function formatTime(value?: number) {
  if (!value) return "-"
  return new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
}

export function Downloads({
  tasks,
  stats,
  isGameRunning,
  onRetry,
  onRemove,
  onClearCompleted,
}: DownloadsProps) {
  const hasCompleted = tasks.some(task => task.status === "success" || task.status === "error")

  return (
    <div className="min-h-screen p-8 space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-primary to-green-600 bg-clip-text text-transparent">
            下载管理
          </h2>
          <p className="text-muted-foreground mt-2 text-sm max-w-xl">
            统一管理 NexusMods 模组和 SMAPI 的下载与安装任务。
          </p>
        </div>
        <Button
          variant="outline"
          onClick={onClearCompleted}
          disabled={!hasCompleted}
          className="h-9 text-xs rounded-lg gap-1.5 self-start lg:self-auto"
        >
          <Trash2 className="h-4 w-4" />
          清除完成项
        </Button>
      </div>

      {isGameRunning && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-700 dark:text-amber-300 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          游戏运行中，下载与安装任务会暂停，退出游戏后自动继续。
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label: "全部任务", value: stats.total },
          { label: "下载中", value: stats.running },
          { label: "排队中", value: stats.queued },
          { label: "已完成", value: stats.finished },
          { label: "失败", value: stats.failed },
        ].map(item => (
          <Card key={item.label} className="border border-border/80 bg-card shadow-sm">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground font-medium">{item.label}</p>
              <p className="text-2xl font-bold text-foreground mt-1">{item.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border border-border/80 bg-card shadow-sm">
        <CardHeader className="p-5 pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Download className="h-4 w-4 text-primary" />
                任务队列
              </CardTitle>
              <CardDescription className="text-[11px] mt-1">
                当前并发 {stats.running}/{stats.maxConcurrent}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-5 pt-0">
          {tasks.length === 0 ? (
            <div className="border border-dashed border-border rounded-xl px-4 py-12 text-center">
              <Download className="h-8 w-8 text-muted-foreground/60 mx-auto mb-3" />
              <p className="text-sm font-semibold text-foreground">暂无下载任务</p>
              <p className="text-xs text-muted-foreground mt-1">
                在获取模组页面加入 NexusMods 下载，或在模组管理中安装 SMAPI 后会显示在这里。
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {tasks.map(task => (
                <div
                  key={task.id}
                  className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 rounded-xl border border-border/70 bg-accent/10 px-4 py-3"
                >
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <TaskIcon status={task.status} />
                      <p className="text-sm font-semibold truncate" title={task.title}>{task.title}</p>
                      <StatusBadge status={task.status} />
                    </div>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {task.subtitle} · {task.error ? task.error : task.message}
                    </p>
                    <p className="text-[10px] text-muted-foreground/80">
                      创建 {formatTime(task.createdAt)}
                      {task.completedAt ? ` · 完成 ${formatTime(task.completedAt)}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {task.status === "error" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onRetry(task.id)}
                        disabled={isGameRunning}
                        title={isGameRunning ? "游戏运行中，不能重试安装" : undefined}
                        className="h-8 text-[11px] rounded-lg gap-1"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        重试
                      </Button>
                    )}
                    {(task.status === "success" || task.status === "error") && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onRemove(task.id)}
                        className="h-8 w-8 rounded-lg"
                        title="移除任务"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
