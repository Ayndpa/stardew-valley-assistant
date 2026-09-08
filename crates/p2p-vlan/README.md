# p2p-vlan

星露谷助手的虚拟局域网引擎（契约见 `cloud-service/REALTIME.md` §7）：房间内成员各持一块
`10.77.0.0/24` 的 TUN 虚拟网卡（Windows 用 Wintun，`wintun.dll` 随应用打包在 `desktop-app/src-tauri/resources/`），
成员两两之间用 ICE 打洞建立 UDP 直连，组成全互联网状网络；服务端只转发握手信令。
因为创建网卡需要管理员权限，引擎实际运行在一个由应用自身 exe 以 `--vlan-helper` 启动的提权辅助进程里（§7.4）。

本 crate 是 `desktop-app/src-tauri` 工作区的成员，所有命令在 `desktop-app/src-tauri` 目录下执行。

## 模块

| 模块 | 内容 |
| --- | --- |
| `ice` | 与信令无关的 ICE 核心（webrtc-ice）：`IceConfig`（STUN、候选过滤）、`IceEndpoint::gather` → `Handshake` → `connect` → `IceConn`，`Role` |
| `engine` | `VlanEngine`：按成员列表两两协商（字典序小者为 offer），失败 5 秒后重试一次；TUN 读取任务按目的地址转发，对端数据报校验源地址后写回 TUN；事件 `VlanEvent`（含要经 `room.signal` 转发的 `SignalOut`） |
| `packet` | IPv4 解析、§7.2 的转发/丢弃规则、带校验和的 `build_ipv4_udp` |
| `tun` | `TunIo` 抽象、`TunConfig`、`open_tun`（tun-rs / Wintun；权限不足时错误以「需要以管理员身份运行」开头） |
| `mem` | 通道模拟的内存网卡，供测试 |
| `helper`（Windows） | §7.4 线协议、辅助进程主循环 `serve`、应用端 `HelperClient`（命名管道、hello/token 校验、请求应答与事件转发）、`HelperArgs` |
| `elevation`（Windows） | `is_elevated`、`launch_helper`（`ShellExecuteEx(runas)` / 无窗口 `Command`）、仅当前用户可访问的管道 DACL |

`recommended_ice_config` 会过滤掉链路本地地址、198.18/15（代理软件 fake-IP）以及 VLAN 自己的网段与网卡：
webrtc-ice 的 controlling 端会提名"最先验证成功"的候选对且不再回退，这类地址会让协商卡死。

## 测试

```powershell
# 无需管理员：单元测试 + 进程内网状网络（内存网卡、回环候选）+ 辅助进程管道协议
cargo test

# 需要管理员权限（默认 ignore），请在提权的终端里运行：
cargo test --test wintun_smoke -- --ignored   # 打开真实 Wintun 网卡，从本机发 UDP 确认能读到
cargo test --test wintun_e2e -- --ignored     # 真实网卡 + ICE 网状网络双向收发，结束后网卡被移除

# 真实提权辅助进程端到端（未提权时会弹一次 UAC）：先在 desktop-app/src-tauri 下构建应用 exe
#   $env:SKIP_ASSISTANT_RUNTIME_BUILD = "1"; cargo build   （在 desktop-app/src-tauri 目录执行）
cargo run --example helper_e2e
```
