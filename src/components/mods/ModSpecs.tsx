import { useTranslation } from "react-i18next"
import { Tag, Eye, Download, Info, User, Calendar } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import type { SmapiMod } from "./OnlineMods"
import type { ParsedModDetails } from "./online-mod-parser"

interface ModSpecsProps {
  details: ParsedModDetails
  mod: SmapiMod
}

export function renderStatusBadge(status: string) {
  const { t } = useTranslation()
  switch (status) {
    case "ok":
      return <Badge className="bg-green-500/10 text-green-500 border border-green-500/20 rounded-full font-semibold px-2.5 py-0.5 text-xs shrink-0">{t("mods.online.statusOk")}</Badge>
    case "workaround":
      return <Badge className="bg-amber-500/10 text-amber-500 border border-amber-500/20 rounded-full font-semibold px-2.5 py-0.5 text-xs shrink-0">{t("mods.online.statusWorkaround")}</Badge>
    case "broken":
      return <Badge className="bg-red-500/10 text-red-500 border border-red-500/20 rounded-full font-semibold px-2.5 py-0.5 text-xs shrink-0">{t("mods.online.statusBroken")}</Badge>
    case "unofficial":
      return <Badge className="bg-blue-500/10 text-blue-500 border border-blue-500/20 rounded-full font-semibold px-2.5 py-0.5 text-xs shrink-0">{t("mods.online.statusUnofficial")}</Badge>
    case "abandoned":
      return <Badge className="bg-gray-500/10 text-gray-500 border border-gray-500/20 rounded-full font-semibold px-2.5 py-0.5 text-xs shrink-0">{t("mods.online.statusAbandoned")}</Badge>
    case "obsolete":
      return <Badge className="bg-slate-500/10 text-slate-500 border border-slate-500/20 rounded-full font-semibold px-2.5 py-0.5 text-xs shrink-0">{t("mods.online.statusObsolete")}</Badge>
    default:
      return <Badge className="bg-green-500/10 text-green-500 border border-green-500/20 rounded-full font-semibold px-2.5 py-0.5 text-xs shrink-0">{t("mods.online.compatDefault")}</Badge>
  }
}

export function ModSpecs({ details, mod }: ModSpecsProps) {
  const { t } = useTranslation()
  return (
    <div className="space-y-4">
      {/* Stats Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-accent/20 border border-border/50 rounded-xl p-3 text-center space-y-1">
          <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider flex items-center justify-center gap-1">
            <Tag className="h-3 w-3" />
            <span>{t("mods.specs.version")}</span>
          </p>
          <p className="text-sm font-bold text-foreground">{details.version}</p>
        </div>
        <div className="bg-accent/20 border border-border/50 rounded-xl p-3 text-center space-y-1">
          <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider flex items-center justify-center gap-1">
            <Eye className="h-3 w-3" />
            <span>{t("mods.specs.uniqueDownloads")}</span>
          </p>
          <p className="text-sm font-bold text-foreground">{details.uniqueDls}</p>
        </div>
        <div className="bg-accent/20 border border-border/50 rounded-xl p-3 text-center space-y-1">
          <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider flex items-center justify-center gap-1">
            <Download className="h-3 w-3" />
            <span>{t("mods.specs.totalDownloads")}</span>
          </p>
          <p className="text-sm font-bold text-foreground">{details.totalDls}</p>
        </div>
        <div className="bg-accent/20 border border-border/50 rounded-xl p-3 text-center space-y-1">
          <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider flex items-center justify-center gap-1">
            <Info className="h-3 w-3" />
            <span>{t("mods.specs.endorsements")}</span>
          </p>
          <p className="text-sm font-bold text-foreground">{details.endorsements}</p>
        </div>
      </div>

      {/* Author & Date Info */}
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <User className="h-3.5 w-3.5" />
          <span>{t("mods.specs.authorLabel")}</span>
          <span className="font-semibold text-foreground">{details.author}</span>
        </span>
        {details.lastUpdated && details.lastUpdated !== "—" && (
          <span className="flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5" />
            <span>{t("mods.specs.lastUpdated")}</span>
            <span className="font-semibold text-foreground">{details.lastUpdated}</span>
          </span>
        )}
        {mod.Compatibility && (
          <span className="flex items-center gap-1.5">
            {renderStatusBadge(mod.Compatibility.Status)}
          </span>
        )}
      </div>

      {/* Compatibility Notice */}
      <div className="bg-accent/10 border border-border/50 rounded-xl p-3.5 text-xs leading-relaxed space-y-1">
        <p className="font-bold text-foreground flex items-center gap-1.5">
          <Info className="h-3.5 w-3.5 text-primary shrink-0" />
          <span>{mod.Compatibility ? t("mods.specs.compatReport") : t("mods.specs.compatNote")}</span>
        </p>
        <p className="text-muted-foreground text-[11px]">
          {mod.Compatibility
            ? t("mods.specs.compatReportDesc")
            : t("mods.specs.compatNoteDesc")}
        </p>
      </div>
    </div>
  )
}
