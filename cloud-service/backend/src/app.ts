import { Hono } from "hono";
import { cors } from "hono/cors";
import { registerAdminRoutes } from "./admin";
import { requireAdmin, requireAuth } from "./auth";
import { createDB, ensureSchema } from "./db";
import { registerFriendRoutes } from "./friends";
import { registerPublicRoutes } from "./handlers";
import { registerRealtimeRoutes } from "./realtime/routes";
import type { AppEnv } from "./types";

// 桌面端来源：Vite dev（:1420）与 Tauri 打包后的 WebView 来源
const ALLOWED_ORIGINS = [
  "http://localhost:1420",
  "http://127.0.0.1:1420",
  "http://tauri.localhost",
  "https://tauri.localhost",
  "tauri://localhost",
];

export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // 访问日志
  app.use("*", async (c, next) => {
    const start = Date.now();
    await next();
    console.log(`${c.req.method} ${c.req.path} (${Date.now() - start}ms)`);
  });

  // CORS：仅 HTTP API 需要；WebSocket 升级响应（101）不能被中间件改写头部，故不覆盖 /ws/*
  app.use(
    "/api/*",
    cors({
      origin: ALLOWED_ORIGINS,
      allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
      maxAge: 86400,
    }),
  );

  // WebSocket 路由（/ws/*）：自行建立数据库连接，不走下方 /api/* 的 DB 中间件
  registerRealtimeRoutes(app);

  // 每请求建立数据库客户端（Workers 池化连接按请求创建、用完即还）
  app.use("/api/*", async (c, next) => {
    let sql;
    try {
      sql = createDB(c.env);
    } catch (err) {
      console.error("数据库配置错误:", err);
      return c.json({ error: (err as Error).message }, 500);
    }
    c.set("sql", sql);
    try {
      await ensureSchema(sql); // 幂等建表，隔离实例内只执行一次
    } catch (err) {
      console.error("初始化表结构失败:", err);
      await sql.end({ timeout: 1 }).catch(() => {});
      return c.json({ error: "初始化数据库失败" }, 500);
    }
    try {
      await next();
    } finally {
      await sql.end({ timeout: 1 }).catch(() => {});
    }
  });

  // 鉴权中间件必须在路由处理器之前注册
  app.use("/api/me", requireAuth);
  app.use("/api/settings", requireAuth);
  app.use("/api/users/*", requireAuth);
  // "/api/friends" 只匹配精确路径，需同时覆盖 "/api/friends/*"
  app.use("/api/friends", requireAuth);
  app.use("/api/friends/*", requireAuth);
  app.use("/api/admin/*", requireAdmin);

  registerPublicRoutes(app);
  registerFriendRoutes(app);
  registerAdminRoutes(app);

  app.onError((err, c) => {
    console.error("未处理异常:", err);
    return c.json({ error: "服务器内部错误" }, 500);
  });

  app.notFound((c) => c.json({ error: "Not Found" }, 404));

  return app;
}
