export interface FishConditions {
  seasons: string[]
  timeRanges: [number, number][]
  weather: string
  minLevel: number
  isTrap: boolean
  locations: string[]
}

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
  recipeSources: string[]
  fishConditions?: FishConditions | null
}

export interface ItemGameData {
  encyclopedia: ItemEntry[]
  categories: string[]
  itemTypes: string[]
}

export interface ItemGameDataOverview {
  categories: string[]
  itemTypes: string[]
  totalCount: number
}

export interface ItemGameDataQueryResult {
  items: ItemEntry[]
  totalCount: number
  page: number
  pageSize: number
}

export interface LocalCacheEntry<T> {
  data: T
  fetchedAt: number
}

export const ITEM_GAME_DATA_CACHE_KEY = "stardew_item_game_data_overview_cache_v2"

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

export function getItemGameDataCacheKey(gameDir: string, lang: string) {
  return `${ITEM_GAME_DATA_CACHE_KEY}:${normalizeGameDir(gameDir) || "default"}:${lang}`
}
