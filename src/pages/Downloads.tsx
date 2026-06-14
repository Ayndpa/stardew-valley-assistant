import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Trash2,
  XCircle,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { DownloadTask, DownloadTaskStatus } from "@/hooks/useDownloadManager"

interface DownloadsProps {
  tasks: DownloadTask[]
  stats: {
    running: number
    queued: number
    paused: number
    failed: number
    finished: number
    total: number
    maxConcurrent: number
  }
  isGameRunning: boolean
  onRetry: (id: string) => void
  onPause: (id: string) => void
  onResume: (id: string) => void
  onRemove: (id: string) => void
  onClearCompleted: () => void
}

function StatusBadge({ status }: { status: DownloadTaskStatus }) {
  const { t } = useTranslation()
  const base = "whitespace-nowrap shrink-0 font-semibold px-2 py-0.5 text-[10px] rounded-full border"
  switch (status) {
    case "queued":
      return <Badge className={`bg-slate-500/10 text-slate-500 border-slate-500/20 ${base}`}>{t("downloads.status.queued")}</Badge>
    case "running":
      return <Badge className={`bg-blue-500/10 text-blue-500 border-blue-500/20 ${base}`}>{t("downloads.status.running")}</Badge>
    case "paused":
      return <Badge className={`bg-amber-500/10 text-amber-500 border-amber-500/20 ${base}`}>{t("downloads.status.paused")}</Badge>
    case "success":
      return <Badge className={`bg-green-500/10 text-green-500 border-green-500/20 ${base}`}>{t("downloads.status.success")}</Badge>
    case "error":
      return <Badge className={`bg-red-500/10 text-red-500 border-red-500/20 ${base}`}>{t("downloads.status.error")}</Badge>
  }
}

function TaskIcon({ status }: { status: DownloadTaskStatus }) {
  if (status === "running") return <Loader2 className="h-4 w-4 animate-spin text-blue-500 shrink-0" />
  if (status === "paused") return <Pause className="h-4 w-4 text-amber-500 shrink-0" />
  if (status === "success") return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
  if (status === "error") return <XCircle className="h-4 w-4 text-red-500 shrink-0" />
  return <Download className="h-4 w-4 text-muted-foreground shrink-0" />
}

function formatTime(value: number | undefined, locale: string) {
  if (!value) return "-"
  const loc = locale === "zh" ? "zh-CN" : "en-US"
  return new Date(value).toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" })
}

export function Downloads({
  tasks,
  stats,
  isGameRunning,
  onRetry,
  onPause,
  onResume,
  onRemove,
  onClearCompleted,
}: DownloadsProps) {
  const { t, i18n } = useTranslation()
  const hasCompleted = tasks.some(task => task.status === "success" || task.status === "error")

  return (
    <div className="min-h-screen p-8 space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-primary to-green-600 bg-clip-text text-transparent">
            {t("downloads.title")}
          </h2>
          <p className="text-muted-foreground mt-2 text-sm max-w-xl">
            {t("downloads.description")}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={onClearCompleted}
          disabled={!hasCompleted}
          className="h-9 text-xs rounded-lg gap-1.5 self-start lg:self-auto"
        >
          <Trash2 className="h-4 w-4" />
          {t("downloads.clearCompleted")}
        </Button>
      </div>

      {isGameRunning && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-700 dark:text-amber-300 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {t("downloads.gameRunningWarning")}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        {[
          { label: t("downloads.stats.total"), value: stats.total },
          { label: t("downloads.stats.running"), value: stats.running },
          { label: t("downloads.stats.queued"), value: stats.queued },
          { label: t("downloads.stats.paused"), value: stats.paused },
          { label: t("downloads.stats.finished"), value: stats.finished },
          { label: t("downloads.stats.failed"), value: stats.failed },
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
                {t("downloads.queue.title")}
              </CardTitle>
              <CardDescription className="text-[11px] mt-1">
                {t("downloads.queue.concurrent", { running: stats.running, max: stats.maxConcurrent })}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-5 pt-0">
          {tasks.length === 0 ? (
            <div className="border border-dashed border-border rounded-xl px-4 py-12 text-center">
              <Download className="h-8 w-8 text-muted-foreground/60 mx-auto mb-3" />
              <p className="text-sm font-semibold text-foreground">{t("downloads.empty.title")}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {t("downloads.empty.description")}
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
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-3 text-[10px] text-muted-foreground/80">
                        <span>{task.phase === "extracting" ? t("downloads.phase.extracting") : task.phase === "installing" ? t("downloads.phase.installing") : task.phase === "paused" ? t("downloads.phase.paused") : t("downloads.phase.downloading")}</span>
                        <span>{task.progress}%</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted/70">
                        <div
                          className={`h-full rounded-full transition-all ${
                            task.status === "error"
                              ? "bg-red-500"
                              : task.status === "success"
                                ? "bg-green-500"
                                : task.status === "paused"
                                  ? "bg-amber-500"
                                  : "bg-blue-500"
                          }`}
                          style={{ width: `${task.progress === 0 ? 4 : task.progress}%` }}
                        />
                      </div>
                    </div>
                    <p className="text-[10px] text-muted-foreground/80">
                      {t("downloads.time.created")} {formatTime(task.createdAt, i18n.language)}
                      {task.completedAt ? ` · ${t("downloads.time.completed")} ${formatTime(task.completedAt, i18n.language)}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {task.status === "running" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onPause(task.id)}
                        className="h-8 text-[11px] rounded-lg gap-1"
                      >
                        <Pause className="h-3.5 w-3.5" />
                        {t("downloads.actions.pause")}
                      </Button>
                    )}
                    {task.status === "paused" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onResume(task.id)}
                        disabled={isGameRunning && !!task.startedAt}
                        title={isGameRunning && !!task.startedAt ? t("downloads.gameRunningCannotResume") : undefined}
                        className="h-8 text-[11px] rounded-lg gap-1"
                      >
                        <Play className="h-3.5 w-3.5" />
                        {t("downloads.actions.resume")}
                      </Button>
                    )}
                    {task.status === "error" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onRetry(task.id)}
                        disabled={isGameRunning}
                        title={isGameRunning ? t("downloads.gameRunningCannotRetry") : undefined}
                        className="h-8 text-[11px] rounded-lg gap-1"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        {t("downloads.actions.retry")}
                      </Button>
                    )}
                    {(task.status === "success" || task.status === "error") && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onRemove(task.id)}
                        className="h-8 w-8 rounded-lg"
                        title={t("downloads.actions.removeTask")}
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
