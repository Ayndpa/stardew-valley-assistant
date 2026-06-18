import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ThemeProvider } from "./lib/theme-provider";
import { BackdropProvider } from "./lib/backdrop-provider";
import { NexusProvider } from "./lib/nexus-provider";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { initLogger } from "./lib/logger";
import "./i18n";

// Initialize logger to capture console output
initLogger();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <BackdropProvider>
          <NexusProvider>
            <App />
          </NexusProvider>
        </BackdropProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
