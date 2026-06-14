import { useState, useEffect } from "react"
import { Package, ExternalLink, CheckCircle2, XCircle, Loader2 } from "lucide-react"
import { openUrl } from "@tauri-apps/plugin-opener"
import type { NexusDependencyGroup } from "./online-mod-parser"

interface InstalledModInfo {
  id: string
  name: string
  version: string
  nexusId?: number
}

interface SmapiInfo {
  installed: boolean
  version?: string
}

interface ModDependenciesProps {
  dependencies: NexusDependencyGroup[]
  /** 点击依赖项名称时的回调，用于在应用内导航到该模组详情。返回 true 表示已处理，否则回退到外部链接。 */
  onModClick?: (nexusUrl: string) => boolean
}

const SMAPI_NEXUS_ID = 2400

async function loadInstalledMods(): Promise<{ mods: InstalledModInfo[]; smapi: SmapiInfo }> {
  if (typeof window === "undefined" || !(window as any).__TAURI_INTERNALS__) return { mods: [], smapi: { installed: false } }
  try {
    const { invoke } = await import("@tauri-apps/api/core")
    const gameDir = localStorage.getItem("stardewGameDirectory") || ""
    if (!gameDir) return { mods: [], smapi: { installed: false } }

    const [modsResult, smapiResult] = await Promise.all([
      invoke("list_installed_mods", { gameDir }) as Promise<any[]>,
      invoke("check_smapi_status", { gameDir }) as Promise<any>,
    ])

    return {
      mods: modsResult.map(m => ({ id: m.id, name: m.name, version: m.version, nexusId: m.nexusId })),
      smapi: { installed: !!smapiResult?.installed, version: smapiResult?.version },
    }
  } catch {
    return { mods: [], smapi: { installed: false } }
  }
}

function extractNexusId(url: string): number | undefined {
  // URL like https://www.nexusmods.com/stardewvalley/mods/1915
  const match = url.match(/nexusmods\.com\/stardewvalley\/mods\/(\d+)/)
  return match ? Number(match[1]) : undefined
}

export function ModDependencies({ dependencies, onModClick }: ModDependenciesProps) {
  const [installedMods, setInstalledMods] = useState<InstalledModInfo[]>([])
  const [smapiInfo, setSmapiInfo] = useState<SmapiInfo>({ installed: false })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadInstalledMods().then(({ mods, smapi }) => {
      setInstalledMods(mods)
      setSmapiInfo(smapi)
      setLoading(false)
    })
  }, [])

  if (!dependencies || dependencies.length === 0) return null

  // Flatten all dependency files from all groups
  const allFiles = dependencies.flatMap(g => g.files)
  if (allFiles.length === 0) return null

  const getInstallStatus = (url: string): { installed: boolean; name?: string; version?: string } | undefined => {
    const nexusId = extractNexusId(url)
    if (!nexusId) return undefined

    // SMAPI is not in the mods list, check separately
    if (nexusId === SMAPI_NEXUS_ID && smapiInfo.installed) {
      return { installed: true, name: "SMAPI", version: smapiInfo.version }
    }

    const mod = installedMods.find(m => m.nexusId === nexusId)
    if (mod) return { installed: true, name: mod.name, version: mod.version }

    return undefined
  }

  return (
    <div className="space-y-2.5">
      <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
        <Package className="h-3.5 w-3.5" />
        <span>依赖项 (Requirements)</span>
        <span className="text-[10px] font-normal text-muted-foreground/60">({allFiles.length})</span>
        {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground/40" />}
      </h4>
      <div className="space-y-2">
        {allFiles.map((file) => {
          const installed = getInstallStatus(file.mod.url)
          return (
            <div
              key={file.uid}
              onClick={() => {
                if (!onModClick?.(file.mod.url)) {
                  openUrl(file.mod.url)
                }
              }}
              className={`flex items-center gap-3 p-2.5 rounded-lg border transition-all group cursor-pointer ${
                installed
                  ? "bg-green-50/50 dark:bg-green-950/20 border-green-200 dark:border-green-800 hover:border-green-400 dark:hover:border-green-600 hover:bg-green-50 dark:hover:bg-green-950/30"
                  : "bg-accent/15 border-border/40 hover:border-primary/30 hover:bg-accent/25"
              }`}
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
                <div className="flex items-center gap-1.5">
                  <span
                    className="text-xs font-semibold text-foreground hover:text-primary transition-colors truncate max-w-full"
                    title={file.mod.name}
                  >
                    {file.mod.name}
                  </span>
                  {!loading && (
                    installed ? (
                      <span title={`已安装: ${installed.name}`}><CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" /></span>
                    ) : (
                      <span title="未安装"><XCircle className="h-3.5 w-3.5 text-red-400 flex-shrink-0" /></span>
                    )
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] text-muted-foreground">
                    需要版本: <span className="font-semibold text-foreground/80">{file.version}</span>
                  </span>
                  {file.dependencyCount > 0 && (
                    <span className="text-[10px] text-muted-foreground/60">
                      +{file.dependencyCount} 子依赖
                    </span>
                  )}
                  {!loading && installed && (
                    <span className="text-[10px] text-green-600 dark:text-green-400 font-medium">
                      已安装 v{installed.version}
                    </span>
                  )}
                </div>
              </div>

              {/* Link icon */}
              <button
                onClick={(e) => { e.stopPropagation(); openUrl(file.mod.url) }}
                className="p-1.5 rounded-md opacity-0 group-hover:opacity-100 hover:bg-accent text-muted-foreground hover:text-primary transition-all cursor-pointer flex-shrink-0"
                title="在 Nexus Mods 中打开"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
