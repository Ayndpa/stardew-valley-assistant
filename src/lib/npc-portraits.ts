// NPC 头像的共享缓存。
//
// 头像由 Rust 侧从 XNB 图集解压并重新编码 PNG，48 张首次渲染需要一秒以上，
// 因此村民关系页与游戏地图页必须共用同一份结果，而不是各自去取。
//
// 缓存放在 IndexedDB 而非 localStorage：整份数据约 300 KB 的 base64，
// localStorage 的读写会同步阻塞主线程，且有 5 MB 硬上限。

const DB_NAME = "stardew-assistant-cache"
const DB_VERSION = 1
const STORE = "npc-portraits"
const LEGACY_KEY_PREFIX = "stardew_npc_portraits_cache"

export type NpcPortraits = Record<string, string>

const memoryCache = new Map<string, NpcPortraits>()
const inflight = new Map<string, Promise<NpcPortraits>>()

function cacheKey(gameDir: string, npcIds: string[]) {
  const dir = gameDir.trim().toLowerCase() || "default"
  return `${dir}:${[...npcIds].sort().join(",")}`
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null)
      return
    }
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION)
    } catch {
      resolve(null)
      return
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })
}

async function dbGet(key: string): Promise<NpcPortraits | null> {
  const db = await openDb()
  if (!db) return null
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key)
      req.onsuccess = () => resolve((req.result as NpcPortraits) ?? null)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    } finally {
      db.close()
    }
  })
}

async function dbPut(key: string, value: NpcPortraits): Promise<void> {
  const db = await openDb()
  if (!db) return
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite")
      // 头像列表随游戏语言/模组变化会产生新 key，只保留最近一份，避免无限增长。
      tx.objectStore(STORE).clear()
      tx.objectStore(STORE).put(value, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    } catch {
      resolve()
    } finally {
      db.close()
    }
  })
}

/** 清理旧版本遗留在 localStorage 里的 base64 头像缓存。 */
function purgeLegacyCache() {
  if (typeof localStorage === "undefined") return
  try {
    const stale: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(LEGACY_KEY_PREFIX)) stale.push(key)
    }
    for (const key of stale) localStorage.removeItem(key)
  } catch {
    // 忽略：清理失败不影响功能
  }
}

let legacyPurged = false

/**
 * 取得指定 NPC 的头像。内存 → IndexedDB → Rust 命令逐层回退，
 * 并对并发调用做去重，保证同一批头像只渲染一次。
 */
export async function loadNpcPortraits(
  npcIds: string[],
  gameDir: string,
): Promise<NpcPortraits> {
  if (typeof window === "undefined" || !(window as any).__TAURI_INTERNALS__) return {}
  if (npcIds.length === 0) return {}

  if (!legacyPurged) {
    legacyPurged = true
    purgeLegacyCache()
  }

  const key = cacheKey(gameDir, npcIds)

  const inMemory = memoryCache.get(key)
  if (inMemory) return inMemory

  const pending = inflight.get(key)
  if (pending) return pending

  const task = (async () => {
    const stored = await dbGet(key)
    if (stored) {
      memoryCache.set(key, stored)
      return stored
    }

    const { invoke } = await import("@tauri-apps/api/core")
    const portraits = await invoke<NpcPortraits>("get_npc_portraits", {
      npcIds,
      gameDir: gameDir.trim() || undefined,
    })
    memoryCache.set(key, portraits)
    void dbPut(key, portraits)
    return portraits
  })()

  inflight.set(key, task)
  try {
    return await task
  } finally {
    inflight.delete(key)
  }
}
