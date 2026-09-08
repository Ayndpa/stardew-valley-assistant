# 联机系统协议规范（账号 / 好友 / 大厅 / 房间 / 私聊）

本文是服务端（`cloud-service/backend`）与桌面端（`desktop-app`）的共同契约。
两侧实现必须严格遵守本文中的路径、字段名与语义。

## 0. 总体设计

- **HTTP（Hono，`/api/*`）** 只负责需要持久化的数据：账号、资料、云设置、好友关系。
- **WebSocket（Durable Object）** 负责一切实时能力：在线状态、私聊、大厅、房间、聊天、ICE 信令转发。
  服务端**只做转发、不落库**：聊天内容与信令仅在内存中经手，不写入任何存储。
  Durable Object storage 里只保存"运行态"（谁在线、房间里有谁、房间列表）。
- 三种 Durable Object，全部使用 WebSocket Hibernation API（`acceptWebSocket`）：
  - `UserHub`：`idFromName(userId)`，每用户一个。承载该用户的所有客户端连接（多端同时在线允许），
    负责好友在线状态广播、私聊转发、房间邀请转发、好友关系变更推送。
  - `Lobby`：`idFromName("global")`，全局唯一。房间目录 + 大厅聊天 + 大厅在线成员。
  - `GameRoom`：`idFromName(code)`，每房间一个。成员列表 + 房间聊天 + 成员间 `signal` 定向转发（供 P2P ICE 握手）。
- 所有 WebSocket 帧均为 UTF-8 文本 JSON，形如 `{"type": "...", ...}`。二进制帧一律拒绝。
- 鉴权：升级请求携带 `?token=<JWT>`（浏览器 WebSocket 无法自定义 Header）。
  Worker 在升级前校验 JWT（与 `/api/*` 相同的 `JWT_SECRET`、HS256），并查询数据库取得 `username`
  与好友 ID 列表，通过内部 Header（`x-user-id`、`x-user-name`、`x-friends`）转交给 DO。
  DO 内部端点（`/internal/*`）仅可经 stub 调用，外部路由永远不会转发到这些路径。

### 0.1 通用帧

| 方向 | type | 字段 | 说明 |
| --- | --- | --- | --- |
| C→S | `ping` | — | 应用层心跳，服务端回 `pong` |
| S→C | `pong` | — | |
| S→C | `error` | `code`, `message` | 出错；部分错误后服务端会关闭连接（见各节） |

通用错误码：`bad_message`（非法 JSON / 二进制帧 / 缺字段）、`bad_type`（未知 type）、
`unauthorized`（token 缺失、无效、过期；升级阶段直接返回 HTTP 401）、`too_large`（超限）、
`rate_limited`（发送过快）。

### 0.2 用户摘要对象 `UserBrief`

```jsonc
{ "id": "uuid", "username": "显示名或 null", "avatar_url": "url 或 null" }
```

username 为 null 时，客户端显示 `id` 前 8 位。

### 0.3 限制

- 聊天文本（私聊 / 大厅 / 房间）：去首尾空白后 1~2000 个字符（按 code point 计），控制字符（< 0x20，除 `\n`）剔除。
- `room.signal` 的 `data` 序列化后 ≤ 32 KB。
- 单帧 ≤ 64 KB，超限直接以 1009 关闭。
- 发送频率：同一连接每 10 秒最多 20 条聊天消息，超出回 `rate_limited` 并丢弃该条。
- 房间：`name` 1~32 字符；`max` 2~8；`password` 0~32 字符（空串或缺省表示无密码）。
- 房间号 `code`：6 位，字母表 `23456789ABCDEFGHJKMNPQRSTUVWXYZ`，服务端生成，统一大写。

## 1. HTTP API（新增部分，均需 `Authorization: Bearer <JWT>`）

现有接口（register / login / me / settings）见 `cloud-service/README.md`，不变。

### 1.1 数据表 `public.friendships`

```sql
CREATE TABLE IF NOT EXISTS public.friendships (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    requester_id uuid NOT NULL REFERENCES public.accounts (id) ON DELETE CASCADE,
    addressee_id uuid NOT NULL REFERENCES public.accounts (id) ON DELETE CASCADE,
    status       text NOT NULL CHECK (status IN ('pending', 'accepted')),
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CHECK (requester_id <> addressee_id),
    UNIQUE (requester_id, addressee_id)
);
CREATE INDEX IF NOT EXISTS friendships_addressee_idx ON public.friendships (addressee_id, status);
CREATE INDEX IF NOT EXISTS friendships_requester_idx ON public.friendships (requester_id, status);
```

