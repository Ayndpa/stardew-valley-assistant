/// 好友 HTTP API（REALTIME.md §1.2）：用户查找、好友列表、好友申请、删除好友。
/// 操作成功后通过 UserHub 推送 friends.changed（§1.3），推送失败不影响 HTTP 结果。

import type { Context, Hono } from "hono";
import type postgres from "postgres";
import { isUniqueViolation } from "./db";
import { notifyHub, type UserBrief } from "./realtime/common";
import type { AppEnv, Env } from "./types";
import { isUUID, readJSON } from "./util";

const LOOKUP_LIMIT = 10;

type ChangeReason = "request" | "accepted" | "declined" | "removed";

interface BriefRow {
  id: string;
  username: string | null;
  avatar_url: string | null;
}

interface FriendRow extends BriefRow {
  since: Date;
}

interface RequestRow {
  id: string;
  created_at: Date;
  user_id: string;
  username: string | null;
  avatar_url: string | null;
}

interface FriendshipRow {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: "pending" | "accepted";
  created_at: Date;
}

export function registerFriendRoutes(app: Hono<AppEnv>): void {
  app.get("/api/users/lookup", handleLookup);
  app.get("/api/friends", handleListFriends);
  app.get("/api/friends/requests", handleListRequests);
  app.post("/api/friends/requests", handleCreateRequest);
  app.post("/api/friends/requests/:id/accept", handleAccept);
  app.post("/api/friends/requests/:id/decline", handleDecline);
  app.delete("/api/friends/:userId", handleRemoveFriend);
}

// ---------- 查询助手（WebSocket 路由也复用） ----------

function toBrief(row: BriefRow): UserBrief {
  return { id: row.id, username: row.username, avatar_url: row.avatar_url };
}

/** 读取用户摘要；不存在返回 null。 */
export async function loadUserBrief(sql: postgres.Sql, id: string): Promise<UserBrief | null> {
  const rows = await sql<BriefRow[]>`
    SELECT id, username, avatar_url FROM public.accounts WHERE id = ${id}`;
  return rows[0] ? toBrief(rows[0]) : null;
}

/** 已接受的好友摘要列表（任一方向）。 */
export async function loadFriendBriefs(sql: postgres.Sql, uid: string): Promise<UserBrief[]> {
  const rows = await sql<BriefRow[]>`
    SELECT a.id, a.username, a.avatar_url
    FROM public.friendships f
    JOIN public.accounts a
      ON a.id = CASE WHEN f.requester_id = ${uid} THEN f.addressee_id ELSE f.requester_id END
    WHERE f.status = 'accepted' AND (f.requester_id = ${uid} OR f.addressee_id = ${uid})
    ORDER BY f.updated_at DESC`;
  return rows.map(toBrief);
}

/** 已接受的好友 ID 列表（供 UserHub 更新缓存）。 */
export async function loadFriendIDs(sql: postgres.Sql, uid: string): Promise<string[]> {
  const rows = await sql<{ id: string }[]>`
    SELECT CASE WHEN f.requester_id = ${uid} THEN f.addressee_id ELSE f.requester_id END AS id
    FROM public.friendships f
    WHERE f.status = 'accepted' AND (f.requester_id = ${uid} OR f.addressee_id = ${uid})`;
  return rows.map((r) => r.id);
}

/**
 * 推送 friends.changed 给某用户；好友集合变化时附带最新好友 ID 列表让 DO 更新缓存。
 * friend_ids 必须在 HTTP 请求的数据库连接关闭前查询，因此这里同步完成。
 */
async function pushFriendsChanged(
  env: Env,
  sql: postgres.Sql,
  targetId: string,
  reason: ChangeReason,
  other: UserBrief,
  withIDs: boolean,
): Promise<void> {
  const frame: Record<string, unknown> = { type: "friends.changed", reason, user: other };
  if (withIDs) {
    try {
      frame["friend_ids"] = await loadFriendIDs(sql, targetId);
    } catch (err) {
      console.error("查询好友 ID 列表失败:", err);
    }
  }
  await notifyHub(env, targetId, frame as { type: string; [k: string]: unknown });
}

function invalidBody(c: Context<AppEnv>): Response {
  return c.json({ error: "请求体格式错误", code: "bad_request" }, 400);
}

// ---------- GET /api/users/lookup?q= ----------

async function handleLookup(c: Context<AppEnv>): Promise<Response> {
  const q = (c.req.query("q") ?? "").trim();
  if (q === "") {
    return c.json({ error: "缺少查询参数 q", code: "bad_request" }, 400);
  }
  const lowered = q.toLowerCase();
  const me = c.get("userID");
  const sql = c.get("sql");
  try {
    // 精确匹配邮箱或用户名（大小写不敏感），不含自己；永远不返回邮箱
    const rows = await sql<BriefRow[]>`
      SELECT id, username, avatar_url
      FROM public.accounts
      WHERE id <> ${me}
        AND (email = ${lowered} OR lower(username) = ${lowered})
      ORDER BY created_at ASC
      LIMIT ${LOOKUP_LIMIT}`;
    return c.json({ users: rows.map(toBrief) });
  } catch (err) {
    console.error("查找用户失败:", err);
    return c.json({ error: "查找用户失败" }, 500);
  }
}

