export interface CropLookup {
  name: string
  sellPrice: number
  regrows: boolean
  regrowDays?: number
  icon?: string | null
}

export interface PlantedCrop {
  location: string
  x: number
  y: number
  seedId: string
  harvestId: string
  currentPhase: number
  dayOfCurrentPhase: number
  fullyGrown: boolean
  dead: boolean
  isWatered: boolean
  phaseDays: number[]
}

export interface Crop {
  seedId?: string
  harvestId?: string
  internalName?: string
  name: string
  icon?: string | null
  season: string
  seasons?: string[]
  growDays: number
  sellPrice: number
  categoryKey?: string
  regrows: boolean
  regrowDays?: number
  needsWatering?: boolean
  waterNeeds: string
}

export interface CropGameData {
  encyclopedia: Crop[]
  lookup: Record<string, CropLookup>
  seasons: string[]
}

export interface LocalCacheEntry<T> {
  data: T
  fetchedAt: number
}

export type ProfitSortField = "dailyProfit" | "sellPrice" | "growDays" | "name"
export type ProfitSortDirection = "asc" | "desc"

export const locationMap: Record<string, string> = {
  Farm: "主要农场",
  Greenhouse: "温室大棚",
  IslandWest: "姜岛农场 (西)",
  IslandNorth: "姜岛农场 (北)",
  Forest: "煤矿森林",
}

export const CROP_GAME_DATA_CACHE_KEY = "stardew_crop_game_data_cache"
export const PLANTED_CROPS_CACHE_KEY = "stardew_planted_crops_cache"

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

export function getCropGameDataCacheKey(gameDir: string) {
  return `${CROP_GAME_DATA_CACHE_KEY}:${normalizeGameDir(gameDir) || "default"}`
}

export function getPlantedCropsCacheKey(saveId: string) {
  return `${PLANTED_CROPS_CACHE_KEY}:${saveId}`
}