同一对用户任意方向只允许存在一行（应用层保证：创建前检查两个方向）。
需同时写入 `backend/schema.sql` 与 `backend/src/db.ts` 的 `SCHEMA_STATEMENTS`。
另需为 `accounts.username` 增加大小写不敏感索引：`CREATE INDEX IF NOT EXISTS accounts_username_lower_idx ON public.accounts (lower(username))`。

### 1.2 接口

| 方法 | 路径 | 请求 | 响应 |
| --- | --- | --- | --- |
| GET | `/api/users/lookup?q=` | q 为邮箱或用户名（精确匹配，大小写不敏感，去空白） | `{ "users": UserBrief[] }`（最多 10 条，不含自己，**不返回邮箱**） |
| GET | `/api/friends` | — | `{ "friends": (UserBrief & { "since": ISO })[] }` |
| GET | `/api/friends/requests` | — | `{ "incoming": Req[], "outgoing": Req[] }`，`Req = { id, user: UserBrief, created_at }`（incoming 的 user 是发起者，outgoing 的 user 是接收者） |
| POST | `/api/friends/requests` | `{ "user_id": uuid }` | 201 `{ "request": Req, "accepted": bool }`。若对方已向我发起 pending 申请，则直接接受并返回 `accepted: true`；已是好友 → 409 `already_friends`；已有待处理申请 → 409 `already_requested`；自己 → 400；用户不存在 → 404 |
| POST | `/api/friends/requests/:id/accept` | — | `{ "ok": true, "friend": UserBrief }`；仅 addressee 可接受，否则 404 |
| POST | `/api/friends/requests/:id/decline` | — | `{ "ok": true }`；addressee 拒绝或 requester 撤回均用此接口（删除该行） |
| DELETE | `/api/friends/:userId` | — | `{ "ok": true }`；删除 accepted 关系（任一方向） |

错误响应统一 `{ "error": "人类可读中文", "code": "机器码（可选）" }`。

### 1.3 实时联动

以下 HTTP 操作成功后，后端必须通过 `env.USER_HUB` stub 调用双方 `UserHub` 的
`POST /internal/notify`，推送 `friends.changed`（见 §2.3），并在好友集合变化时附带最新好友 ID 列表让 DO 更新缓存：

- 发起申请 → 通知接收方（`reason: "request"`）
- 接受 → 通知双方（`reason: "accepted"`），双方 DO 更新好友集合并互相同步在线状态
- 拒绝 / 撤回 → 通知双方（`reason: "declined"`）
- 删除好友 → 通知双方（`reason: "removed"`），双方 DO 移除好友

`PATCH /api/me` 修改用户名后也应通知本人 `UserHub` 更新缓存的 `username`（`POST /internal/profile`）。

## 2. WebSocket：`/ws/hub?token=`（UserHub）

登录后客户端**始终保持**一条 hub 连接。

### 2.1 连接建立

升级成功后服务端立即推送：

```jsonc
{ "type": "hub.ready",
  "user": UserBrief,
  "friends": [ { ...UserBrief, "online": true } ] }
```

`online` 由 UserHub 并行询问各好友 DO 的 `GET /internal/status` 得到。

本用户从"无连接"变为"有连接"时，向所有好友 DO 广播 `presence online=true`；
最后一条连接断开时广播 `online=false`。中间的多端连接变化不广播。

### 2.2 私聊

| 方向 | type | 字段 |
| --- | --- | --- |
| C→S | `dm.send` | `to`(uuid), `text`, `cid`(客户端消息 ID，任意字符串 ≤ 64) |
| S→C（发送方所有连接） | `dm.ack` | `cid`, `to`, `delivered`(bool：对方当时是否有在线连接), `ts`(ms) |
| S→C（接收方所有连接） | `dm` | `from`: UserBrief, `text`, `ts` |
| S→C（发送方其他连接） | `dm.echo` | `to`, `text`, `ts`, `cid`（多端同步：让另一台设备也看到自己发出的消息） |

`to` 不是好友 → `error code=not_friend`，丢弃。对方离线 → 仍回 `dm.ack delivered=false`，消息丢弃（不存储）。

### 2.3 好友事件

| 方向 | type | 字段 |
| --- | --- | --- |
| S→C | `presence` | `user_id`, `online`(bool) |
| S→C | `friends.changed` | `reason`: `"request" \| "accepted" \| "declined" \| "removed"`, `user`: UserBrief（对方） |

