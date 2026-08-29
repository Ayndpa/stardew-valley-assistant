# 账户系统 (account-system)

星露谷物语助手的独立账户系统：**Cloudflare Workers 后端（TypeScript + Hono）+ 本地 CLI 管理器（TypeScript + Bun）**，复用现有 Supabase 数据库（与主软件 `stardew-valley-assistant` 同一个 PostgreSQL 项目，`mrmllvptnjlggskghkka`）。

## 架构

```
account-system/
├── backend/                  # Cloudflare Workers 后端（直连 PostgreSQL）
│   ├── wrangler.toml         # Workers 配置（Hyperdrive 绑定可选）
│   ├── .dev.vars.example     # 本地开发环境变量示例
│   ├── schema.sql            # 可手动执行的建表 SQL
│   └── src/
│       ├── index.ts          # Worker 入口（默认导出 Hono app）
│       ├── app.ts            # 路由装配 + CORS/日志/DB 中间件
│       ├── types.ts          # 环境绑定类型
│       ├── db.ts             # postgres.js 客户端 + 幂等建表
│       ├── auth.ts           # JWT 签发/校验 + AUTH/ADMIN 中间件
│       ├── handlers.ts       # 注册/登录/资料/设置 API
│       ├── admin.ts          # 管理接口 /api/admin/*
│       └── util.ts           # 常数时间比较 / UUID 校验等
└── cli/                      # 本地远程管理器（Bun 运行，零运行时依赖，非交互）
    └── src/
        ├── index.ts          # 入口 + 全局选项解析 + 命令分发
        ├── client.ts         # HTTP 客户端 + 账户标识解析
        ├── ops.ts            # users / settings / status / config 命令
        └── config.ts         # 本地配置（admin.json）
```

## 设计要点

- **后端自管账户**：不使用 Supabase Auth，而是 Workers 后端直连 PostgreSQL（`postgres.js`，Workers 下走 `cloudflare:sockets`，支持 Hyperdrive/Supavisor 池化），密码用 `bcryptjs` 哈希，登录签发自签名 JWT（HS256，7 天有效期）。
- **复用现有数据库**：连接串指向现有 Supabase 项目，新增 `accounts` / `user_settings` 两张表（`backend/schema.sql`），与翻译共享库等现有表共存。
- **云同步载体**：`user_settings` 表用 JSONB，为「手机电脑互通」预留配置/数据同步。
- **远程管理**：CLI 在本地通过 HTTP 调用后端 `/api/admin/*`（`ADMIN_KEY` 鉴权），与数据库完全解耦。
- **bcrypt 成本**：`bcryptjs` 为纯 JS 实现，成本 10（与原 Go 版一致）。Workers 免费计划 CPU 限额约 10ms，注册/登录可能超限；建议在付费计划运行，或按需降低成本。

## 快速开始

### 1. 数据库

```bash
# 在 supabase 项目中应用表结构（二选一）
# 方式 A：Supabase CLI
supabase db push
# 方式 B：psql 手动执行
psql "$DATABASE_URL" -f backend/schema.sql
```

### 2. 后端（Cloudflare Workers）

```bash
cd backend
bun install
cp .dev.vars.example .dev.vars   # 本地开发：填 DATABASE_URL、JWT_SECRET、ADMIN_KEY
bun run dev                      # wrangler dev 本地启动，默认 :8787

# 部署
bunx wrangler secret put DATABASE_URL
bunx wrangler secret put JWT_SECRET
bunx wrangler secret put ADMIN_KEY   # 不设置则禁用管理接口
bun run deploy
```

生产环境推荐接入 Hyperdrive 连接池（见 `wrangler.toml` 注释）；未配置时使用 `DATABASE_URL`（建议使用 Supabase Supavisor 池化连接串）。

### 3. CLI 管理器

```bash
cd cli
bun install
bun run . config set-base-url http://127.0.0.1:8787   # 本地 dev 默认 :8787
bun run . config set-key <后端 ADMIN_KEY>
bun run . status          # 健康检查 + 管理接口验证
bun run . users list
```

## API

公开接口：

