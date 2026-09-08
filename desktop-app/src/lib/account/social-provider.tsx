import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import type { Page } from "@/App"
import { useAccount } from "./account-provider"
import * as api from "./api"
import { wsUrl } from "./config"
import { RealtimeSocket } from "./realtime"
import { usePeerSession, type PeerSession } from "./p2p"
import type {
  ChatMessage,
  FriendEntry,
  FriendRequests,
  HubServerFrame,
  Invite,
  RoomInfo,
  RoomMember,
  RoomRef,
  RoomServerFrame,
  UserBrief,
} from "./types"
import { isP2POfferSignal, isVlanSignal } from "./types"
import { displayName, newCid, newLocalId, normalizeChatText, randomCode } from "./utils"
import { useVlan, type VlanController, type VlanErrorKind } from "./vlan"
import { readOpenChats, writeCurrentRoom } from "./window-signals"

export type ToastType = "success" | "info" | "warning"
export type Notifier = (message: string, type: ToastType) => void
/** main = 主窗口（处理邀请、房间、全局提示）；popup = 好友 / 私聊弹窗（只关心好友与私聊） */
export type SocialRole = "main" | "popup"

const DM_THREAD_CAP = 200
const ROOM_CHAT_CAP = 300
const JOIN_TIMEOUT_MS = 15000
const REPLACED_CLOSE_CODE = 4000

export type HubStatus = "offline" | "connecting" | "online"
export type RoomStatus = "idle" | "joining" | "joined"

export interface RoomState {
  info: RoomInfo
  members: RoomMember[]
  chat: ChatMessage[]
  you: string
}

export interface P2POffer {
  from: string
  fromUser: UserBrief | null
  code: string
  ts: number
}

export type SignalHandler = (from: string, data: unknown) => void

/** joinRoom 失败时抛出的错误，message 为 i18n key */
export class RoomJoinError extends Error {
  constructor(key = "social.room.joinFailed") {
    super(key)
    this.name = "RoomJoinError"
  }
}

interface SocialState {
  hubStatus: HubStatus
  friends: FriendEntry[]
  requests: FriendRequests
  dmThreads: Map<string, ChatMessage[]>
  unread: Record<string, number>
  totalUnread: number
  invites: Invite[]
  sendDm: (to: string, text: string) => boolean
  markRead: (userId: string) => void
  setActiveThread: (userId: string | null) => void
  sendInvite: (to: string, room: RoomRef) => boolean
  refreshFriends: () => Promise<void>
  dismissInvite: (id: string) => void

  room: RoomState | null
  roomStatus: RoomStatus
  joinRoom: (code: string, password?: string) => Promise<void>
  leaveRoom: () => void
  sendRoomChat: (text: string) => boolean
  sendSignal: (to: string, data: unknown) => boolean
  kick: (userId: string) => boolean
  closeRoom: () => boolean
  onSignal: (handler: SignalHandler) => () => void

  peer: PeerSession
  p2pOffer: P2POffer | null
  startP2P: (to: string) => Promise<void>
  acceptP2POffer: () => Promise<void>
  declineP2POffer: () => void

  /** 虚拟局域网（仅主窗口有效，弹窗里 available=false 且永远未开启） */
  vlan: VlanController
}

const SocialContext = createContext<SocialState | undefined>(undefined)
const EMPTY_MEMBERS: RoomMember[] = []

function appendCapped(list: ChatMessage[], msg: ChatMessage, cap: number): ChatMessage[] {
  const next = [...list, msg]
  return next.length > cap ? next.slice(next.length - cap) : next
}

interface SocialProviderProps {
  children: React.ReactNode
  /** 主窗口 / 弹窗，见 SocialRole */
  role: SocialRole
  /** 提示回调（主窗口为 App 的 showGlobalToast，弹窗为窗口内的小提示） */
  notify?: Notifier
  /** 主窗口当前页面：不在联机页面时房间类事件才弹 toast；弹窗可省略 */
  activePage?: Page
}

const noopNotify: Notifier = () => {}

