export const depthColors = ["#38bdf8", "#22c55e", "#facc15", "#fb923c", "#ef4444", "#a855f7"]

export function formatCount(value: number) {
  return value.toLocaleString("zh-CN")
}

export function tileColor(depth: number) {
  return depthColors[Math.max(0, Math.min(depth, depthColors.length - 1))]
}

export function formatGameTime(time?: number | null) {
  if (!time) return "未知时间"
  const hour = Math.floor(time / 100)
  const minute = time % 100
  return `${hour}:${minute.toString().padStart(2, "0")}`
}

export function resolveFishingArea(
  areas: { x?: number | null; y?: number | null; width?: number | null; height?: number | null }[],
  tileX: number,
  tileY: number,
) {
  let fallback: (typeof areas)[number] | null = null
  for (const area of areas) {
    const hasRect =
      area.x !== null && area.x !== undefined &&
      area.y !== null && area.y !== undefined &&
      area.width !== null && area.width !== undefined &&
      area.height !== null && area.height !== undefined

    if (!hasRect) {
      fallback ||= area
      continue
    }

    if (
      tileX >= area.x! &&
      tileY >= area.y! &&
      tileX < area.x! + area.width! &&
      tileY < area.y! + area.height!
    ) {
      return area
    }
  }
  return fallback
}
