# 🌾 星露谷物语助手 (Stardew Valley Assistant)

一个基于 Tauri + React + TypeScript 构建的现代星露谷物语工具助手。旨在为农场主们提供最便捷的模组管理、存档编辑及游戏数据查询体验。

<p align="center">
  <a href="https://ayndpa.github.io/stardew-valley-assistant-pages/">
    <img src="https://img.shields.io/badge/🌐_宣传网站-在线预览-22c55e?style=for-the-badge&logo=github&logoColor=white" alt="宣传网站">
  </a>
  &nbsp;
  <a href="https://github.com/Ayndpa/stardew-valley-assistant-pages">
    <img src="https://img.shields.io/badge/📄_页面源码-Pages_仓库-18181b?style=for-the-badge&logo=github&logoColor=white" alt="Pages 仓库">
  </a>
</p>

> 🌐 在线宣传页：[ayndpa.github.io/stardew-valley-assistant-pages](https://ayndpa.github.io/stardew-valley-assistant-pages/) — 与本应用同源的季节主题、交互式配色预览，点击季节卡片即可切换全站配色。

## ✨ 主要功能

- 📦 **模组管理**：一键安装 SMAPI 及各类模组，轻松管理你的模组配置。
- 💾 **存档编辑**：可视化编辑你的农场存档，修改金钱、物品、技能等级等。
- 📅 **农场日历**：查看节日、村民生日及当日运势。
- 📈 **利润计算**：精准计算作物收益，助你成为最有钱的农场主。
- 🗺️ **位置查询**：实时查看村民位置，再也不用担心找不到人。

## 🤝 交流与反馈

想要参与开发或反馈建议？欢迎加入我们的 QQ 群！

<p align="center">
  <a href="https://qm.qq.com/q/baMrNVj6Za">
    <img src="public/qq-group-card.png" alt="QQ Group Card" width="600">
  </a>
</p>

- **QQ 交流群**：[903067633](https://qm.qq.com/q/baMrNVj6Za)
- **🌐 宣传网站**：[ayndpa.github.io/stardew-valley-assistant-pages](https://ayndpa.github.io/stardew-valley-assistant-pages/)（[源码仓库](https://github.com/Ayndpa/stardew-valley-assistant-pages)）
- **反馈建议**：请在 GitHub Issues 中提出

## 💻 平台支持

桌面端在 Windows 与 macOS 上都能构建运行，两者的能力差异全部来自系统本身：

| 能力 | Windows | macOS |
| --- | --- | --- |
| 模组管理 / 存档编辑 / 数据查询 | ✅ | ✅ |
| 从助手启动游戏并挂载实时数据（`DOTNET_STARTUP_HOOKS`） | ✅ | ✅ |
| 对已在运行的游戏「附加」实时数据 | ✅（远程线程注入） | ❌ SIP 禁止进程注入，只能从助手启动游戏 |
| 虚拟局域网联机 | ✅ 弹 UAC 拉起提权辅助进程 | ⚠️ 需以 `sudo` 启动助手（创建 utun 要 root） |

macOS 上的游戏目录是个 `.app` 包，`Content`、`Mods` 与 SMAPI 都在
`Contents/MacOS` 里；助手会自动往里走一层，用户选中包目录或包内目录都行。
游戏与助手共用的数据目录同样对齐 .NET 的 `SpecialFolder.ApplicationData`，
即 `$XDG_CONFIG_HOME`（缺省 `~/.config`）下的 `StardewValley/`。

游戏内运行时与助手之间的那条管道，在 Windows 上是命名管道，在 macOS / Linux 上
是 .NET 同名机制底下的 Unix 域套接字（`$TMPDIR/CoreFxPipe_<管道名>`）——
C# 那侧一行都不用改。

## 📱 移动端

除桌面端外，仓库还包含一个 Android 助手 `stardew-valley-assistant-mobile/`。

手机上没有「游戏安装目录」这回事，玩家手里只有一个安装包，所以移动端多了一步：
选择安装包 → 校验并解出游戏资源到应用私有目录 → 之后所有数据查询都读这份副本。
联机的虚拟局域网在桌面端靠 Wintun 虚拟网卡，在手机端则由 Android `VpnService`
建立隧道，两端共用同一个点对点引擎。

详见 [移动端说明](stardew-valley-assistant-mobile/README.md)。

## 🧩 仓库结构

```
desktop-app/                     桌面端（Tauri + React）
stardew-valley-assistant-mobile/ 移动端（Tauri + React，Android）
cloud-service/                   账号、好友、大厅与房间的云服务
crates/                          两端共用的 Rust 库
  p2p-vlan/                      虚拟局域网引擎（ICE 直连 + 数据包转发）
  sdv-game-data/                 xnb 解包与游戏数据模型
shared/                          两端共用的前端代码（账号与社交）
```

共享的库刻意不依赖 Tauri，平台差异留在各自的应用层：桌面端和移动端只是在
同一套实现外面各包一层命令，避免两端逻辑随时间漂移。

## 🛠️ 技术栈

- **前端**：React, TypeScript, Tailwind CSS, Lucide React
- **后端**：Rust (Tauri), Supabase
- **云服务**：Cloudflare Workers (Hono) + PostgreSQL
- **打包工具**：Vite

## 🚀 快速开始

### 环境准备

- [Node.js](https://nodejs.org/)
- [Rust](https://www.rust-lang.org/)
- [Tauri 开发环境](https://tauri.app/v1/guides/getting-started/prerequisites)

### 运行项目

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run tauri dev
```

## 📄 开源协议

本项目采用 [MIT License](LICENSE) 协议。
