using System.Runtime.CompilerServices;

// 注意：本类型刻意置于全局命名空间，且名字必须是 StartupHook。
// .NET 运行时处理 DOTNET_STARTUP_HOOKS 时，会在指定程序集的全局命名空间中
// 按此名字查找类型，并调用其 `public static void Initialize()`。
// 改名或加命名空间都会导致钩子被静默忽略。
internal sealed class StartupHook
{
    /// <remarks>
    /// 运行在游戏 Main 之前，且此刻程序集解析器尚未安装，因此这里只做一次转调；
    /// 真正的初始化在 <see cref="StardewValleyAssistant.Runtime.AssistantRuntime.Start"/>，
    /// 用 NoInlining 确保它的方法体不会被内联到这里而提前触发类型解析。
    /// </remarks>
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void Initialize() => StardewValleyAssistant.Runtime.AssistantRuntime.Start();
}
