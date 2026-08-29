export interface AnimalProduceInfo {
  itemId: string
  name: string
}

export interface AnimalEncyclopediaEntry {
  id: string
  name: string
  house: string
  houseDisplay: string
  purchasePrice: number
  sellPrice: number
  daysToMature: number
  daysToProduce: number
  canGetPregnant: boolean
  harvestType: string
  harvestTool: string
  produceItems: AnimalProduceInfo[]
  deluxeProduceItems: AnimalProduceInfo[]
  deluxeProduceMinFriendship: number
  canSwim: boolean
  canEatGoldenCrackers: boolean
  icon: string | null
}

export interface AnimalGameData {
  encyclopedia: AnimalEncyclopediaEntry[]
  houses: string[]
  dataSource: "export" | "xnb"
  generatedAt?: string | null
}

export interface OwnedAnimal {
  id: number
  name: string
  typeName: string
  age: number
  isBaby: boolean
  friendship: number
  happiness: number
  moodMessage: string
  fullness: number
  wasPet: boolean
  homeBuilding: string
  produceItem: string | null
  daysSinceLastLay: number
}

export interface LocalCacheEntry<T> {
  data: T
  fetchedAt: number
}

export const ANIMAL_GAME_DATA_CACHE_KEY = "stardew_animal_game_data_cache"
export const SAVE_ANIMALS_CACHE_KEY = "stardew_save_animals_cache"

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

export function getAnimalGameDataCacheKey(gameDir: string, lang: string) {
  return `${ANIMAL_GAME_DATA_CACHE_KEY}:${normalizeGameDir(gameDir) || "default"}:${lang}`
}

export function getSaveAnimalsCacheKey(saveId: string) {
  return `${SAVE_ANIMALS_CACHE_KEY}:${saveId}`
}
