/**
 * 带指数退避重连的 WebSocket 封装（REALTIME.md §5）。
 * - 所有帧均为 JSON 文本；`pong` 在内部吞掉
 * - 每 25 秒发送一次应用层 `ping`
 * - 退避 1s → 30s（含少量抖动），成功打开后归零
 */

export interface RealtimeCloseInfo {
  code: number
  reason: string
  /** 本次连接是否曾成功打开（false 说明升级阶段就失败了，如 401/404/403/409） */
  everOpened: boolean
  /** 是否会自动重连 */
  willReconnect: boolean
}

export interface RealtimeSocketOptions {
  /** 返回连接地址；返回 null 表示当前不应连接 */
  url: () => string | null
  onFrame: (frame: { type: string } & Record<string, unknown>) => void
  onOpen?: () => void
  onClose?: (info: RealtimeCloseInfo) => void
  /** 默认 true */
  reconnect?: boolean
  /** 自定义"是否重连"判断；返回 false 则停止 */
  shouldReconnect?: (info: Omit<RealtimeCloseInfo, "willReconnect">) => boolean
  minDelayMs?: number
  maxDelayMs?: number
  pingIntervalMs?: number
}

export type RealtimeState = "idle" | "connecting" | "open" | "closed"

export class RealtimeSocket {
  private ws: WebSocket | null = null
  private attempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private disposed = false
  private everOpened = false
  private readonly opts: RealtimeSocketOptions

  state: RealtimeState = "idle"

  constructor(opts: RealtimeSocketOptions) {
    this.opts = opts
  }

  /** 建立连接（重复调用无副作用） */
  connect(): void {
    if (this.disposed) return
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return
    this.clearReconnectTimer()

    const url = this.opts.url()
    if (!url) {
      this.state = "idle"
      return
    }

    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch (err) {
      console.error("[realtime] failed to construct WebSocket:", err)
      this.scheduleReconnect({ code: 1006, reason: "construct_failed", everOpened: false })
      return
    }

    this.ws = ws
    this.everOpened = false
    this.state = "connecting"

    ws.onopen = () => {
      if (this.ws !== ws) return
      this.everOpened = true
      this.attempt = 0
      this.state = "open"
      this.startPing()
      this.opts.onOpen?.()
    }

    ws.onmessage = (ev) => {
      if (this.ws !== ws) return
      if (typeof ev.data !== "string") return
      let frame: unknown
      try {
        frame = JSON.parse(ev.data)
      } catch {
        return
      }
      if (!frame || typeof frame !== "object" || typeof (frame as { type?: unknown }).type !== "string") return
      const typed = frame as { type: string } & Record<string, unknown>
      if (typed.type === "pong") return
      this.opts.onFrame(typed)
    }

    ws.onerror = () => {
      // 浏览器不暴露错误详情；close 事件会紧随其后
    }

    ws.onclose = (ev) => {
      if (this.ws !== ws) return
      this.ws = null
      this.stopPing()
      this.state = "closed"
      this.scheduleReconnect({ code: ev.code, reason: ev.reason, everOpened: this.everOpened })
    }
  }

  /** 发送一帧；未连接时返回 false */
  send(frame: { type: string } & Record<string, unknown>): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false
    try {
      this.ws.send(JSON.stringify(frame))
      return true
    } catch (err) {
      console.error("[realtime] send failed:", err)
      return false
    }
  }

  get isOpen(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN
  }

  /** 主动关闭并停止重连 */
  close(code = 1000, reason = "client_close"): void {
    this.disposed = true
    this.clearReconnectTimer()
    this.stopPing()
    const ws = this.ws
    this.ws = null
    this.state = "closed"
    if (ws) {
      ws.onopen = null
      ws.onmessage = null
      ws.onerror = null
      ws.onclose = null
      try {
        ws.close(code, reason)
      } catch {
        // 已经关闭
      }
    }
  }

  private scheduleReconnect(info: Omit<RealtimeCloseInfo, "willReconnect">): void {
    if (this.disposed) {
      this.opts.onClose?.({ ...info, willReconnect: false })
      return
    }
    const allowed = (this.opts.reconnect ?? true) && (this.opts.shouldReconnect ? this.opts.shouldReconnect(info) : true)
    this.opts.onClose?.({ ...info, willReconnect: allowed })
    if (!allowed) {
      this.disposed = true
      return
    }
    const min = this.opts.minDelayMs ?? 1000
    const max = this.opts.maxDelayMs ?? 30000
    const base = Math.min(max, min * Math.pow(2, this.attempt))
    const jitter = base * 0.2 * Math.random()
    const delay = Math.min(max, base + jitter)
    this.attempt += 1
    this.clearReconnectTimer()
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private startPing(): void {
    this.stopPing()
    const interval = this.opts.pingIntervalMs ?? 25000
    this.pingTimer = setInterval(() => {
      this.send({ type: "ping" })
    }, interval)
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
  }
}
