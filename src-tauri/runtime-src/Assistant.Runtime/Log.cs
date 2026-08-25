using System.Text;

namespace StardewValleyAssistant.Runtime;

/// <summary>
/// 替代 SMAPI 的 <c>IMonitor</c>：脱离 SMAPI 后没有宿主日志系统，自行写文件。
/// 所有方法都不会抛异常——日志失败绝不能拖垮游戏进程。
/// </summary>
internal static class Log
{
    private const long MaxBytes = 2 * 1024 * 1024;

    private static readonly object Gate = new();
    private static bool _failed;

    public static void Debug(string message) => Write("DEBUG", message);
    public static void Info(string message) => Write("INFO", message);
    public static void Warn(string message) => Write("WARN", message);

    public static void Error(string message, Exception ex) => Write("ERROR", $"{message}: {ex}");

    private static void Write(string level, string message)
    {
        if (_failed)
            return;

        try
        {
            lock (Gate)
            {
                Directory.CreateDirectory(Paths.ExportDir);

                // 简单轮转：超限后截断重来，避免长期运行把磁盘写满。
                var file = new FileInfo(Paths.LogFile);
                if (file.Exists && file.Length > MaxBytes)
                    File.WriteAllText(Paths.LogFile, $"--- 日志已轮转于 {DateTimeOffset.Now:O} ---{Environment.NewLine}");

                File.AppendAllText(
                    Paths.LogFile,
                    $"[{DateTimeOffset.Now:HH:mm:ss.fff}] [{level}] {message}{Environment.NewLine}",
                    Encoding.UTF8);
            }
        }
        catch
        {
            // 磁盘只读、目录被占用等情况下彻底放弃日志，不再反复尝试。
            _failed = true;
        }
    }
}
