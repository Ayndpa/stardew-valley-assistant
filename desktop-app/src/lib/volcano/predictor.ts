// 火山地牢（姜岛火山）10 层布局与掉落预测。
// 参考实现：https://github.com/trillllian/sdv-volcano/blob/main/src/lib.rs
//
// 核心思路：地牢的每一层布局由 (天数 × 层号, 层号 × 5152, 种子/2) 混出的种子决定，
// 其中「是否刷特殊层」这一步依赖每日幸运值。与其让用户填幸运值，不如把可能的幸运
// 区间二分细分，把每种可能的布局组合都算出来，再标注出每种结果对应的幸运区间。

import { DotnetRng, nextUp, stardewSeedMix } from "./rng"
import {
  generateGoodie,
  goodieKey,
  type ChestItem,
  type Goodie,
} from "./loot"
import {
  SetPieceFeature,
  VolcanoTile,
  getVolcanoLayoutData,
} from "./layout-store"

export interface VolcanoSettings {
  /** 存档种子，游戏内 / 存档文件里的 uniqueIDForThisGame */
  seed: number
  /** 1.5 及更早的随机数（legacy rng） */
  legacyRng: boolean
  /** 1.6.4 及以上（层号参与种子计算的方式有变化，且开放火山口布局） */
  post164: boolean
  /** 是否已抵达火山口（1.6.4 起会多出 20 套布局） */
  hasCaldera: boolean
  /** 是否已砸开过金椰子（未砸开则宝箱不会出金椰子） */
  crackedGoldenCoconut: boolean
  /** 是否拥有特殊护符（每日幸运 +0.025） */
  specialCharm: boolean
  /** 累计游玩天数，春季 1 日为 1 */
  daysPlayed: number
  /** 幸运 buff 等级上限（0-3） */
  maxLuckLevel: number
}

/** 一个 (区间下限, 区间上限, 值) 三元组，区间是闭区间 */
export type ProbabilityRange<T> = Array<{ minLuck: number; maxLuck: number; value: T }>

export interface VolcanoPrediction {
  /** 每层可能的布局编号 */
  layouts: ProbabilityRange<number>[]
  /** 每层可能的掉落 */
  loots: ProbabilityRange<Goodie[]>[]
}

// ---------------------------------------------------------------- 布局生成

interface LayoutBranch {
  minLuck: number
  maxLuck: number
  levels: number[]
}

function levelModifier(settings: VolcanoSettings, level: number): number {
  return settings.post164 ? level + 1 : level
}

function floorSeed(settings: VolcanoSettings, level: number): number {
  const lvlMod = levelModifier(settings, level)
  return stardewSeedMix(settings.legacyRng, [
    // Rust 里是 u32 乘法，会回绕
    Math.imul(settings.daysPlayed, lvlMod) >>> 0,
    level * 5152,
    Math.trunc(settings.seed / 2),
  ])
}

export function isMushroomFloor(layout: number): boolean {
  return layout >= 32 && layout <= 34
}

export function isMonsterFloor(layout: number): boolean {
  return layout >= 35 && layout <= 37
}

function computeInner(
  settings: VolcanoSettings,
  prev: number[],
  minLuck: number,
  maxLuck: number,
): LayoutBranch[] {
  const level = prev.length
  const genSeed = floorSeed(settings, level)
  const levels = prev.slice()

  if (level === 0) {
    levels.push(0)
    return computeInner(settings, levels, minLuck, maxLuck)
  }
  if (level === 5) {
    levels.push(31)
    return computeInner(settings, levels, minLuck, maxLuck)
  }
  if (level === 9) {
    levels.push(30)
    return [{ minLuck, maxLuck, levels }]
  }

  const validLayouts: number[] = []
  for (let i = 1; i < 30; i++) validLayouts.push(i)
  const layoutRandom = new DotnetRng(stardewSeedMix(settings.legacyRng, [genSeed]))

  if (level > 1) {
    const specialRoll = layoutRandom.nextDouble()
    // 只要之前没有出现过特殊层，就可能再刷一次特殊层
    const specialPossible = prev.every((x) => x < 32)
    if (specialPossible) {
      if (specialRoll < minLuck * 0.5) {
        // 最差运气也一定会出特殊层
        for (let i = 32; i < 38; i++) validLayouts.push(i)
      } else if (!(specialRoll < maxLuck * 0.5)) {
        // 最好运气也不会出特殊层
      } else {
        // 落在区间中间，需要把幸运区间一分为二分别计算
        const midpoint = specialRoll / 0.5
        const first = computeInner(settings, prev, minLuck, midpoint)
        const second = computeInner(settings, prev, nextUp(midpoint), maxLuck)
        return first.concat(second)
      }
    }
  }

  if (level > 0 && settings.post164 && settings.hasCaldera) {
    if (layoutRandom.nextDouble() < 0.75) {
      for (let i = 38; i < 58; i++) validLayouts.push(i)
    }
  }

  // 不能连着两层用同一套布局
  const prevLevel = prev[level - 1]
  const dup = validLayouts.indexOf(prevLevel)
  if (dup !== -1) validLayouts.splice(dup, 1)

  levels.push(validLayouts[layoutRandom.nextRange(validLayouts.length)])
  return computeInner(settings, levels, minLuck, maxLuck)
}

