import type { Client } from "./client";
import { resolveAccountID } from "./client";

export let asJSON = false;
export function setJSONOutput(v: boolean): void {
  asJSON = v;
}

const adminTimeLayout = "yyyy-MM-dd HH:mm";

const passwordChars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

interface AdminUser {
  id: string;
  email: string;
  username: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
  has_settings: boolean;
  settings_updated_at: string | null;
}

interface UsersPage {
  users: AdminUser[];
  total: number;
}

export function printUsage(): void {
  console.log(`账户系统远程管理器（本地 CLI，通过 HTTP 控制已部署的后端）

用法:
  bun run . [选项] <命令> [参数...]
  选项: -j/--json 输出 JSON    -b/--base-url <URL>    -k/--key <ADMIN_KEY>

命令:
  status                                  健康检查 + 管理接口验证
  users list [N]                          账户列表（默认 50 条）
  users search <keyword>                  按邮箱/用户名搜索
  users show <id|email>                   账户详情（含云设置）
  users create <email> [password] [name]  创建账户（密码留空自动生成）
  users delete <id|email> --yes           删除账户（级联删除云设置）
  users reset-password <id|email> [new]   重置密码（留空自动生成）
  users set-username <id|email> [name]    修改用户名（留空清除）
  settings get <id|email>                 查看云设置 JSON
  settings set <id|email> <file|->        写入云设置（- 为标准输入）
  settings clear <id|email> --yes         清空云设置
  config show                             查看本地配置（admin.json）
  config set-base-url <url>               保存后端地址
  config set-key <key>                    保存管理密钥
  config gen-key                          生成随机 ADMIN_KEY

配置读取顺序: 命令行选项 > 环境变量 ADMIN_BASE_URL/ADMIN_KEY > admin.json > 默认值
后端需实现 /api/admin/* 管理接口并以 ADMIN_KEY 鉴权（见 cloud-service/README.md）
`);
}

export function dispatch(c: Client, args: string[]): Promise<void> {
  switch (args[0]) {
    case "status":
      return opStatus(c);
    case "users":
      return execUsers(c, args.slice(1));
    case "settings":
      return execSettings(c, args.slice(1));
    case "config":
      return execConfig(c, args.slice(1));
    case "help":
    case "-h":
    case "--help":
      printUsage();
      return Promise.resolve();
    default:
      printUsage();
      return Promise.reject(new Error(`未知命令 ${args[0] ?? ""}`));
  }
}

// --- users ---

async function execUsers(c: Client, args: string[]): Promise<void> {
  if (args.length === 0) {
    printUsage();
    throw new Error("缺少 users 子命令 (list/search/show/create/delete/reset-password/set-username)");
  }
  const sub = args[0]!;
  const [rest, yes] = popYes(args.slice(1));
  switch (sub) {
    case "list":
    case "ls": {
      const limit = parseLimit(rest.join(" "));
      return opUsersList(c, limit);
    }
    case "search": {
      if (rest.length < 1) throw new Error("用法: users search <keyword>");
      return opUsersSearch(c, rest.join(" "));
    }
    case "show": {
      if (rest.length < 1) throw new Error("用法: users show <id|email>");
      return opUsersShow(c, rest[0]!);
    }
    case "create":
    case "add": {
      if (rest.length < 1) throw new Error("用法: users create <email> [password] [username]");
      return opUsersCreate(c, rest[0]!, rest[1] ?? "", rest[2] ?? "");
    }
    case "delete":
    case "rm": {
      if (rest.length < 1) throw new Error("用法: users delete <id|email> --yes");
      return opUsersDelete(c, rest[0]!, yes);
    }
    case "reset-password":
    case "passwd": {
      if (rest.length < 1) throw new Error("用法: users reset-password <id|email> [newpassword]");
      return opUsersResetPassword(c, rest[0]!, rest[1] ?? "");
    }
    case "set-username":
    case "rename": {
      if (rest.length < 1) throw new Error("用法: users set-username <id|email> [username]");
      return opUsersSetUsername(c, rest[0]!, rest[1] ?? "");
    }
    default:
      printUsage();
      throw new Error(`未知 users 子命令 ${sub}`);
  }
}

