# Bundled Mods 目录

此目录存放随应用内置打包的模组资源。

## ⚠️ 打包注意事项

**zip 文件内的目录结构决定了安装后模组在 `Mods/` 下的位置。**

- **正确做法**：zip 内的文件应放在一个子文件夹中（如 `StardewValleyAssistant/manifest.json`），这样解压后会安装到 `Mods/StardewValleyAssistant/`。
- **错误做法**：如果文件直接放在 zip 根目录（如 `manifest.json`、`xxx.dll`），会直接散落在 `Mods/` 根目录下，导致模组无法被 SMAPI 正确识别。

## 目录结构示例

```
StardewValleyAssistant.zip
  └── StardewValleyAssistant/      ← 必须有这一层文件夹
        ├── manifest.json
        └── StardewValleyAssistant.dll
```

## 重新打包方法

```bash
cd src-tauri/bundled-mods/StardewValleyAssistant
zip -r ../StardewValleyAssistant.zip .
```

注意在 `StardewValleyAssistant/` 目录**内部**执行 zip 命令，确保 `manifest.json` 在 zip 的根路径下不会直接暴露。
