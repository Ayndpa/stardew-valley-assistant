import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ThemeProvider } from "./lib/theme-provider";
import { NexusProvider } from "./lib/nexus-provider";
import "./i18n";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <NexusProvider>
        <App />
      </NexusProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
