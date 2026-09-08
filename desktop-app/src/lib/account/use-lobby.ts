/**
 * 大厅连接（REALTIME.md §3）：组件挂载时连接 /ws/lobby，卸载时断开。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useAccount } from "./account-provider"
import { wsUrl } from "./config"
import { RealtimeSocket } from "./realtime"
import type { ChatMessage, LobbyServerFrame, RoomSummary, UserBrief } from "./types"
import { newLocalId, normalizeChatText } from "./utils"

const LOBBY_CHAT_CAP = 300
const CREATE_TIMEOUT_MS = 10000

export type LobbyStatus = "offline" | "connecting" | "online"

export interface LobbyState {
  status: LobbyStatus
  rooms: RoomSummary[]
  members: UserBrief[]
  chat: ChatMessage[]
  sendChat: (text: string) => boolean
  createRoom: (name: string, max: number, password?: string) => Promise<RoomSummary>
}

/** 创建房间失败时抛出，message 为 i18n key */
export class LobbyError extends Error {
  constructor(key: string) {
    super(key)
    this.name = "LobbyError"
  }
}

export function useLobby(enabled = true): LobbyState {
  const { user, token } = useAccount()
  const [status, setStatus] = useState<LobbyStatus>("offline")
  const [rooms, setRooms] = useState<RoomSummary[]>([])
  const [members, setMembers] = useState<UserBrief[]>([])
  const [chat, setChat] = useState<ChatMessage[]>([])

  const socketRef = useRef<RealtimeSocket | null>(null)
  const userIdRef = useRef<string | null>(user?.id ?? null)
  userIdRef.current = user?.id ?? null
  const pendingCreateRef = useRef<{
    resolve: (room: RoomSummary) => void
    reject: (err: Error) => void
    timer: ReturnType<typeof setTimeout>
  } | null>(null)

  const settleCreate = useCallback((room?: RoomSummary, err?: Error) => {
    const pending = pendingCreateRef.current
    if (!pending) return
    pendingCreateRef.current = null
    clearTimeout(pending.timer)
    if (room) pending.resolve(room)
    else pending.reject(err ?? new LobbyError("social.lobby.createFailed"))
  }, [])

  useEffect(() => {
    if (!enabled || !token) {
      socketRef.current?.close()
      socketRef.current = null
      setStatus("offline")
      return
    }

    setStatus("connecting")
    const socket = new RealtimeSocket({
      url: () => `${wsUrl("/ws/lobby")}?token=${encodeURIComponent(token)}`,
      onOpen: () => setStatus("online"),
      onClose: (info) => setStatus(info.willReconnect ? "connecting" : "offline"),
      onFrame: (raw) => {
        const frame = raw as unknown as LobbyServerFrame
        switch (frame.type) {
          case "lobby.ready":
            setRooms(frame.rooms)
            setMembers(frame.members)
            break
          case "lobby.rooms":
            setRooms(frame.rooms)
            break
          case "lobby.members":
            setMembers(frame.members)
            break
          case "lobby.chat": {
            const msg: ChatMessage = {
              id: newLocalId(),
              from: frame.from.id === userIdRef.current ? "me" : frame.from,
              text: frame.text,
              ts: frame.ts,
            }
            setChat((prev) => {
              const next = [...prev, msg]
              return next.length > LOBBY_CHAT_CAP ? next.slice(next.length - LOBBY_CHAT_CAP) : next
            })
            break
          }
          case "room.created":
            settleCreate(frame.room)
            break
          case "error":
            console.warn("[social/lobby] error:", frame.code, frame.message)
            if (pendingCreateRef.current) {
              settleCreate(undefined, new LobbyError(frame.code === "bad_message" ? "social.lobby.createInvalid" : "social.lobby.createFailed"))
            }
            break
          default:
            break
        }
      },
    })
    socketRef.current = socket
    socket.connect()

    return () => {
      socket.close()
      if (socketRef.current === socket) socketRef.current = null
      settleCreate(undefined, new LobbyError("social.lobby.createFailed"))
      setStatus("offline")
      setMembers([])
    }
  }, [enabled, token, settleCreate])

  const sendChat = useCallback((rawText: string): boolean => {
    const text = normalizeChatText(rawText)
    if (!text) return false
    const socket = socketRef.current
    if (!socket || !socket.isOpen) return false
    return socket.send({ type: "lobby.chat", text })
  }, [])

  const createRoom = useCallback(
    (name: string, max: number, password?: string): Promise<RoomSummary> => {
      const socket = socketRef.current
      if (!socket || !socket.isOpen) {
        return Promise.reject(new LobbyError("social.lobby.notConnected"))
      }
      if (pendingCreateRef.current) {
        return Promise.reject(new LobbyError("social.lobby.createPending"))
      }
      return new Promise<RoomSummary>((resolve, reject) => {
        const timer = setTimeout(() => settleCreate(undefined, new LobbyError("social.lobby.createTimeout")), CREATE_TIMEOUT_MS)
        pendingCreateRef.current = { resolve, reject, timer }
        const frame: { type: "room.create"; name: string; max: number; password?: string } = {
          type: "room.create",
          name: name.trim(),
          max,
        }
        if (password && password.length > 0) frame.password = password
        if (!socket.send(frame)) {
          settleCreate(undefined, new LobbyError("social.lobby.notConnected"))
        }
      })
    },
    [settleCreate],
  )

  return useMemo(() => ({ status, rooms, members, chat, sendChat, createRoom }), [status, rooms, members, chat, sendChat, createRoom])
}