async function opStatus(c: Client): Promise<void> {
  let healthStatus = 0;
  try {
    healthStatus = (await c.do("GET", "/api/health", null)).status;
  } catch (err) {
    throw new Error(`无法连接后端 ${c.baseURL}: ${err instanceof Error ? err.message : err}`);
  }
  const healthOK = healthStatus === 200;
  let adminState = "disabled";
  if (healthOK) {
    try {
      const adminStatus = (await c.do("GET", "/api/admin/users?limit=1", null)).status;
      if (adminStatus === 200) adminState = "ok";
      else if (adminStatus === 401 || adminStatus === 403) adminState = "unauthorized";
      else if (adminStatus === 503) adminState = "disabled";
      else adminState = `http-${adminStatus}`;
    } catch {
      adminState = "unreachable";
    }
  }
  if (asJSON) {
    printJSON({
      base_url: c.baseURL,
      health_ok: healthOK,
      health_status: healthStatus,
      admin_state: adminState,
    });
    return;
  }
  console.log(`后端地址 : ${c.baseURL}`);
  console.log("健康检查 : 正常（/api/health）");
  switch (adminState) {
    case "ok":
      console.log("管理接口 : 可用");
      break;
    case "unauthorized":
      console.log("管理接口 : 密钥无效（401），请用 config set-key 或 -k 提供正确的 ADMIN_KEY");
      break;
    case "disabled":
      console.log("管理接口 : 后端未启用（服务端未配置 ADMIN_KEY）");
      break;
    default:
      console.log(`管理接口 : 异常（${adminState}）`);
  }
}

async function opUsersList(c: Client, limit: number): Promise<void> {
  const res = (await getJSON(c, `/api/admin/users?limit=${limit}`)) as UsersPage;
  if (asJSON) {
    printJSON(res);
    return;
  }
  renderUsers(res);
}

async function opUsersSearch(c: Client, keyword: string): Promise<void> {
  const res = (await getJSON(
    c,
    `/api/admin/users?q=${encodeURIComponent(keyword)}&limit=50`,
  )) as UsersPage;
  if (asJSON) {
    printJSON(res);
    return;
  }
  renderUsers(res);
}

function renderUsers(res: UsersPage): void {
  console.log(
    pad("#", 4) + " " + pad("ID", 38) + " " + pad("EMAIL", 32) + " " + pad("USERNAME", 18) + " " + pad("SETTINGS_AT", 18) + " CREATED_AT",
  );
  res.users.forEach((u, i) => {
    const settingsCell = u.settings_updated_at ? formatDate(u.settings_updated_at) : "-";
    console.log(
      pad(String(i + 1), 4) +
        " " +
        pad(u.id, 38) +
        " " +
        pad(truncate(u.email, 32), 32) +
        " " +
        pad(truncate(u.username ?? "", 18), 18) +
        " " +
        pad(settingsCell, 18) +
        " " +
        formatDate(u.created_at),
    );
  });
  console.log(`\n共 ${res.total} 个账户（显示 ${res.users.length} 个）`);
}

async function opUsersShow(c: Client, ident: string): Promise<void> {
  const id = await resolveAccountID(c, ident);
  const data = await c.ok("GET", `/api/admin/users/${id}`, null);
  if (asJSON) {
    console.log(new TextDecoder().decode(data));
    return;
  }
  const res = JSON.parse(new TextDecoder().decode(data)) as {
    user: AdminUser;
    settings?: unknown;
    settings_updated_at?: string | null;
  };
  const u = res.user;
  console.log("=== 账户详情 ===");
  console.log(`  ID       : ${u.id}`);
  console.log(`  邮箱     : ${u.email}`);
  console.log(`  用户名   : ${orDash(u.username ?? "")}`);
  console.log(`  头像     : ${orDash(u.avatar_url ?? "")}`);
  console.log(`  创建时间 : ${formatDate(u.created_at)}`);
  console.log(`  更新时间 : ${formatDate(u.updated_at)}`);
  if (res.settings === undefined || res.settings === null) {
    console.log("  云设置   : 无");
    return;
  }
  const updated = res.settings_updated_at ? formatDate(res.settings_updated_at) : "-";
  console.log(`  云设置   : （更新于 ${updated}）`);
  printIndentJSON(res.settings);
}

