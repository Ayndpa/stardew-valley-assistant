export type LogLevel = "info" | "warn" | "error"

export interface LogEntry {
  timestamp: number
  level: LogLevel
  message: string
}

type Listener = (entries: LogEntry[]) => void

const MAX_BUFFER_SIZE = 500
const FLUSH_INTERVAL = 5000 // 5 seconds
const MAX_FLUSH_BATCH = 100

let logBuffer: LogEntry[] = []
let pendingEntries: LogEntry[] = []
let listeners: Set<Listener> = new Set()
let originalConsole: {
  log: typeof console.log
  warn: typeof console.warn
  error: typeof console.error
} | null = null
let initialized = false

function notifyListeners() {
  for (const listener of listeners) {
    try {
      listener([...logBuffer])
    } catch {
      // Ignore listener errors
    }
  }
}

function addEntry(level: LogLevel, args: unknown[]) {
  const message = args
    .map((a) => {
      if (a instanceof Error) return `${a.message}\n${a.stack}`
      if (typeof a === "object") {
        try {
          return JSON.stringify(a, null, 2)
        } catch {
          return String(a)
        }
      }
      return String(a)
    })
    .join(" ")

  const entry: LogEntry = { timestamp: Date.now(), level, message }

  logBuffer.push(entry)
  if (logBuffer.length > MAX_BUFFER_SIZE) {
    logBuffer = logBuffer.slice(-MAX_BUFFER_SIZE)
  }

  pendingEntries.push(entry)

  notifyListeners()
}

async function flush() {
  if (pendingEntries.length === 0) return

  const batch = pendingEntries.splice(0, MAX_FLUSH_BATCH)
  if (batch.length === 0) return

  try {
    if (
      typeof window !== "undefined" &&
      !!(window as any).__TAURI_INTERNALS__
    ) {
      const { invoke } = await import("@tauri-apps/api/core")
      await invoke("write_log_entries", { entries: batch })
    }
  } catch {
    // Flush failed — entries are lost but in-memory buffer still works
  }
}

export function initLogger() {
  if (initialized) return
  initialized = true

  originalConsole = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  }

  console.log = (...args: unknown[]) => {
    originalConsole!.log(...args)
    addEntry("info", args)
  }

  console.warn = (...args: unknown[]) => {
    originalConsole!.warn(...args)
    addEntry("warn", args)
  }

  console.error = (...args: unknown[]) => {
    originalConsole!.error(...args)
    addEntry("error", args)
  }

  setInterval(flush, FLUSH_INTERVAL)
}

export function getLogs(): LogEntry[] {
  return [...logBuffer]
}

export function subscribeLogs(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export async function flushLogs(): Promise<void> {
  await flush()
}

export async function readLogFiles(): Promise<
  { name: string; content: string }[]
> {
  try {
    if (
      typeof window !== "undefined" &&
      !!(window as any).__TAURI_INTERNALS__
    ) {
      const { invoke } = await import("@tauri-apps/api/core")
      return await invoke("read_log_files")
    }
  } catch {
    // ignore
  }
  return []
}

export async function getLogDirPath(): Promise<string | null> {
  try {
    if (
      typeof window !== "undefined" &&
      !!(window as any).__TAURI_INTERNALS__
    ) {
      const { invoke } = await import("@tauri-apps/api/core")
      return await invoke("get_log_dir_path")
    }
  } catch {
    // ignore
  }
  return null
}

export async function clearLogFiles(): Promise<void> {
  if (
    typeof window !== "undefined" &&
    !!(window as any).__TAURI_INTERNALS__
  ) {
    const { invoke } = await import("@tauri-apps/api/core")
    await invoke("clear_log_files")
  }
  logBuffer = []
  notifyListeners()
}