export function computeVolcanoLayouts(settings: VolcanoSettings): LayoutBranch[] {
  // 下面这些值严格来说因为浮点舍入并不精确（特殊护符尤其明显），
  // 但展示时只保留 4 位有效数字，足够用了。
  let minLuck = -0.1
  let baseMaxLuck = 0.1
  if (settings.specialCharm) {
    minLuck += 0.025
    baseMaxLuck += 0.025
  }
  // 内部一律用 luckMult，luckMult = 1 + 幸运等级 × 0.035 + 每日幸运 / 2
  return computeInner(
    settings,
    [],
    1 + minLuck / 2,
    1 + baseMaxLuck / 2 + 0.035 * settings.maxLuckLevel,
  )
}

// ---------------------------------------------------------------- 单层掉落

function getLayouts(): Uint8Array[] {
  return getVolcanoLayoutData().layouts
}

class DungeonFloorState {
  private rng: DotnetRng
  private map: Uint8Array
  private setPieces: Array<{ x: number; y: number; size: number }> = []
  private readonly settings: VolcanoSettings
  private readonly level: number
  private readonly minLuck: number
  private readonly maxLuck: number

  constructor(settings: VolcanoSettings, level: number, layoutId: number, minLuck: number, maxLuck: number) {
    this.settings = settings
    this.level = level
    this.minLuck = minLuck
    this.maxLuck = maxLuck
    const genSeed = floorSeed(settings, level)
    const genRandom = new DotnetRng(stardewSeedMix(settings.legacyRng, [genSeed]))
    genRandom.next()
    let flipX = genRandom.nextRange(2) === 1
    if (layoutId === 0 || layoutId === 31) flipX = false

    this.rng = genRandom
    const source = getLayouts()[layoutId]
    this.map = new Uint8Array(64 * 64)
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        this.map[y * 64 + x] = source[y * 64 + (flipX ? 63 - x : x)]
      }
    }
  }

  getMap(): Uint8Array {
    return this.map
  }

  /** 地砖随机（结果用不到，但必须消耗掉，否则后面全部对不上）。
   *  注意阈值是 `0.3_f32 as f64`，不能直接写 0.3。 */
  private loadMapTiles() {
    const threshold = Math.fround(0.3)
    for (let x = 0; x < 64; x++) {
      for (let y = 0; y < 64; y++) {
        if (this.rng.nextDouble() < threshold) {
          this.rng.next()
          this.rng.next()
        }
      }
    }
  }

  loadMap(): Goodie[] {
    this.loadMapTiles()
    return this.loadSetPieces()
  }

  private loadSetPieces(): Goodie[] {
    // 越界返回 -1：原实现用的是二维数组索引，越界会 panic，而扁平索引会“绕行”到下一行
    const at = (x: number, y: number) =>
      x < 0 || y < 0 || x >= 64 || y >= 64 ? -1 : this.map[y * 64 + x]
    const set = (x: number, y: number, v: number) => {
      if (x < 0 || y < 0 || x >= 64 || y >= 64) return
      this.map[y * 64 + x] = v
    }

    for (let x = 0; x < 64; x++) {
      for (let y = 0; y < 64; y++) {
        if (at(x, y) !== VolcanoTile.SetPiece) continue
        let j = 0
        while (
          j < 64 &&
          at(x + j, y) === VolcanoTile.SetPiece &&
          at(x, y + j) === VolcanoTile.SetPiece
        ) {
          j++
        }
        for (let yy = y; yy < y + j; yy++) {
          for (let xx = x; xx < x + j; xx++) set(xx, yy, VolcanoTile.Floor)
        }
        const realJ = j >= 32 ? 32 : j >= 16 ? 16 : j >= 8 ? 8 : j >= 4 ? 4 : 3
        this.setPieces.push({ x, y, size: realJ })
      }
    }

    // 识别完再把 set piece 区域标回去，渲染地图时才能显示
    for (const { x, y, size } of this.setPieces) {
      for (let yy = y; yy < y + size; yy++) {
        for (let xx = x; xx < x + size; xx++) set(xx, yy, VolcanoTile.SetPiece)
      }
    }

    const { pieceSizes, pieceEvents } = getVolcanoLayoutData()
    const goodies: Goodie[] = []
    for (const { size } of this.setPieces) {
      const [numRows, numCols] = pieceSizes.get(size) ?? [0, 0]
      const selectedCol = this.rng.nextRange(numCols)
      const selectedRow = this.rng.nextRange(numRows)
      const events = pieceEvents.get(`${size}|${selectedRow}|${selectedCol}`) ?? []
      for (const ev of events) {
        if (ev === SetPieceFeature.Rng) {
          this.rng.next()
        } else if (ev === SetPieceFeature.Tooth) {
          if (this.rng.nextDouble() < 0.5) goodies.push({ type: "DragonTooth" })
        } else {
          const chestSeed = stardewSeedMix(this.settings.legacyRng, [this.rng.next()])
          goodies.push(
            generateGoodie(chestSeed, this.settings, this.level, this.minLuck, this.maxLuck),
          )
        }
      }
    }
    return goodies
  }
}