async function opUsersCreate(c: Client, email: string, password: string, username: string): Promise<void> {
  email = email.trim().toLowerCase();
  username = username.trim();
  if (!email || !email.includes("@")) throw new Error("邮箱格式不正确");
  const autoGenerated = password === "";
  if (autoGenerated) password = randomPassword(16);
  if (password.length < 8) throw new Error("密码至少 8 位");

  const data = await c.ok("POST", "/api/admin/users", {
    email,
    password,
    username,
  });
  if (asJSON) {
    const out = JSON.parse(new TextDecoder().decode(data)) as Record<string, unknown>;
    if (autoGenerated) out["generated_password"] = password;
    printJSON(out);
    return;
  }
  const res = JSON.parse(new TextDecoder().decode(data)) as { user: AdminUser };
  console.log("账户创建成功");
  console.log(`  ID     : ${res.user.id}`);
  console.log(`  邮箱   : ${res.user.email}`);
  console.log(`  用户名 : ${orDash(username)}`);
  if (autoGenerated) console.log(`  密码   : ${password}（自动生成，请妥善保存）`);
}

async function opUsersDelete(c: Client, ident: string, yes: boolean): Promise<void> {
  if (!yes) throw new Error("删除账户属危险操作，请显式追加 --yes 确认");
  const id = await resolveAccountID(c, ident);
  await c.ok("DELETE", `/api/admin/users/${id}`, null);
  if (asJSON) {
    console.log(JSON.stringify({ ok: true, deleted: id }));
    return;
  }
  console.log("账户已删除");
}

async function opUsersResetPassword(c: Client, ident: string, newPass: string): Promise<void> {
  newPass = newPass.trim();
  const autoGenerated = newPass === "";
  if (autoGenerated) newPass = randomPassword(16);
  if (newPass.length < 8) throw new Error("密码至少 8 位");
  const id = await resolveAccountID(c, ident);
  await c.ok("PATCH", `/api/admin/users/${id}`, { password: newPass });
  if (asJSON) {
    printJSON({ ok: true, generated_password: newPass });
    return;
  }
  console.log("密码已重置");
  console.log(`  新密码 : ${newPass}`);
}

async function opUsersSetUsername(c: Client, ident: string, username: string): Promise<void> {
  const id = await resolveAccountID(c, ident);
  await c.ok("PATCH", `/api/admin/users/${id}`, { username: username.trim() });
  if (asJSON) {
    console.log(JSON.stringify({ ok: true }));
    return;
  }
  const name = username.trim();
  console.log(name === "" ? "用户名已清除" : `用户名已更新为: ${name}`);
}

// --- settings ---

async function execSettings(c: Client, args: string[]): Promise<void> {
  if (args.length === 0) {
    printUsage();
    throw new Error("缺少 settings 子命令 (get/set/clear)");
  }
  const sub = args[0]!;
  const [rest, yes] = popYes(args.slice(1));
  switch (sub) {
    case "get": {
      if (rest.length < 1) throw new Error("用法: settings get <id|email>");
      return opSettingsGet(c, rest[0]!);
    }
    case "set": {
      if (rest.length < 2) throw new Error("用法: settings set <id|email> <file.json|->");
      return opSettingsSet(c, rest[0]!, rest[1]!);
    }
    case "clear": {
      if (rest.length < 1) throw new Error("用法: settings clear <id|email> --yes");
      return opSettingsClear(c, rest[0]!, yes);
    }
    default:
      printUsage();
      throw new Error(`未知 settings 子命令 ${sub}`);
  }
}

async function opSettingsGet(c: Client, ident: string): Promise<void> {
  const id = await resolveAccountID(c, ident);
  const data = await c.ok("GET", `/api/admin/users/${id}/settings`, null);
  if (asJSON) {
    console.log(new TextDecoder().decode(data));
    return;
  }
  const res = JSON.parse(new TextDecoder().decode(data)) as { settings?: unknown };
  if (res.settings === undefined || res.settings === null) {
    console.log("该账户暂无云设置");
    return;
  }
  printIndentJSON(res.settings);
}

