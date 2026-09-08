/**
 * 多窗口之间的轻量同步：全部走 localStorage + `storage` 事件（同源 webview 之间会互相触发）。
 * - accountToken / accountUser：登录态（AccountProvider 负责读写）
 * - socialCurrentRoom：主窗口在房间内时写入 { code, name }，离开时删除；聊天窗口据此显示"邀请进房间"
 * - socialOpenChats：当前打开的私聊窗口对应的好友 id 列表（聊天窗口挂载/卸载时维护）
 */
import { useCallback, useSyncExternalStore } from "react"
import type { SocialWindowSync } from "@shared/account/social-provider"
import type { RoomRef } from "./types"

// 登录态的键定义在 shared 里（AccountProvider 共用），这里转发出去保持既有 import 路径
export { TOKEN_KEY, USER_KEY } from "@shared/account/storage"
export const CURRENT_ROOM_KEY = "socialCurrentRoom"
export const OPEN_CHATS_KEY = "socialOpenChats"

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSet(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // 隐私模式等写入失败时忽略
  }
}

export function readCurrentRoom(): RoomRef | null {
  const raw = safeGet(CURRENT_ROOM_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<RoomRef>
    if (typeof parsed.code === "string" && typeof parsed.name === "string") {
      return { code: parsed.code, name: parsed.name }
    }
  } catch {
    // ignore
  }
  return null
}

export function writeCurrentRoom(room: RoomRef | null) {
  safeSet(CURRENT_ROOM_KEY, room ? JSON.stringify({ code: room.code, name: room.name }) : null)
}

export function readOpenChats(): string[] {
  const raw = safeGet(OPEN_CHATS_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []
  } catch {
    return []
  }
}

export function addOpenChat(userId: string) {
  const list = readOpenChats()
  if (!list.includes(userId)) safeSet(OPEN_CHATS_KEY, JSON.stringify([...list, userId]))
}

export function removeOpenChat(userId: string) {
  const list = readOpenChats().filter((id) => id !== userId)
  safeSet(OPEN_CHATS_KEY, list.length ? JSON.stringify(list) : null)
}

/** 注入给共享 SocialProvider 的多窗口同步适配器（手机端不需要，传空实现） */
export const desktopWindowSync: SocialWindowSync = {
  readOpenChats,
  writeCurrentRoom,
}

/** 订阅某个 localStorage 键的原始值（其他窗口修改时通过 storage 事件刷新） */
export function useStorageValue(key: string): string | null {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const handler = (e: StorageEvent) => {
        if (e.key === null || e.key === key) onChange()
      }
      window.addEventListener("storage", handler)
      return () => window.removeEventListener("storage", handler)
    },
    [key],
  )
  return useSyncExternalStore(subscribe, () => safeGet(key), () => null)
}

/** 订阅 storage 事件（用于登出时关闭弹窗等一次性动作） */
export function onStorageKey(key: string, handler: (newValue: string | null) => void): () => void {
  const listener = (e: StorageEvent) => {
    if (e.key === key) handler(e.newValue)
    else if (e.key === null) handler(safeGet(key))
  }
  window.addEventListener("storage", listener)
  return () => window.removeEventListener("storage", listener)
}
