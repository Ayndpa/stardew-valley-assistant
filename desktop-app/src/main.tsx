import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ThemeProvider } from "./lib/theme-provider";
import { NexusProvider } from "./lib/nexus-provider";
import { AccountProvider } from "./lib/account/account-provider";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { FriendsWindow } from "./windows/FriendsWindow";
import { ChatWindow } from "./windows/ChatWindow";
import { initLogger } from "./lib/logger";
import { initI18n } from "./i18n";

// Initialize logger to capture console output
initLogger();

// 弹窗入口用 hash 路由区分：#friends → 好友窗口；#chat/<user_id> → 私聊窗口；其余 → 主应用。
// 弹窗由 Rust 侧 open_friends_window / open_chat_window 创建（src-tauri/src/social_windows.rs）。
type Route = { kind: "app" } | { kind: "friends" } | { kind: "chat"; userId: string };

function resolveRoute(): Route {
  const hash = window.location.hash;
  if (hash === "#friends") return { kind: "friends" };
  const chat = /^#chat\/([A-Za-z0-9-]{1,64})$/.exec(hash);
  if (chat) return { kind: "chat", userId: chat[1] };
  return { kind: "app" };
}

function renderRoute(route: Route) {
  switch (route.kind) {
    case "friends":
      return (
        <AccountProvider>
          <FriendsWindow />
        </AccountProvider>
      );
    case "chat":
      return (
        <AccountProvider>
          <ChatWindow userId={route.userId} />
        </AccountProvider>
      );
    default:
      return (
        <NexusProvider>
          <AccountProvider>
            <App />
          </AccountProvider>
        </NexusProvider>
      );
  }
}

// 语言包按需加载，先备好当前语言再挂载，避免首帧闪出未翻译的 key
initI18n().then(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <ErrorBoundary>
        <ThemeProvider>{renderRoute(resolveRoute())}</ThemeProvider>
      </ErrorBoundary>
    </React.StrictMode>,
  );
});