async function opSettingsSet(c: Client, ident: string, source: string): Promise<void> {
  let raw: string;
  if (source === "-") {
    raw = await Bun.stdin.text();
  } else {
    raw = await Bun.file(source).text();
  }
  raw = raw.trim();
  if (!raw) raw = "{}";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("内容不是有效的 JSON");
  }
  const byteLen = new TextEncoder().encode(raw).length;
  const id = await resolveAccountID(c, ident);
  await c.ok("PUT", `/api/admin/users/${id}/settings`, { settings: parsed });
  console.log(`云设置已保存（${byteLen} 字节）`);
}

async function opSettingsClear(c: Client, ident: string, yes: boolean): Promise<void> {
  if (!yes) throw new Error("清空云设置属危险操作，请显式追加 --yes 确认");
  const id = await resolveAccountID(c, ident);
  await c.ok("DELETE", `/api/admin/users/${id}/settings`, null);
  console.log("云设置已清空");
}

// --- config ---

async function execConfig(c: Client, args: string[]): Promise<void> {
  const { readConfigFile, saveCLIConfig, configFilePath } = await import("./config");
  if (args.length === 0) {
    printUsage();
    throw new Error("缺少 config 子命令 (show/set-base-url/set-key/gen-key)");
  }
  switch (args[0]) {
    case "show": {
      const cfg = await readConfigFile();
      console.log(`配置文件 : ${configFilePath}`);
      const base = cfg.base_url ?? "";
      console.log(`后端地址 : ${base || "（未设置，默认 http://127.0.0.1:8080）"}`);
      if (!cfg.admin_key) {
        console.log("管理密钥 : 未设置（config set-key 或环境变量 ADMIN_KEY）");
      } else {
        console.log(`管理密钥 : ${cfg.admin_key.slice(0, 4)}***（已保存）`);
      }
      if (process.env.ADMIN_KEY) {
        console.log("环境变量 : ADMIN_KEY 已设置（优先于配置文件）");
      }
      return;
    }
    case "set-base-url": {
      if (args.length < 2) throw new Error("用法: config set-base-url <url>");
      const cfg = await readConfigFile();
      cfg.base_url = (args[1] ?? "").trim().replace(/\/+$/, "");
      await saveCLIConfig(cfg);
      console.log("已保存后端地址:", cfg.base_url);
      return;
    }
    case "set-key": {
      if (args.length < 2) throw new Error("用法: config set-key <ADMIN_KEY>");
      const cfg = await readConfigFile();
      cfg.admin_key = (args[1] ?? "").trim();
      await saveCLIConfig(cfg);
      console.log(`已保存管理密钥到 ${configFilePath}`);
      return;
    }
    case "gen-key": {
      console.log(randomHex(24));
      return;
    }
    default:
      printUsage();
      throw new Error(`未知 config 子命令 ${args[0]}`);
  }
}

// --- 工具 ---

async function getJSON(c: Client, path: string): Promise<unknown> {
  const data = await c.ok("GET", path, null);
  return JSON.parse(new TextDecoder().decode(data));
}

function popYes(args: string[]): [string[], boolean] {
  const out: string[] = [];
  let yes = false;
  for (const a of args) {
    if (a === "--yes" || a === "-y") {
      yes = true;
      continue;
    }
    out.push(a);
  }
  return [out, yes];
}

function parseLimit(input: string): number {
  input = input.trim();
  if (!input) return 50;
  const n = Number.parseInt(input, 10);
  if (Number.isNaN(n) || n <= 0) throw new Error("数量需为正整数");
  return n;
}

function randomHex(byteCount: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteCount));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function randomPassword(n: number): string {
  const buf = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(buf, (b) => passwordChars[b % passwordChars.length]!).join("");
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

/** 按码点截断，超出以 … 结尾（与 Go 版一致）。 */
function truncate(s: string, n: number): string {
  const chars = Array.from(s);
  if (chars.length <= n) return s;
  if (n <= 1) return chars.slice(0, n).join("");
  return chars.slice(0, n - 1).join("") + "…";
}

function orDash(s: string): string {
  return s === "" ? "-" : s;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p2 = (v: number) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

function printIndentJSON(v: unknown): void {
  try {
    console.log(JSON.stringify(v, null, 2));
  } catch {
    console.log(String(v));
  }
}

function printJSON(v: unknown): void {
  console.log(JSON.stringify(v, null, 2));
}
