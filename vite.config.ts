import type { RollupLog } from "rollup";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  define: {
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV || "development"),
  },

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  build: {
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      onwarn(warning: RollupLog, warn) {
        if (
          typeof warning.message === "string" &&
          warning.message.includes("dynamically imported") &&
          warning.message.includes("but also statically imported")
        ) {
          return;
        }
        warn(warning);
      },
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return undefined;
          }
          if (id.includes("@tauri-apps")) {
            return "tauri";
          }
          if (id.includes("react-grid-layout") || id.includes("react-draggable")) {
            return "grid-layout";
          }
          if (id.includes("@radix-ui")) {
            return "radix";
          }
          if (id.includes("react-router-dom")) {
            return "router";
          }
          // 只把 React 核心包放到 react-vendor，避免 lucide-react 等包被误分入该 chunk
          // 引起 vendor <-> react-vendor 循环依赖，导致生产构建运行时 TypeError
          const reactCorePackages = ["react", "react-dom", "scheduler"];
          const isReactCore = reactCorePackages.some(
            (pkg) => id === pkg || id.includes(`/${pkg}/`) || id.includes(`node_modules/${pkg}/`),
          );
          if (isReactCore) {
            return "react-vendor";
          }
          return "vendor";
        },
      },
    },
  },
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
