/** 常数时间字符串比较（防时序攻击）。 */
export function timingSafeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) {
    diff |= ab[i]! ^ bb[i]!;
  }
  return diff === 0;
}

export const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function isUUID(s: string): boolean {
  return UUID_PATTERN.test(s);
}

/** 空串 → NULL（用于可空列写入）。 */
export function nullIfEmpty(s: string): string | null {
  return s === "" ? null : s;
}

/** 解析 JSON 请求体，失败返回 null。 */
export async function readJSON<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}
