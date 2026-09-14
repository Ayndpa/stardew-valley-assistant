// 火山地牢宝箱 / 龙牙掉落逻辑。
// 参考实现：https://github.com/trillllian/sdv-volcano/blob/main/src/loot.rs

import { DotnetRng } from "./rng"

export type Enchant =
  | "Defense"
  | "Weight"
  | "SlimeGatherer"
  | "SlimeSlayer"
  | "CritPower"
  | "CritChance"
  | "Attack"
  | "Speed"

export const ENCHANT_NAMES: Record<Enchant, string> = {
  Defense: "Defense",
  Weight: "Weight",
  SlimeGatherer: "Slime Gatherer",
  SlimeSlayer: "Slime Slayer",
  CritPower: "Crit. Power",
  CritChance: "Crit. Chance",
  Attack: "Attack",
  Speed: "Speed",
}

export interface EnchantEntry {
  enchant: Enchant
  /** 界面上显示的数字，不是内部等级（暴击威力是 25-75，重量为负） */
  level: number
}

export type Enchants = EnchantEntry[]

export function formatEnchants(enchants: Enchants): string {
  if (!enchants.length) return ""
  const parts = enchants.map(({ enchant, level }) => {
    const num = level !== 0 ? `${level > 0 ? "+" : ""}${level} ` : ""
    return `${num}${ENCHANT_NAMES[enchant]}`
  })
  return ` (${parts.join(", ")})`
}

export type ChestItemKind =
  | "CinderShards3"
  | "GoldenCoconut"
  | "TaroTuber"
  | "PineappleSeeds"
  | "ProtectionRing"
  | "SoulSapperRing"
  | "DwarfSword"
  | "DwarfHammer"
  | "DwarfDagger"
  | "CinderShards10"
  | "MermaidBoots"
  | "DragonscaleBoots"
  | "GoldenCoconuts"
  | "PhoenixRing"
  | "HotJavaRing"
  | "DragontoothCutlass"
  | "DragontoothClub"
  | "DragontoothShiv"
  | "DeluxePirateHat"
  | "OstrichEgg"

export interface ChestItem {
  kind: ChestItemKind
  enchants?: Enchants
}

const CHEST_ITEM_LABELS: Record<ChestItemKind, string> = {
  CinderShards3: "Cinder Shard (3)",
  GoldenCoconut: "Golden Coconut",
  TaroTuber: "Taro Tuber (8)",
  PineappleSeeds: "Pineapple Seeds (5)",
  ProtectionRing: "Protection Ring",
  SoulSapperRing: "Soul Sapper Ring",
  DwarfSword: "Dwarf Sword",
  DwarfHammer: "Dwarf Hammer",
  DwarfDagger: "Dwarf Dagger",
  CinderShards10: "Cinder Shard (10)",
  MermaidBoots: "Mermaid Boots",
  DragonscaleBoots: "Dragonscale Boots",
  GoldenCoconuts: "Golden Coconut (3)",
  PhoenixRing: "Phoenix Ring",
  HotJavaRing: "Hot Java Ring",
  DragontoothCutlass: "Dragontooth Cutlass",
  DragontoothClub: "Dragontooth Club",
  DragontoothShiv: "Dragontooth Shiv",
  DeluxePirateHat: "Deluxe Pirate Hat",
  OstrichEgg: "Ostrich Egg",
}

const CHEST_ITEM_ICONS: Record<ChestItemKind, string> = {
  CinderShards3: "cinder_shard",
  GoldenCoconut: "golden_coconut",
  TaroTuber: "taro_tuber",
  PineappleSeeds: "pineapple_seeds",
  ProtectionRing: "protection_ring",
  SoulSapperRing: "soul_sapper_ring",
  DwarfSword: "dwarf_sword",
  DwarfHammer: "dwarf_hammer",
  DwarfDagger: "dwarf_dagger",
  CinderShards10: "cinder_shard",
  MermaidBoots: "mermaid_boots",
  DragonscaleBoots: "dragonscale_boots",
  GoldenCoconuts: "golden_coconut",
  PhoenixRing: "phoenix_ring",
  HotJavaRing: "hot_java_ring",
  DragontoothCutlass: "dragontooth_cutlass",
  DragontoothClub: "dragontooth_club",
  DragontoothShiv: "dragontooth_shiv",
  DeluxePirateHat: "deluxe_pirate_hat",
  OstrichEgg: "ostrich_egg",
}

export function chestItemLabel(item: ChestItem): string {
  const base = CHEST_ITEM_LABELS[item.kind]
  return item.enchants?.length ? `${base}${formatEnchants(item.enchants)}` : base
}

export function chestItemIcon(item: ChestItem): string {
  return CHEST_ITEM_ICONS[item.kind]
}

/** 用于比较两个掉落物是否相同 */
export function chestItemKey(item: ChestItem): string {
  return item.enchants?.length
    ? `${item.kind}${formatEnchants(item.enchants)}`
    : item.kind
}

export type Goodie =
  | { type: "DragonTooth" }
  | { type: "CommonChest"; item: ChestItem }
  | { type: "RareChest"; item: ChestItem }
  | { type: "ChanceChest"; minLuck: number; common: ChestItem; rare: ChestItem }

export function goodieKey(g: Goodie): string {
  switch (g.type) {
    case "DragonTooth":
      return "DragonTooth"
    case "CommonChest":
      return `common:${chestItemKey(g.item)}`
    case "RareChest":
      return `rare:${chestItemKey(g.item)}`
    case "ChanceChest":
      return `chance:${g.minLuck}:${chestItemKey(g.common)}:${chestItemKey(g.rare)}`
  }
}

