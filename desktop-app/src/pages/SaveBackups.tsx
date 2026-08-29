import { ArchiveRestore } from "lucide-react"
import { useTranslation } from "react-i18next"
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
  const { t } = useTranslation()

  return (
    <div className="p-8 space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">{t("saveBackups.title")}</h2>
        <p className="text-muted-foreground mt-1">
          {t("saveBackups.description")}
        </p>
      </div>

      <div className="space-y-6">
        <div className="rounded-lg border bg-accent/20 px-4 py-3 text-sm text-muted-foreground">
          <div className="flex items-start gap-3">
            <ArchiveRestore className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
            <p>{t("saveBackups.restoreNotice")}</p>
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
