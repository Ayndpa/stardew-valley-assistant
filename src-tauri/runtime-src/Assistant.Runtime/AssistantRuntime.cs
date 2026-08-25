using System.Runtime.CompilerServices;
using System.Runtime.Loader;
using System.Text.Json;
using StardewValley;

namespace StardewValleyAssistant.Runtime;

/// <summary>
/// 运行时总装。两条加载路径最终都汇聚到 <see cref="Start"/>：
///   1. 助手启动游戏时通过 <c>DOTNET_STARTUP_HOOKS</c> 由运行时在 Main 之前加载；
///   2. 游戏已在运行时由注入器把 Assistant.Bootstrap 载入进程后转调过来。
/// 两次调用是幂等的。
/// </summary>
internal static class AssistantRuntime
{
    private const string GameAssemblyName = "Stardew Valley";

    private static int _started;

    /// <summary>已完成全量数据导出的存档，用于避免重复导出。</summary>
    private static string? _exportedSaveId;

    public static void Start()
    {
        if (Interlocked.Exchange(ref _started, 1) == 1)
        {
            Log.Debug("[启动] 运行时已在运行，忽略重复请求");
            return;
        }

        try
        {
            // 必须先于任何 Harmony 类型解析安装，否则 0Harmony.dll 找不到。
            AssemblyResolver.Install();
            Log.Info($"[启动] 助手运行时已载入进程 (PID {Environment.ProcessId})，目录: {Paths.RuntimeDir}");

            new Thread(WaitForGame)
            {
                IsBackground = true,
                Name = "StardewValleyAssistant.Runtime",
            }.Start();
        }
        catch (Exception ex)
        {
            Log.Error("[启动] 初始化失败", ex);
        }
    }