/** 给武器随机附魔，对应 MeleeWeapon.attemptAddRandomInnateEnchantment */
function enchantItem(rng: DotnetRng, weaponLevel: number, weaponSpeed: number): Enchants {
  const enchants: Enchants = []
  if (rng.nextDouble() < 0.5) {
    if (rng.nextDouble() < 0.125 && weaponLevel <= 10) {
      const level = Math.min(Math.floor(rng.nextRange(weaponLevel + 1) / 2) + 1, 2)
      enchants.push({ enchant: "Defense", level: Math.max(level, 1) })
    } else if (rng.nextDouble() < 0.125) {
      enchants.push({ enchant: "Weight", level: -(1 + rng.nextRange(5)) })
    } else if (rng.nextDouble() < 0.125) {
      enchants.push({ enchant: "SlimeGatherer", level: 0 })
    }

    // 只命中一个分支，所以这里只有一次额外的随机数消耗
    switch (rng.nextRange(5)) {
      case 0: {
        const level = clamp(Math.floor(rng.nextRange(weaponLevel + 1) / 2) + 1, 1, 5)
        enchants.push({ enchant: "Attack", level })
        break
      }
      case 1: {
        const level = clamp(Math.floor(rng.nextRange(weaponLevel) / 3), 1, 3)
        enchants.push({ enchant: "CritChance", level })
        break
      }
      case 2: {
        const level = clamp(rng.nextRange(weaponLevel), 1, Math.max(1, 4 - weaponSpeed))
        enchants.push({ enchant: "Speed", level })
        break
      }
      case 3:
        enchants.push({ enchant: "SlimeSlayer", level: 0 })
        break
      default: {
        const level = clamp(Math.floor(rng.nextRange(weaponLevel) / 3), 1, 3) * 25
        enchants.push({ enchant: "CritPower", level })
        break
      }
    }
  }
  return enchants
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(Math.max(v, lo), hi)
}

// ---------------------------------------------------------------- 生成

export function generateCommonChest(seed: number, crackedGoldenCoconut: boolean): ChestItem {
  const rng = new DotnetRng(seed)
  rng.next() // 这次 roll 用于普通/稀有判定
  let ind: number
  for (;;) {
    ind = rng.nextRange(7)
    if (ind === 1 && !crackedGoldenCoconut) continue
    break
  }
  switch (ind) {
    case 0:
      return { kind: "CinderShards3" }
    case 1:
      return { kind: "GoldenCoconut" }
    case 2:
      return { kind: "TaroTuber" }
    case 3:
      return { kind: "PineappleSeeds" }
    case 4:
      return { kind: "ProtectionRing" }
    case 5:
      return { kind: "SoulSapperRing" }
    case 6:
      switch (rng.nextRange(3)) {
        case 0:
          return { kind: "DwarfSword", enchants: enchantItem(rng, 13, 4) }
        case 1:
          return { kind: "DwarfHammer", enchants: enchantItem(rng, 13, -8) }
        default:
          return { kind: "DwarfDagger", enchants: enchantItem(rng, 11, 3) }
      }
    default:
      throw new Error("unreachable")
  }
}

export function generateRareChest(seed: number, crackedGoldenCoconut: boolean): ChestItem {
  const rng = new DotnetRng(seed)
  rng.next() // 这次 roll 用于普通/稀有判定
  let ind: number
  for (;;) {
    ind = rng.nextRange(9)
    if (ind === 3 && !crackedGoldenCoconut) continue
    break
  }
  switch (ind) {
    case 0:
      return { kind: "CinderShards10" }
    case 1:
      return { kind: "MermaidBoots" }
    case 2:
      return { kind: "DragonscaleBoots" }
    case 3:
      return { kind: "GoldenCoconuts" }
    case 4:
      return { kind: "PhoenixRing" }
    case 5:
      return { kind: "HotJavaRing" }
    case 6:
      switch (rng.nextRange(3)) {
        case 0:
          return { kind: "DragontoothCutlass", enchants: enchantItem(rng, 13, 0) }
        case 1:
          return { kind: "DragontoothClub", enchants: enchantItem(rng, 14, -8) }
        default:
          return { kind: "DragontoothShiv", enchants: enchantItem(rng, 12, 0) }
      }
    case 7:
      return { kind: "DeluxePirateHat" }
    default:
      return { kind: "OstrichEgg" }
  }
}

export interface LootSettings {
  crackedGoldenCoconut: boolean
}

export function generateGoodie(
  chestSeed: number,
  settings: LootSettings,
  level: number,
  minLuck: number,
  maxLuck: number,
): Goodie {
  const chestRng = new DotnetRng(chestSeed)
  // 判定：roll < (0.1 或 0.5) + 幸运加成，等价于下面这行
  const chestRoll = chestRng.nextDouble() - (level === 9 ? 0.5 : 0.1) + 1
  if (chestRoll < minLuck) {
    return {
      type: "RareChest",
      item: generateRareChest(chestSeed, settings.crackedGoldenCoconut),
    }
  }
  if (chestRoll >= maxLuck) {
    return {
      type: "CommonChest",
      item: generateCommonChest(chestSeed, settings.crackedGoldenCoconut),
    }
  }
  return {
    type: "ChanceChest",
    minLuck: chestRoll,
    common: generateCommonChest(chestSeed, settings.crackedGoldenCoconut),
    rare: generateRareChest(chestSeed, settings.crackedGoldenCoconut),
  }
}
