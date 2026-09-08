/**
 * 虚拟局域网（REALTIME.md §7）：封装 Tauri 命令 vlan_start / vlan_update_members / vlan_signal_in / vlan_stop /
 * vlan_status / vlan_helper_status 与事件 vlan-event / vlan-signal-out。
 * 只在主窗口的 SocialProvider 里使用（需要房间上下文与 room.signal 通道）。
 *
 * 进入房间（room.ready）后自动 vlan_start（localStorage `vlanAutoJoin === "false"` 时除外）；
 * 启动失败不会自动重试，由面板上的「重试」触发。提权由 Rust 侧的辅助进程负责（§7.4），
 * 用户拒绝 UAC 时 vlan_start 返回以「未获得管理员权限」开头的错误。
 * Rust 侧命令可能尚未就绪或在浏览器预览中不存在——所有 invoke 错误都被捕获并以 error 呈现。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { RoomMember, VlanEvent, VlanHelperStatus, VlanMemberRef, VlanPeer, VlanSignalOut, VlanStatus } from "./types"
import { newLocalId } from "./utils"

const MAX_LOG = 100
const STATUS_POLL_MS = 3000
export const AUTO_JOIN_KEY = "vlanAutoJoin"

/** vlan_start 错误前缀（§7.3 / §7.4） */
export const VLAN_ERR_NEEDS_ADMIN = "需要以管理员身份运行"
export const VLAN_ERR_DENIED = "未获得管理员权限"

export type VlanErrorKind = "denied" | "needsAdmin" | "other"

export interface VlanLogLine {
  id: string
  ts: number
  kind: VlanEvent["kind"]
  text: string
}

export interface VlanController {
  status: VlanStatus | null
  enabled: boolean
  starting: boolean
  /** 启动过程中的当前阶段文案（来自 vlan-event log，例如「正在申请管理员权限…」） */
  statusText: string | null
  error: string | null
  errorKind: VlanErrorKind | null
  log: VlanLogLine[]
  /** 是否检测到 Tauri 环境（否则命令不可用） */
  available: boolean
  /** 进房自动加入（localStorage vlanAutoJoin） */
  autoJoin: boolean
  setAutoJoin: (value: boolean) => void
  helper: VlanHelperStatus | null
  refreshHelperStatus: () => Promise<void>
  enable: () => Promise<void>
  disable: () => Promise<void>
  /** 供 SocialProvider 把 kind 以 vlan- 开头的 room.signal 交给 Rust */
  signalIn: (from: string, data: Record<string, unknown>) => void
}

interface UseVlanParams {
  /** 只有主窗口（有房间能力）才激活桥接 */
  active: boolean
  /** 当前房间：null 表示已离开 / 关闭 / 被踢 / 登出 → 自动 vlan_stop；变为非空 → 自动 vlan_start */
  roomCode: string | null
  you: string | null
  members: RoomMember[]
  sendSignal: (to: string, data: unknown) => boolean
  /** 错误提示（主窗口 toast）；kind=denied 表示用户在 UAC 中拒绝，调用方可换成 i18n 文案 */
  onError: (message: string, kind: VlanErrorKind) => void
}

function isTauri(): boolean {
  return typeof window !== "undefined" && !!(window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
}

function readAutoJoin(): boolean {
  try {
    return localStorage.getItem(AUTO_JOIN_KEY) !== "false"
  } catch {
    return true
  }
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === "string") return err
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

export function classifyVlanError(error: string | null): VlanErrorKind | null {
  if (!error) return null
  if (error.startsWith(VLAN_ERR_DENIED)) return "denied"
  if (error.startsWith(VLAN_ERR_NEEDS_ADMIN)) return "needsAdmin"
  return "other"
}

function toMemberRefs(members: RoomMember[]): VlanMemberRef[] {
  return members.filter((m) => typeof m.vip === "string" && m.vip).map(({ id, vip }) => ({ id, vip }))
}

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<T>(cmd, args)
}

