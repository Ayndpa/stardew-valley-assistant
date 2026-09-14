// 火山地牢布局数据的加载与缓存。
//
// 布局来自游戏文件（Content/VolcanoLayouts/Layouts.xnb 与 Content/Maps/Mines/Volcano_SetPieces_*.xnb），
// 由 Rust 侧解析后传过来。这里只负责解码与缓存，不内置任何游戏数据——
// 这样换游戏版本后不用改代码，也能避免把贴图数据塞进前端打包产物。

/** 图块类型，与游戏内部枚举一致 */
export const VolcanoTile = {
  Floor: 0,
  Lava: 1,
  Wall: 2,
  Enter: 3,
  Exit: 4,
  SetPiece: 5,
  Switch: 6,
  Monster: 7,
} as const
export type VolcanoTileValue = (typeof VolcanoTile)[keyof typeof VolcanoTile]

/** set piece 特征：0 = 消耗一次随机数，1 = 龙牙，2 = 宝箱 */
export const SetPieceFeature = { Rng: 0, Tooth: 1, Chest: 2 } as const

/** 单个布局的边长 */
export const LAYOUT_TILE_SIZE = 64

/** 后端 `get_volcano_layout_data` 返回的原始结构（字段名是 Rust 的 snake_case 经 tauri 转成的 camelCase） */
export interface VolcanoLayoutPayload {
  layoutCount: number
  layoutsRle: string
  pieceSizes: Array<{ size: number; rows: number; cols: number }>
  pieceEvents: Array<{ size: number; row: number; col: number; events: number[] }>
}

/** 解码后的运行时结构 */
export interface ResolvedVolcanoData {
  layoutCount: number
  /** 每个元素是一个 64×64 的布局，按行优先存放 */
  layouts: Uint8Array[]
  /** set piece 尺寸 -> (行数, 列数) */
  pieceSizes: Map<number, readonly [number, number]>
  /** `${尺寸}|${行}|${列}` -> 按顺序触发的特征 */
  pieceEvents: Map<string, readonly number[]>
}

let cached: ResolvedVolcanoData | null = null

/** 把 RLE + base64 解成 `layoutCount` 个 64×64 的 Uint8Array。
 *  注意：run 会跨布局边界，所以必须先把整条流解成一个大数组再切分，
 *  否则跨界的那一段会被下一个布局吃掉，后面的布局会整体错位。 */
export function decodeVolcanoLayouts(rle: string, layoutCount: number): Uint8Array[] {
  const bin = atob(rle)
  const size = LAYOUT_TILE_SIZE * LAYOUT_TILE_SIZE
  const total = layoutCount * size
  const flat = new Uint8Array(total)
  let cursor = 0
  let p = 0
  while (p < total && cursor + 1 < bin.length) {
    const value = bin.charCodeAt(cursor++)
    const count = bin.charCodeAt(cursor++)
    flat.fill(value, p, p + count)
    p += count
  }
  const out: Uint8Array[] = []
  for (let l = 0; l < layoutCount; l++) {
    out.push(flat.subarray(l * size, (l + 1) * size))
  }
  return out
}

function resolve(payload: VolcanoLayoutPayload): ResolvedVolcanoData {
  const layouts = decodeVolcanoLayouts(payload.layoutsRle, payload.layoutCount)
  if (layouts.length !== payload.layoutCount) {
    throw new Error(
      `火山布局数据不完整：期望 ${payload.layoutCount} 个，实际解出 ${layouts.length} 个`,
    )
  }
  const pieceSizes = new Map<number, readonly [number, number]>()
  for (const entry of payload.pieceSizes) {
    pieceSizes.set(entry.size, [entry.rows, entry.cols])
  }
  const pieceEvents = new Map<string, readonly number[]>()
  for (const entry of payload.pieceEvents) {
    pieceEvents.set(`${entry.size}|${entry.row}|${entry.col}`, entry.events)
  }
  return { layoutCount: payload.layoutCount, layouts, pieceSizes, pieceEvents }
}

/** 从游戏目录加载布局数据。重复调用只会真正解析一次（后端还有一层按目录的缓存）。 */
export async function loadVolcanoLayoutData(gameDir?: string): Promise<ResolvedVolcanoData> {
  // 动态导入：这个模块也会在非 Tauri 环境（测试、浏览器预览）里被加载，
  // 顶层静态导入 Tauri API 会直接报错。
  const { invoke } = await import("@tauri-apps/api/core")
  const payload = await invoke<VolcanoLayoutPayload>("get_volcano_layout_data", {
    gameDir: gameDir?.trim() || undefined,
  })
  return resolveVolcanoLayoutPayload(payload)
}

/** 直接使用一份已拿到的解析结果（非 Tauri 环境、单元测试、或上层已有缓存时用）。 */
export function resolveVolcanoLayoutPayload(
  payload: VolcanoLayoutPayload,
): ResolvedVolcanoData {
  cached = resolve(payload)
  return cached
}

export function hasVolcanoLayoutData(): boolean {
  return cached !== null
}

/** 取已加载的数据。预测前必须先调用过 loadVolcanoLayoutData。 */
export function getVolcanoLayoutData(): ResolvedVolcanoData {
  if (!cached) {
    throw new Error("火山布局数据尚未加载，请先调用 loadVolcanoLayoutData()")
  }
  return cached
}

/** 仅供测试：清空缓存 */
export function resetVolcanoLayoutData() {
  cached = null
}
