// 星露谷 1.6 使用的随机数与种子混合逻辑的 TypeScript 移植。
// 参考实现：https://github.com/trillllian/sdv-volcano/blob/main/src/rng.rs
//
// 需要注意两点：
// 1. 星露谷跑在 .NET 上，用的是 .NET 5 兼容版 Random（减法进位发生器）的「魔改」版本，
//    和 .NET Framework 的老实现并不一致，不能直接用常见的 DotNetRandom 端口替代。
// 2. 1.6 起种子混合改成了 xxHash32，1.5 及更早只是把数值取模后相加。

const I32_MAX = 2147483647

function saturatingAbs(v: number): number {
  return v === -2147483648 ? I32_MAX : Math.abs(v)
}

/** 模拟 Rust 的 `f64 as i32`（饱和转换，NaN 归零） */
export function f64ToI32(v: number): number {
  if (Number.isNaN(v)) return 0
  if (v >= I32_MAX) return I32_MAX
  if (v <= -2147483648) return -2147483648
  return Math.trunc(v)
}

const _f64 = new Float64Array(1)
const _u32 = new Uint32Array(_f64.buffer)

/** 模拟 Rust 的 `f64::next_up()`：返回大于 x 的最小 f64 */
export function nextUp(x: number): number {
  if (Number.isNaN(x) || x === Number.POSITIVE_INFINITY) return x
  if (x === 0) return Number.MIN_VALUE
  if (x === Number.NEGATIVE_INFINITY) return -Number.MAX_VALUE
  _f64[0] = x
  let lo = _u32[0]
  let hi = _u32[1]
  if (x > 0) {
    lo = (lo + 1) >>> 0
    if (lo === 0) hi = (hi + 1) >>> 0
  } else {
    lo = (lo - 1) >>> 0
    if (lo === 0xffffffff) hi = (hi - 1) >>> 0
  }
  _u32[0] = lo
  _u32[1] = hi
  return _f64[0]
}

// ---------------------------------------------------------------- xxHash32

const P1 = 2654435761
const P2 = 2246822519
const P3 = 3266489917
const P4 = 668265263
const P5 = 374761393

function rotl32(x: number, r: number): number {
  return ((x << r) | (x >>> (32 - r))) >>> 0
}

function readU32LE(bytes: Uint8Array, off: number): number {
  return (
    (bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) | (bytes[off + 3] << 24)) >>> 0
  )
}

function xxhRound(acc: number, input: number): number {
  acc = (acc + Math.imul(input, P2)) >>> 0
  acc = rotl32(acc, 13)
  return Math.imul(acc, P1) >>> 0
}

/** xxHash32，与 StardewValley.Utility 内部使用的哈希一致 */
export function xxHash32(bytes: Uint8Array, seed = 0): number {
  const len = bytes.length
  let h32: number
  let off = 0
  if (len >= 16) {
    let v1 = (seed + P1 + P2) >>> 0
    let v2 = (seed + P2) >>> 0
    let v3 = seed >>> 0
    let v4 = (seed - P1) >>> 0
    const limit = len - 16
    for (; off <= limit; off += 16) {
      v1 = xxhRound(v1, readU32LE(bytes, off))
      v2 = xxhRound(v2, readU32LE(bytes, off + 4))
      v3 = xxhRound(v3, readU32LE(bytes, off + 8))
      v4 = xxhRound(v4, readU32LE(bytes, off + 12))
    }
    h32 = (rotl32(v1, 1) + rotl32(v2, 7) + rotl32(v3, 12) + rotl32(v4, 18)) >>> 0
  } else {
    h32 = (seed + P5) >>> 0
  }
  h32 = (h32 + len) >>> 0
  while (off + 4 <= len) {
    h32 = (h32 + Math.imul(readU32LE(bytes, off), P3)) >>> 0
    h32 = Math.imul(rotl32(h32, 17), P4) >>> 0
    off += 4
  }
  while (off < len) {
    h32 = (h32 + Math.imul(bytes[off], P5)) >>> 0
    h32 = Math.imul(rotl32(h32, 11), P1) >>> 0
    off++
  }
  h32 = (h32 ^ (h32 >>> 15)) >>> 0
  h32 = Math.imul(h32, P2) >>> 0
  h32 = (h32 ^ (h32 >>> 13)) >>> 0
  h32 = Math.imul(h32, P3) >>> 0
  h32 = (h32 ^ (h32 >>> 16)) >>> 0
  return h32
}

/** 星露谷把哈希结果当 i32 用（二进制补码） */
export function stardewHashCode(data: Uint8Array): number {
  return xxHash32(data, 0) | 0
}

/** 把最多 5 个数值混成一个种子 */
export function stardewSeedMix(legacyRng: boolean, values: readonly number[]): number {
  if (legacyRng) {
    let sum = 0
    for (const v of values) sum += v % I32_MAX
    return f64ToI32(sum)
  }
  const h = new Int32Array(5)
  for (let i = 0; i < values.length && i < 5; i++) h[i] = f64ToI32(values[i] % I32_MAX)
  const bytes = new Uint8Array(20)
  new Int32Array(bytes.buffer).set(h) // 小端
  return stardewHashCode(bytes)
}

// ---------------------------------------------------------------- 随机数发生器

/**
 * .NET 5 兼容版 Random 的移植。
 * 与常见的 .NET Framework 版本差异：初始化时用 2147483647 而非 int.MaxValue 的部分细节，
 * 以及 inextp 初值是 21 而不是 31（原实现的注释里吐槽过这一点）。
 */
export class DotnetRng {
  private state = new Int32Array(56)
  private inext = 0
  private inextp = 21

  constructor(seed: number) {
    const state = this.state
    // 原实现是 i32 运算，溢出时按二进制补码回绕；JS 的 number 不会回绕，
    // 所以每步算术都要 `| 0` 强制截断。初始化时 state[55] 会被赋成一个负数，
    // 第二轮循环里 `state[55] - state[31]` 很容易下溢——漏了这一步，
    // 大约一半的种子整个随机序列都会跑偏。
    let mj = (161803398 - saturatingAbs(seed | 0)) | 0
    state[55] = mj
    let mk = 1
    let ii = 0
    for (let i = 1; i < 55; i++) {
      ii = (ii + 21) % 55
      state[ii] = mk
      mk = (mj - mk) | 0
      if (mk < 0) mk += I32_MAX
      mj = state[ii]
    }
    for (let k = 1; k < 5; k++) {
      for (let i = 1; i < 56; i++) {
        const n = (i + 30) % 55
        let v = (state[i] - state[1 + n]) | 0
        if (v < 0) v += I32_MAX
        state[i] = v
      }
    }
  }

  next(): number {
    this.inext = (this.inext % 55) + 1
    this.inextp = (this.inextp % 55) + 1
    let result = (this.state[this.inext] - this.state[this.inextp]) | 0
    if (result === I32_MAX) result -= 1
    if (result < 0) result += I32_MAX
    this.state[this.inext] = result
    return result
  }

  nextDouble(): number {
    return this.next() * (1 / I32_MAX)
  }

  /** [0, max) 区间内的整数 */
  nextRange(max: number): number {
    return Math.floor(this.nextDouble() * max)
  }
}
