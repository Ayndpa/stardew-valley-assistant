import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { CheckCircle2, ChevronDown, ChevronRight, Copy, Crown, Loader2, Network, RefreshCw, ShieldAlert, ShieldCheck, Unplug } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { useSocial } from "@/lib/account/social-provider"
import type { VlanPeer, VlanPeerState } from "@/lib/account/types"
import { displayName, formatBytes, formatTime } from "@/lib/account/utils"
import { UserAvatar } from "./UserAvatar"

interface VlanPanelProps {
  onShowToast: (message: string, type: "success" | "info" | "warning") => void
}

type PeerChip = VlanPeerState | "notJoined"

const CHIP_CLASS: Record<PeerChip, string> = {
  notJoined: "bg-muted text-muted-foreground",
  connecting: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  connected: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  failed: "bg-destructive/15 text-destructive",
  disconnected: "bg-muted text-muted-foreground",
}

type Phase = "starting" | "joined" | "denied" | "failed" | "idle"

/** 房间面板里的"虚拟局域网"卡片（REALTIME.md §7）：进房自动加入，面板反映自动流程的状态 */
export function VlanPanel({ onShowToast }: VlanPanelProps) {
  const { t } = useTranslation()
  const { room, vlan } = useSocial()
  const [showLog, setShowLog] = useState(false)

  // 面板挂载时查询一次提权辅助进程状态（每次启动尝试后由 useVlan 自行刷新）
  const { refreshHelperStatus } = vlan
  useEffect(() => {
    void refreshHelperStatus()
  }, [refreshHelperStatus])

  if (!room) return null

  const me = room.members.find((m) => m.id === room.you) ?? null
  const host = room.members.find((m) => m.id === room.info.host_id) ?? null
  const isHost = room.info.host_id === room.you
  const others = [...room.members].filter((m) => m.id !== room.you).sort((a, b) => a.joined_at - b.joined_at)
  const peersById = new Map<string, VlanPeer>((vlan.status?.peers ?? []).map((p) => [p.id, p]))
  const myVip = vlan.status?.vip || me?.vip || "—"

  const phase: Phase = vlan.starting
    ? "starting"
    : vlan.enabled
      ? "joined"
      : vlan.errorKind === "denied"
        ? "denied"
        : vlan.error
          ? "failed"
          : "idle"

  const errorText = (() => {
    if (!vlan.error) return null
    const key = `social.vlan.errors.${vlan.error}`
    const translated = t(key)
    return translated === key ? vlan.error : translated
  })()

  const phaseText = (() => {
    switch (phase) {
      case "starting":
        return vlan.statusText || t("social.vlan.phase.starting")
      case "joined":
        return t("social.vlan.phase.joined", { vip: myVip })
      case "denied":
        return t("social.vlan.phase.denied")
      case "failed":
        return t("social.vlan.phase.failed")
      default:
        return t("social.vlan.phase.idle")
    }
  })()

  const phaseClass =
    phase === "joined"
      ? "text-emerald-600 dark:text-emerald-400"
      : phase === "starting"
        ? "text-amber-600 dark:text-amber-400"
        : phase === "denied" || phase === "failed"
          ? "text-destructive"
          : "text-muted-foreground"

  const PhaseIcon =
    phase === "joined" ? CheckCircle2 : phase === "starting" ? Loader2 : phase === "denied" || phase === "failed" ? ShieldAlert : Network

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      onShowToast(t("social.vlan.copied", { vip: value }), "success")
    } catch {
      onShowToast(t("social.vlan.copyFailed"), "warning")
    }
  }

  const renderChip = (state: PeerChip) => (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold", CHIP_CLASS[state])}>
      {state === "connecting" && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
      {t(`social.vlan.state.${state}`)}
    </span>
  )

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border/80 bg-card">
      {/* 状态头 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-4 py-2.5">
        <Network className="h-3.5 w-3.5 text-primary" />
        <p className="text-sm font-semibold">{t("social.vlan.title")}</p>
        <span className={cn("flex min-w-0 items-center gap-1.5 text-xs font-medium", phaseClass)}>
          <PhaseIcon className={cn("h-3.5 w-3.5 shrink-0", phase === "starting" && "animate-spin")} />
          <span className="truncate">{phaseText}</span>
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {(phase === "denied" || phase === "failed") && (
            <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => void vlan.enable()} disabled={vlan.starting || !me}>
              <RefreshCw className="h-3.5 w-3.5" />
              {t("social.vlan.retry")}
            </Button>
          )}
          {vlan.enabled ? (
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => void vlan.disable()}
              disabled={vlan.starting}
            >
              <Unplug className="h-3.5 w-3.5" />
              {t("social.vlan.disable")}
            </Button>
          ) : (
            phase === "idle" && (
              <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => void vlan.enable()} disabled={vlan.starting || !me}>
                <RefreshCw className="h-3.5 w-3.5" />
                {t("social.vlan.rejoin")}
              </Button>
            )
          )}
        </div>
      </div>

      <div className="space-y-3 px-4 py-3">
        {/* 我的 vip / 房主 vip */}
        <div className={cn("grid gap-3", !isHost && host ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1")}>
          <div className="rounded-lg border border-border/60 bg-accent/20 px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{t("social.vlan.myVip")}</p>
            <div className="mt-0.5 flex items-center gap-2">
              <span className="font-mono text-xl font-bold tracking-wide text-foreground">{myVip}</span>
              <button
                type="button"
                onClick={() => void copy(myVip)}
                disabled={myVip === "—"}
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer disabled:cursor-default disabled:opacity-40"
                title={t("social.vlan.copy")}
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            </div>
            {vlan.status && (
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                {t("social.vlan.subnet", { subnet: vlan.status.subnet, mtu: vlan.status.mtu })}
              </p>
            )}
          </div>
          {!isHost && host && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
              <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                <Crown className="h-3 w-3 text-amber-500" />
                {t("social.vlan.hostVip")}
              </p>
              <div className="mt-0.5 flex items-center gap-2">
                <span className="font-mono text-xl font-bold tracking-wide text-primary">{host.vip || "—"}</span>
                <button
                  type="button"
                  onClick={() => void copy(host.vip)}
                  disabled={!host.vip}
                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer disabled:cursor-default disabled:opacity-40"
                  title={t("social.vlan.copy")}
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{displayName(host)}</p>
            </div>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground">{t("social.vlan.hint")}</p>

        {errorText && (
          <div className="space-y-1 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
            <p className="flex items-start gap-1.5">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="break-all">{errorText}</span>
            </p>
            {vlan.errorKind === "denied" && <p className="pl-5 text-foreground">{t("social.vlan.deniedHint")}</p>}
            {vlan.errorKind === "needsAdmin" && <p className="pl-5 text-foreground">{t("social.vlan.adminHint")}</p>}
          </div>
        )}

        {/* 成员连接表 */}
        {vlan.enabled && (
          <div className="overflow-hidden rounded-lg border border-border/60">
            <table className="w-full text-xs">
              <thead className="bg-accent/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-2.5 py-1.5 text-left font-bold">{t("social.vlan.colName")}</th>
                  <th className="px-2.5 py-1.5 text-left font-bold">{t("social.vlan.colVip")}</th>
                  <th className="px-2.5 py-1.5 text-left font-bold">{t("social.vlan.colState")}</th>
                  <th className="px-2.5 py-1.5 text-right font-bold">{t("social.vlan.colTraffic")}</th>
                </tr>
              </thead>
              <tbody>
                {others.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-2.5 py-3 text-center text-muted-foreground">
                      {t("social.vlan.noPeers")}
                    </td>
                  </tr>
                ) : (
                  others.map((m) => {
                    const peer = peersById.get(m.id)
                    const chip: PeerChip = peer ? peer.state : "notJoined"
                    return (
                      <tr key={m.id} className="border-t border-border/50">
                        <td className="px-2.5 py-1.5">
                          <span className="flex items-center gap-1.5">
                            <UserAvatar user={m} size="sm" />
                            <span className="truncate">{displayName(m)}</span>
                            {m.id === room.info.host_id && <Crown className="h-3 w-3 shrink-0 text-amber-500" />}
                          </span>
                        </td>
                        <td className="px-2.5 py-1.5">
                          <button
                            type="button"
                            onClick={() => void copy(peer?.vip || m.vip)}
                            className="inline-flex items-center gap-1 rounded px-1 font-mono text-foreground transition-colors hover:bg-accent cursor-pointer"
                            title={t("social.vlan.copy")}
                          >
                            {peer?.vip || m.vip || "—"}
                            <Copy className="h-3 w-3 text-muted-foreground" />
                          </button>
                        </td>
                        <td className="px-2.5 py-1.5">{renderChip(chip)}</td>
                        <td className="px-2.5 py-1.5 text-right font-mono text-[11px] text-muted-foreground">
                          {peer ? `${formatBytes(peer.tx_bytes)} / ${formatBytes(peer.rx_bytes)}` : "—"}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* 自动加入开关 + 提权状态 + 日志 */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
          <label className="flex cursor-pointer items-center gap-1.5 select-none">
            <Checkbox
              id="vlan-auto-join"
              checked={vlan.autoJoin}
              onCheckedChange={(checked) => vlan.setAutoJoin(!!checked)}
              className="h-3.5 w-3.5 rounded"
            />
            <span>{t("social.vlan.autoJoin")}</span>
          </label>
          {vlan.helper?.elevated ? (
            <span className="flex items-center gap-1">
              <ShieldCheck className="h-3 w-3 text-emerald-500" />
              {t("social.vlan.helperElevated")}
            </span>
          ) : vlan.helper?.helper_running ? (
            <span className="flex items-center gap-1">
              <ShieldCheck className="h-3 w-3 text-primary" />
              {t("social.vlan.helperRunning")}
            </span>
          ) : null}
          {(vlan.enabled || vlan.log.length > 0) && (
            <button
              type="button"
              onClick={() => setShowLog((v) => !v)}
              className="ml-auto flex items-center gap-0.5 hover:text-foreground cursor-pointer"
            >
              {showLog ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              {t("social.vlan.log")} ({vlan.log.length})
            </button>
          )}
        </div>
        {showLog && (
          <div className="max-h-40 overflow-y-auto rounded-lg bg-muted/40 px-3 py-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
            {vlan.log.length === 0 ? (
              <p>—</p>
            ) : (
              vlan.log.map((line) => (
                <p key={line.id} className={cn(line.kind === "error" && "text-destructive", line.kind === "started" && "text-emerald-600 dark:text-emerald-400")}>
                  [{formatTime(line.ts)}] {line.kind}: {line.text}
                </p>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}
