import { Package, ExternalLink } from "lucide-react"
import { openUrl } from "@tauri-apps/plugin-opener"
import type { NexusDependencyGroup } from "./online-mod-parser"

interface ModDependenciesProps {
  dependencies: NexusDependencyGroup[]
}

export function ModDependencies({ dependencies }: ModDependenciesProps) {
  if (!dependencies || dependencies.length === 0) return null

  // Flatten all dependency files from all groups
  const allFiles = dependencies.flatMap(g => g.files)
  if (allFiles.length === 0) return null

  return (
    <div className="space-y-2.5">
      <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
        <Package className="h-3.5 w-3.5" />
        <span>依赖项 (Requirements)</span>
        <span className="text-[10px] font-normal text-muted-foreground/60">({allFiles.length})</span>
      </h4>
      <div className="space-y-2">
        {allFiles.map((file) => (
          <div
            key={file.uid}
            className="flex items-center gap-3 p-2.5 rounded-lg bg-accent/15 border border-border/40 hover:border-primary/30 hover:bg-accent/25 transition-all group"
          >
            {/* Thumbnail */}
            {file.mod.thumbnailUrl ? (
              <img
                src={file.mod.thumbnailUrl}
                alt={file.mod.name}
                className="w-10 h-10 rounded-md object-cover flex-shrink-0 border border-border/30"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none"
                }}
              />
            ) : (
              <div className="w-10 h-10 rounded-md bg-accent/30 flex items-center justify-center flex-shrink-0 border border-border/30">
                <Package className="h-4 w-4 text-muted-foreground/40" />
              </div>
            )}

            {/* Info */}
            <div className="flex-1 min-w-0">
              <button
                onClick={() => openUrl(file.mod.url)}
                className="text-xs font-semibold text-foreground hover:text-primary transition-colors truncate block max-w-full cursor-pointer"
                title={file.mod.name}
              >
                {file.mod.name}
              </button>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] text-muted-foreground">
                  需要版本: <span className="font-semibold text-foreground/80">{file.version}</span>
                </span>
                {file.dependencyCount > 0 && (
                  <span className="text-[10px] text-muted-foreground/60">
                    +{file.dependencyCount} 子依赖
                  </span>
                )}
              </div>
            </div>

            {/* Link icon */}
            <button
              onClick={() => openUrl(file.mod.url)}
              className="p-1.5 rounded-md opacity-0 group-hover:opacity-100 hover:bg-accent text-muted-foreground hover:text-primary transition-all cursor-pointer flex-shrink-0"
              title="在 Nexus Mods 中打开"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