// ---------------------------------------------------------------- 主流程

export function predictVolcano(settings: VolcanoSettings): VolcanoPrediction {
  const layoutsPoss: ProbabilityRange<number>[] = Array.from({ length: 10 }, () => [])
  const lootsPoss: ProbabilityRange<Goodie[]>[] = Array.from({ length: 10 }, () => [])

  for (const branch of computeVolcanoLayouts(settings)) {
    const { minLuck, maxLuck, levels } = branch
    levels.forEach((layout, i) => {
      // 合并幸运区间上相邻的相同结果
      const lastLayout = layoutsPoss[i][layoutsPoss[i].length - 1]
      if (lastLayout && lastLayout.value === layout && nextUp(lastLayout.maxLuck) === minLuck) {
        lastLayout.maxLuck = maxLuck
      } else {
        layoutsPoss[i].push({ minLuck, maxLuck, value: layout })
      }

      const floor = new DungeonFloorState(settings, i, layout, minLuck, maxLuck)
      const loot = floor.loadMap()
      handleLoot(minLuck, maxLuck, loot, lootsPoss[i])
    })
  }

  return { layouts: layoutsPoss, loots: lootsPoss }
}

/** 把「看运气」的宝箱拆成普通 / 稀有两条分支，各自缩小幸运区间 */
function handleLoot(
  minLuck: number,
  maxLuck: number,
  loot: Goodie[],
  out: ProbabilityRange<Goodie[]>,
) {
  const chanceIndex = loot.findIndex((g) => g.type === "ChanceChest")
  if (chanceIndex !== -1) {
    const chance = loot[chanceIndex] as Extract<Goodie, { type: "ChanceChest" }>
    if (chance.minLuck >= minLuck) {
      const alt = loot.slice()
      alt[chanceIndex] = { type: "CommonChest", item: chance.common }
      handleLoot(minLuck, Math.min(chance.minLuck, maxLuck), alt, out)
    }
    if (chance.minLuck < maxLuck) {
      const alt = loot.slice()
      alt[chanceIndex] = { type: "RareChest", item: chance.rare }
      handleLoot(Math.max(nextUp(chance.minLuck), minLuck), maxLuck, alt, out)
    }
    return
  }

  const last = out[out.length - 1]
  const sameAsLast = last && keysOf(last.value) === keysOf(loot)
  if (last && sameAsLast && nextUp(last.maxLuck) === minLuck) {
    last.maxLuck = maxLuck
  } else {
    out.push({ minLuck, maxLuck, value: loot })
  }
}

function keysOf(loot: Goodie[]): string {
  return loot.map(goodieKey).join("|")
}

// ---------------------------------------------------------------- 展示辅助

/** 内部用 luckMult，展示时换算回「等效每日幸运」 */
export function displayLuck(luckMult: number): number {
  return (luckMult - 1) * 2
}

export interface VolcanoFloorNotes {
  mushroomFloor: boolean
  monsterFloor: boolean
  hasButtons: boolean
}

/** 渲染单层地图所需的图块数据 */
export function renderFloorTiles(
  settings: VolcanoSettings,
  level: number,
  layout: number,
): { tiles: Uint8Array; notes: VolcanoFloorNotes } {
  // 地图渲染不依赖幸运值，用占位值即可
  const floor = new DungeonFloorState(settings, level, layout, 0, 0)
  floor.loadMap()
  const tiles = floor.getMap()
  let hasButtons = false
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] === VolcanoTile.Switch) {
      hasButtons = true
      break
    }
  }
  return {
    tiles,
    notes: {
      mushroomFloor: isMushroomFloor(layout),
      monsterFloor: isMonsterFloor(layout),
      hasButtons,
    },
  }
}

export type { ChestItem, Goodie }
