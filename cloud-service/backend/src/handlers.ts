import bcrypt from "bcryptjs";
import type postgres from "postgres";
import type { Context } from "hono";
import type { Hono } from "hono";
import { issueToken } from "./auth";
import { isUniqueViolation } from "./db";
import type { AppEnv } from "./types";
import { nullIfEmpty, readJSON } from "./util";

interface RegisterBody {
  email?: string;
  password?: string;
  username?: string;
}

interface LoginBody {
  email?: string;
  password?: string;
}

interface UpdateMeBody {
  username?: string | null;
  avatar_url?: string | null;
}

const BCRYPT_COST = 10; // 与 Go bcrypt.DefaultCost 一致

export function registerPublicRoutes(app: Hono<AppEnv>): void {
  app.get("/api/health", (c) => c.json({ ok: true, time: new Date().toISOString() }));
  app.post("/api/register", handleRegister);
  app.post("/api/login", handleLogin);
  app.post("/api/logout", (c) => c.json({ ok: true }));
  app.patch("/api/me", handleUpdateMe);
  app.get("/api/me", handleMe);
  app.get("/api/settings", handleGetSettings);
  app.put("/api/settings", handlePutSettings);
}

function invalidBody(c: Context<AppEnv>): Response {
  return c.json({ error: "请求体格式错误" }, 400);
}

function cleanEmail(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

async function handleRegister(c: Context<AppEnv>): Promise<Response> {
  const body = await readJSON<RegisterBody>(c.req.raw);
  if (!body) return invalidBody(c);

  const email = cleanEmail(body.email);
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (email === "" || !email.includes("@")) {
    return c.json({ error: "邮箱格式不正确" }, 400);
  }
  if (password.length < 8) {
    return c.json({ error: "密码至少 8 位" }, 400);
  }

  let hash: string;
  try {
    hash = await bcrypt.hash(password, BCRYPT_COST);
  } catch {
    return c.json({ error: "密码加密失败" }, 500);
  }

  const sql = c.get("sql");
  let id: string;
  try {
    const rows = await sql`
      INSERT INTO public.accounts (email, password_hash, username)
      VALUES (${email}, ${hash}, ${nullIfEmpty(username)})
      RETURNING id`;
    id = rows[0]!.id as string;
  } catch (err) {
    if (isUniqueViolation(err)) {
      return c.json({ error: "该邮箱已注册" }, 409);
    }
    console.error("注册失败:", err);
    return c.json({ error: "注册失败" }, 500);
  }

  try {
    const { token, expiresAt } = await issueToken(c.env, id);
    return c.json(
      {
        token,
        expires_at: expiresAt.toISOString(),
        user: { id, email, username: nullIfEmpty(username) },
      },
      201,
    );
  } catch {
    return c.json({ error: "生成令牌失败" }, 500);
  }
}

async function handleLogin(c: Context<AppEnv>): Promise<Response> {
  const body = await readJSON<LoginBody>(c.req.raw);
  if (!body) return invalidBody(c);

  const email = cleanEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";

  const sql = c.get("sql");
  let rows: postgres.RowList<Record<string, unknown>[]>;
  try {
    rows = await sql`
      SELECT id, email, password_hash, username, avatar_url
      FROM public.accounts WHERE email = ${email}`;
  } catch (err) {
    console.error("查询账户失败:", err);
    return c.json({ error: "查询账户失败" }, 500);
  }
  const acc = rows[0] as
    | { id: string; email: string; password_hash: string; username: string | null; avatar_url: string | null }
    | undefined;
  if (!acc) {
    return c.json({ error: "邮箱或密码不正确" }, 401);
  }

  const valid = await bcrypt.compare(password, acc.password_hash);
  if (!valid) {
    return c.json({ error: "邮箱或密码不正确" }, 401);
  }

  try {
    const { token, expiresAt } = await issueToken(c.env, acc.id);
    return c.json({
      token,
      expires_at: expiresAt.toISOString(),
      user: { id: acc.id, email: acc.email, username: acc.username, avatar_url: acc.avatar_url },
    });
  } catch {
    return c.json({ error: "生成令牌失败" }, 500);
  }
}

async function handleMe(c: Context<AppEnv>): Promise<Response> {
  const userID = c.get("userID");
  const sql = c.get("sql");
  let rows: postgres.RowList<Record<string, unknown>[]>;
  try {
    rows = await sql`
      SELECT id, email, username, avatar_url, created_at
      FROM public.accounts WHERE id = ${userID}`;
  } catch (err) {
    console.error("查询账户失败:", err);
    return c.json({ error: "查询账户失败" }, 500);
  }
  const acc = rows[0] as
    | { id: string; email: string; username: string | null; avatar_url: string | null; created_at: Date }
    | undefined;
  if (!acc) {
    return c.json({ error: "账户不存在" }, 404);
  }
  return c.json({
    user: {
      id: acc.id,
      email: acc.email,
      username: acc.username,
      avatar_url: acc.avatar_url,
      created_at: acc.created_at.toISOString(),
    },
  });
}

/** 只更新显式提供的字段；提供的字段 trim 后为空串时按 SQL COALESCE 语义视为不更新。 */
async function handleUpdateMe(c: Context<AppEnv>): Promise<Response> {
  const body = await readJSON<UpdateMeBody>(c.req.raw);
  if (!body) return invalidBody(c);

  const username =
    body.username != null && typeof body.username === "string"
      ? body.username.trim() || null
      : null;
  const avatarURL =
    body.avatar_url != null && typeof body.avatar_url === "string"
      ? body.avatar_url.trim() || null
      : null;

  const sql = c.get("sql");
  try {
    await sql`
      UPDATE public.accounts
      SET username = COALESCE(${username}, username),
          avatar_url = COALESCE(${avatarURL}, avatar_url)
      WHERE id = ${c.get("userID")}`;
  } catch (err) {
    console.error("更新资料失败:", err);
    return c.json({ error: "更新资料失败" }, 500);
  }
  return c.json({ ok: true });
}

async function handleGetSettings(c: Context<AppEnv>): Promise<Response> {
  const sql = c.get("sql");
  const rows = await sql`
    SELECT COALESCE(settings, '{}'::jsonb) AS settings
    FROM public.user_settings WHERE account_id = ${c.get("userID")}`.catch(() => []);
  const row = rows[0] as { settings: unknown } | undefined;
  return c.json({ settings: row?.settings ?? {} });
}

async function handlePutSettings(c: Context<AppEnv>): Promise<Response> {
  const body = await readJSON<{ settings?: unknown }>(c.req.raw);
  if (body === null) return invalidBody(c);
  const settings = body.settings === undefined || body.settings === null ? {} : body.settings;

  const sql = c.get("sql");
  try {
    await sql`
      INSERT INTO public.user_settings (account_id, settings)
      VALUES (${c.get("userID")}, ${JSON.stringify(settings)}::jsonb)
      ON CONFLICT (account_id)
      DO UPDATE SET settings = EXCLUDED.settings`;
  } catch (err) {
    console.error("保存设置失败:", err);
    return c.json({ error: "保存设置失败" }, 500);
  }
  return c.json({ ok: true });
}
