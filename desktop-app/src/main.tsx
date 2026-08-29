import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ThemeProvider } from "./lib/theme-provider";
import { NexusProvider } from "./lib/nexus-provider";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { initLogger } from "./lib/logger";
import { initI18n } from "./i18n";

// Initialize logger to capture console output
initLogger();

// 语言包按需加载，先备好当前语言再挂载，避免首帧闪出未翻译的 key
initI18n().then(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <ErrorBoundary>
        <ThemeProvider>
          <NexusProvider>
            <App />
          </NexusProvider>
        </ThemeProvider>
      </ErrorBoundary>
    </React.StrictMode>,
  );
});
