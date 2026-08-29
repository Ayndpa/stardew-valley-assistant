# Signaling Server —— P2P ICE 快速连接信令服务器（Cloudflare Workers）

为 `p2p-ice-chat` 提供两端"快速连接"的信令服务器，运行在 Cloudflare Workers 上：
**每个房间一个 Durable Object**（SQLite 版，免费计划可用），采用 WebSocket Hibernation API
——房间空闲时实例被平台卸载而连接保持，来消息才唤醒。**只做配对与信令转发，不做中继**：

- **房间配对** —— 两端用相同房间号入房即可配对，免复制粘贴连接码；
- **信令转发** —— 把一端的握手信息（ICE ufrag/pwd + 候选地址）原样转发给对端；
- **保活** —— 协议层 ping/pong 由边缘托管，死连接由平台判定并触发 `peer-left`。

P2P 打通后客户端立即发送 `bye` 与服务器告别，之后所有聊天数据直接在两端之间流动，
**服务器对聊天内容零感知、不经手任何数据包**（这是设计契约，不是附带结果：
服务器唯一会转发的消息类型就是 `signal`，且单条不超过 32KB）。

## 部署

```bash
cd cloud-service/signaling-server
npm install
npx wrangler login        # 首次使用需登录 Cloudflare 账号
npx wrangler deploy       # 部署成功后会输出 workers.dev 域名
```

客户端用法（注意协议是 `wss://`）：

```bash
# 双方都执行，房间号相同即可自动配对；角色由服务器按入房顺序分配
cargo run -- --server wss://ice-signaling.<你的子域>.workers.dev/ws --room GAME1

# 省略 --room 时服务器随机分配 6 位房间号并打印出来，
# 把它告诉对方：cargo run -- --server wss://.../ws --room <房间号>
```

可选访问控制（设置后客户端 hello 必须携带相同 token）：

```bash
npx wrangler secret put SIGNALING_TOKEN
```

绑定自有域名：在 Cloudflare 控制台该 Worker 的 Settings → Domains & Routes 添加，
客户端 `--server` 换成自己的域名即可。

## 本地开发

```bash
npx wrangler dev --port 9877
```

- 本地跑在 `ws://127.0.0.1:9877/ws`，Durable Object（含 Hibernation）在本地完整模拟
- 端口别用 8788 一类——Windows 会把动态端口段保留给 Hyper-V/WSL
  （`netsh interface ipv4 show excludedportrange protocol=tcp` 可查），
  落在保留段里 workerd 会报 `os error 10013` 拒绝绑定
- 若本机 npm 启用了 install-script 白名单（安装时警告 esbuild/workerd 的
  postinstall 被拦），workerd 二进制可能缺失，手动补齐：

  ```bash
  npm install @cloudflare/workerd-windows-64 --no-save --ignore-scripts
  node node_modules\workerd\install.js
  ```

## 协议规范

传输：WebSocket 文本帧，每帧一个 UTF-8 JSON 信封。
WebSocket 端点为 `GET /ws?room=<房间号>`（房间号取自 URL；缺省时随机分配）。
另有 `GET /healthz`（返回 `ok`）与 `GET /`（简介）可做探活。

### 信封结构

```jsonc
{
  "type": "hello",       // 消息类型，见下表
  "name": "Alice",       // hello: 显示名（≤32 字，控制字符会被剔除）
  "room": "GAME1",       // hello: 期望房间号（仅作参考，实际以 URL ?room= 为准）
  "token": "...",        // hello: 共享密钥（设置 SIGNALING_TOKEN 时必填）
  "role": "offer",       // welcome: 分配的角色
  "peer": false,         // welcome: 对端是否已在房（或已有对端缓冲的握手）
  "code": "room_full",   // error: 错误码
  "message": "...",      // error: 人类可读的错误说明
  "data": { }            // signal: 任意 JSON，服务器不解析、原样转发
}
```

### 消息时序

```
offer 端                          服务器(DO)                     answer 端
  │── {type:"hello"} ───────────▶│                                │
  │◀── {type:"welcome",          │                                │
  │      role:"offer",peer:false}│                                │
  │── {type:"signal",data:握手} ▶│（对端未入房，缓冲并持久化）     │
  │                              │◀── {type:"hello"} ─────────────│
  │                              │──▶ {type:"welcome",            │
  │                              │      role:"answer",peer:true} ─│
  │                              │──▶ {type:"signal",data:缓冲} ──│
  │◀─ {type:"peer-joined",name} ─│                                │
  │◀─ {type:"signal",data:握手} ─│◀── {type:"signal",data:握手} ──│
  │── {type:"bye"} ──▶│          │            ▶── {type:"bye"} ───│
  │     （此后 ICE 打洞、聊天全部 P2P 直连，服务器可下线）           │
```

### 消息类型一览

| 方向 | type | 说明 |
|---|---|---|
| 客户端→服务器 | `hello` | **首条消息**，携带 name/token； hello 完成才算正式入房 |
| 客户端→服务器 | `signal` | `data` 字段原样转发给对端；对端未入房时先缓冲（≤8 条，超出丢最旧），入房后按序补发 |
| 客户端→服务器 | `bye` | 主动离开；对端会收到 `peer-left` |
| 客户端→服务器 | `ping` | 应用层心跳，服务器回 `pong`（协议层 ping/pong 由边缘自动处理） |
| 服务器→客户端 | `welcome` | 入房成功。`room` 为实际房间号（统一大写），`role` 为分配的角色 |
| 服务器→客户端 | `peer-joined` | 对端入房，`name` 为其显示名 |
| 服务器→客户端 | `peer-left` | 对端离开/断开 |
| 服务器→客户端 | `pong` | 心跳应答 |
| 服务器→客户端 | `error` | 出错；`code` 见下表。部分错误后会直接关闭连接 |

### 错误码

| code | 场景 |
|---|---|
| `bad_message` | JSON 解析失败、首条消息不是 hello、signal 缺 data、二进制帧 |
| `bad_type` | 未知的消息类型 |
| `bad_room` | 房间号不合法（需 3~32 位字母/数字/`_`/`-`，HTTP 400） |
| `room_full` | 房间已有两端（仅支持一对一） |
| `unauthorized` | token 缺失或不匹配 |
| `too_large` | signal.data 超过 32KB |

### 角色分配规则

按入房顺序分配：**先到者 `offer`（ICE controlling），后到者 `answer`（controlled）**。
一端掉线后其槽位立即释放，双方重新连入同一房间号即可快速重连；
房间彻底空了会清空状态，同一房间号下次使用等于全新开局。

## 实现要点与资源限制

- 同一房间的两条连接由 `idFromName(房间号)` 保证汇于同一个单线程 DO，无锁无竞态；
- 成员/缓冲信号持久化在 DO storage，休眠唤醒后状态不丢；
- 房间空闲即被平台回收，无需 TTL/GC；
- 限制：单条 WS 消息 64KB / signal.data 32KB / 缓冲 8 条 / 显示名 32 字 / 每房间 2 人
  （平台侧单 DO 最多 32,768 条连接，一个房间只占 2 条）。

## 开发

```bash
npx tsc --noEmit    # 类型检查
npx wrangler dev    # 本地起服（含 DO 模拟），配合 p2p-ice-chat 双开联调
```
