import { useTranslation } from "react-i18next"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { Loader2, Map as MapIcon } from "lucide-react"
import { formatGameTime } from "./game-map-utils"
import type { NpcSchedulePoint } from "./GameMap.types"

interface NpcOverlayPanelProps {
  showNpcLocations: boolean
  setShowNpcLocations: (v: boolean) => void
  showNpcRoute: boolean
  setShowNpcRoute: (v: boolean) => void
  isGameRunning: boolean
  pipeConnected: boolean
  isModSource: boolean
  loadingLocations: boolean
  npcLocationError: string | null
  npcDropdownRef: React.RefObject<HTMLDivElement | null>
  isNpcDropdownOpen: boolean
  setIsNpcDropdownOpen: (v: boolean) => void
  npcSearchTerm: string
  setNpcSearchTerm: (v: string) => void
  selectedNpcId: string
  setSelectedNpcId: (v: string) => void
  npcList: any[]
  npcPortraits: Record<string, string>
  selectedSaveId?: string
  saveSeason: number
  setSaveSeason: (v: number) => void
  saveDay: number
  setSaveDay: (v: number) => void
  schedulePoints: NpcSchedulePoint[]
  loadingSchedule: boolean
  onSchedulePointClick: (point: NpcSchedulePoint) => void
  selectedMapId?: string
}

