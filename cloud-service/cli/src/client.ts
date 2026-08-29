import type { CLIConfig } from "./config";

export class Client {
  readonly baseURL: string;
  readonly key: string;

  constructor(cfg: CLIConfig) {
    this.baseURL = cfg.base_url ?? "";
    this.key = cfg.admin_key ?? "";
  }

  async do(
    method: string,
    path: string,
    body: unknown,
  ): Promise<{ status: number; data: Uint8Array }> {
    const headers: Record<string, string> = {};
    if (body !== undefined && body !== null) headers["Content-Type"] = "application/json";
    if (this.key) headers["Authorization"] = `Bearer ${this.key}`;
    const res = await fetch(this.baseURL + path, {
      method,
      headers,
      body: body === undefined || body === null ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const data = new Uint8Array(await res.arrayBuffer());
    return { status: res.status, data };
  }

  async ok(method: string, path: string, body: unknown): Promise<Uint8Array> {
    const { status, data } = await this.do(method, path, body);
    if (status >= 400) throw httpError(status, data);
    return data;
  }
}

function httpError(status: number, data: Uint8Array): Error {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(data)) as { error?: string };
    if (parsed.error) return new Error(`HTTP ${status}: ${parsed.error}`);
  } catch {
    // 回落到截断展示
  }
  return new Error(`HTTP ${status}: ${truncate(new TextDecoder().decode(data), 200)}`);
}

function truncate(s: string, n: number): string {
  const chars = Array.from(s);
  if (chars.length <= n) return s;
  if (n <= 1) return chars.slice(0, n).join("");
  return chars.slice(0, n - 1).join("") + "…";
}

export const uuidPattern =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export async function resolveAccountID(c: Client, ident: string): Promise<string> {
  ident = ident.trim();
  if (!ident) throw new Error("账户标识不能为空");
  if (uuidPattern.test(ident)) return ident.toLowerCase();
  const data = await c.ok(
    "GET",
    `/api/admin/users?email=${encodeURIComponent(ident.toLowerCase())}`,
    null,
  );
  const res = JSON.parse(new TextDecoder().decode(data)) as { users?: { id: string }[] };
  if (!res.users || res.users.length === 0) throw new Error(`账户不存在: ${ident}`);
  return res.users[0]!.id;
}
