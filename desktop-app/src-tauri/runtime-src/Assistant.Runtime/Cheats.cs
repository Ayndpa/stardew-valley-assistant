using System.Text.Json;
using StardewValley;
using StardewValley.Monsters;
using StardewValley.TerrainFeatures;

namespace StardewValleyAssistant.Runtime;

/// <summary>
/// 作弊指令的执行体。所有方法都由 <see cref="FrameLoop"/> 投递到游戏主线程执行——
/// Game1 及其下属集合都不是线程安全的，旧伴侣模组直接在管道读取回调（线程池）里
/// 改游戏状态其实是有竞态的，这里一并修正。
/// </summary>
internal static class Cheats
{
    /// <summary>时间冻结是持续状态，由每帧钩子读取。</summary>
    public static bool FreezeTimeActive { get; private set; }

    public static bool SpeedBoostActive { get; private set; }

    /// <summary>切换存档 / 回到标题时清空持续状态。</summary>
    public static void ResetToggles()
    {
        FreezeTimeActive = false;
        SpeedBoostActive = false;
    }

    /// <summary>已知的作弊指令类型；非作弊消息返回 false 交由调用方处理。</summary>
    public static bool IsCheat(string type) => type.StartsWith("cheat", StringComparison.Ordinal);

    public static void Handle(string type, JsonElement root)
    {
        switch (type)
        {
            case "cheatRefillEnergy":
                Execute("refillEnergy", () =>
                {
                    Game1.player.stamina = Game1.player.MaxStamina;
                    return $"体力已补满 ({Game1.player.MaxStamina})";
                });
                break;

            case "cheatRefillHealth":
                Execute("refillHealth", () =>
                {
                    Game1.player.health = Game1.player.maxHealth;
                    return $"生命已补满 ({Game1.player.maxHealth})";
                });
                break;

            case "cheatToggleSpeed":
                HandleToggleSpeed(ReadBool(root, "enabled"));
                break;

            case "cheatToggleFreezeTime":
                // 冻结时间不触碰游戏状态，只是切标志位，不需要世界就绪检查。
                FreezeTimeActive = ReadBool(root, "enabled");
                SendResult("toggleFreezeTime", true, FreezeTimeActive ? "时间已冻结" : "时间已恢复流动");
                break;

            case "cheatWaterCrops":
                Execute("waterCrops", WaterCrops);
                break;

            case "cheatGrowCrops":
                Execute("growCrops", GrowCrops);
                break;

            case "cheatTeleport":
                HandleTeleport(ReadString(root, "location"));
                break;

            case "cheatAddItem":
                HandleAddItem(ReadString(root, "itemId"), ReadInt(root, "count", 1));
                break;

            case "cheatAddMoney":
                HandleAddMoney(ReadInt(root, "amount", 0));
                break;

            case "cheatMaxFriendship":
                Execute("maxFriendship", MaxFriendship);
                break;

            case "cheatKillMonsters":
                Execute("killMonsters", KillMonsters);
                break;

            case "cheatSetWeather":
                HandleSetWeather(ReadString(root, "weather"));
                break;

            default:
                Log.Warn($"[作弊] 未知指令: {type}");
                break;
        }
    }

    // ── 各指令实现 ──────────────────────────────────────────

    private static void HandleToggleSpeed(bool enabled)
    {
        Execute("toggleSpeed", () =>
        {
            if (enabled)
            {
                // 速度 buff 的物品 ID 为 9
                Game1.player.applyBuff("9");
                SpeedBoostActive = true;
                return "速度加成已开启";
            }

            Game1.player.buffs.Remove("9");
            SpeedBoostActive = false;
            return "速度加成已关闭";
        });
    }

    private static string WaterCrops()
    {
        var farm = Game1.getFarm();
        if (farm is null)
            return "未找到农场";

        var count = 0;
        foreach (var pair in farm.terrainFeatures.Pairs)
        {
            if (pair.Value is HoeDirt { crop: not null } dirt && dirt.state.Value == 0) // 0 = 未浇水
            {
                dirt.state.Value = 1; // 1 = 已浇水
                count++;
            }
        }

        return $"已浇水 {count} 块农田";
    }

    /// <summary>
    /// 反复推进生长阶段直到成熟。加了迭代上限：本方法运行在游戏主线程上，
    /// 若遇到永远不会置 fullyGrown 的模组作物，无上限的循环会直接卡死游戏。
    /// </summary>
    private static string GrowCrops()
    {
        const int MaxDaysPerCrop = 200;

        var farm = Game1.getFarm();
        if (farm is null)
            return "未找到农场";

        var count = 0;
        var stalled = 0;
        foreach (var pair in farm.terrainFeatures.Pairs)
        {
            if (pair.Value is not HoeDirt { crop: not null } dirt)
                continue;

            var days = 0;
            while (!dirt.crop.fullyGrown.Value && days < MaxDaysPerCrop)
            {
                dirt.crop.newDay(1);
                days++;
            }

            if (days >= MaxDaysPerCrop)
                stalled++;
            else
                count++;
        }

        return stalled > 0
            ? $"已催熟 {count} 块作物（{stalled} 块未能成熟，已跳过）"
            : $"已催熟 {count} 块作物";
    }

