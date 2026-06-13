import { Tag, Eye, Download, Info, User, Calendar } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import type { SmapiMod } from "./OnlineMods"
import type { ParsedModDetails } from "./online-mod-parser"

interface ModSpecsProps {
  details: ParsedModDetails
  mod: SmapiMod
}

export function renderStatusBadge(status: string) {
  switch (status) {
    case "ok":
      return <Badge className="bg-green-500/10 text-green-500 border border-green-500/20 rounded-full font-semibold px-2.5 py-0.5 text-xs shrink-0">完美兼容</Badge>
    case "workaround":
      return <Badge className="bg-amber-500/10 text-amber-500 border border-amber-500/20 rounded-full font-semibold px-2.5 py-0.5 text-xs shrink-0">有解决方法</Badge>
    case "broken":
      return <Badge className="bg-red-500/10 text-red-500 border border-red-500/20 rounded-full font-semibold px-2.5 py-0.5 text-xs shrink-0">已损坏</Badge>
    case "unofficial":
      return <Badge className="bg-blue-500/10 text-blue-500 border border-blue-500/20 rounded-full font-semibold px-2.5 py-0.5 text-xs shrink-0">非官方更新</Badge>
    case "abandoned":
      return <Badge className="bg-gray-500/10 text-gray-500 border border-gray-500/20 rounded-full font-semibold px-2.5 py-0.5 text-xs shrink-0">已弃用</Badge>
    case "obsolete":
      return <Badge className="bg-slate-500/10 text-slate-500 border border-slate-500/20 rounded-full font-semibold px-2.5 py-0.5 text-xs shrink-0">已过时</Badge>
    default:
      return <Badge className="bg-green-500/10 text-green-500 border border-green-500/20 rounded-full font-semibold px-2.5 py-0.5 text-xs shrink-0">兼容</Badge>
  }
}

export function ModSpecs({ details, mod }: ModSpecsProps) {
  return (
    <div className="space-y-4">
      {/* Stats Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-accent/20 border border-border/50 rounded-xl p-3 text-center space-y-1">
          <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider flex items-center justify-center gap-1">
            <Tag className="h-3 w-3" />
            <span>版本</span>
          </p>
          <p className="text-sm font-bold text-foreground">{details.version}</p>
        </div>
        <div className="bg-accent/20 border border-border/50 rounded-xl p-3 text-center space-y-1">
          <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider flex items-center justify-center gap-1">
            <Eye className="h-3 w-3" />
            <span>独立下载</span>
          </p>
          <p className="text-sm font-bold text-foreground">{details.uniqueDls}</p>
        </div>
        <div className="bg-accent/20 border border-border/50 rounded-xl p-3 text-center space-y-1">
          <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider flex items-center justify-center gap-1">
            <Download className="h-3 w-3" />
            <span>总下载</span>
          </p>
          <p className="text-sm font-bold text-foreground">{details.totalDls}</p>
        </div>
        <div className="bg-accent/20 border border-border/50 rounded-xl p-3 text-center space-y-1">
          <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider flex items-center justify-center gap-1">
            <Info className="h-3 w-3" />
            <span>推荐数</span>
          </p>
          <p className="text-sm font-bold text-foreground">{details.endorsements}</p>
        </div>
      </div>

      {/* Author & Date Info */}
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <User className="h-3.5 w-3.5" />
          <span>作者：</span>
          <span className="font-semibold text-foreground">{details.author}</span>
        </span>
        {details.lastUpdated && details.lastUpdated !== "—" && (
          <span className="flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5" />
            <span>最后更新：</span>
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
          <span>{mod.Compatibility ? "兼容性报告" : "兼容性说明"}</span>
        </p>
        <p className="text-muted-foreground text-[11px]">
          {mod.Compatibility
            ? "此处的报告是经 SMAPI 社区及作者核验后的准确记录，用以替代落后的游戏日志检查。"
            : "该模组暂未收录在 SMAPI 兼容列表中，通常适用于不需要 SMAPI 兼容特殊报告的模组。"}
        </p>
      </div>
    </div>
  )
}
