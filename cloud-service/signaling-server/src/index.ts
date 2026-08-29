/// Worker 入口：把 /ws 的 WebSocket 升级请求按房间号路由到对应的 Room Durable Object。
///
/// 房间号取自 URL 查询参数 `?room=`（客户端会自动拼接）；缺省时随机分配 6 位房间号——
/// 与 Go 版语义一致：两个都未指定房间号的客户端本来就会各自拿到独立房间，
/// 由先到者把分配到的号告诉对方。除路由方式外，线上协议与 Go 版完全相同。

// wrangler 要求 Durable Object 类从入口文件导出
export { Room } from "./room";

export interface Env {
  ROOM: DurableObjectNamespace;
  /** 可选共享密钥：`wrangler secret put SIGNALING_TOKEN` 设置后启用校验 */
  SIGNALING_TOKEN?: string;
}

// 与 Go 版相同的房间号随机码字母表（剔除易混淆的 0/O、1/I/L）
const ROOM_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const ROOM_CODE_RE = /^[A-Za-z0-9_-]{3,32}$/;

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    switch (url.pathname) {
      case "/ws":
        return handleWS(request, env);
      case "/healthz":
        return new Response("ok");
      case "/":
        return new Response(
          "P2P ICE Chat 信令服务器（Cloudflare Workers 版）\n\n" +
            "仅转发两端握手信令，不中继聊天数据。\n" +
            "WebSocket 端点: /ws?room=<房间号>\n健康检查: /healthz\n",
          { headers: { "Content-Type": "text/plain; charset=utf-8" } }
        );
      default:
        return new Response("not found", { status: 404 });
    }
  },
} satisfies ExportedHandler<Env>;

async function handleWS(request: Request, env: Env): Promise<Response> {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return new Response("expected websocket upgrade", { status: 426 });
  }

  const url = new URL(request.url);
  let room = (url.searchParams.get("room") ?? "").trim().toUpperCase();

  if (room === "") {
    const rnd = crypto.getRandomValues(new Uint8Array(6));
    room = Array.from(rnd, (n) => ROOM_CODE_ALPHABET[n % ROOM_CODE_ALPHABET.length]).join("");
  } else if (!ROOM_CODE_RE.test(room)) {
    return jsonError(400, "bad_room", "房间号需为 3~32 位字母/数字/下划线/连字符");
  }

  const id = env.ROOM.idFromName(room);
  const stub = env.ROOM.get(id);
  const target = new URL("https://room/ws");
  target.searchParams.set("room", room);
  return stub.fetch(new Request(target, request));
}

function jsonError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ type: "error", code, message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