客户端收到 `friends.changed` 后重新拉取 `/api/friends` 与 `/api/friends/requests`。

### 2.4 房间邀请

| 方向 | type | 字段 |
| --- | --- | --- |
| C→S | `invite.send` | `to`(uuid，必须是好友), `room`: `{ code, name }` |
| S→C（接收方） | `invite` | `from`: UserBrief, `room`: `{ code, name }`, `ts` |
| S→C（发送方） | `invite.ack` | `to`, `delivered` |

### 2.5 DO 内部端点（仅 stub 调用）

- `GET /internal/status` → `{ "online": bool }`
- `POST /internal/notify` body 为任意 S→C 帧，DO 原样推送给本用户所有连接；返回 `{ "delivered": bool }`
  （`delivered` = 推送时至少有一条在线连接）。
  当帧为 `friends.changed` 且附带 `friend_ids: string[]` 时，DO 用它替换好友集合缓存（该字段不下发给客户端）。
  当帧为 `presence` 时也走此端点。
- `POST /internal/profile` body `{ "username", "avatar_url" }` → 更新缓存。

DO storage 键：`profile`（UserBrief）、`friends`（string[]）。WebSocket attachment 保存 `{ connId }`。

## 3. WebSocket：`/ws/lobby?token=`（Lobby）

进入"大厅"页面时连接，离开时断开。

### 3.1 对象

```jsonc
// RoomSummary
{ "code": "ABC234", "name": "一起种地", "host": UserBrief,
  "count": 2, "max": 4, "locked": false, "created_at": 1700000000000 }
```

### 3.2 帧

| 方向 | type | 字段 |
| --- | --- | --- |
| S→C | `lobby.ready` | `user`: UserBrief, `rooms`: RoomSummary[], `members`: UserBrief[]（当前大厅在线用户，去重） |
| S→C | `lobby.rooms` | `rooms`: RoomSummary[]（任何房间变化后全量推送） |
| S→C | `lobby.members` | `members`: UserBrief[]（任何人进出大厅后全量推送） |
| C→S | `lobby.chat` | `text` |
| S→C（所有人含发送者） | `lobby.chat` | `from`: UserBrief, `text`, `ts` |
| C→S | `room.create` | `name`, `max`, `password?` |
| S→C（创建者） | `room.created` | `room`: RoomSummary（`locked` 表示有密码） |

创建房间：Lobby 生成唯一 `code`，调用 `GameRoom` 的 `POST /internal/init`
（body：`{ code, name, max, password, host: UserBrief }`），成功后写入目录并推送 `lobby.rooms`。
创建者随后自行连接 `/ws/room/<code>`。创建者若 60 秒内未加入，房间自动删除（GameRoom 用 alarm 实现）。

### 3.3 DO 内部端点

- `POST /internal/room-update` body RoomSummary → 更新目录并广播 `lobby.rooms`
- `POST /internal/room-remove` body `{ code }` → 删除并广播
- `POST /internal/room-exists` body `{ code }` → `{ exists }`（可选）

Lobby storage 键：`rooms`（`Record<code, RoomSummary>`）。attachment 保存 `UserBrief`。

## 4. WebSocket：`/ws/room/<code>?token=&password=`（GameRoom）

### 4.1 升级阶段校验（失败直接返回 HTTP JSON 错误，不升级）

| 情况 | HTTP | code |
| --- | --- | --- |
| 房间不存在 / 已关闭 | 404 | `room_not_found` |
| 密码错误 | 403 | `bad_password` |
| 已满（不含自己已在房内的情况） | 409 | `room_full` |

同一用户重复连接：新连接顶替旧连接（旧连接收到 `error code=replaced` 后以 4000 关闭）。

### 4.2 帧

```jsonc
// RoomMember
{ ...UserBrief, "joined_at": 1700000000000, "vip": "10.77.0.3" }
```

`vip` 为服务端分配的虚拟局域网 IP（见 §6）：房间内唯一，取 `10.77.0.1 ~ 10.77.0.254` 中最小的空闲值，
成员离开后回收，同一用户重连保持不变。

