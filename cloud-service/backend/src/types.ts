/// <reference types="@cloudflare/workers-types" />

import type postgres from "postgres";

export interface Env {
  /** Supabase/PostgreSQL 连接串（或通过 Hyperdrive 绑定提供） */
  DATABASE_URL?: string;
  /** 可选 Hyperdrive 绑定，优先于 DATABASE_URL */
  HYPERDRIVE?: Hyperdrive;
  /** JWT 签名密钥 */
  JWT_SECRET?: string;
  /** 管理接口密钥；未设置则禁用 /api/admin/* */
  ADMIN_KEY?: string;
  /** UserHub Durable Object：每用户一个（idFromName(userId)），承载在线状态 / 私聊 / 好友事件 */
  USER_HUB: DurableObjectNamespace;
  /** Lobby Durable Object：全局唯一（idFromName("global")），房间目录 + 大厅聊天 */
  LOBBY: DurableObjectNamespace;
  /** GameRoom Durable Object：每房间一个（idFromName(code)），成员 / 房间聊天 / 信令转发 */
  GAME_ROOM: DurableObjectNamespace;
}

export interface AppEnv {
  Bindings: Env;
  Variables: {
    sql: postgres.Sql;
    userID: string;
  };
}

export const DEFAULT_JWT_SECRET = "dev-insecure-secret-change-me";

export function jwtSecret(env: Env): string {
  return env.JWT_SECRET || DEFAULT_JWT_SECRET;
}
