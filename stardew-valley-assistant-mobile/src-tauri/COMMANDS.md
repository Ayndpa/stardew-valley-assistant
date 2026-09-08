# 移动端 Tauri 命令契约

前端调用 `invoke(名字, 参数)`。参数在 JS 侧一律用 camelCase，Tauri 会自动转成 Rust 的 snake_case。
所有命令失败时 reject 出一个中文字符串。

## 游戏安装包

### `inspect_game_package({ path })`
识别一个安装包，不写任何东西。`path` 可以是文件路径，也可以是系统文件选择器返回的
`content://` URI。

返回 `PackageInfo`：

| 字段 | 类型 | 说明 |
|---|---|---|
| `packageName` | string | 安装包声明的包名 |
| `versionName` | string | 如 `1.6.15.3` |
| `versionCode` | number | 如 `245` |
| `label` | string \| null | 应用名（只有字面量标签能读到） |
| `minSdk` / `targetSdk` | number \| null | |
| `abis` | string[] | 如 `["arm64-v8a"]` |
| `mainActivity` | string \| null | 入口 Activity |
| `isStardewValley` | boolean | **界面据此决定能不能导入** |
| `hasContent` | boolean | 是否含 `assets/Content/` |
| `contentFileCount` | number | 资源文件数 |
| `contentBytes` | number | 资源解压后字节数，用来提示所需空间 |
| `totalEntries` | number | 安装包条目总数 |
| `fileSize` | number | 安装包体积 |
| `warnings` | string[] | 不阻塞导入但值得提示的问题，直接展示给玩家 |

### `install_game_package({ path, taskId?, keepPackage? })`
把资源导入应用私有目录。`keepPackage` 为真时额外留一份原始安装包——打模组启动需要它，
但会多占几百 MB，建议让玩家自己勾选。返回 `InstalledGame`。

进度通过事件 `game-import-progress` 上报：

```ts
{
  taskId: string
  stage: "inspecting" | "extracting" | "finalizing" | "finished"
        | "cancelled" | "failed" | "warning"
  processed: number   // 已写字节
  total: number       // 总字节
  percent: number     // 0-100
  message: string     // 中文，可直接展示
  currentFile: string | null
}
```

### `cancel_game_import({ taskId })`
返回 boolean，表示是否找到并取消了该任务。

### `get_game_install_status()`
```ts
{
  installed: boolean
  game: InstalledGame | null
  contentPath: string | null
  actualFileCount: number   // 实际磁盘占用，可能与记录不一致
  actualBytes: number
}
```

`InstalledGame`：`packageName` / `versionName` / `versionCode` / `abis` /
`installedAt`(Unix 毫秒) / `contentFileCount` / `contentBytes` /
`sourceFileName` / `packageRetained`。

### `uninstall_game_package()`
删除已导入的游戏资源与留存的安装包。

## SMAPI 载荷

SMAPI 的 Android 构建是第三方产物，助手造不出来，需要玩家自己提供一份压缩包。

- `get_smapi_status()` → `{ installed, payload, path }`
- `import_smapi_package({ path })` → `SmapiPayload`
  （`version` / `installedAt` / `fileCount` / `bytes` / `sourceFileName`）
- `remove_smapi_package()`

压缩包里没有 `StardewModdingAPI.dll` 会直接报错，界面把错误文案原样展示即可。

载荷会**按它自己的目录结构原样注入安装包根部**——压缩包内的相对路径就是它在
安装包里的最终位置。载荷怎么组织由发布者决定，助手不做假设也不重排。

## 游戏数据

命令名、参数与返回结构与桌面端一致，解析实现也是同一份共享 crate，
因此两端的数据、分类、排序、本地化完全相同。

`get_crop_game_data` · `get_animal_game_data` · `get_npc_game_data` ·
`get_calendar_game_data` · `get_bundle_game_data` · `get_secret_notes_game_data` ·
`get_item_game_data` · `get_item_game_data_overview` · `query_item_game_data` ·
`get_fishing_map_data` · `get_fishing_map_detail`

共同参数 `lang`（默认 `"zh"`）。与桌面端的唯一差别是 `dataSource` 恒为 `"xnb"`：
手机端没有游戏内运行时导出价格那条链路。前端的「数据来源提示条」分支仍然成立。

游戏资源没导入时，这些命令统一报
`还没有导入游戏资源，请先在首页选择星露谷物语的安装包完成导入。`

## 模组

`list_installed_mods` · `toggle_mod({folderName, enable})` ·
`delete_mod({folderName})` · `save_mod_config({folderName, config})` ·
`rename_local_mod({folderName, newName})` · `install_mod_from_zip({path})`

语义与桌面端共用同一份实现：禁用是给文件夹名加前导点号，
manifest 走宽松 JSON 解析并解析 `{{i18n:Key}}` 占位符。
`install_mod_from_zip` 的 `path` 同样支持 `content://` URI，返回安装后的完整模组列表。

## 带模组的游戏

- `get_modded_game_status()` →
  ```ts
  {
    packageName: string            // 装成的独立应用包名
    installed: boolean
    version: string | null
    sourcePackageAvailable: boolean // 有没有留存原始安装包
    smapiAvailable: boolean         // 有没有导入 SMAPI 载荷
    builtApk: string | null         // 已打包好、待安装的产物
    supported: boolean              // 桌面预览窗口里为 false
  }
  ```
- `build_modded_game()` —— 生成带模组的安装包，返回产物路径。
  三步：改清单（换包名、换显示名、去掉会失效的授权校验）→ 注入 SMAPI 载荷与
  `Mods/` → 用本机密钥做 APK v2 签名。**很慢**（真机上按分钟计），
  前端应显示进度并禁用重复点击。前提不齐时直接报错，文案可原样展示。

  进度事件 `modded-build-progress`：
  ```ts
  { stage: "patching" | "repacking" | "signing" | "finished", message: string }
  ```

- `install_modded_game()` —— 交给系统安装器，用户还要在弹窗里确认。
  安装可能持续一两分钟，**前端应轮询 `get_modded_game_status` 直到 `installed` 为真**。
- `launch_modded_game()`
- `remove_modded_package()` —— 删打包产物回收空间

## 虚拟局域网

命令名、参数与事件都与桌面端一致，桌面端那套状态机可以直接复用。

- `vlan_start({ selfId, vip, members, stunUrls? })` → `VlanStatus`
- `vlan_update_members({ members })`
- `vlan_signal_in({ from, data })` —— 引擎没跑时静默忽略
- `vlan_stop()`
- `vlan_status()` → `VlanStatus`
- `vlan_helper_status()` → `{ elevated, helperRunning, available }`
  移动端语义：`elevated` = 已拿到 VPN 授权，`helperRunning` = 引擎在跑，
  `available` = 当前平台支持（桌面预览里为 false）
- `vlan_prepare()` → boolean，`true` 表示已授权、不需要用户操作

`members` 是 `{ id: string, vip: string }[]`，直接用房间成员里的 `id` 与 `vip`。

事件：

- `vlan-event` → `{ kind: "started"|"stopped"|"peer"|"error"|"log", peer?, text? }`
- `vlan-signal-out` → `{ to, data }`，**前端必须原样经房间 `room.signal` 转发给对端**

### 授权失败的识别

未授权时 `vlan_start` 会 reject 一个以 `未获得 VPN 授权` 开头的字符串，同时已经把系统
授权对话框拉起来了。界面应提示玩家授权后重试，而不是当成普通错误。
（桌面端对应的前缀是 `需要以管理员身份运行`。）
