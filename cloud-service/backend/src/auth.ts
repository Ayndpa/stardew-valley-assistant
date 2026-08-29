import { sign, verify } from "hono/jwt";
import type { Context, Next } from "hono";
import type { AppEnv, Env } from "./types";
import { jwtSecret } from "./types";
import { timingSafeEqual } from "./util";

const TOKEN_TTL_SECONDS = 7 * 24 * 3600;

export async function issueToken(
  env: Env,
  userID: string,
): Promise<{ token: string; expiresAt: Date }> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + TOKEN_TTL_SECONDS;
  const token = await sign({ uid: userID, iss: "account-system", iat: now, exp }, jwtSecret(env));
  return { token, expiresAt: new Date(exp * 1000) };
}

async function parseToken(env: Env, token: string): Promise<string | null> {
  try {
    const payload = await verify(token, jwtSecret(env), "HS256");
    return typeof payload.uid === "string" ? payload.uid : null;
  } catch {
    return null;
  }
}

/** Bearer JWT 鉴权，通过后把 userID 放进上下文。 */
export async function requireAuth(c: Context<AppEnv>, next: Next): Promise<Response | void> {
  const auth = c.req.header("Authorization") ?? "";
  if (!auth.startsWith("Bearer ") || auth.length <= 7) {
    return c.json({ error: "未登录" }, 401);
  }
  const uid = await parseToken(c.env, auth.slice(7));
  if (!uid) {
    return c.json({ error: "无效或过期的令牌" }, 401);
  }
  c.set("userID", uid);
  await next();
}

/** ADMIN_KEY 鉴权；服务端未配置时一律 503 视为禁用。 */
export async function requireAdmin(c: Context<AppEnv>, next: Next): Promise<Response | void> {
  if (!c.env.ADMIN_KEY) {
    return c.json({ error: "管理接口未启用（服务端未配置 ADMIN_KEY）" }, 503);
  }
  const auth = c.req.header("Authorization") ?? "";
  if (!auth.startsWith("Bearer ") || auth.length <= 7) {
    return c.json({ error: "管理密钥无效" }, 401);
  }
  if (!timingSafeEqual(auth.slice(7), c.env.ADMIN_KEY)) {
    return c.json({ error: "管理密钥无效" }, 401);
  }
  await next();
}
