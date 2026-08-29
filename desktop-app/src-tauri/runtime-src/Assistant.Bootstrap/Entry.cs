using System.Reflection;
using System.Runtime.InteropServices;
using System.Runtime.Loader;

namespace StardewValleyAssistant.Bootstrap;

/// <summary>
/// 运行时注入路径的落点。注入器（assistant_inject.dll）通过 hostfxr 的
/// <c>load_assembly_and_get_function_pointer</c> 拿到 <see cref="Initialize"/> 的
/// 函数指针并调用它。
///
/// 这条路径下本程序集位于一个次级 ALC 中，而游戏的类型都在 Default ALC；
/// 因此这里唯一的职责就是把 Assistant.Runtime 显式加载到 Default ALC 后转调过去，
/// 确保它看到的 Game1 与游戏自身完全是同一个类型。
/// </summary>
public static class Entry
{
    /// <param name="runtimeDllPath">指向 Assistant.Runtime.dll 完整路径的 UTF-16 字符串。</param>
    /// <param name="charCount">上述字符串的字符数（不含结尾 NUL）。</param>
    /// <returns>0 表示成功，负值表示失败。</returns>
    [UnmanagedCallersOnly]
    public static int Initialize(IntPtr runtimeDllPath, int charCount)
    {
        try
        {
            if (runtimeDllPath == IntPtr.Zero || charCount <= 0)
                return -1;

            var path = Marshal.PtrToStringUni(runtimeDllPath, charCount);
            if (string.IsNullOrWhiteSpace(path) || !File.Exists(path))
                return -2;

            var assembly = AssemblyLoadContext.Default.LoadFromAssemblyPath(path);

            // StartupHook 位于全局命名空间，与 DOTNET_STARTUP_HOOKS 走的是同一个入口。
            var hook = assembly.GetType("StartupHook", throwOnError: false);
            var initialize = hook?.GetMethod("Initialize", BindingFlags.Public | BindingFlags.Static);
            if (initialize is null)
                return -3;

            initialize.Invoke(null, null);
            return 0;
        }
        catch
        {
            // 此处不能抛异常穿回原生调用方；失败原因由 Assistant.Runtime 自己的日志记录。
            return -4;
        }
    }
}