export function useVlan({ active, roomCode, you, members, sendSignal, onError }: UseVlanParams): VlanController {
  const [status, setStatus] = useState<VlanStatus | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [starting, setStarting] = useState(false)
  const [statusText, setStatusText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [log, setLog] = useState<VlanLogLine[]>([])
  const [autoJoin, setAutoJoinState] = useState<boolean>(readAutoJoin)
  const [helper, setHelper] = useState<VlanHelperStatus | null>(null)

  const available = useMemo(isTauri, [])
  const enabledRef = useRef(false)
  const startingRef = useRef(false)
  const autoJoinRef = useRef(autoJoin)
  const sendSignalRef = useRef(sendSignal)
  const onErrorRef = useRef(onError)
  const membersRef = useRef(members)
  const youRef = useRef(you)
  const roomCodeRef = useRef(roomCode)
  autoJoinRef.current = autoJoin
  sendSignalRef.current = sendSignal
  onErrorRef.current = onError
  membersRef.current = members
  youRef.current = you
  roomCodeRef.current = roomCode

  const pushLog = useCallback((kind: VlanEvent["kind"], text: string) => {
    setLog((prev) => {
      const next = [...prev, { id: newLocalId(), ts: Date.now(), kind, text }]
      return next.length > MAX_LOG ? next.slice(next.length - MAX_LOG) : next
    })
  }, [])

  const refreshHelperStatus = useCallback(async () => {
    if (!active || !available) return
    try {
      const next = await tauriInvoke<VlanHelperStatus>("vlan_helper_status")
      if (next && typeof next === "object") {
        setHelper({ elevated: !!next.elevated, helper_running: !!next.helper_running })
      }
    } catch {
      // 命令不可用时保持未知
    }
  }, [active, available])

  const stop = useCallback(async () => {
    const wasEnabled = enabledRef.current
    enabledRef.current = false
    setEnabled(false)
    setStarting(false)
    startingRef.current = false
    setStatusText(null)
    setStatus(null)
    if (!available || !wasEnabled) return
    try {
      await tauriInvoke<void>("vlan_stop")
    } catch (err) {
      console.warn("[vlan] vlan_stop failed:", err)
    }
  }, [available])

  const enable = useCallback(async () => {
    if (enabledRef.current || startingRef.current) return
    const selfId = youRef.current
    const me = selfId ? membersRef.current.find((m) => m.id === selfId) : null
    if (!roomCodeRef.current || !selfId || !me || !me.vip) {
      setError("vlan_no_room")
      return
    }
    setError(null)
    setStatusText(null)
    startingRef.current = true
    setStarting(true)
    setLog([])
    if (!available) {
      startingRef.current = false
      setStarting(false)
      setError("vlan_unavailable")
      return
    }
    try {
      const result = await tauriInvoke<VlanStatus>("vlan_start", {
        selfId,
        vip: me.vip,
        members: toMemberRefs(membersRef.current),
      })
      enabledRef.current = true
      setEnabled(true)
      setStatus(result)
      if (result?.error) setError(result.error)
      pushLog("started", result?.vip ?? me.vip)
    } catch (err) {
      const text = errorText(err)
      setError(text)
      pushLog("error", text)
      // 每次启动尝试只提示一次（成员变化不会触发重新启动）
      onErrorRef.current(text, classifyVlanError(text) ?? "other")
    } finally {
      startingRef.current = false
      setStarting(false)
      setStatusText(null)
      void refreshHelperStatus()
    }
  }, [available, pushLog, refreshHelperStatus])

  const setAutoJoin = useCallback((value: boolean) => {
    setAutoJoinState(value)
    autoJoinRef.current = value
    try {
      localStorage.setItem(AUTO_JOIN_KEY, value ? "true" : "false")
    } catch {
      // ignore
    }
  }, [])

  const signalIn = useCallback(
    (from: string, data: Record<string, unknown>) => {
      if (!enabledRef.current || !available) return
      tauriInvoke<void>("vlan_signal_in", { from, data }).catch((err) => {
        console.warn("[vlan] vlan_signal_in failed:", err)
      })
    },
    [available],
  )

  // 进入房间（room.ready → roomCode 非空）→ 自动 vlan_start；离开房间 → vlan_stop。只按房间号变化触发，启动失败不自动重试。
  useEffect(() => {
    if (!active) return
    if (!roomCode) {
      setError(null)
      if (enabledRef.current || startingRef.current) void stop()
      return
    }
    if (autoJoinRef.current && !enabledRef.current && !startingRef.current) {
      void enable()
    }
  }, [active, roomCode, enable, stop])

  // 房间成员变化 → vlan_update_members（仅已开启时）
  const memberKey = useMemo(() => toMemberRefs(members).map((m) => `${m.id}=${m.vip}`).sort().join(","), [members])
  useEffect(() => {
    if (!active || !roomCode || !enabledRef.current || !available) return
    tauriInvoke<void>("vlan_update_members", { members: toMemberRefs(membersRef.current) }).catch((err) => {
      console.warn("[vlan] vlan_update_members failed:", err)
    })
  }, [active, roomCode, memberKey, available])

  // 事件监听：vlan-event（状态 / 日志 / 错误）与 vlan-signal-out（经 room.signal 转发）
  useEffect(() => {
    if (!active || !available) return
    let disposed = false
    const unlisteners: Array<() => void> = []
    ;(async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event")
        const unEvent = await listen<VlanEvent>("vlan-event", (event) => {
          const ev = event.payload
          if (!ev || typeof ev !== "object") return
          switch (ev.kind) {
            case "started":
              setStatus((prev) => (prev ? { ...prev, running: true } : prev))
              if (ev.text) pushLog("started", ev.text)
              break
            case "stopped":
              enabledRef.current = false
              setEnabled(false)
              setStatus(null)
              pushLog("stopped", ev.text ?? "")
              break
            case "peer":
              if (ev.peer) {
                const peer = ev.peer
                setStatus((prev) => {
                  if (!prev) return prev
                  const exists = prev.peers.some((p) => p.id === peer.id)
                  const peers: VlanPeer[] = exists
                    ? prev.peers.map((p) => (p.id === peer.id ? { ...p, vip: peer.vip, state: peer.state } : p))
                    : [...prev.peers, { id: peer.id, vip: peer.vip, state: peer.state, tx_bytes: 0, rx_bytes: 0 }]
                  return { ...prev, peers }
                })
                pushLog("peer", `${peer.vip} ${peer.state}`)
              }
              break
            case "error": {
              const text = ev.text ?? "error"
              setError(text)
              pushLog("error", text)
              onErrorRef.current(text, classifyVlanError(text) ?? "other")
              break
            }
            case "log":
              if (ev.text) {
                pushLog("log", ev.text)
                // 启动期间的日志（如「正在申请管理员权限…」）作为当前状态文案展示
                if (startingRef.current) setStatusText(ev.text)
              }
              break
          }
        })
        const unSignal = await listen<VlanSignalOut>("vlan-signal-out", (event) => {
          const payload = event.payload
          if (!payload || typeof payload.to !== "string" || !payload.data) return
          if (!sendSignalRef.current(payload.to, payload.data)) {
            console.warn("[vlan] room socket not open, dropped signal to", payload.to)
          }
        })
        if (disposed) {
          unEvent()
          unSignal()
        } else {
          unlisteners.push(unEvent, unSignal)
        }
      } catch (err) {
        console.error("[vlan] failed to listen events:", err)
      }
    })()
    return () => {
      disposed = true
      unlisteners.forEach((fn) => fn())
    }
  }, [active, available, pushLog])

  // 开启期间定时拉取 vlan_status 刷新流量计数
  useEffect(() => {
    if (!active || !available || !enabled) return
    let cancelled = false
    const tick = async () => {
      try {
        const next = await tauriInvoke<VlanStatus>("vlan_status")
        if (!cancelled && next) setStatus(next)
      } catch {
        // 命令不可用时忽略
      }
    }
    const timer = setInterval(tick, STATUS_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [active, available, enabled])

  // Provider 卸载（窗口关闭）时停止
  useEffect(() => {
    if (!active) return
    return () => {
      if (enabledRef.current && available) {
        enabledRef.current = false
        tauriInvoke<void>("vlan_stop").catch(() => {})
      }
    }
  }, [active, available])

  const errorKind = useMemo(() => classifyVlanError(error), [error])

  return useMemo<VlanController>(
    () => ({
      status,
      enabled,
      starting,
      statusText,
      error,
      errorKind,
      log,
      available,
      autoJoin,
      setAutoJoin,
      helper,
      refreshHelperStatus,
      enable,
      disable: stop,
      signalIn,
    }),
    [status, enabled, starting, statusText, error, errorKind, log, available, autoJoin, setAutoJoin, helper, refreshHelperStatus, enable, stop, signalIn],
  )
}
