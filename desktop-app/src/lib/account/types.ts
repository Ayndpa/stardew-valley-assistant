/** 与 cloud-service/REALTIME.md 一一对应的类型定义 */

// ---------- 基础对象 ----------

export interface UserBrief {
  id: string
  username: string | null
  avatar_url?: string | null
}

export interface AccountUser extends UserBrief {
  email: string
  created_at?: string
  updated_at?: string
}

export interface FriendEntry extends UserBrief {
  online: boolean
  since?: string
}

export interface FriendRequest {
  id: string
  user: UserBrief
  created_at: string
}

export interface FriendRequests {
  incoming: FriendRequest[]
  outgoing: FriendRequest[]
}

export interface RoomSummary {
  code: string
  name: string
  host: UserBrief
  count: number
  max: number
  locked: boolean
  created_at: number
}

export interface RoomMember extends UserBrief {
  joined_at: number
  /** 服务端分配的虚拟局域网 IP（10.77.0.1 ~ 10.77.0.254），见 REALTIME.md §7 */
  vip: string
}

export interface RoomInfo {
  code: string
  name: string
  host_id: string
  max: number
  locked: boolean
}

export interface RoomRef {
  code: string
  name: string
}

export type SystemChatEvent = "joined" | "leave" | "kicked" | "disconnect"

export interface ChatMessage {
  id: string
  from: UserBrief | "me"
  text: string
  ts: number
  /** 已发出但尚未收到服务端 ack */
  pending?: boolean
  /** 私聊：对方当时是否在线（dm.ack.delivered） */
  delivered?: boolean
  /** 系统提示（成员进出），text 为空，渲染时按 system + from 组合文案 */
  system?: SystemChatEvent
}

export interface Invite {
  id: string
  from: UserBrief
  room: RoomRef
  ts: number
}

export type FriendsChangedReason = "request" | "accepted" | "declined" | "removed"
export type RoomLeftReason = "leave" | "kicked" | "disconnect"
export type RoomClosedReason = "host_closed" | "empty" | "expired"

// ---------- 通用帧 ----------

export interface PongFrame {
  type: "pong"
}

export interface ErrorFrame {
  type: "error"
  code: string
  message: string
}

// ---------- Hub（/ws/hub）S→C ----------

export interface HubReadyFrame {
  type: "hub.ready"
  user: UserBrief
  friends: FriendEntry[]
}

export interface DmAckFrame {
  type: "dm.ack"
  cid: string
  to: string
  delivered: boolean
  ts: number
}

export interface DmFrame {
  type: "dm"
  from: UserBrief
  text: string
  ts: number
}

export interface DmEchoFrame {
  type: "dm.echo"
  to: string
  text: string
  ts: number
  cid: string
}

export interface PresenceFrame {
  type: "presence"
  user_id: string
  online: boolean
}

export interface FriendsChangedFrame {
  type: "friends.changed"
  reason: FriendsChangedReason
  user: UserBrief
}

export interface InviteFrame {
  type: "invite"
  from: UserBrief
  room: RoomRef
  ts: number
}

export interface InviteAckFrame {
  type: "invite.ack"
  to: string
  delivered: boolean
}

export type HubServerFrame =
  | PongFrame
  | ErrorFrame
  | HubReadyFrame
  | DmAckFrame
  | DmFrame
  | DmEchoFrame
  | PresenceFrame
  | FriendsChangedFrame
  | InviteFrame
  | InviteAckFrame

// ---------- Hub C→S ----------

export type HubClientFrame =
  | { type: "ping" }
  | { type: "dm.send"; to: string; text: string; cid: string }
  | { type: "invite.send"; to: string; room: RoomRef }

// ---------- Lobby（/ws/lobby）S→C ----------

export interface LobbyReadyFrame {
  type: "lobby.ready"
  user: UserBrief
  rooms: RoomSummary[]
  members: UserBrief[]
}

export interface LobbyRoomsFrame {
  type: "lobby.rooms"
  rooms: RoomSummary[]
}

export interface LobbyMembersFrame {
  type: "lobby.members"
  members: UserBrief[]
}

export interface LobbyChatFrame {
  type: "lobby.chat"
  from: UserBrief
  text: string
  ts: number
}

export interface RoomCreatedFrame {
  type: "room.created"
  room: RoomSummary
}

export type LobbyServerFrame =
  | PongFrame
  | ErrorFrame
  | LobbyReadyFrame
  | LobbyRoomsFrame
  | LobbyMembersFrame
  | LobbyChatFrame
  | RoomCreatedFrame

export type LobbyClientFrame =
  | { type: "ping" }
  | { type: "lobby.chat"; text: string }
  | { type: "room.create"; name: string; max: number; password?: string }

// ---------- Room（/ws/room/<code>）S→C ----------

export interface RoomReadyFrame {
  type: "room.ready"
  room: RoomInfo
  members: RoomMember[]
  you: string
}

export interface RoomMembersFrame {
  type: "room.members"
  room: RoomInfo
  members: RoomMember[]
}

export interface RoomJoinedFrame {
  type: "room.joined"
  user: UserBrief
}

export interface RoomLeftFrame {
  type: "room.left"
  user: UserBrief
  reason: RoomLeftReason
}

export interface RoomChatFrame {
  type: "room.chat"
  from: UserBrief
  text: string
  ts: number
}

export interface RoomSignalFrame {
  type: "room.signal"
  from: string
  data: unknown
}

export interface RoomClosedFrame {
  type: "room.closed"
  reason: RoomClosedReason
}

export type RoomServerFrame =
  | PongFrame
  | ErrorFrame
  | RoomReadyFrame
  | RoomMembersFrame
  | RoomJoinedFrame
  | RoomLeftFrame
  | RoomChatFrame
  | RoomSignalFrame
  | RoomClosedFrame

export type RoomClientFrame =
  | { type: "ping" }
  | { type: "room.chat"; text: string }
  | { type: "room.signal"; to: string; data: unknown }
  | { type: "room.kick"; user_id: string }
  | { type: "room.close" }
  | { type: "room.leave" }

// ---------- 虚拟局域网（REALTIME.md §7.3） ----------

export type VlanPeerState = "connecting" | "connected" | "failed" | "disconnected"

export interface VlanPeer {
  id: string
  vip: string
  state: VlanPeerState
  tx_bytes: number
  rx_bytes: number
}

export interface VlanStatus {
  running: boolean
  vip: string
  subnet: string
  mtu: number
  peers: VlanPeer[]
  error: string | null
}

export interface VlanMemberRef {
  id: string
  vip: string
}

export interface VlanEvent {
  kind: "started" | "stopped" | "peer" | "error" | "log"
  peer?: { id: string; vip: string; state: VlanPeerState }
  text?: string
}

export interface VlanSignalOut {
  to: string
  data: Record<string, unknown>
}

/** vlan_helper_status（REALTIME.md §7.4） */
export interface VlanHelperStatus {
  elevated: boolean
  helper_running: boolean
}

/** `room.signal` 中 kind 以 `vlan-` 开头的信令（握手 / bye），全部交给 vlan_signal_in */
export function isVlanSignal(data: unknown): data is { kind: string } & Record<string, unknown> {
  return (
    typeof data === "object" &&
    data !== null &&
    typeof (data as { kind?: unknown }).kind === "string" &&
    ((data as { kind: string }).kind).startsWith("vlan-")
  )
}
