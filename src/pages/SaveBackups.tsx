import { ArchiveRestore } from "lucide-react"
import { SaveBackupCard } from "@/components/settings/SaveBackupCard"

export function SaveBackups({
  selectedSaveId,
  onShowToast,
  onSavesChanged,
}: {
  selectedSaveId: string
  onShowToast: (message: string, type: "success" | "info" | "warning") => void
  onSavesChanged: () => Promise<void>
}) {
  return (
    <div className="p-8 space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">存档备份</h2>
        <p className="text-muted-foreground mt-1">
          为当前选中的本地存档创建快照，并管理恢复与删除操作。
        </p>
      </div>

      <div className="max-w-5xl space-y-6">
        <div className="rounded-lg border bg-accent/20 px-4 py-3 text-sm text-muted-foreground">
          <div className="flex items-start gap-3">
            <ArchiveRestore className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
            <p>恢复备份前会先自动为当前存档再创建一组回滚备份，避免误恢复后无法撤销。</p>
          </div>
        </div>

        <SaveBackupCard
          selectedSaveId={selectedSaveId}
          onShowToast={onShowToast}
          onChanged={onSavesChanged}
        />
      </div>
    </div>
  )
}
