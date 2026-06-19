import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"

// Re-export types used by widgets
export interface SaveSummary {
  id: string
  playerName: string
  farmName: string
  money: number
  totalMoneyEarned: number
  dayOfMonth: number
  season: number // 0: Spring, 1: Summer, 2: Fall, 3: Winter
  year: number
  farmingLevel: number
  miningLevel: number
  combatLevel: number
  foragingLevel: number
  fishingLevel: number
  deepestMineLevel: number
  millisecondsPlayed: number
  lastSaveTime: number
}

export interface FriendshipInfo {
  npcName: string
  points: number
  giftsThisWeek: number
  giftsToday: number
  talkedToToday: boolean
  status: string
}

export interface MonsterKillInfo {
  name: string
  count: number
}

export interface SaveDetail {
  summary: SaveSummary
  weatherToday: string
  weatherTomorrow: string
  museumPiecesCount: number
  museumPieces: string[]
  friendships: FriendshipInfo[]
  shippedItems: string[]
  fishCaught: string[]
  cookingRecipes: string[]
  craftingRecipes: string[]
  recipesCooked: string[]
  secretNotesSeen: number[]
  songsHeard: string[]
  mailReceived: string[]
  maxStamina: number
  specificMonstersKilled: MonsterKillInfo[]
  goldenWalnutsFound: number
}

/**
 * Grid size presets in react-grid-layout units (12-column grid).
 */
export type WidgetSize = "small" | "medium" | "large" | "full" | "wide" | "tall"

export interface WidgetSizeConfig {
  w: number
  h: number
  minW?: number
  minH?: number
  maxW?: number
  maxH?: number
}

export const WIDGET_SIZE_PRESETS: Record<WidgetSize, WidgetSizeConfig> = {
  small:  { w: 3, h: 2, minW: 2, minH: 2 },
  medium: { w: 6, h: 3, minW: 3, minH: 2 },
  large:  { w: 6, h: 4, minW: 4, minH: 3 },
  full:   { w: 12, h: 3, minW: 6, minH: 2 },
  wide:   { w: 8, h: 3, minW: 4, minH: 2 },
  tall:   { w: 4, h: 4, minW: 3, minH: 3 },
}

/**
 * Static metadata + render function for a widget type.
 */
export interface WidgetDefinition {
  id: string
  nameKey: string
  descriptionKey: string
  icon: LucideIcon
  defaultSize: WidgetSize
  removable?: boolean
  category: "stats" | "weather" | "progress" | "info" | "social" | "time"
  render: (props: WidgetRenderProps) => ReactNode
}

/** Context passed to every widget's render function */
export interface WidgetRenderProps {
  selectedSaveId: string
  saveDetail: SaveDetail | null
  isLoading: boolean
  itemEntries: import("../items/types").ItemEntry[] | null
  config: Record<string, unknown>
  isEditMode: boolean
}

/**
 * A placed widget instance on the dashboard. Persisted in localStorage.
 */
export interface WidgetInstance {
  instanceId: string
  widgetId: string
  layout: {
    x: number
    y: number
    w: number
    h: number
    minW?: number
    minH?: number
    maxW?: number
    maxH?: number
  }
  config?: Record<string, unknown>
}

/**
 * The full persisted dashboard layout.
 */
export interface DashboardLayout {
  version: number
  widgets: WidgetInstance[]
}
