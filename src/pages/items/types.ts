export interface ItemEntry {
  id: string
  name: string
  internalName: string
  description: string
  itemType: string
  itemTypeKey: string
  category: string
  categoryKey: string
  icon?: string | null
  sellPrice: number
  edibility?: number | null
  canBeGivenAsGift: boolean
  canBeTrashed: boolean
}

export interface ItemGameData {
  encyclopedia: ItemEntry[]
  categories: string[]
  itemTypes: string[]
}

export interface LocalCacheEntry<T> {
  data: T
  fetchedAt: number
}

export const ITEM_GAME_DATA_CACHE_KEY = "stardew_item_game_data_cache"

export function normalizeGameDir(gameDir: string) {
  return gameDir.trim().toLowerCase()
}

export function readCache<T>(key: string): LocalCacheEntry<T> | null {
  if (typeof window === "undefined") return null

  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as LocalCacheEntry<T>
  } catch (error) {
    console.error(`Failed to read cache: ${key}`, error)
    return null
  }
}

export function writeCache<T>(key: string, data: T) {
  if (typeof window === "undefined") return

  try {
    const entry: LocalCacheEntry<T> = {
      data,
      fetchedAt: Date.now(),
    }
    window.localStorage.setItem(key, JSON.stringify(entry))
  } catch (error) {
    console.error(`Failed to write cache: ${key}`, error)
  }
}

export function getItemGameDataCacheKey(gameDir: string) {
  return `${ITEM_GAME_DATA_CACHE_KEY}:${normalizeGameDir(gameDir) || "default"}`
}
