using StardewValley;

namespace StardewValleyAssistant.Runtime;

/// <summary>
/// 复现旧伴侣模组依赖的那几个 SMAPI 事件。脱离 SMAPI 后没有事件总线，
/// 这里改为每帧对 Game1 的状态做差分推断出等价事件。
///
/// 对应关系：
///   SaveLoaded       ← IsWorldReady 由 false 变 true
///   ReturnedToTitle  ← IsWorldReady 由 true 变 false
///   TimeChanged      ← Game1.timeOfDay 变化
///   Warped           ← Game1.currentLocation 引用变化（仅本地玩家，与旧行为一致）
///   OneSecondTick    ← 每 60 帧
/// </summary>
internal static class GameEvents
{
    public static event Action? SaveLoaded;
    public static event Action? ReturnedToTitle;
    public static event Action<int>? TimeChanged;
    public static event Action<GameLocation>? Warped;
    public static event Action? OneSecondTick;

    private static bool _wasReady;
    private static int _lastTimeOfDay;
    private static GameLocation? _lastLocation;
    private static int _tickCounter;

    public static void Attach() => FrameLoop.Tick += OnTick;

    private static void OnTick()
    {
        if (++_tickCounter >= 60)
        {
            _tickCounter = 0;
            Raise(OneSecondTick, nameof(OneSecondTick));
        }

        var ready = GameContext.IsWorldReady;

        if (ready != _wasReady)
        {
            _wasReady = ready;
            if (ready)
            {
                // 重置差分基准，避免把首帧当成一次时间变化/切图。
                _lastTimeOfDay = Game1.timeOfDay;
                _lastLocation = Game1.currentLocation;
                Raise(SaveLoaded, nameof(SaveLoaded));
            }
            else
            {
                _lastTimeOfDay = 0;
                _lastLocation = null;
                Raise(ReturnedToTitle, nameof(ReturnedToTitle));
            }
            return;
        }

        if (!ready)
            return;

        if (Game1.timeOfDay != _lastTimeOfDay)
        {
            _lastTimeOfDay = Game1.timeOfDay;
            Raise(TimeChanged, _lastTimeOfDay, nameof(TimeChanged));
        }

        var location = Game1.currentLocation;
        if (!ReferenceEquals(location, _lastLocation))
        {
            _lastLocation = location;
            if (location is not null)
                Raise(Warped, location, nameof(Warped));
        }
    }

    private static void Raise(Action? handler, string name)
    {
        try
        {
            handler?.Invoke();
        }
        catch (Exception ex)
        {
            Log.Error($"[事件] {name} 处理失败", ex);
        }
    }

    private static void Raise<T>(Action<T>? handler, T arg, string name)
    {
        try
        {
            handler?.Invoke(arg);
        }
        catch (Exception ex)
        {
            Log.Error($"[事件] {name} 处理失败", ex);
        }
    }
}
