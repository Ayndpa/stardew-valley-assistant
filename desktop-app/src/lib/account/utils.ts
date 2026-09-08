import type { UserBrief } from "./types"

/** 房间号 / ICE 房间号字母表（REALTIME.md §0.3） */
export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"

/** username 为 null 时显示 id 前 8 位（REALTIME.md §0.2） */
export function displayName(user: UserBrief | null | undefined): string {
  if (!user) return ""
  return user.username && user.username.trim() ? user.username : user.id.slice(0, 8)
}

/** 头像占位：显示名的首字符（大写） */
export function initialOf(user: UserBrief | null | undefined): string {
  const name = displayName(user)
  return name ? name.slice(0, 1).toUpperCase() : "?"
}

export function randomCode(length: number): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  let out = ""
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  }
  return out
}

/** 客户端消息 ID（≤ 64 字符） */
export function newCid(): string {
  return Date.now().toString(36) + "-" + randomCode(8)
}

export function newLocalId(): string {
  return "local-" + newCid()
}

/** 聊天文本规范化：去首尾空白、剔除控制字符（保留换行），限制 2000 个 code point */
export function normalizeChatText(text: string): string {
  const cleaned = Array.from(text.trim())
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0
      return code >= 0x20 || ch === "\n"
    })
    .join("")
  return Array.from(cleaned).slice(0, 2000).join("")
}

/** 紧凑的字节数显示：B / KB / MB / GB */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B"
  if (bytes < 1024) return `${bytes} B`
  const units = ["KB", "MB", "GB", "TB"]
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}

export function formatTime(ts: number): string {
  const d = new Date(ts)
  const hh = d.getHours().toString().padStart(2, "0")
  const mm = d.getMinutes().toString().padStart(2, "0")
  return `${hh}:${mm}`
}
