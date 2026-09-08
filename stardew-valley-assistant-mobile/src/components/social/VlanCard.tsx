import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import { Loader2, Network, Power, RefreshCw } from "lucide-react"
import { useSocial } from "@shared/account/social-provider"
import type { VlanPeerState } from "@shared/account/types"
import { displayName, formatBytes } from "@shared/account/utils"
import { cn } from "../../lib/utils"
import { Button } from "../ui"

/**
 * 房间页的虚拟局域网卡片。状态机与桌面端共用（shared/account/vlan.ts），
 * 平台差异只在 Rust 侧：手机端用 Android VpnService，授权失败的提示文案由 i18n 覆盖。
 */
export function VlanCard() {
  const { t } = useTranslation()
  const { room, vlan } = useSocial()
  const { refreshHelperStatus } = vlan

  // vlan_helper_status().available 会告诉我们当前平台是否支持（桌面预览窗口里为 false）
  useEffect(() => {
    void refreshHelperStatus()
  }, [refreshHelperStatus])

  if (!room || !vlan.available || vlan.helper?.available === false) return null

  const me = room.members.find((m) => m.id === room.you)
  const host = room.members.find((m) => m.id === room.info.host_id)
  const peers = room.members
    .filter((m) => m.id !== room.you)
    .map((m) => ({
      member: m,
      peer: vlan.status?.peers.find((p) => p.id === m.id),
    }))

  const phase = vlan.starting
    ? t("social.vlan.phase.starting")
    : vlan.errorKind === "denied"
      ? t("social.vlan.phase.denied")
      : vlan.error
        ? t("social.vlan.phase.failed")
        : vlan.enabled
          ? t("social.vlan.phase.joined", { vip: vlan.status?.vip ?? me?.vip ?? "" })
          : t("social.vlan.phase.idle")

  const stateLabel = (state: VlanPeerState | undefined) =>
    state ? t(`social.vlan.state.${state}`) : t("social.vlan.state.notJoined")

  return (
    <div className="mx-3 space-y-3 rounded-2xl border border-border/60 bg-card p-3.5">
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
            vlan.enabled ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground",
          )}
        >
          <Network className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">{t("social.vlan.title")}</p>
          <p className="truncate text-xs text-muted-foreground">{vlan.statusText ?? phase}</p>
        </div>
        {vlan.starting ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : vlan.enabled ? (
          <Button size="sm" variant="outline" onClick={() => void vlan.disable()}>
            <Power className="h-3.5 w-3.5" />
            {t("social.vlan.disable")}
          </Button>
        ) : (
          <Button size="sm" onClick={() => void vlan.enable()}>
            <RefreshCw className="h-3.5 w-3.5" />
            {t(vlan.error ? "social.vlan.retry" : "social.vlan.rejoin")}
          </Button>
        )}
      </div>

      {vlan.errorKind === "denied" && <p className="text-xs text-muted-foreground">{t("social.vlan.deniedHint")}</p>}
      {vlan.errorKind === "needsAdmin" && <p className="text-xs text-muted-foreground">{t("social.vlan.adminHint")}</p>}
      {vlan.errorKind === "other" && vlan.error && (
        <p className="break-words text-xs text-destructive">
          {/* Rust 侧只返回 vlan_unavailable / vlan_no_room 这类机器码时走 i18n，其余直接显示原文 */}
          {vlan.error.startsWith("vlan_") ? t(`social.vlan.errors.${vlan.error}`) : vlan.error}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-xl bg-accent/40 px-3 py-2">
          <p className="text-muted-foreground">{t("social.vlan.myVip")}</p>
          <p className="font-mono text-sm font-semibold">{me?.vip ?? "—"}</p>
        </div>
        <div className="rounded-xl bg-accent/40 px-3 py-2">
          <p className="text-muted-foreground">{t("social.vlan.hostVip")}</p>
          <p className="font-mono text-sm font-semibold">{host?.vip ?? "—"}</p>
        </div>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{t("social.vlan.hint")}</p>

      {peers.length > 0 && (
        <div className="space-y-1.5 border-t border-border/60 pt-3">
          {peers.map(({ member, peer }) => (
            <div key={member.id} className="flex items-center gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate">{displayName(member)}</span>
              <span className="font-mono text-muted-foreground">{member.vip}</span>
              <span
                className={cn(
                  "w-20 text-right",
                  peer?.state === "connected"
                    ? "text-emerald-600 dark:text-emerald-400"
                    : peer?.state === "failed"
                      ? "text-destructive"
                      : "text-muted-foreground",
                )}
              >
                {stateLabel(peer?.state)}
              </span>
            </div>
          ))}
          {vlan.status && (
            <p className="pt-1 text-[11px] text-muted-foreground">
              {t("social.vlan.subnet", { subnet: vlan.status.subnet, mtu: vlan.status.mtu })}
              {vlan.status.peers.length > 0 && (
                <>
                  {" · "}
                  {formatBytes(vlan.status.peers.reduce((sum, p) => sum + p.tx_bytes, 0))}
                  {" / "}
                  {formatBytes(vlan.status.peers.reduce((sum, p) => sum + p.rx_bytes, 0))}
                </>
              )}
            </p>
          )}
        </div>
      )}

      <label className="flex items-center gap-2.5 border-t border-border/60 pt-3 text-xs">
        <input
          type="checkbox"
          checked={vlan.autoJoin}
          onChange={(e) => vlan.setAutoJoin(e.target.checked)}
          className="h-5 w-5 accent-[var(--primary)]"
        />
        <span className="text-muted-foreground">{t("social.vlan.autoJoin")}</span>
      </label>
    </div>
  )
}
