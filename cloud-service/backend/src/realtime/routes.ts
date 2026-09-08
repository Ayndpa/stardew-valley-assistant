/// WebSocket 公共路由：/ws/hub、/ws/lobby、/ws/room/:code。
///
/// Worker 在升级前校验 JWT（与 /api/* 相同）、查库取得用户摘要（hub 还需好友列表），
/// 再通过内部 Header 转交给对应的 Durable Object。永远只转发 /ws/* 路径，
/// DO 的 /internal/* 端点对外不可达。

import type { Context, Hono } from "hono";
import type postgres from "postgres";
import { verifyToken } from "../auth";
import { createDB, ensureSchema } from "../db";
import { loadFriendBriefs, loadUserBrief } from "../friends";
import type { AppEnv } from "../types";
import {
  MAX_ROOM_PASSWORD_CHARS,
  encodeHeaderJSON,
  encodeHeaderText,
  normalizeRoomCode,
  type UserBrief,
} from "./common";

/** 转交给 DO 的内部 Header；转发前先从客户端请求里剔除，防止伪造。 */
const INTERNAL_HEADERS = ["x-user-id", "x-user-name", "x-avatar-url", "x-friends", "x-room-password"];

export function registerRealtimeRoutes(app: Hono<AppEnv>): void {
  app.get("/ws/hub", async (c) => {
    const auth = await authenticate(c, true);
    if (auth instanceof Response) return auth;
    return forward(c, c.env.USER_HUB, auth.user.id, "/ws/hub", {
      ...userHeaders(auth.user),
      "x-friends": encodeHeaderJSON(auth.friends),
    });
  });

  app.get("/ws/lobby", async (c) => {
    const auth = await authenticate(c, false);
    if (auth instanceof Response) return auth;
    return forward(c, c.env.LOBBY, "global", "/ws/lobby", userHeaders(auth.user));
  });

  app.get("/ws/room/:code", async (c) => {
    const code = normalizeRoomCode(c.req.param("code"));
    if (!code) {
      return c.json({ error: "房间号格式不正确", code: "bad_code" }, 400);
    }
    const password = c.req.query("password") ?? "";
    if (Array.from(password).length > MAX_ROOM_PASSWORD_CHARS) {
      return c.json({ error: "密码需为 0~32 个字符", code: "bad_password" }, 400);
    }
    const auth = await authenticate(c, false);
    if (auth instanceof Response) return auth;
    return forward(c, c.env.GAME_ROOM, code, `/ws/room/${code}`, {
      ...userHeaders(auth.user),
      "x-room-password": encodeHeaderText(password),
    });
  });
}

interface AuthResult {
  user: UserBrief;
  friends: UserBrief[];
}

/**
 * 升级前置校验：Upgrade 头（426）、?token=（401）、查库取用户摘要（必要时含好友列表）。
 * 失败返回 Response，成功返回用户信息。
 */
async function authenticate(c: Context<AppEnv>, withFriends: boolean): Promise<AuthResult | Response> {
  if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
    return c.json({ error: "需要 WebSocket 升级", code: "upgrade_required" }, 426);
  }
  const token = c.req.query("token") ?? "";
  const uid = await verifyToken(c.env, token);
  if (!uid) {
    return c.json({ error: "无效或过期的令牌", code: "unauthorized" }, 401);
  }

  let sql: postgres.Sql;
  try {
    sql = createDB(c.env);
  } catch (err) {
    console.error("数据库配置错误:", err);
    return c.json({ error: (err as Error).message }, 500);
  }
  try {
    await ensureSchema(sql);
    const user = await loadUserBrief(sql, uid);
    if (!user) {
      return c.json({ error: "账户不存在", code: "unauthorized" }, 401);
    }
    const friends = withFriends ? await loadFriendBriefs(sql, uid) : [];
    return { user, friends };
  } catch (err) {
    console.error("WebSocket 升级前查询失败:", err);
    return c.json({ error: "查询账户失败" }, 500);
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {});
  }
}

function userHeaders(user: UserBrief): Record<string, string> {
  return {
    "x-user-id": user.id,
    "x-user-name": encodeHeaderText(user.username),
    "x-avatar-url": encodeHeaderText(user.avatar_url),
  };
}

/** 把升级请求原样转交给 DO stub（保留 Upgrade / Sec-WebSocket-* 头），返回 101 或 DO 的 JSON 错误。 */
async function forward(
  c: Context<AppEnv>,
  ns: DurableObjectNamespace,
  name: string,
  path: string,
  extra: Record<string, string>,
): Promise<Response> {
  const headers = new Headers(c.req.raw.headers);
  for (const h of INTERNAL_HEADERS) headers.delete(h);
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);

  const target = new URL(c.req.url);
  target.pathname = path;
  target.search = "";
  const stub = ns.get(ns.idFromName(name));
  return stub.fetch(new Request(target.toString(), { method: "GET", headers }));
}