export function NpcOverlayPanel({
  showNpcLocations,
  setShowNpcLocations,
  showNpcRoute,
  setShowNpcRoute,
  isGameRunning,
  pipeConnected,
  isModSource,
  loadingLocations,
  npcLocationError,
  npcDropdownRef,
  isNpcDropdownOpen,
  setIsNpcDropdownOpen,
  npcSearchTerm,
  setNpcSearchTerm,
  selectedNpcId,
  setSelectedNpcId,
  npcList,
  npcPortraits,
  selectedSaveId,
  saveSeason,
  setSaveSeason,
  saveDay,
  setSaveDay,
  schedulePoints,
  loadingSchedule,
  onSchedulePointClick,
  selectedMapId,
}: NpcOverlayPanelProps) {
  const { t, i18n } = useTranslation()

  return (
    <div className="absolute right-4 top-4 z-30 max-h-[80%] w-72 overflow-y-auto rounded-lg border border-border/70 bg-background/88 p-4 shadow-2xl backdrop-blur-xl pointer-events-auto">
      <div className="space-y-4">
        <div className="flex items-center justify-between border-b pb-2">
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <MapIcon className="h-4 w-4 text-primary" />
            {t("fishingMap.npcOverlay", { defaultValue: "NPC 图层" })}
          </h3>
        </div>

        <div className="space-y-2">
          <div className="flex rounded-md border overflow-hidden text-xs">
            <button
              className={cn(
                "flex-1 py-1.5 px-2 transition-colors",
                !showNpcLocations && !showNpcRoute
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              )}
              onClick={() => { setShowNpcLocations(false); setShowNpcRoute(false) }}
            >
              关闭
            </button>
            <button
              className={cn(
                "flex-1 py-1.5 px-2 border-l transition-colors",
                isModSource && !pipeConnected
                  ? "opacity-50 cursor-not-allowed text-muted-foreground"
                  : showNpcLocations
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
              )}
              onClick={() => {
                if (isModSource && !pipeConnected) return
                setShowNpcLocations(!showNpcLocations)
                setShowNpcRoute(false)
              }}
            >
              {t("fishingMap.showNpcLocation", { defaultValue: "实时位置" })}
              {loadingLocations && <Loader2 className="h-3 w-3 animate-spin inline ml-1" />}
            </button>
            <button
              className={cn(
                "flex-1 py-1.5 px-2 border-l transition-colors",
                showNpcRoute
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              )}
              onClick={() => { setShowNpcRoute(!showNpcRoute); setShowNpcLocations(false) }}
            >
              {t("fishingMap.showNpcRoute", { defaultValue: "行动路线" })}
            </button>
          </div>
          {isModSource && !pipeConnected ? (
            <div className="text-[10px] text-amber-500 font-medium">{t("fishingMap.pipeNotConnected", { defaultValue: "助手应用未运行，实时位置不可用。" })}</div>
          ) : isModSource && pipeConnected && !isGameRunning ? (
            <div className="text-[10px] text-blue-500 font-medium">{t("fishingMap.pipeConnectedNoData", { defaultValue: "Mod 已连接，请加载存档以启用实时位置。" })}</div>
          ) : (
            npcLocationError && <div className="text-[10px] text-red-500 font-medium">{npcLocationError}</div>
          )}
        </div>

        {showNpcRoute && (
          <div className="space-y-3 pt-3 border-t">
            <div className="space-y-1" ref={npcDropdownRef}>
              <span className="text-[11px] font-semibold text-muted-foreground">
                {t("fishingMap.selectNpc", { defaultValue: "选择 NPC" })}
              </span>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIsNpcDropdownOpen(!isNpcDropdownOpen)}
                  className="flex h-9 w-full items-center justify-between rounded-md border border-border/70 bg-background/50 px-2.5 text-xs text-foreground outline-none hover:bg-background/80 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    {selectedNpcId ? (
                      <>
                        {npcPortraits[selectedNpcId] ? (
                          <img src={npcPortraits[selectedNpcId]} alt="" className="h-5 w-5 rounded-full object-cover border border-primary/20 shrink-0" style={{ imageRendering: "pixelated" }} />
                        ) : (
                          <div className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary shrink-0">
                            {selectedNpcId.charAt(0)}
                          </div>
                        )}
                        <span>{npcList.find(n => n.id === selectedNpcId)?.name || selectedNpcId}</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">-- 选择村民 --</span>
                    )}
                  </div>
                  <span className="text-muted-foreground text-[10px]">▼</span>
                </button>

                {isNpcDropdownOpen && (
                  <div className="mt-1.5 max-h-48 overflow-y-auto rounded-md border border-border bg-popover/50 pb-1">
                    <div className="w-full px-2 py-1.5 border-b sticky top-0 bg-popover/70 z-10 backdrop-blur-md">
                      <Input
                        placeholder="搜索村民..."
                        value={npcSearchTerm}
                        onChange={(e) => setNpcSearchTerm(e.target.value)}
                        className="h-7 text-xs px-2 bg-background/50 border-border/70"
                      />
                    </div>
                    {npcList
                      .filter(npc => npc.name.toLowerCase().includes(npcSearchTerm.toLowerCase()) || npc.id.toLowerCase().includes(npcSearchTerm.toLowerCase()))
                      .map((npc) => {
                        const portrait = npcPortraits[npc.id]
                        const isSelected = npc.id === selectedNpcId
                        return (
                          <button
                            key={npc.id}
                            type="button"
                            onClick={() => { setSelectedNpcId(npc.id); setIsNpcDropdownOpen(false); setNpcSearchTerm("") }}
                            className={cn(
                              "w-full flex items-center gap-2.5 px-2.5 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer",
                              isSelected && "bg-accent/50 text-accent-foreground font-semibold"
                            )}
                          >
                            {portrait ? (
                              <img src={portrait} alt="" className="h-5 w-5 rounded-full object-cover border border-primary/20 shrink-0" style={{ imageRendering: "pixelated" }} />
                            ) : (
                              <div className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary shrink-0">
                                {npc.name.charAt(0)}
                              </div>
                            )}
                            <span className="truncate">{npc.name}</span>
                          </button>
                        )
                      })}
                  </div>
                )}
              </div>
            </div>

            {selectedSaveId && (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <span className="text-[10px] font-semibold text-muted-foreground">季节</span>
                  <select
                    value={saveSeason}
                    onChange={(e) => setSaveSeason(Number(e.target.value))}
                    className="h-8 w-full rounded-md border border-border/70 bg-background/50 px-2 text-[11px] text-foreground outline-none"
                  >
                    <option value={0}>春季</option>
                    <option value={1}>夏季</option>
                    <option value={2}>秋季</option>
                    <option value={3}>冬季</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] font-semibold text-muted-foreground">天数</span>
                  <Input
                    type="number"
                    min={1}
                    max={28}
                    value={saveDay}
                    onChange={(e) => {
                      const next = Number(e.target.value)
                      if (Number.isFinite(next)) setSaveDay(Math.min(28, Math.max(1, next)))
                    }}
                    className="h-8 px-2 text-[11px] bg-background/50 border-border/70"
                  />
                </div>
              </div>
            )}

            {selectedNpcId && (
              <div className="space-y-1.5 pt-2 border-t">
                <span className="text-[11px] font-semibold text-muted-foreground">
                  {t("fishingMap.npcScheduleTitle", { defaultValue: "日程路线点" })}
                </span>

                {loadingSchedule ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                ) : schedulePoints.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground text-center py-2">
                    {t("fishingMap.noSchedulePoints", { defaultValue: "今日无日程或不在当前地图" })}
                  </p>
                ) : (
                  <div className="max-h-40 overflow-y-auto pr-1 space-y-1">
                    {schedulePoints.map((p, idx) => {
                      const isOnCurrentMap = p.location.toLowerCase() === (selectedMapId ?? "").toLowerCase()
                      return (
                        <button
                          key={`list-point-${idx}`}
                          type="button"
                          onClick={() => onSchedulePointClick(p)}
                          className={cn(
                            "w-full text-left p-1.5 rounded text-[11px] border transition-colors flex items-center justify-between",
                            isOnCurrentMap
                              ? "bg-primary/5 border-primary/20 hover:bg-primary/10 text-foreground"
                              : "bg-muted/30 border-border/40 hover:bg-muted/50 text-muted-foreground"
                          )}
                          title={isOnCurrentMap ? t("fishingMap.scheduleClickLocate", { defaultValue: "点击定位到此坐标" }) : t("fishingMap.scheduleClickSwitch", { defaultValue: "点击切换地图并定位", location: p.locationDisplayName })}
                        >
                          <div className="truncate">
                            <span className="font-semibold text-primary/80 mr-1.5">{formatGameTime(p.time)}</span>
                            <span>
                              {(() => {
                                const keys = [`maps.${p.location}`, `fishingMap.locations.${p.location}`]
                                for (const key of keys) {
                                  if (i18n.exists(key, { lng: i18n.language })) return t(key, { lng: i18n.language })
                                }
                                return p.locationDisplayName
                              })()}
                            </span>
                          </div>
                          <div className="text-[9px] shrink-0 opacity-80">
                            {isOnCurrentMap ? `(${p.tileX}, ${p.tileY})` : "➔"}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
