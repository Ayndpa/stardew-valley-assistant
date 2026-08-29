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
