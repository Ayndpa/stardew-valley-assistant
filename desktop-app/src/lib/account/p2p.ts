/**
 * P2P 直连（REALTIME.md §6）：封装 Tauri 命令 p2p_connect / p2p_send / p2p_close 与事件 p2p-event。
 * Rust 侧命令可能尚未就绪或在 Web 预览中不存在——所有 invoke 错误都被捕获并以 error 状态呈现。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { SIGNALING_WS_URL } from "./config"
import type { ChatMessage } from "./types"
import { newLocalId } from "./utils"

export type PeerRole = "offer" | "answer"
export type PeerStatus = "idle" | "connecting" | "connected" | "closed" | "error"

export interface PeerEvent {
  session: string
  kind: "status" | "log" | "connected" | "message" | "closed" | "error"
  text?: string
  role?: PeerRole
  room?: string
  peer?: string
}

export interface PeerLogLine {
  id: string
  ts: number
  kind: PeerEvent["kind"]
  text: string
}

export interface PeerSession {
  sessionId: string | null
  status: PeerStatus
  role: PeerRole | null
  peer: string | null
  /** 当前 ICE 房间号 */
  code: string | null
  error: string | null
  log: PeerLogLine[]
  messages: ChatMessage[]
  /** 是否检测到 Tauri 环境（否则命令不可用） */
  available: boolean
  connect: (code: string, name: string) => Promise<void>
  send: (text: string) => Promise<void>
  close: () => Promise<void>
  reset: () => void
}

const MAX_LOG = 200
const MAX_MESSAGES = 300

function isTauri(): boolean {
  return typeof window !== "undefined" && !!(window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
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

export function usePeerSession(): PeerSession {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [status, setStatus] = useState<PeerStatus>("idle")
  const [role, setRole] = useState<PeerRole | null>(null)
  const [peer, setPeer] = useState<string | null>(null)
  const [code, setCode] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [log, setLog] = useState<PeerLogLine[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])

  const sessionRef = useRef<string | null>(null)
  const connectingRef = useRef(false)
  // 命令返回 sessionId 之前就可能收到事件，先缓存起来
  const bufferedRef = useRef<PeerEvent[]>([])
  const available = useMemo(isTauri, [])

  const pushLog = useCallback((kind: PeerEvent["kind"], text: string) => {
    setLog((prev) => {
      const next = [...prev, { id: newLocalId(), ts: Date.now(), kind, text }]
      return next.length > MAX_LOG ? next.slice(next.length - MAX_LOG) : next
    })
  }, [])

  const applyEvent = useCallback(
    (ev: PeerEvent) => {
      switch (ev.kind) {
        case "status":
          if (ev.role) setRole(ev.role)
          if (ev.room) setCode(ev.room)
          if (ev.text) pushLog("status", ev.text)
          break
        case "log":
          if (ev.text) pushLog("log", ev.text)
          break
        case "connected":
          setStatus("connected")
          if (ev.role) setRole(ev.role)
          if (ev.peer) setPeer(ev.peer)
          pushLog("connected", ev.text || ev.peer || "")
          break
        case "message":
          if (typeof ev.text === "string") {
            const from = { id: "peer", username: ev.peer || null }
            if (ev.peer) setPeer(ev.peer)
            setMessages((prev) => {
              const next = [...prev, { id: newLocalId(), from, text: ev.text as string, ts: Date.now() }]
              return next.length > MAX_MESSAGES ? next.slice(next.length - MAX_MESSAGES) : next
            })
          }
          break
        case "closed":
          setStatus("closed")
          pushLog("closed", ev.text || "")
          sessionRef.current = null
          setSessionId(null)
          break
        case "error":
          setStatus("error")
          setError(ev.text || "error")
          pushLog("error", ev.text || "")
          break
      }
    },
    [pushLog],
  )

  // 监听 p2p-event
  useEffect(() => {
    if (!available) return
    let unlisten: (() => void) | null = null
    let disposed = false
    ;(async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event")
        const un = await listen<PeerEvent>("p2p-event", (event) => {
          const payload = event.payload
          if (!payload || typeof payload !== "object") return
          const current = sessionRef.current
          if (current && payload.session === current) {
            applyEvent(payload)
          } else if (!current && connectingRef.current) {
            bufferedRef.current.push(payload)
          }
        })
        if (disposed) un()
        else unlisten = un
      } catch (err) {
        console.error("[p2p] failed to listen p2p-event:", err)
      }
    })()
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [available, applyEvent])

  const close = useCallback(async () => {
    const current = sessionRef.current
    sessionRef.current = null
    connectingRef.current = false
    bufferedRef.current = []
    setSessionId(null)
    setStatus((prev) => (prev === "idle" ? "idle" : "closed"))
    if (!current || !available) return
    try {
      const { invoke } = await import("@tauri-apps/api/core")
      await invoke("p2p_close", { session: current })
    } catch (err) {
      console.warn("[p2p] p2p_close failed:", err)
    }
  }, [available])

  const reset = useCallback(() => {
    setStatus("idle")
    setRole(null)
    setPeer(null)
    setCode(null)
    setError(null)
    setLog([])
    setMessages([])
  }, [])

  const connect = useCallback(
    async (nextCode: string, name: string) => {
      if (sessionRef.current) {
        await close()
      }
      reset()
      setCode(nextCode)
      setStatus("connecting")
      if (!available) {
        setStatus("error")
        setError("p2p_unavailable")
        return
      }
      connectingRef.current = true
      bufferedRef.current = []
      try {
        const { invoke } = await import("@tauri-apps/api/core")
        const id = await invoke<string>("p2p_connect", { server: SIGNALING_WS_URL, room: nextCode, name })
        sessionRef.current = id
        setSessionId(id)
        const buffered = bufferedRef.current.filter((ev) => ev.session === id)
        bufferedRef.current = []
        buffered.forEach(applyEvent)
      } catch (err) {
        setStatus("error")
        setError(errorText(err))
        pushLog("error", errorText(err))
      } finally {
        connectingRef.current = false
      }
    },
    [available, close, reset, applyEvent, pushLog],
  )

  const send = useCallback(
    async (text: string) => {
      const current = sessionRef.current
      if (!current) throw new Error("p2p_not_connected")
      const { invoke } = await import("@tauri-apps/api/core")
      await invoke("p2p_send", { session: current, text })
      setMessages((prev) => {
        const next = [...prev, { id: newLocalId(), from: "me" as const, text, ts: Date.now() }]
        return next.length > MAX_MESSAGES ? next.slice(next.length - MAX_MESSAGES) : next
      })
    },
    [],
  )

  // 卸载时关闭会话
  useEffect(() => {
    return () => {
      const current = sessionRef.current
      if (current && available) {
        import("@tauri-apps/api/core")
          .then(({ invoke }) => invoke("p2p_close", { session: current }))
          .catch(() => {})
      }
    }
  }, [available])

  return useMemo<PeerSession>(
    () => ({ sessionId, status, role, peer, code, error, log, messages, available, connect, send, close, reset }),
    [sessionId, status, role, peer, code, error, log, messages, available, connect, send, close, reset],
  )
}