export function SocialProvider({ children, role, notify = noopNotify, activePage }: SocialProviderProps) {
  const { t } = useTranslation()
  const { user, token, withToken, refreshMe } = useAccount()
  const peer = usePeerSession()

  const [hubStatus, setHubStatus] = useState<HubStatus>("offline")
  const [friends, setFriends] = useState<FriendEntry[]>([])
  const [requests, setRequests] = useState<FriendRequests>({ incoming: [], outgoing: [] })
  const [dmThreads, setDmThreads] = useState<Map<string, ChatMessage[]>>(() => new Map())
  const [unread, setUnread] = useState<Record<string, number>>({})
  const [invites, setInvites] = useState<Invite[]>([])
  const [room, setRoom] = useState<RoomState | null>(null)
  const [roomStatus, setRoomStatus] = useState<RoomStatus>("idle")
  const [p2pOffer, setP2pOffer] = useState<P2POffer | null>(null)

  const hubRef = useRef<RealtimeSocket | null>(null)
  const roomRef = useRef<RealtimeSocket | null>(null)
  const roomStateRef = useRef<RoomState | null>(null)
  const roomLeavingRef = useRef(false)
  const joinPendingRef = useRef<{
    resolve: () => void
    reject: (err: Error) => void
    timer: ReturnType<typeof setTimeout>
  } | null>(null)
  const signalHandlersRef = useRef<Set<SignalHandler>>(new Set())
  const activePageRef = useRef<Page | undefined>(activePage)
  const activeThreadRef = useRef<string | null>(null)
  const notifyRef = useRef<Notifier>(notify)
  const tRef = useRef(t)
  const userRef = useRef(user)
  const peerRef = useRef(peer)
  // 本窗口发出、尚未收到 invite.ack 的邀请（只在发出邀请的窗口提示结果）
  const pendingInvitesRef = useRef<Set<string>>(new Set())
  // 虚拟局域网控制器（在下方 useVlan 处赋值；room.signal 处理器通过 ref 访问）
  const vlanRef = useRef<VlanController | null>(null)

  activePageRef.current = activePage
  notifyRef.current = notify
  tRef.current = t
  userRef.current = user
  peerRef.current = peer
  roomStateRef.current = room

  const isMain = role === "main"
  const onSocialPage = () => activePageRef.current === "social"
  const toast = (key: string, type: ToastType, params?: Record<string, unknown>) =>
    notifyRef.current(tRef.current(key, params), type)

  // ---------- 好友 ----------

  const refreshFriends = useCallback(async () => {
    if (!token) return
    const [list, reqs] = await Promise.all([
      withToken((tk) => api.listFriends(tk)),
      withToken((tk) => api.listFriendRequests(tk)),
    ])
    setFriends((prev) => {
      const onlineById = new Map(prev.map((f) => [f.id, f.online]))
      return list.map((f) => ({ ...f, online: onlineById.get(f.id) ?? f.online ?? false }))
    })
    setRequests(reqs)
  }, [token, withToken])

  const refreshFriendsRef = useRef(refreshFriends)
  refreshFriendsRef.current = refreshFriends

  const appendDm = useCallback((userId: string, msg: ChatMessage) => {
    setDmThreads((prev) => {
      const next = new Map(prev)
      next.set(userId, appendCapped(prev.get(userId) ?? [], msg, DM_THREAD_CAP))
      return next
    })
  }, [])

  // ---------- Hub 帧处理 ----------

  const handleHubFrame = useCallback(
    (raw: { type: string } & Record<string, unknown>) => {
      const frame = raw as unknown as HubServerFrame
      switch (frame.type) {
        case "hub.ready": {
          setFriends(frame.friends.map((f) => ({ ...f, online: !!f.online })))
          // 补齐 since 与待处理申请（HTTP）
          refreshFriendsRef.current().catch((err) => console.warn("[social] refreshFriends failed:", err))
          break
        }
        case "dm.ack": {
          setDmThreads((prev) => {
            const list = prev.get(frame.to)
            if (!list) return prev
            const next = new Map(prev)
            next.set(
              frame.to,
              list.map((m) => (m.id === frame.cid ? { ...m, pending: false, delivered: frame.delivered, ts: frame.ts } : m)),
            )
            return next
          })
          break
        }
        case "dm": {
          appendDm(frame.from.id, { id: newLocalId(), from: frame.from, text: frame.text, ts: frame.ts })
          // 该好友的私聊窗口已打开（本窗口就是它，或其他窗口写了 socialOpenChats）→ 不计未读
          const chatOpen = activeThreadRef.current === frame.from.id || readOpenChats().includes(frame.from.id)
          if (!chatOpen) {
            setUnread((prev) => ({ ...prev, [frame.from.id]: (prev[frame.from.id] ?? 0) + 1 }))
            if (isMain) {
              toast("social.notify.dm", "info", { name: displayName(frame.from), text: frame.text })
            }
          }
          break
        }
        case "dm.echo": {
          setDmThreads((prev) => {
            const list = prev.get(frame.to) ?? []
            if (list.some((m) => m.id === frame.cid)) return prev
            const next = new Map(prev)
            next.set(frame.to, appendCapped(list, { id: frame.cid, from: "me", text: frame.text, ts: frame.ts }, DM_THREAD_CAP))
            return next
          })
          break
        }
        case "presence": {
          setFriends((prev) => prev.map((f) => (f.id === frame.user_id ? { ...f, online: frame.online } : f)))
          break
        }
        case "friends.changed": {
          refreshFriendsRef.current().catch((err) => console.warn("[social] refreshFriends failed:", err))
          // 好友事件的提示只由主窗口弹出，避免多个窗口重复提示
          if (isMain && frame.reason === "request") {
            toast("social.notify.friendRequest", "info", { name: displayName(frame.user) })
          } else if (isMain && frame.reason === "accepted") {
            toast("social.notify.friendAccepted", "success", { name: displayName(frame.user) })
          }
          break
        }
        case "invite": {
          // 房间邀请只由主窗口处理（弹窗没有房间能力）
          if (!isMain) break
          const invite: Invite = { id: newLocalId(), from: frame.from, room: frame.room, ts: frame.ts }
          setInvites((prev) => [
            ...prev.filter((i) => !(i.from.id === invite.from.id && i.room.code === invite.room.code)),
            invite,
          ])
          if (!onSocialPage()) {
            toast("social.notify.invite", "info", { name: displayName(frame.from), room: frame.room.name })
          }
          break
        }
        case "invite.ack": {
          if (!pendingInvitesRef.current.delete(frame.to)) break
          toast(frame.delivered ? "social.notify.inviteSent" : "social.notify.inviteNotDelivered", frame.delivered ? "success" : "warning")
          break
        }
        case "error": {
          console.warn("[social/hub] error:", frame.code, frame.message)
          if (frame.code === "not_friend" || frame.code === "rate_limited" || frame.code === "too_large") {
            toast(`social.errors.${frame.code}`, "warning")
          }
          break
        }
        default:
          break
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appendDm],
  )

  const handleHubFrameRef = useRef(handleHubFrame)
  handleHubFrameRef.current = handleHubFrame

  // ---------- Hub 连接生命周期 ----------

  useEffect(() => {
    if (!token) {
      hubRef.current?.close()
      hubRef.current = null
      setHubStatus("offline")
      setFriends([])
      setRequests({ incoming: [], outgoing: [] })
      setDmThreads(new Map())
      setUnread({})
      setInvites([])
      return
    }

    let upgradeFailures = 0
    setHubStatus("connecting")
    const socket = new RealtimeSocket({
      url: () => `${wsUrl("/ws/hub")}?token=${encodeURIComponent(token)}`,
      onFrame: (frame) => handleHubFrameRef.current(frame),
      onOpen: () => {
        upgradeFailures = 0
        setHubStatus("online")
      },
      onClose: (info) => {
        if (!info.everOpened) {
          // 升级阶段就失败（401 / 网络不通）：显示离线，后台继续退避重连；
          // 第 1 次与之后每 5 次失败用 /api/me 校验一次 token（账户被删或令牌失效 → 401 → 登出并停止重连）
          upgradeFailures += 1
          setHubStatus("offline")
          if (upgradeFailures === 1 || upgradeFailures % 5 === 0) {
            refreshMe().catch(() => {})
          }
          return
        }
        setHubStatus(info.willReconnect ? "connecting" : "offline")
      },
    })
    hubRef.current = socket
    socket.connect()

    return () => {
      socket.close()
      if (hubRef.current === socket) hubRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  // ---------- 私聊 / 邀请 ----------

  const sendDm = useCallback(
    (to: string, rawText: string): boolean => {
      const text = normalizeChatText(rawText)
      if (!text) return false
      const socket = hubRef.current
      if (!socket || !socket.isOpen) return false
      const cid = newCid()
      appendDm(to, { id: cid, from: "me", text, ts: Date.now(), pending: true })
      return socket.send({ type: "dm.send", to, text, cid })
    },
    [appendDm],
  )

  const markRead = useCallback((userId: string) => {
    setUnread((prev) => {
      if (!prev[userId]) return prev
      const next = { ...prev }
      delete next[userId]
      return next
    })
  }, [])

  const setActiveThread = useCallback(
    (userId: string | null) => {
      activeThreadRef.current = userId
      if (userId) markRead(userId)
    },
    [markRead],
  )

  const sendInvite = useCallback((to: string, roomRef: RoomRef): boolean => {
    const socket = hubRef.current
    if (!socket || !socket.isOpen) return false
    const ok = socket.send({ type: "invite.send", to, room: { code: roomRef.code, name: roomRef.name } })
    if (ok) pendingInvitesRef.current.add(to)
    return ok
  }, [])

  const dismissInvite = useCallback((id: string) => {
    setInvites((prev) => prev.filter((i) => i.id !== id))
  }, [])

  // ---------- 房间 ----------

  const settleJoin = useCallback((err?: Error) => {
    const pending = joinPendingRef.current
    if (!pending) return
    joinPendingRef.current = null
    clearTimeout(pending.timer)
    if (err) pending.reject(err)
    else pending.resolve()
  }, [])

  const teardownRoom = useCallback(
    (opts: { sendLeave?: boolean } = {}) => {
      const socket = roomRef.current
      roomRef.current = null
      roomLeavingRef.current = true
      if (socket) {
        if (opts.sendLeave) socket.send({ type: "room.leave" })
        socket.close()
      }
      setRoom(null)
      roomStateRef.current = null
      setRoomStatus("idle")
      setP2pOffer(null)
      settleJoin(new RoomJoinError())
      void peerRef.current.close()
    },
    [settleJoin],
  )

  const appendRoomChat = useCallback((msg: ChatMessage) => {
    setRoom((prev) => (prev ? { ...prev, chat: appendCapped(prev.chat, msg, ROOM_CHAT_CAP) } : prev))
  }, [])

  const handleRoomFrame = useCallback(
    (raw: { type: string } & Record<string, unknown>) => {
      const frame = raw as unknown as RoomServerFrame
      switch (frame.type) {
        case "room.ready": {
          setRoom((prev) => ({
            info: frame.room,
            members: frame.members,
            chat: prev && prev.info.code === frame.room.code ? prev.chat : [],
            you: frame.you,
          }))
          setRoomStatus("joined")
          settleJoin()
          break
        }
        case "room.members": {
          setRoom((prev) => (prev ? { ...prev, info: frame.room, members: frame.members } : prev))
          break
        }
        case "room.joined": {
          appendRoomChat({ id: newLocalId(), from: frame.user, text: "", ts: Date.now(), system: "joined" })
          break
        }
        case "room.left": {
          const me = roomStateRef.current?.you
          if (frame.user.id === me && frame.reason === "kicked") {
            toast("social.notify.kicked", "warning")
            teardownRoom()
            break
          }
          appendRoomChat({ id: newLocalId(), from: frame.user, text: "", ts: Date.now(), system: frame.reason })
          break
        }
        case "room.chat": {
          const me = roomStateRef.current?.you
          appendRoomChat({
            id: newLocalId(),
            from: frame.from.id === me ? "me" : frame.from,
            text: frame.text,
            ts: frame.ts,
          })
          break
        }
        case "room.signal": {
          // vlan-* 信令（握手 / bye）直接交给 Rust 侧的虚拟局域网，不走 P2P 与自定义订阅
          if (isVlanSignal(frame.data)) {
            vlanRef.current?.signalIn(frame.from, frame.data)
            break
          }
          if (isP2POfferSignal(frame.data)) {
            const fromUser = roomStateRef.current?.members.find((m) => m.id === frame.from) ?? null
            setP2pOffer({ from: frame.from, fromUser, code: frame.data.code, ts: Date.now() })
            if (!onSocialPage()) {
              toast("social.notify.p2pOffer", "info", { name: fromUser ? displayName(fromUser) : frame.from.slice(0, 8) })
            }
          }
          signalHandlersRef.current.forEach((handler) => {
            try {
              handler(frame.from, frame.data)
            } catch (err) {
              console.error("[social] signal handler failed:", err)
            }
          })
          break
        }
        case "room.closed": {
          toast(`social.notify.roomClosed.${frame.reason}`, "info")
          teardownRoom()
          break
        }
        case "error": {
          console.warn("[social/room] error:", frame.code, frame.message)
          if (frame.code === "replaced") {
            toast("social.notify.replaced", "warning")
            teardownRoom()
          } else if (frame.code === "forbidden" || frame.code === "rate_limited" || frame.code === "too_large") {
            toast(`social.errors.${frame.code}`, "warning")
          }
          break
        }
        default:
          break
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appendRoomChat, settleJoin, teardownRoom],
  )

  const handleRoomFrameRef = useRef(handleRoomFrame)
  handleRoomFrameRef.current = handleRoomFrame

  const joinRoom = useCallback(
    (rawCode: string, password?: string): Promise<void> => {
      const code = rawCode.trim().toUpperCase()
      if (!token || !code) return Promise.reject(new RoomJoinError())

      // 已在房间：先离开
      if (roomRef.current) {
        teardownRoom({ sendLeave: true })
      }

      return new Promise<void>((resolve, reject) => {
        roomLeavingRef.current = false
        setRoomStatus("joining")
        const timer = setTimeout(() => {
          if (joinPendingRef.current) {
            teardownRoom()
          }
        }, JOIN_TIMEOUT_MS)
        joinPendingRef.current = { resolve, reject, timer }

        const query = new URLSearchParams({ token })
        if (password) query.set("password", password)

        const socket = new RealtimeSocket({
          url: () => `${wsUrl(`/ws/room/${encodeURIComponent(code)}`)}?${query.toString()}`,
          onFrame: (frame) => handleRoomFrameRef.current(frame),
          shouldReconnect: (info) =>
            info.everOpened && info.code !== 1000 && info.code !== REPLACED_CLOSE_CODE && !roomLeavingRef.current,
          onClose: (info) => {
            if (roomRef.current !== socket) return
            if (!info.everOpened) {
              // 升级阶段失败：房间不存在 / 密码错误 / 已满（浏览器拿不到 HTTP 状态码）
              teardownRoom()
              return
            }
            if (!info.willReconnect) {
              if (roomStateRef.current) toast("social.notify.roomDisconnected", "warning")
              teardownRoom()
            }
          },
        })
        roomRef.current = socket
        socket.connect()
      })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [token, teardownRoom],
  )

  const leaveRoom = useCallback(() => {
    teardownRoom({ sendLeave: true })
  }, [teardownRoom])

  const sendRoomChat = useCallback((rawText: string): boolean => {
    const text = normalizeChatText(rawText)
    if (!text) return false
    const socket = roomRef.current
    if (!socket || !socket.isOpen) return false
    return socket.send({ type: "room.chat", text })
  }, [])

  const sendSignal = useCallback((to: string, data: unknown): boolean => {
    const socket = roomRef.current
    if (!socket || !socket.isOpen) return false
    return socket.send({ type: "room.signal", to, data })
  }, [])

  const kick = useCallback((userId: string): boolean => {
    const socket = roomRef.current
    if (!socket || !socket.isOpen) return false
    return socket.send({ type: "room.kick", user_id: userId })
  }, [])

  const closeRoom = useCallback((): boolean => {
    const socket = roomRef.current
    if (!socket || !socket.isOpen) return false
    return socket.send({ type: "room.close" })
  }, [])

  const onSignal = useCallback((handler: SignalHandler) => {
    signalHandlersRef.current.add(handler)
    return () => {
      signalHandlersRef.current.delete(handler)
    }
  }, [])

  // ---------- 虚拟局域网桥接（仅主窗口） ----------
  // 信令：Rust → vlan-signal-out → room.signal；room.signal(vlan-*) → vlan_signal_in（见 handleRoomFrame）
  // 生命周期：成员变化 → vlan_update_members；离开 / 关闭 / 被踢 / 登出（room 变为 null）与卸载 → vlan_stop
  // 用户在 UAC 中拒绝 → 统一的 i18n 提示（每次启动尝试只提示一次）；其他错误直接显示 Rust 侧文案
  const notifyVlanError = useCallback((message: string, kind: VlanErrorKind) => {
    notifyRef.current(kind === "denied" ? tRef.current("social.vlan.deniedToast") : message, "warning")
  }, [])
  const vlan = useVlan({
    active: isMain,
    roomCode: room?.info.code ?? null,
    you: room?.you ?? null,
    members: room?.members ?? EMPTY_MEMBERS,
    sendSignal,
    onError: notifyVlanError,
  })
  vlanRef.current = vlan

  // 登出时清理房间
  useEffect(() => {
    if (!token && roomRef.current) {
      teardownRoom({ sendLeave: true })
    }
  }, [token, teardownRoom])

  // 主窗口把当前房间写到 localStorage，私聊窗口据此显示"邀请进房间"
  const roomCode = room?.info.code ?? null
  const roomName = room?.info.name ?? null
  useEffect(() => {
    if (!isMain) return
    writeCurrentRoom(roomCode && roomName !== null ? { code: roomCode, name: roomName } : null)
  }, [isMain, roomCode, roomName])

  // ---------- P2P ----------

  const startP2P = useCallback(
    async (to: string) => {
      const code = randomCode(8)
      if (!sendSignal(to, { kind: "p2p-offer", code })) {
        throw new Error("room_not_connected")
      }
      setP2pOffer(null)
      await peerRef.current.connect(code, displayName(userRef.current))
    },
    [sendSignal],
  )

  const acceptP2POffer = useCallback(async () => {
    const offer = p2pOffer
    if (!offer) return
    setP2pOffer(null)
    await peerRef.current.connect(offer.code, displayName(userRef.current))
  }, [p2pOffer])

  const declineP2POffer = useCallback(() => {
    setP2pOffer(null)
  }, [])

  const totalUnread = useMemo(() => Object.values(unread).reduce((sum, n) => sum + n, 0), [unread])

  const value = useMemo<SocialState>(
    () => ({
      hubStatus,
      friends,
      requests,
      dmThreads,
      unread,
      totalUnread,
      invites,
      sendDm,
      markRead,
      setActiveThread,
      sendInvite,
      refreshFriends,
      dismissInvite,
      room,
      roomStatus,
      joinRoom,
      leaveRoom,
      sendRoomChat,
      sendSignal,
      kick,
      closeRoom,
      onSignal,
      peer,
      p2pOffer,
      startP2P,
      acceptP2POffer,
      declineP2POffer,
      vlan,
    }),
    [
      hubStatus,
      friends,
      requests,
      dmThreads,
      unread,
      totalUnread,
      invites,
      sendDm,
      markRead,
      setActiveThread,
      sendInvite,
      refreshFriends,
      dismissInvite,
      room,
      roomStatus,
      joinRoom,
      leaveRoom,
      sendRoomChat,
      sendSignal,
      kick,
      closeRoom,
      onSignal,
      peer,
      p2pOffer,
      startP2P,
      acceptP2POffer,
      declineP2POffer,
      vlan,
    ],
  )

  return <SocialContext.Provider value={value}>{children}</SocialContext.Provider>
}

export function useSocial(): SocialState {
  const ctx = useContext(SocialContext)
  if (ctx === undefined) {
    throw new Error("useSocial must be used within a SocialProvider")
  }
  return ctx
}