    private static void HandleTeleport(string location)
    {
        Execute("teleport", () =>
        {
            if (string.IsNullOrWhiteSpace(location))
                return "未指定传送位置";

            // 常用传送点映射
            var teleportTargets = new Dictionary<string, (string Name, int X, int Y)>
            {
                ["farm"] = ("Farm", 64, 15),
                ["town"] = ("Town", 53, 67),
                ["forest"] = ("Forest", 52, 94),
                ["mountain"] = ("Mountain", 31, 20),
                ["mine"] = ("Mine", 13, 9),
                ["beach"] = ("Beach", 20, 4),
                ["desert"] = ("Desert", 35, 43),
                ["island"] = ("IslandWest", 77, 40),
            };

            if (teleportTargets.TryGetValue(location.ToLower(), out var target))
            {
                Game1.warpFarmer(target.Name, target.X, target.Y, false);
                return $"已传送到 {target.Name}";
            }

            // 未收录的地图名直接按原样传送
            Game1.warpFarmer(location, 64, 64, false);
            return $"已传送到 {location}";
        });
    }

    private static void HandleAddItem(string itemId, int count)
    {
        Execute("addItem", () =>
        {
            if (string.IsNullOrWhiteSpace(itemId))
                return "未指定物品ID";

            var amount = Math.Clamp(count, 1, 999);
            var item = ItemRegistry.Create(itemId, amount);
            if (item is null)
                return $"无法创建物品: {itemId}";

            Game1.player.addItemByMenuIfNecessary(item);
            return $"已添加 {item.DisplayName} x{amount}";
        });
    }

    private static void HandleAddMoney(int amount)
    {
        Execute("addMoney", () =>
        {
            if (amount == 0)
                return "未指定金额";

            Game1.player.Money += amount;
            return $"金币 {(amount > 0 ? "+" : "")}{amount:N0}，当前: {Game1.player.Money:N0}";
        });
    }

    private static string MaxFriendship()
    {
        var count = 0;
        foreach (var pair in Game1.player.friendshipData.Pairs)
        {
            if (pair.Value.Points < 2500)
            {
                pair.Value.Points = 2500;
                count++;
            }
        }

        return $"已将 {count} 个NPC好感度设为满值 (10❤)";
    }

    private static string KillMonsters()
    {
        var location = Game1.currentLocation;
        if (location is null)
            return "未找到当前地图";

        var monsters = location.characters.Where(c => c is Monster).ToList();
        foreach (var monster in monsters)
            location.characters.Remove(monster);

        return $"已清除 {monsters.Count} 个怪物";
    }

    private static void HandleSetWeather(string weather)
    {
        Execute("setWeather", () =>
        {
            if (string.IsNullOrWhiteSpace(weather))
                return "未指定天气类型";

            var weatherMap = new Dictionary<string, (string Id, string Name)>
            {
                ["sunny"] = ("Sun", "晴天"),
                ["rain"] = ("Rain", "雨天"),
                ["thunder"] = ("Storm", "雷暴"),
                ["snow"] = ("Snow", "雪天"),
            };

            if (weatherMap.TryGetValue(weather.ToLower(), out var target))
            {
                Game1.weatherForTomorrow = target.Id;
                return $"明天天气已设为: {target.Name}";
            }

            return $"未知天气类型: {weather}";
        });
    }

    // ── 公共包装 ────────────────────────────────────────────

    /// <summary>统一的作弊执行包装器，处理就绪检查、异常和结果回传。</summary>
    private static void Execute(string action, Func<string> execute)
    {
        if (!GameContext.IsWorldReady || Game1.player is null)
        {
            SendResult(action, false, "游戏未就绪，请先加载存档");
            return;
        }

        try
        {
            var message = execute();
            Log.Info($"[作弊] {action}: {message}");
            SendResult(action, true, message);
        }
        catch (Exception ex)
        {
            Log.Warn($"[作弊] {action} 失败: {ex.Message}");
            SendResult(action, false, $"执行失败: {ex.Message}");
        }
    }

    private static void SendResult(string action, bool success, string message) =>
        _ = PipeClient.SendAsync("cheatResult", new CheatResultPayload(action, success, message));

    // ── JSON 取值helper ─────────────────────────────────────

    private static bool ReadBool(JsonElement root, string name) =>
        root.TryGetProperty(name, out var prop) && prop.ValueKind == JsonValueKind.True;

    private static string ReadString(JsonElement root, string name) =>
        root.TryGetProperty(name, out var prop) ? prop.GetString() ?? "" : "";

    private static int ReadInt(JsonElement root, string name, int fallback) =>
        root.TryGetProperty(name, out var prop) && prop.TryGetInt32(out var value) ? value : fallback;
}
