using System.Reflection;
using System.Runtime.Loader;

namespace StardewValleyAssistant.Runtime;

/// <summary>
/// 本程序集位于助手安装目录，而游戏进程的 Default ALC 只会在游戏目录及其
/// deps.json 中探测程序集，因此我们的依赖（0Harmony.dll）默认解析不到。
/// 这里补一个解析回调，指向我们自己的目录。
/// </summary>
internal static class AssemblyResolver
{
    private static int _installed;

    /// <remarks>
    /// 必须在任何 Harmony 类型被解析之前调用，因此本方法自身不得引用 Harmony。
    /// </remarks>
    public static void Install()
    {
        if (Interlocked.Exchange(ref _installed, 1) == 1)
            return;

        AssemblyLoadContext.Default.Resolving += Resolve;
    }

    private static Assembly? Resolve(AssemblyLoadContext context, AssemblyName name)
    {
        if (string.IsNullOrEmpty(name.Name))
            return null;

        try
        {
            // 进程里已经有同名程序集就直接复用——SMAPI 会先加载它自己的 0Harmony，
            // 复用可避免同一方法被两个 Harmony 实例分别打补丁。
            var loaded = context.Assemblies.FirstOrDefault(a => a.GetName().Name == name.Name);
            if (loaded is not null)
            {
                Log.Debug($"[解析] 复用进程内已加载的 {name.Name}");
                return loaded;
            }

            var candidate = Path.Combine(Paths.RuntimeDir, name.Name + ".dll");
            if (File.Exists(candidate))
            {
                Log.Debug($"[解析] 从助手目录加载 {name.Name}");
                return context.LoadFromAssemblyPath(candidate);
            }
        }
        catch (Exception ex)
        {
            Log.Error($"[解析] {name.Name} 失败", ex);
        }

        return null;
    }
}
