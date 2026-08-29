import bcrypt from "bcryptjs";
import type postgres from "postgres";
import type { Context } from "hono";
import type { Hono } from "hono";
import { isUniqueViolation } from "./db";
import type { AppEnv } from "./types";
import { isUUID, nullIfEmpty, readJSON } from "./util";

const BCRYPT_COST = 10;

interface AdminUserView {
  id: string;
  email: string;
  username: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
  has_settings: boolean;
  settings_updated_at: string | null;
}

interface AdminUserRow {
  id: string;
  email: string;
  username: string | null;
  avatar_url: string | null;
  created_at: Date;
  updated_at: Date;
  has_settings: boolean;
  settings_updated_at: Date | null;
}

interface AccountRow {
  id: string;
  email: string;
  username: string | null;
  avatar_url: string | null;
  created_at: Date;
  updated_at: Date;
}

function toView(row: AdminUserRow): AdminUserView {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    avatar_url: row.avatar_url,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    has_settings: row.has_settings,
    settings_updated_at: row.settings_updated_at?.toISOString() ?? null,
  };
}

interface CreateBody {
  email?: string;
  password?: string;
  username?: string;
}

interface PatchBody {
  username?: string | null;
  avatar_url?: string | null;
  password?: string | null;
}

function invalidBody(c: Context<AppEnv>): Response {
  return c.json({ error: "请求体格式错误" }, 400);
}

function invalidID(c: Context<AppEnv>): Response {
  return c.json({ error: "无效的账户 ID" }, 400);
}

