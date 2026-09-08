# 星露谷物语助手 · 移动端

基于 **Tauri 2 + Bun + React + TypeScript + Tailwind CSS v4** 的 Android 助手。

和桌面端最大的差别在于「游戏从哪来」。桌面端可以扫描 Steam 库直接读游戏安装目录，
手机上没有这个东西：玩家手里只有一个安装包，应用必须自己把资源解出来、装进私有目录，
之后所有数据查询都读这份副本。

## 三条主线

| 能力 | 做法 |
|---|---|
| 导入游戏 | 玩家选安装包 → 校验 → 解出 `assets/Content/` 到应用私有目录 |
| 查看数据 | 直接解析导入的 xnb 资源，与桌面端共用同一套解析实现 |
| 联机 | 账号 / 好友 / 聊天走同一套云服务；虚拟局域网用 Android `VpnService` |

## 与桌面端的代码复用

两端共用的部分放在仓库根目录的 `crates/`，各自以 path 依赖引用：

- `crates/p2p-vlan` —— 虚拟局域网引擎（ICE 直连 + 数据包转发）。
  桌面端用 Wintun 建网卡，手机端把 `VpnService` 的隧道描述符交给同一个引擎。
- `crates/sdv-game-data` —— xnb 解包与全部游戏数据模型。不依赖 tauri，
  两端只在外面各包一层命令。

前端共用的账号 / 社交代码放在仓库根目录的 `shared/`，两端通过 Vite 别名引用。

## 目录

```
src-tauri/src/
  apk/            安装包识别与导入（含二进制 AndroidManifest 解析）
  android/        JNI 桥接：内容 URI、VpnService、安装与启动
  paths.rs        应用私有目录布局，其余模块都从这里取路径
  smapi.rs        SMAPI 载荷导入与校验
  launcher.rs     带模组的游戏：打包产物的安装与启动
  vlan.rs         虚拟局域网命令层（命令名与桌面端一致）
gen/android/app/src/main/java/.../
  ContentBridge.kt      content:// URI → 文件描述符
  VpnBridge.kt          VPN 授权与隧道生命周期
  StardewVpnService.kt  承载隧道的前台服务
  GameLauncher.kt       PackageInstaller 安装与启动
```

> `gen/android/` 是 `tauri android init` 生成的工程，但上面这几个 Kotlin 文件
> 是手写并纳入版本管理的。重新执行 `android init` 前请确认不会覆盖它们。

## 关键实现细节

**安装包按描述符读取。** 系统文件选择器给的是 `content://` 而不是路径。
应用接管内容提供者的文件描述符直接当普通文件用，省掉一次近 400 MB 的整包复制。

**虚拟网卡只路由自己的网段。** `VpnService` 只添加 `10.77.0.0/24` 路由，
绝不配默认路由：一旦全量路由，ICE 打洞用的 UDP 报文会被自己的隧道捕获形成回环，
点对点直连永远协商不出来。只路由本网段还有个好处——不需要对每个套接字调
`protect()`，而 ICE 内部自建的套接字本来也拿不到。

**打模组走重新打包。** 助手进程里没有 .NET 运行时，没法像桌面端那样把运行时
注入游戏进程。手机端的做法是把 SMAPI 载荷合进游戏安装包、改包名重新签名，
装成一个独立应用再启动。改包名是必须的——沿用原包名会和玩家已装的正版游戏
撞签名，系统直接拒绝安装；换掉之后两个应用并存，正版存档也不会被动到。
SMAPI 的 Android 构建是第三方产物，需要玩家自行提供一份压缩包。

打包过程有两个会影响适配范围的取舍：

- **产物只有 APK Signature Scheme v2 签名**，所以 `minSdkVersion` 被抬到 24。
  API 21~23 的系统只认 JAR 签名，装不上只有 v2 签名的包。也就是说
  Android 5/6 设备用不了打模组的游戏（查看数据不受影响）。
- **原生库按 16 KB 对齐**而不是 4 KB。商店版原包本身就是 16 KB 对齐的，
  降回 4 KB 会让产物在 Android 15 的 16 KB 页设备上失去直接 mmap 的能力，
  代价是几十个 `.so` 多出约 1 MB 填充。

签名密钥在首次打包时生成并存在 `<app_data>/keystore/`，之后一直复用。
换密钥会导致新包和已装的旧包签名不一致，必须先卸载才能安装。

## 开发

```bash
bun install
bun run dev        # 浏览器预览（Vite，端口 1420）
bun run tauri dev  # 桌面窗口预览（移动端比例）
```

## 构建与调试

```bash
bun run tauri android build      # 构建 APK
bun run tauri android dev        # 连真机调试
```

## 测试

```bash
cd src-tauri
cargo test

# 针对真实安装包的识别测试（不设环境变量则跳过）
$env:SDV_TEST_APK = "C:\path\to\stardew-valley.apk"
cargo test --test apk_inspect -- --nocapture
```

交叉编译检查：

```powershell
$ndk = "$env:LOCALAPPDATA\Android\Sdk\ndk\27.0.12077973"
$bin = "$ndk\toolchains\llvm\prebuilt\windows-x86_64\bin"
$env:CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER = "$bin\aarch64-linux-android24-clang.cmd"
$env:CC_aarch64_linux_android = "$bin\aarch64-linux-android24-clang.cmd"
$env:AR_aarch64_linux_android = "$bin\llvm-ar.exe"
cargo check --lib --target aarch64-linux-android
```
