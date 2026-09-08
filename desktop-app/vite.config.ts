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
  base: "./",

  define: {
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV || "development"),
  },

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // 与手机端共用的账号 / 联机实现（仓库根目录 shared/，源码直接参与编译）
      "@shared": path.resolve(__dirname, "../shared"),
      // shared/ 在本包之外，从它出发的裸模块解析找不到本包的 node_modules，
      // 因此把它用到的运行时依赖显式指回来（与 tsconfig.json 的 paths 一一对应）。
      // 指向的正是本包原本就会解析到的目录，不会引入第二份副本。
      react: path.resolve(__dirname, "./node_modules/react"),
      "react-i18next": path.resolve(__dirname, "./node_modules/react-i18next"),
      i18next: path.resolve(__dirname, "./node_modules/i18next"),
      "@tauri-apps/api": path.resolve(__dirname, "./node_modules/@tauri-apps/api"),
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
          if (id.includes("@radix-ui")) {
            return "radix";
          }
          // React 核心包单独分包
          const reactCorePackages = ["react", "react-dom", "scheduler"];
          const isReactCore = reactCorePackages.some(
            (pkg) => id === pkg || id.includes(`/${pkg}/`) || id.includes(`node_modules/${pkg}/`),
          );
          if (isReactCore) {
            return "react-vendor";
          }
          // 其他所有依赖放到 vendor，避免循环依赖
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