async function accountExists(sql: postgres.Sql, id: string): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS(SELECT 1 FROM public.accounts WHERE id = ${id}) AS exists`;
  return rows[0]?.exists ?? false;
}

export function registerAdminRoutes(app: Hono<AppEnv>): void {
  app.get("/api/admin/users", adminListUsers);
  app.post("/api/admin/users", adminCreateUser);
  app.get("/api/admin/users/:id", adminGetUser);
  app.patch("/api/admin/users/:id", adminPatchUser);
  app.delete("/api/admin/users/:id", adminDeleteUser);
  app.get("/api/admin/users/:id/settings", adminGetSettings);
  app.put("/api/admin/users/:id/settings", adminPutSettings);
  app.delete("/api/admin/users/:id/settings", adminDeleteSettings);
}

// --- 账户列表 / 搜索 ---

async function adminListUsers(c: Context<AppEnv>): Promise<Response> {
  const email = (c.req.query("email") ?? "").trim().toLowerCase();
  const keyword = (c.req.query("q") ?? "").trim();

  let limit = 50;
  const rawLimit = c.req.query("limit");
  if (rawLimit) {
    const n = Number.parseInt(rawLimit, 10);
    if (Number.isNaN(n) || n <= 0 || n > 200) {
      return c.json({ error: "limit 需为 1-200 的整数" }, 400);
    }
    limit = n;
  }
  let offset = 0;
  const rawOffset = c.req.query("offset");
  if (rawOffset) {
    const n = Number.parseInt(rawOffset, 10);
    if (Number.isNaN(n) || n < 0) {
      return c.json({ error: "offset 需为非负整数" }, 400);
    }
    offset = n;
  }

  const sql = c.get("sql");
  try {
    const rows = await sql<AdminUserRow[]>`
      SELECT a.id, a.email, a.username, a.avatar_url, a.created_at, a.updated_at,
             (us.account_id IS NOT NULL) AS has_settings, us.updated_at AS settings_updated_at
      FROM public.accounts a
      LEFT JOIN public.user_settings us ON us.account_id = a.id
      WHERE (${email} = '' OR a.email = ${email})
        AND (${keyword} = '' OR a.email ILIKE '%' || ${keyword} || '%' OR COALESCE(a.username, '') ILIKE '%' || ${keyword} || '%')
      ORDER BY a.created_at DESC
      LIMIT ${limit} OFFSET ${offset}`;

    const totalRows = await sql<{ total: number }[]>`
      SELECT count(*)::int AS total
      FROM public.accounts a
      WHERE (${email} = '' OR a.email = ${email})
        AND (${keyword} = '' OR a.email ILIKE '%' || ${keyword} || '%' OR COALESCE(a.username, '') ILIKE '%' || ${keyword} || '%')`;
    const total = totalRows[0]?.total ?? 0;

    return c.json({ users: rows.map(toView), total, limit, offset });
  } catch (err) {
    console.error("查询账户失败:", err);
    return c.json({ error: "查询账户失败" }, 500);
  }
}

async function adminGetUser(c: Context<AppEnv>): Promise<Response> {
  const id = c.req.param("id")!;
  if (!isUUID(id)) return invalidID(c);

  const sql = c.get("sql");
  try {
    const rows = await sql<AdminUserRow[]>`
      SELECT a.id, a.email, a.username, a.avatar_url, a.created_at, a.updated_at,
             (us.account_id IS NOT NULL) AS has_settings, us.updated_at AS settings_updated_at
      FROM public.accounts a
      LEFT JOIN public.user_settings us ON us.account_id = a.id
      WHERE a.id = ${id}`;
    const row = rows[0];
    if (!row) {
      return c.json({ error: "账户不存在" }, 404);
    }

    const payload: Record<string, unknown> = { user: toView(row) };
    const settingRows = await sql<{ settings: unknown; updated_at: Date }[]>`
      SELECT settings, updated_at FROM public.user_settings WHERE account_id = ${id}`;
    const settings = settingRows[0];
    if (settings) {
      payload["settings"] = settings.settings;
      payload["settings_updated_at"] = settings.updated_at.toISOString();
    }
    return c.json(payload);
  } catch (err) {
    console.error("查询账户失败:", err);
    return c.json({ error: "查询账户失败" }, 500);
  }
}

async function adminCreateUser(c: Context<AppEnv>): Promise<Response> {
  const body = await readJSON<CreateBody>(c.req.raw);
  if (!body) return invalidBody(c);

  const email = (body.email ?? "").trim().toLowerCase();
  const username = (body.username ?? "").trim();
  const password = body.password ?? "";
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
  try {
    const rows = await sql<AccountRow[]>`
      INSERT INTO public.accounts (email, password_hash, username)
      VALUES (${email}, ${hash}, ${nullIfEmpty(username)})
      RETURNING id, email, username, avatar_url, created_at, updated_at`;
    const row = rows[0]!;
    return c.json(
      {
        user: {
          id: row.id,
          email: row.email,
          username: row.username,
          avatar_url: row.avatar_url,
          created_at: row.created_at.toISOString(),
          updated_at: row.updated_at.toISOString(),
        },
      },
      201,
    );
  } catch (err) {
    if (isUniqueViolation(err)) {
      return c.json({ error: "该邮箱已注册" }, 409);
    }
    console.error("创建账户失败:", err);
    return c.json({ error: "创建账户失败" }, 500);
  }
}

async function adminPatchUser(c: Context<AppEnv>): Promise<Response> {
  const id = c.req.param("id")!;
  if (!isUUID(id)) return invalidID(c);

  const body = await readJSON<PatchBody>(c.req.raw);
  if (!body) return invalidBody(c);

  const hasUsername = body.username != null && typeof body.username === "string";
  const hasAvatar = body.avatar_url != null && typeof body.avatar_url === "string";
  const hasPassword = body.password != null && typeof body.password === "string";
  if (!hasUsername && !hasAvatar && !hasPassword) {
    return c.json({ error: "无可更新字段" }, 400);
  }

  const sql = c.get("sql");
  try {
    if (!(await accountExists(sql, id))) {
      return c.json({ error: "账户不存在" }, 404);
    }

    if (hasPassword) {
      const password = body.password as string;
      if (password.length < 8) {
        return c.json({ error: "密码至少 8 位" }, 400);
      }
      const hash = await bcrypt.hash(password, BCRYPT_COST);
      await sql`UPDATE public.accounts SET password_hash = ${hash} WHERE id = ${id}`;
    }
    if (hasUsername) {
      const username = (body.username as string).trim();
      await sql`UPDATE public.accounts SET username = ${nullIfEmpty(username)} WHERE id = ${id}`;
    }
    if (hasAvatar) {
      const avatar = (body.avatar_url as string).trim();
      await sql`UPDATE public.accounts SET avatar_url = ${nullIfEmpty(avatar)} WHERE id = ${id}`;
    }
    return c.json({ ok: true });
  } catch (err) {
    console.error("更新账户失败:", err);
    return c.json({ error: "更新账户失败" }, 500);
  }
}

async function adminDeleteUser(c: Context<AppEnv>): Promise<Response> {
  const id = c.req.param("id")!;
  if (!isUUID(id)) return invalidID(c);

  const sql = c.get("sql");
  try {
    const result = await sql`DELETE FROM public.accounts WHERE id = ${id}`;
    if (result.count === 0) {
      return c.json({ error: "账户不存在" }, 404);
    }
    return c.json({ ok: true, deleted: id });
  } catch (err) {
    console.error("删除账户失败:", err);
    return c.json({ error: "删除账户失败" }, 500);
  }
}

// --- 云设置管理 ---

async function adminGetSettings(c: Context<AppEnv>): Promise<Response> {
  const id = c.req.param("id")!;
  if (!isUUID(id)) return invalidID(c);

  const sql = c.get("sql");
  try {
    const rows = await sql<{ settings: unknown }[]>`
      SELECT settings FROM public.user_settings WHERE account_id = ${id}`;
    return c.json({ settings: rows[0]?.settings ?? {} });
  } catch (err) {
    console.error("查询设置失败:", err);
    return c.json({ error: "查询设置失败" }, 500);
  }
}

async function adminPutSettings(c: Context<AppEnv>): Promise<Response> {
  const id = c.req.param("id")!;
  if (!isUUID(id)) return invalidID(c);

  const body = await readJSON<{ settings?: unknown }>(c.req.raw);
  if (!body) return invalidBody(c);
  const settings = body.settings === undefined || body.settings === null ? {} : body.settings;

  const sql = c.get("sql");
  try {
    if (!(await accountExists(sql, id))) {
      return c.json({ error: "账户不存在" }, 404);
    }
    await sql`
      INSERT INTO public.user_settings (account_id, settings)
      VALUES (${id}, ${JSON.stringify(settings)}::jsonb)
      ON CONFLICT (account_id)
      DO UPDATE SET settings = EXCLUDED.settings`;
    return c.json({ ok: true });
  } catch (err) {
    console.error("保存设置失败:", err);
    return c.json({ error: "保存设置失败" }, 500);
  }
}

async function adminDeleteSettings(c: Context<AppEnv>): Promise<Response> {
  const id = c.req.param("id")!;
  if (!isUUID(id)) return invalidID(c);

  const sql = c.get("sql");
  try {
    const result = await sql`DELETE FROM public.user_settings WHERE account_id = ${id}`;
    return c.json({ ok: true, deleted: result.count > 0 });
  } catch (err) {
    console.error("清空设置失败:", err);
    return c.json({ error: "清空设置失败" }, 500);
  }
}
