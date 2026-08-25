using System.Collections.Concurrent;
using System.Reflection;
using HarmonyLib;
using Microsoft.Xna.Framework;
using StardewValley;

namespace StardewValleyAssistant.Runtime;

/// <summary>
/// 主线程泵。<see cref="Game1"/> 不是线程安全的，从管道线程收到的任何指令都必须
/// 回到游戏主线程执行；SMAPI 的 <c>UpdateTicked</c> 事件原本承担这个职责，脱离
/// SMAPI 后由这里用 Harmony 补丁自行提供。
///
/// 补丁目标选 <c>Game1._update</c>：它是 private 且非虚方法，SMAPI 的 SGame 只能
/// 覆盖 <c>Game1.Update</c>（其内部仍会调到 <c>_update</c>），因此无论是否挂载
/// SMAPI，这个补丁每帧都只触发一次，不会重复也不会被旁路。
/// </summary>
internal static class FrameLoop
{
    private const string HarmonyId = "com.stardewvalleyassistant.runtime";

    private static readonly ConcurrentQueue<PendingAction> Pending = new();
    private static int _installed;

    /// <summary>每帧在游戏主线程上触发。订阅方必须自行处理异常。</summary>
    public static event Action? Tick;

    public static bool IsInstalled => Volatile.Read(ref _installed) == 1;

    public static bool Install()
    {
        if (Interlocked.Exchange(ref _installed, 1) == 1)
            return true;

        try
        {
            var target = ResolveUpdateMethod();
            if (target is null)
            {
                Log.Warn("[主线程泵] 未能在 Game1 上找到 _update/Update 方法，实时功能不可用");
                Volatile.Write(ref _installed, 0);
                return false;
            }

            var postfix = new HarmonyMethod(typeof(FrameLoop).GetMethod(
                nameof(AfterUpdate), BindingFlags.NonPublic | BindingFlags.Static));

            new Harmony(HarmonyId).Patch(target, postfix: postfix);
            Log.Info($"[主线程泵] 已挂载到 Game1.{target.Name}");
            return true;
        }
        catch (Exception ex)
        {
            Log.Error("[主线程泵] 挂载失败", ex);
            Volatile.Write(ref _installed, 0);
            return false;
        }
    }

    /// <summary>
    /// 优先 <c>_update</c>；旧版本或改版游戏若没有该方法则退回 <c>Update</c>
    /// （此时若存在 SGame 之类的子类覆盖且未调用 base，补丁可能不触发）。
    /// </summary>
    private static MethodBase? ResolveUpdateMethod()
    {
        var args = new[] { typeof(GameTime) };
        return AccessTools.DeclaredMethod(typeof(Game1), "_update", args)
            ?? AccessTools.DeclaredMethod(typeof(Game1), "Update", args);
    }

    /// <summary>把一个操作排队到游戏主线程执行。</summary>
    public static void Post(string label, Action action) => Pending.Enqueue(new PendingAction(label, action));

    /// <summary>Harmony 后置补丁——运行在游戏主线程。</summary>
    private static void AfterUpdate()
    {
        // 每帧限量处理，避免一次性涌入大量指令造成掉帧。
        for (var i = 0; i < 16 && Pending.TryDequeue(out var pending); i++)
        {
            try
            {
                pending.Action();
            }
            catch (Exception ex)
            {
                Log.Error($"[主线程泵] 执行 {pending.Label} 失败", ex);
            }
        }

        try
        {
            Tick?.Invoke();
        }
        catch (Exception ex)
        {
            // 绝不能让异常冒泡回游戏循环。
            Log.Error("[主线程泵] Tick 订阅方抛出异常", ex);
        }
    }

    private readonly record struct PendingAction(string Label, Action Action);
}