// ---------- GET /api/friends ----------

async function handleListFriends(c: Context<AppEnv>): Promise<Response> {
  const me = c.get("userID");
  const sql = c.get("sql");
  try {
    const rows = await sql<FriendRow[]>`
      SELECT a.id, a.username, a.avatar_url, f.updated_at AS since
      FROM public.friendships f
      JOIN public.accounts a
        ON a.id = CASE WHEN f.requester_id = ${me} THEN f.addressee_id ELSE f.requester_id END
      WHERE f.status = 'accepted' AND (f.requester_id = ${me} OR f.addressee_id = ${me})
      ORDER BY f.updated_at DESC`;
    return c.json({
      friends: rows.map((r) => ({ ...toBrief(r), since: r.since.toISOString() })),
    });
  } catch (err) {
    console.error("查询好友列表失败:", err);
    return c.json({ error: "查询好友列表失败" }, 500);
  }
}

// ---------- GET /api/friends/requests ----------

function toReq(row: RequestRow): { id: string; user: UserBrief; created_at: string } {
  return {
    id: row.id,
    user: { id: row.user_id, username: row.username, avatar_url: row.avatar_url },
    created_at: row.created_at.toISOString(),
  };
}

async function handleListRequests(c: Context<AppEnv>): Promise<Response> {
  const me = c.get("userID");
  const sql = c.get("sql");
  try {
    // incoming 的 user 是发起者，outgoing 的 user 是接收者
    const incoming = await sql<RequestRow[]>`
      SELECT f.id, f.created_at, a.id AS user_id, a.username, a.avatar_url
      FROM public.friendships f
      JOIN public.accounts a ON a.id = f.requester_id
      WHERE f.addressee_id = ${me} AND f.status = 'pending'
      ORDER BY f.created_at DESC`;
    const outgoing = await sql<RequestRow[]>`
      SELECT f.id, f.created_at, a.id AS user_id, a.username, a.avatar_url
      FROM public.friendships f
      JOIN public.accounts a ON a.id = f.addressee_id
      WHERE f.requester_id = ${me} AND f.status = 'pending'
      ORDER BY f.created_at DESC`;
    return c.json({ incoming: incoming.map(toReq), outgoing: outgoing.map(toReq) });
  } catch (err) {
    console.error("查询好友申请失败:", err);
    return c.json({ error: "查询好友申请失败" }, 500);
  }
}

// ---------- POST /api/friends/requests ----------

async function handleCreateRequest(c: Context<AppEnv>): Promise<Response> {
  const body = await readJSON<{ user_id?: unknown }>(c.req.raw);
  if (!body) return invalidBody(c);
  const target = typeof body.user_id === "string" ? body.user_id : "";
  if (!isUUID(target)) {
    return c.json({ error: "无效的用户 ID", code: "bad_request" }, 400);
  }
  const me = c.get("userID");
  if (target.toLowerCase() === me.toLowerCase()) {
    return c.json({ error: "不能添加自己为好友", code: "self" }, 400);
  }

  const sql = c.get("sql");
  try {
    const [meBrief, targetBrief] = await Promise.all([loadUserBrief(sql, me), loadUserBrief(sql, target)]);
    if (!meBrief) {
      return c.json({ error: "账户不存在", code: "unauthorized" }, 401);
    }
    if (!targetBrief) {
      return c.json({ error: "用户不存在", code: "user_not_found" }, 404);
    }

    // 同一对用户任意方向只允许存在一行：创建前检查两个方向
    const existing = await sql<FriendshipRow[]>`
      SELECT id, requester_id, addressee_id, status, created_at
      FROM public.friendships
      WHERE (requester_id = ${me} AND addressee_id = ${target})
         OR (requester_id = ${target} AND addressee_id = ${me})
      LIMIT 1`;
    const row = existing[0];
    if (row) {
      if (row.status === "accepted") {
        return c.json({ error: "你们已经是好友", code: "already_friends" }, 409);
      }
      if (row.requester_id === me) {
        return c.json({ error: "已发送过好友申请，等待对方处理", code: "already_requested" }, 409);
      }
      // 对方已向我发起申请：直接接受
      await sql`UPDATE public.friendships SET status = 'accepted' WHERE id = ${row.id}`;
      await Promise.all([
        pushFriendsChanged(c.env, sql, me, "accepted", targetBrief, true),
        pushFriendsChanged(c.env, sql, target, "accepted", meBrief, true),
      ]);
      return c.json(
        {
          request: { id: row.id, user: targetBrief, created_at: row.created_at.toISOString() },
          accepted: true,
        },
        201,
      );
    }

    let inserted: { id: string; created_at: Date };
    try {
      const rows = await sql<{ id: string; created_at: Date }[]>`
        INSERT INTO public.friendships (requester_id, addressee_id, status)
        VALUES (${me}, ${target}, 'pending')
        RETURNING id, created_at`;
      inserted = rows[0]!;
    } catch (err) {
      if (isUniqueViolation(err)) {
        return c.json({ error: "已发送过好友申请，等待对方处理", code: "already_requested" }, 409);
      }
      throw err;
    }
    await pushFriendsChanged(c.env, sql, target, "request", meBrief, false);
    return c.json(
      {
        request: { id: inserted.id, user: targetBrief, created_at: inserted.created_at.toISOString() },
        accepted: false,
      },
      201,
    );
  } catch (err) {
    console.error("发起好友申请失败:", err);
    return c.json({ error: "发起好友申请失败" }, 500);
  }
}

