# 账户系统 (account-system)

星露谷物语助手的独立账户系统：**React 前端 + Go 后端**，复用现有 Supabase 数据库（与主软件 `stardew-valley-assistant` 同一个 PostgreSQL 项目，`mrmllvptnjlggskghkka`）。

## 架构

```
account-system/
├── backend/                  # Go 后端（独立服务，直连数据库）
│   ├── main.go               # 入口 + HTTP 服务
│   ├── config.go             # 环境变量配置
│   ├── db.go                 # 数据库连接 + 自动建表
│   ├── handlers.go           # 注册/登录/资料/设置 API
│   ├── middleware.go         # CORS / 日志 / JWT 鉴权
│   ├── schema.sql            # 可手动执行的建表 SQL
│   └── .env.example          # 环境变量示例
└── frontend/                 # React 前端（Vite + Tailwind）
    └── src/
        ├── lib/api.ts        # Go API 客户端（JWT 存储）
        ├── lib/auth-context.tsx
        ├── components/       # AuthForm / AccountOverview
        └── App.tsx
```

## 设计要点

- **后端自管账户**：不使用 Supabase Auth，而是 Go 后端直连 PostgreSQL，密码用 `bcrypt` 哈希，登录签发自签名 JWT（HS256，7 天有效期）。
- **复用现有数据库**：连接串指向现有 Supabase 项目，新增 `accounts` / `user_settings` 两张表（`backend/schema.sql`），与翻译共享库等现有表共存。
- **云同步载体**：`user_settings` 表用 JSONB，为「手机电脑互通」预留配置/数据同步。
- **开发代理**：Vite 将 `/api` 代理到 Go 后端（`http://localhost:8080`），无需处理 CORS，与生产同构。

## 快速开始

### 1. 数据库

```bash
# 在 supabase 项目中应用表结构（二选一）
# 方式 A：Supabase CLI
supabase db push
# 方式 B：psql 手动执行
psql "$DATABASE_URL" -f backend/schema.sql
```

### 2. 后端

```bash
cd backend
cp .env.example .env   # 填写 DATABASE_URL（复用现有 Supabase 数据库连接串）、JWT_SECRET
go run .
# 监听 :8080
```

### 3. 前端

```bash
cd frontend
npm install
npm run dev
# 打开 http://localhost:1430
```

## API

| 方法 | 路径            | 说明                     | 鉴权 |
| ---- | --------------- | ------------------------ | ---- |
| POST | `/api/register` | 注册（邮箱 + bcrypt 密码）| 否   |
| POST | `/api/login`    | 登录，返回 JWT           | 否   |
| GET  | `/api/me`       | 当前用户资料             | Bearer |
| PATCH| `/api/me`       | 更新用户名/头像          | Bearer |
| GET  | `/api/settings` | 读取用户设置（JSONB）    | Bearer |
| PUT  | `/api/settings` | 保存用户设置             | Bearer |
| POST | `/api/logout`   | 退出（无状态，前端清 token）| 否 |

## 环境变量

| 变量          | 说明                             |
| ------------- | -------------------------------- |
| `DATABASE_URL`| 现有 Supabase 数据库连接串       |
| `JWT_SECRET`  | JWT 签名密钥（生产务必更换）     |
| `PORT`        | 后端端口（默认 8080）            |