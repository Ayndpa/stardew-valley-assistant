export interface FishingTile {
  x: number
  y: number
  depth: number
  hidden: boolean
}

export interface FishingMapSummary {
  id: string
  name: string
  relativePath: string
  width: number
  height: number
  waterTiles: number
  fishableTiles: number
  maxDepth: number
}

export interface FishingMapDetail extends FishingMapSummary {
  tiles: FishingTile[]
  fishingAreas: FishingArea[]
  mapImageDataUrl?: string | null
  mapImageError?: string | null
  cached: boolean
}

export interface FishingMapData {
  maps: FishingMapSummary[]
  cached: boolean
}

export interface FishingAreaFish {
  id: string
  name: string
  description: string
  icon?: string | null
  seasons: string[]
  timeRanges: [number, number][]
  weather: string
  minLevel: number
  isTrap: boolean
  price: number
  priceSource: string
  minDistanceFromShore: number
  maxDistanceFromShore: number
}

export interface FishingArea {
  id: string
  name: string
  x?: number | null
  y?: number | null
  width?: number | null
  height?: number | null
  fish: FishingAreaFish[]
}

export interface TileRun {
  x: number
  y: number
  width: number
  depth: number
  hidden: boolean
}

export interface SelectedFishingInfo {
  tile: FishingTile
  area: FishingArea | null
  tileX: number
  tileY: number
}

export interface NpcSchedulePoint {
  time: number
  location: string
  locationDisplayName: string
  tileX: number
  tileY: number
  direction: number
}

export interface NpcLocationInfo {
  npcName: string
  location: string
  locationDisplayName: string
  tileX?: number | null
  tileY?: number | null
  direction?: number | null
  scheduleKey?: string | null
  scheduleTime?: number | null
  source: string
  confidence: string
  updatedAt?: string | null
}
