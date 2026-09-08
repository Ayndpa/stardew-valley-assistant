import { createApp } from "./app";

// wrangler 要求 Durable Object 类从入口文件导出（与 wrangler.toml 中 class_name 对应）
export { UserHub } from "./realtime/user-hub";
export { Lobby } from "./realtime/lobby";
export { GameRoom } from "./realtime/game-room";

export default createApp();