    /// <remarks>
    /// 本方法刻意不引用任何游戏类型：通过 startup hook 加载时，我们比游戏的 Main
    /// 更早运行，过早触碰 Game1 会提前触发它的静态构造函数。这里只按名字等待游戏
    /// 程序集出现，再把后续工作交给 <see cref="AttachToGame"/>。
    /// </remarks>
    private static void WaitForGame()
    {
        try
        {
            while (!AssemblyLoadContext.Default.Assemblies.Any(a => a.GetName().Name == GameAssemblyName))
                Thread.Sleep(250);

            // 程序集已加载说明游戏的 Main 即将/正在运行，稍等一下让它自己完成
            // Game1 的构造，避免由我们这边先触发静态构造。
            Thread.Sleep(2000);

            AttachToGame();
        }
        catch (Exception ex)
        {
            Log.Error("[启动] 等待游戏就绪失败", ex);
        }
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private static void AttachToGame()
    {
        while (Game1.game1 is null)
            Thread.Sleep(250);

        Log.Info("[启动] 游戏实例已就绪，开始挂载");

        if (!FrameLoop.Install())
        {
            Log.Warn("[启动] 主线程泵不可用，实时数据与作弊功能将无法工作");
            return;
        }

        GameEvents.Attach();
        GameEvents.SaveLoaded += OnSaveLoaded;
        GameEvents.ReturnedToTitle += OnReturnedToTitle;
        GameEvents.TimeChanged += OnTimeChanged;
        GameEvents.Warped += OnWarped;
        GameEvents.OneSecondTick += OnOneSecondTick;
        FrameLoop.Tick += OnTick;

        PipeClient.MessageReceived += OnMessageReceived;
        PipeClient.Connected += OnPipeConnected;
        PipeClient.TryConnectAsync();

        Log.Info("[启动] 挂载完成");
    }

    // ── 每帧 ────────────────────────────────────────────────

    private static void OnTick()
    {
        // 冻结时间：每帧把时间累加器清零
        if (Cheats.FreezeTimeActive)
            Game1.gameTimeInterval = 0;

        IconExport.ProcessBatch();
    }

    // ── 游戏事件 ────────────────────────────────────────────

    private static void OnSaveLoaded()
    {
        Log.Info($"[事件] 存档已加载, IsConnected={PipeClient.IsConnected}");
        Cheats.ResetToggles();
        SendNpcLocations();

        // IsWorldReady 是从 Game1 状态推断出来的，过夜结算之类的过场也可能让它
        // 短暂翻转从而重复触发本事件。全量导出要遍历上千条数据、逐个探测图标文件，
        // 跑在主线程上会造成明显卡顿，因此按存档去重，一个存档只做一次。
        var saveId = GameContext.SaveId;
        if (saveId is not null && saveId == _exportedSaveId)
        {
            Log.Debug("[事件] 该存档已导出过数据，跳过");
            return;
        }

        _exportedSaveId = saveId;
        IconExport.Enqueue();

        GameContext.Toast("助手：正在导出游戏数据…");
        DataExport.Run();
    }

    private static void OnTimeChanged(int timeOfDay)
    {
        Log.Debug($"[事件] 时间变化 {timeOfDay}");
        SendNpcLocations();
    }

    private static void OnWarped(GameLocation location)
    {
        Log.Debug($"[事件] 切换地图 → {location.Name}");
        SendNpcLocations();
    }

    private static async void OnReturnedToTitle()
    {
        Log.Info("[事件] 已返回标题界面");
        Cheats.ResetToggles();
        // 换存档后要重新导出（不同存档可能启用了不同的模组）
        _exportedSaveId = null;

        try
        {
            await PipeClient.SendAsync("clear", null);
        }
        catch (Exception ex)
        {
            Log.Warn($"发送清除消息失败: {ex.Message}");
        }

        PipeClient.Disconnect();
    }

    private static void OnOneSecondTick()
    {
        if (!PipeClient.IsConnected)
            PipeClient.TryConnectAsync();
    }

    // ── 管道事件 ────────────────────────────────────────────

    /// <remarks>在管道线程上触发，因此所有游戏状态访问都要投递回主线程。</remarks>
    private static void OnPipeConnected() => FrameLoop.Post("连接后推送NPC位置", SendNpcLocations);

    /// <remarks>同样在管道线程上触发。</remarks>
    private static void OnMessageReceived(string type, JsonElement root)
    {
        Log.Debug($"[处理] 消息类型: {type}");

        switch (type)
        {
            case "requestNpcLocations":
                FrameLoop.Post(type, SendNpcLocations);
                break;

            case "pong":
                break;

            default:
                if (Cheats.IsCheat(type))
                    FrameLoop.Post(type, () => Cheats.Handle(type, root));
                else
                    Log.Warn($"[处理] 未知消息类型: {type}");
                break;
        }
    }

    // ── 数据推送 ────────────────────────────────────────────

    /// <remarks>必须在游戏主线程调用。</remarks>
    private static void SendNpcLocations()
    {
        if (!GameContext.IsWorldReady || !PipeClient.IsConnected)
        {
            Log.Debug($"[发送] 跳过NPC位置: IsWorldReady={GameContext.IsWorldReady}, IsConnected={PipeClient.IsConnected}");
            return;
        }

        try
        {
            var npcs = CollectNpcLocations();
            var snapshot = new NpcLocationsSnapshot(
                SaveId: GameContext.SaveId,
                GameTime: Game1.timeOfDay,
                GeneratedAt: DateTimeOffset.Now.ToString("O"),
                Npcs: npcs);

            Log.Debug($"[发送] npcLocations: {npcs.Count} 个NPC, 时间={Game1.timeOfDay}");
            _ = PipeClient.SendAsync("npcLocations", snapshot);
        }
        catch (Exception ex)
        {
            Log.Warn($"[发送] NPC 位置失败: {ex.Message}");
        }
    }

    private static List<NpcLocationEntry> CollectNpcLocations()
    {
        var result = new List<NpcLocationEntry>();

        foreach (var npc in Utility.getAllVillagers())
        {
            if (npc.currentLocation is null || string.IsNullOrWhiteSpace(npc.Name))
                continue;

            result.Add(new NpcLocationEntry(
                NpcName: npc.Name,
                Location: npc.currentLocation.NameOrUniqueName,
                TileX: npc.TilePoint.X,
                TileY: npc.TilePoint.Y,
                Direction: npc.FacingDirection));
        }

        return result;
    }
}