| 方法 | 路径            | 说明                     | 鉴权 |
| ---- | --------------- | ------------------------ | ---- |
| GET  | `/api/health`   | 健康检查                 | 否   |
| POST | `/api/register` | 注册（邮箱 + bcrypt 密码）| 否   |
| POST | `/api/login`    | 登录，返回 JWT           | 否   |
| GET  | `/api/me`       | 当前用户资料             | Bearer JWT |
| PATCH| `/api/me`       | 更新用户名/头像          | Bearer JWT |
| GET  | `/api/settings` | 读取用户设置（JSONB）    | Bearer JWT |
| PUT  | `/api/settings` | 保存用户设置             | Bearer JWT |
| POST | `/api/logout`   | 退出（无状态，前端清 token）| 否 |

管理接口（`Authorization: Bearer <ADMIN_KEY>`；服务端未配置 `ADMIN_KEY` 时一律返回 503，视为禁用）：

| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| GET  | `/api/admin/users?limit=&offset=&email=&q=` | 账户列表/搜索（返回 `{users, total}`） |
| POST | `/api/admin/users` | 创建账户 `{email, password, username}` |
| GET  | `/api/admin/users/{id}` | 账户详情（含云设置） |
| PATCH| `/api/admin/users/{id}` | 更新 `{username?, avatar_url?, password?}`，空串表示清除 |
| DELETE| `/api/admin/users/{id}` | 删除账户（级联删除云设置） |
| GET  | `/api/admin/users/{id}/settings` | 读取云设置 `{settings}` |
| PUT  | `/api/admin/users/{id}/settings` | 覆盖云设置 `{settings}` |
| DELETE| `/api/admin/users/{id}/settings` | 清空云设置 |

## CLI 管理器

`cli/` 是**非交互式**的远程管理工具（TypeScript + Bun，零运行时依赖），在本地通过 HTTP 控制已部署的后端：

```bash
cd cli
bun run . status                                    # 服务 + 管理接口状态
bun run . users list                                # 账户列表
bun run . users create someone@example.com          # 创建账户，密码自动生成并打印
bun run . users reset-password someone@example.com  # 重置密码，自动生成
bun run . settings get someone@example.com          # 查看云设置
bun run . -j users list                             # -j/--json 输出 JSON，便于脚本
```

命令一览：

| 命令 | 说明 |
| ---- | ---- |
| `status` | 健康检查 + 管理接口验证 |
| `users list [N]` / `users search <keyword>` | 列表 / 按邮箱或用户名搜索 |
| `users show <id\|email>` | 账户详情（含云设置） |
| `users create <email> [password] [name]` | 创建账户，密码留空自动生成 |
| `users delete <id\|email> --yes` | 删除账户（级联删除云设置，必须显式 `--yes`） |
| `users reset-password <id\|email> [new]` | 重置密码，留空自动生成 |
| `users set-username <id\|email> [name]` | 修改用户名，留空清除 |
| `settings get <id\|email>` | 查看云设置 JSON |
| `settings set <id\|email> <file\|->` | 导入云设置（`-` 为标准输入） |
| `settings clear <id\|email> --yes` | 清空云设置（必须显式 `--yes`） |
| `config show / set-base-url / set-key / gen-key` | 本地配置管理 |

说明：

- **配置优先级**：命令行 `-b/--base-url`、`-k/--key` > 环境变量 `ADMIN_BASE_URL`、`ADMIN_KEY` > `cli/admin.json`（`config set-*` 保存，已加入 .gitignore）> 默认 `http://127.0.0.1:8080`。
- **账户标识**：命令中的 `<id|email>` 支持 UUID 或邮箱，CLI 自动把邮箱解析为后端账户 ID。

## 环境变量（backend / Workers）

| 变量          | 说明                             |
| ------------- | -------------------------------- |
| `DATABASE_URL`| Supabase 数据库连接串（或改用 Hyperdrive 绑定） |
| `JWT_SECRET`  | JWT 签名密钥（生产务必更换）     |
| `ADMIN_KEY`   | 管理接口密钥（CLI 远程管理用；不设置则禁用 `/api/admin/*`） |

本地开发写入 `backend/.dev.vars`；生产用 `bunx wrangler secret put <name>` 设置。
