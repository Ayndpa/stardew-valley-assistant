# 星露谷物语助手 · 移动端

基于 **Tauri 2 + Bun + React + TypeScript + Tailwind CSS v4** 的移动端助手。

当前处于起步阶段，仅包含开始页（品牌区、功能预告卡片、占位按钮），视觉风格与桌面端一致（绿色主色、明暗跟随系统、四季主题令牌）。

## 开发

```bash
bun install
bun run dev        # 浏览器预览（Vite，端口 1420）
bun run tauri dev  # 桌面窗口预览（移动端比例的窗口）
```

## 构建

```bash
bun run build                      # 前端产物
bun run tauri android init         # 初始化 Android 工程
bun run tauri android build        # 构建 Android APK
```

## 目录

- `src/App.tsx` — 开始页
- `src/index.css` — Tailwind v4 主题令牌，与桌面端 `src/index.css` 对齐
- `src-tauri/` — Tauri 2 工程（含 Rust 侧）