| 方向 | type | 字段 |
| --- | --- | --- |
| S→C | `room.ready` | `room`: `{ code, name, host_id, max, locked }`, `members`: RoomMember[], `you`: uuid |
| S→C | `room.members` | `room`（同上，host 可能变化）, `members`: RoomMember[] |
| S→C | `room.joined` | `user`: UserBrief |
| S→C | `room.left` | `user`: UserBrief, `reason`: `"leave" \| "kicked" \| "disconnect"` |
| C→S | `room.chat` | `text` |
| S→C（所有人） | `room.chat` | `from`: UserBrief, `text`, `ts` |
| C→S | `room.signal` | `to`(uuid，须在房内), `data`(任意 JSON) |
| S→C（仅 to） | `room.signal` | `from`(uuid), `data` |
| C→S（仅房主） | `room.kick` | `user_id` |
| C→S（仅房主） | `room.close` | — |
| S→C（所有人） | `room.closed` | `reason`: `"host_closed" \| "empty" \| "expired"`，随后服务端以 1000 关闭 |
| C→S | `room.leave` | — （随后服务端关闭连接） |

规则：

- 房主离开（主动或掉线）时，房主转移给 `joined_at` 最早的剩余成员，并广播 `room.members`。
- 最后一人离开 → 通知 Lobby `room-remove`，`storage.deleteAll()`。
- 成员数变化 → 通知 Lobby `room-update`。
- 非房主发 `room.kick` / `room.close` → `error code=forbidden`。
- `room.signal` 的 `data` 由客户端自定义，服务端不解析。桌面端约定：`kind` 以 `vlan-` 开头的信令用于虚拟局域网 ICE 握手（见 §6）。

GameRoom storage 键：`meta`（`{ code, name, max, password, host_id, created_at }`）、`members`（`Record<uuid, RoomMember>`）。
attachment 保存 `{ userId }`。

## 5. 桌面端约定

- 后端地址常量：`https://stardew-api.unmod.online`（Worker `stardew-account-backend` 的自有域名；workers.dev 在国内被阻断，已禁用），
  见 `src/lib/account/config.ts`，允许用 localStorage `accountBaseUrl` 覆盖以便本地调试。
- token 存 localStorage `accountToken`，用户信息缓存 `accountUser`。
- 401 → 清除 token，回到未登录态。
- hub 连接：登录后自动建立，断线指数退避重连（1s→30s），重连后重新拉取好友列表。
- 私聊记录只保存在内存（`Map<friendId, Message[]>`，每人最多 200 条），重启即清空，与"服务端不记录"的语义一致。
- 新消息且用户不在联机页面 → 通过现有 `onShowToast` 提示，并在侧边栏图标显示未读数。

## 6. 虚拟局域网（VLAN，共享 crate `crates/p2p-vlan`，桌面端与手机端的 src-tauri 均以路径依赖引用）

房间内所有开启了虚拟局域网的成员组成同一网段 `10.77.0.0/24` 的虚拟局域网：
每人一块 TUN 虚拟网卡（Windows 用 Wintun，dll 随应用打包在 resources 目录），IP 为服务端分配的 `vip`，MTU 1280。
成员两两之间用 ICE 打洞建立 UDP 直连（`p2p-vlan` 内置的 ICE 核心 `ice.rs`，基于 webrtc-ice，STUN 默认 Google），
构成全互联网状网络；握手信令经后端 `room.signal` 定向转发，服务端不经手任何数据包。

### 6.1 角色与握手

- 每一对成员中，用户 ID 字典序较小者为 `offer`（ICE controlling，调用 dial），较大者为 `answer`（accept）。
- 每个节点在 `vlan_start` 时生成随机 `session` 串（16 位十六进制）。
- 对每个对端：本地收集候选完毕后立即通过 `room.signal` 发送
  `{ "kind": "vlan-handshake", "session": "<本端 session>", "u": ufrag, "p": pwd, "c": [候选串...] }`；
  收到对端握手后（且本端已收集完毕）进入 dial/accept。两端发送顺序无要求。
- 收到的握手若 `session` 与该对端已建立连接时记录的 session 不同，视为对端重启，丢弃旧连接并重新协商。
- `vlan_stop` 时向所有对端发 `{ "kind": "vlan-bye" }`，接收方断开该对端。
- `room.members` 变化时前端调用 `vlan_update_members`：新成员 → 发起协商；离开的成员 → 断开并释放。
- 未开启 VLAN 的成员不会发送握手，对端状态停留在 `connecting`，不影响其他连接。

### 6.2 数据面

- TUN 读到的 IPv4 包按目的地址查对端（`vip → 连接`），找到则作为一个 UDP 数据报原样发送（一包一报，无额外封装）。
- 目的地址为 `10.77.0.255` 或 `255.255.255.255` 时发给所有已连接对端（用于游戏局域网发现广播）。
- 非 IPv4 包（IPv6、ARP 等）、长度 > 1400 字节的包、未知目的地址的包一律丢弃。
- 从对端收到的数据报必须是 IPv4 且源地址等于该对端的 `vip`，否则丢弃（防伪造）；通过后写入 TUN。
- 无加密（与 P2P 聊天一致），后续可加。