// ---------- POST /api/friends/requests/:id/accept ----------

async function handleAccept(c: Context<AppEnv>): Promise<Response> {
  const id = c.req.param("id")!;
  if (!isUUID(id)) {
    return c.json({ error: "无效的申请 ID", code: "bad_request" }, 400);
  }
  const me = c.get("userID");
  const sql = c.get("sql");
  try {
    // 仅 addressee 可接受
    const rows = await sql<{ requester_id: string }[]>`
      UPDATE public.friendships SET status = 'accepted'
      WHERE id = ${id} AND addressee_id = ${me} AND status = 'pending'
      RETURNING requester_id`;
    const row = rows[0];
    if (!row) {
      return c.json({ error: "好友申请不存在", code: "request_not_found" }, 404);
    }
    const [meBrief, friend] = await Promise.all([loadUserBrief(sql, me), loadUserBrief(sql, row.requester_id)]);
    const friendBrief: UserBrief = friend ?? { id: row.requester_id, username: null, avatar_url: null };
    const meBriefSafe: UserBrief = meBrief ?? { id: me, username: null, avatar_url: null };
    await Promise.all([
      pushFriendsChanged(c.env, sql, me, "accepted", friendBrief, true),
      pushFriendsChanged(c.env, sql, row.requester_id, "accepted", meBriefSafe, true),
    ]);
    return c.json({ ok: true, friend: friendBrief });
  } catch (err) {
    console.error("接受好友申请失败:", err);
    return c.json({ error: "接受好友申请失败" }, 500);
  }
}

// ---------- POST /api/friends/requests/:id/decline ----------

async function handleDecline(c: Context<AppEnv>): Promise<Response> {
  const id = c.req.param("id")!;
  if (!isUUID(id)) {
    return c.json({ error: "无效的申请 ID", code: "bad_request" }, 400);
  }
  const me = c.get("userID");
  const sql = c.get("sql");
  try {
    // addressee 拒绝或 requester 撤回均删除该行
    const rows = await sql<{ requester_id: string; addressee_id: string }[]>`
      DELETE FROM public.friendships
      WHERE id = ${id} AND status = 'pending' AND (addressee_id = ${me} OR requester_id = ${me})
      RETURNING requester_id, addressee_id`;
    const row = rows[0];
    if (!row) {
      return c.json({ error: "好友申请不存在", code: "request_not_found" }, 404);
    }
    const otherId = row.requester_id === me ? row.addressee_id : row.requester_id;
    const [meBrief, other] = await Promise.all([loadUserBrief(sql, me), loadUserBrief(sql, otherId)]);
    await Promise.all([
      pushFriendsChanged(c.env, sql, me, "declined", other ?? { id: otherId, username: null, avatar_url: null }, false),
      pushFriendsChanged(c.env, sql, otherId, "declined", meBrief ?? { id: me, username: null, avatar_url: null }, false),
    ]);
    return c.json({ ok: true });
  } catch (err) {
    console.error("处理好友申请失败:", err);
    return c.json({ error: "处理好友申请失败" }, 500);
  }
}

// ---------- DELETE /api/friends/:userId ----------

async function handleRemoveFriend(c: Context<AppEnv>): Promise<Response> {
  const other = c.req.param("userId")!;
  if (!isUUID(other)) {
    return c.json({ error: "无效的用户 ID", code: "bad_request" }, 400);
  }
  const me = c.get("userID");
  const sql = c.get("sql");
  try {
    // 删除 accepted 关系（任一方向）
    const result = await sql`
      DELETE FROM public.friendships
      WHERE status = 'accepted'
        AND ((requester_id = ${me} AND addressee_id = ${other})
          OR (requester_id = ${other} AND addressee_id = ${me}))`;
    if (result.count === 0) {
      return c.json({ error: "对方不是你的好友", code: "not_friend" }, 404);
    }
    const [meBrief, otherBrief] = await Promise.all([loadUserBrief(sql, me), loadUserBrief(sql, other)]);
    await Promise.all([
      pushFriendsChanged(c.env, sql, me, "removed", otherBrief ?? { id: other, username: null, avatar_url: null }, true),
      pushFriendsChanged(c.env, sql, other, "removed", meBrief ?? { id: me, username: null, avatar_url: null }, true),
    ]);
    return c.json({ ok: true });
  } catch (err) {
    console.error("删除好友失败:", err);
    return c.json({ error: "删除好友失败" }, 500);
  }
}
