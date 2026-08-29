// Knuth's subtractive PRNG port from .NET Framework for Bookseller schedule calculation
export class DotNetRandom {
  private inext: number = 0
  private inextp: number = 0
  private SeedArray: number[] = new Array(56)

  constructor(seed: number) {
    let ii = 0
    let mj = 0
    let mk = 0

    const subtraction = (seed === -2147483648) ? 2147483647 : Math.abs(seed)
    mj = 161803398 - subtraction
    this.SeedArray[55] = mj
    mk = 1
    for (let i = 1; i < 55; i++) {
      ii = (21 * i) % 55
      this.SeedArray[ii] = mk
      mk = mj - mk
      if (mk < 0) mk += 2147483647
      mj = this.SeedArray[ii]
    }
    for (let k = 1; k < 5; k++) {
      for (let i = 1; i < 56; i++) {
        this.SeedArray[i] -= this.SeedArray[1 + (i + 30) % 55]
        if (this.SeedArray[i] < 0) this.SeedArray[i] += 2147483647
      }
    }
    this.inext = 0
    this.inextp = 21
  }

  private Sample(): number {
    let retVal = 0
    let locINext = this.inext + 1
    let locINextp = this.inextp + 1
    if (locINext >= 56) locINext = 1
    if (locINextp >= 56) locINextp = 1
    retVal = this.SeedArray[locINext] - this.SeedArray[locINextp]
    if (retVal < 0) retVal += 2147483647
    this.SeedArray[locINext] = retVal
    this.inext = locINext
    this.inextp = locINextp
    return retVal * 4.6566128752457969E-10
  }

  public Next(max: number): number {
    return Math.floor(this.Sample() * max)
  }
}

// Calculate the two bookseller visit days for a given year, unique ID, and season
export const getBooksellerDays = (year: number, uniqueIdStr: string, seasonIndex: number) => {
  let uniqueID = 0
  const match = uniqueIdStr.match(/\d+/)
  if (match) {
    uniqueID = parseInt(match[0]) || 0
  }

  const seedA = year * 11
  const seedB = uniqueID
  const seedC = seasonIndex

  const combinedSeed = (seedA % 2147483647 + seedB % 2147483647 + seedC % 2147483647) % 2147483647
  
  let array: number[] = []
  switch (seasonIndex) {
    case 0: // Spring
      array = [11, 12, 21, 22, 25]
      break;
    case 1: // Summer
      array = [9, 12, 18, 25, 27]
      break;
    case 2: // Fall
      array = [4, 7, 8, 9, 12, 19, 22, 25]
      break;
    case 3: // Winter
      array = [5, 11, 12, 19, 22, 24]
      break;
  }

  if (array.length === 0) return []

  const rand = new DotNetRandom(combinedSeed)
  const num = rand.Next(array.length)
  const list: number[] = []
  list.push(array[num])
  list.push(array[(num + Math.floor(array.length / 2)) % array.length])
  return list.sort((a, b) => a - b)
}
