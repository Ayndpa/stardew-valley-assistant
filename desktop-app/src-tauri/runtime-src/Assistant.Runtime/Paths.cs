namespace StardewValleyAssistant.Runtime;

/// <summary>
/// 与 Rust 端约定的磁盘路径。这些位置被 item_prices.rs / mod_data.rs / live_server.rs
/// 硬编码读取，改动会导致数据页静默失效。
/// </summary>
internal static class Paths
{
    /// <summary>%APPDATA%\StardewValley\StardewValleyAssistant</summary>
    public static string ExportDir { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "StardewValley",
        "StardewValleyAssistant");

    public static string GameDataFile => Path.Combine(ExportDir, "game-data.json");
    public static string ModDataFile => Path.Combine(ExportDir, "mod-data.json");
    public static string IconsDir => Path.Combine(ExportDir, "icons");
    public static string LogFile => Path.Combine(ExportDir, "runtime.log");

    /// <summary>本程序集所在目录（助手安装目录下的 runtime 子目录，不在游戏目录内）。</summary>
    public static string RuntimeDir { get; } =
        Path.GetDirectoryName(typeof(Paths).Assembly.Location) ?? AppContext.BaseDirectory;
}