### 6.3 Tauri 命令与事件

| 命令 | 参数 | 返回 |
| --- | --- | --- |
| `vlan_start` | `{ selfId: string, vip: string, members: { id: string, vip: string }[] }` | `VlanStatus`（TUN 创建失败时 `Err(String)`，需管理员权限时错误文本以 `需要以管理员身份运行` 开头） |
| `vlan_update_members` | `{ members: { id, vip }[] }` | `void` |
| `vlan_signal_in` | `{ from: string, data: object }`（`data.kind` 以 `vlan-` 开头的 `room.signal`） | `void` |
| `vlan_stop` | — | `void`（幂等） |
| `vlan_status` | — | `VlanStatus` |

```jsonc
// VlanStatus
{ "running": true, "vip": "10.77.0.3", "subnet": "10.77.0.0/24", "mtu": 1280,
  "peers": [ { "id": "uuid", "vip": "10.77.0.1", "state": "connected", "tx_bytes": 0, "rx_bytes": 0 } ],
  "error": null }
// peer.state: "connecting" | "connected" | "failed" | "disconnected"
```

事件：

- `vlan-event`：`{ "kind": "started" | "stopped" | "peer" | "error" | "log", "peer"?: { id, vip, state }, "text"?: string }`
- `vlan-signal-out`：`{ "to": string, "data": object }` — 前端收到后调用 `room.signal` 原样转发给 `to`。

前端约定：进入房间（收到 `room.ready`）后**自动**调用 `vlan_start`（localStorage `vlanAutoJoin` 为 `"false"` 时除外）；
把所有 `room.signal` 中 `kind` 以 `vlan-` 开头的信令交给 `vlan_signal_in`，
`room.members` 变化时调用 `vlan_update_members`，离开房间 / 房间关闭 / 退出登录时调用 `vlan_stop`。
房间面板仍提供「退出 / 重新加入虚拟局域网」按钮与「进房自动加入」开关。
界面展示本机 vip、各成员 vip 与连接状态，并提示「在游戏中选择局域网加入并输入房主的虚拟 IP」。

### 6.4 权限：提权辅助进程

创建 Wintun 网卡需要管理员权限，但应用本身以普通权限运行。因此 VLAN 引擎**始终运行在一个辅助进程**里：

- 辅助进程就是应用自身的可执行文件，以 `--vlan-helper <管道名> --wintun-dll <路径> --token <随机串>` 参数启动；
  `main.rs` 在初始化 Tauri 之前识别该参数，直接进入辅助进程主循环（不加载 Tauri、不触发单实例插件），管道断开即退出。
- 应用未提权时用 `ShellExecuteW(verb = "runas")` 启动辅助进程（弹出一次 UAC）；应用已提权时用普通 `Command` 启动（无提示）。
- 辅助进程在应用运行期间常驻（首次进房时拉起），避免每次进房重复弹 UAC；应用退出时随管道断开而退出。
- 管道：应用创建命名管道服务端 `\\.\pipe\stardew-vlan-<随机串>`（单实例、仅当前用户可访问），辅助进程作为客户端连接，
  首帧必须是 `{"op":"hello","token":"<随机串>"}`，token 不匹配立即断开。
- 协议：UTF-8 JSON 行。应用→辅助：`{ "id": n, "op": "start" | "update_members" | "signal_in" | "stop" | "status" | "shutdown", ...参数同 §6.3 }`；
  辅助→应用：`{ "reply": n, "ok": true, "result": ... }` 或 `{ "reply": n, "ok": false, "error": "..." }`，以及异步 `{ "event": VlanEvent }`
  （`VlanEvent` 形状同 `vlan-event` payload；`vlan-signal-out` 以 `{ "event": { "kind": "signal_out", "to", "data" } }` 表示）。
- Tauri 命令接口（§6.3）保持不变；`vlan_start` 在辅助进程未运行时先拉起它。
  新增命令 `vlan_helper_status()` → `{ "elevated": bool, "helper_running": bool }`。
- 用户在 UAC 中拒绝 → `vlan_start` 返回以 `未获得管理员权限` 开头的错误；前端显示带「重试」按钮的提示。
  拉起过程中通过 `vlan-event` 推送 `{ "kind": "log", "text": "正在申请管理员权限…" }`。
