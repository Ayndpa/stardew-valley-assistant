using System.Text.Json;
using StardewValley;

namespace StardewValleyAssistant.Runtime;

/// <summary>
/// 导出游戏数据到 <c>%APPDATA%\StardewValley\StardewValleyAssistant\</c>。
/// 这是助手拿到「被其它模组改过的」价格、周期等数据的唯一途径——无模组时
/// Rust 端走 XNB 解包即可，装了模组则必须以这里导出的为准。
/// </summary>
internal static class DataExport
{
    /// <summary>
    /// 由主线程调用：<c>DataLoader</c> 与本地化字符串解析都依赖游戏内容管理器，
    /// 必须在游戏线程上采集；耗时的序列化和磁盘写入再甩到后台线程。
    /// </summary>
    public static void Run()
    {
        List<ModExportItemEntry> items;
        List<ModExportCropEntry> crops;
        List<ModExportAnimalEntry> animals;
        List<ModExportVillagerEntry> villagers;
        string? saveId;

        try
        {
            items = CollectAllItems();
            crops = CollectAllCrops();
            animals = CollectAllAnimals();
            villagers = CollectModAddedVillagers();
            saveId = GameContext.SaveId;
        }
        catch (Exception ex)
        {
            Log.Error("[导出] 采集游戏数据失败", ex);
            return;
        }

        _ = Task.Run(() => WriteAll(saveId, items, crops, animals, villagers));
    }

    private static void WriteAll(
        string? saveId,
        List<ModExportItemEntry> items,
        List<ModExportCropEntry> crops,
        List<ModExportAnimalEntry> animals,
        List<ModExportVillagerEntry> villagers)
    {
        try
        {
            Directory.CreateDirectory(Paths.ExportDir);
            var generatedAt = DateTimeOffset.Now.ToString("O");

            // 1. game-data.json：全量数据（原版 + 模组），供物品/作物/动物页面使用
            WriteExportFile(
                Paths.GameDataFile,
                new ModExportSnapshot(saveId, generatedAt, items, crops, animals, new List<ModExportVillagerEntry>()),
                $"[导出] 已写入游戏数据: {items.Count} 物品, {crops.Count} 作物, {animals.Count} 动物");

            // 2. mod-data.json：仅模组新增的数据，供模组数据页面使用
            var modItems = items.Where(i => IsModAddedId(i.Id)).ToList();
            var modCrops = crops.Where(c => IsModAddedId(c.Id)).ToList();
            var modAnimals = animals.Where(a => IsModAddedId(a.Id)).ToList();

            WriteExportFile(
                Paths.ModDataFile,
                new ModExportSnapshot(saveId, generatedAt, modItems, modCrops, modAnimals, villagers),
                $"[导出] 已写入模组数据: {modItems.Count} 物品, {modCrops.Count} 作物, {modAnimals.Count} 动物, {villagers.Count} 村民");

            FrameLoop.Post("导出完成提示", () => GameContext.Toast("助手：游戏数据导出完成"));
        }
        catch (Exception ex)
        {
            Log.Error("[导出] 写入数据失败", ex);
        }
    }

    private static void WriteExportFile<T>(string filePath, T snapshot, string logMessage)
    {
        var json = JsonSerializer.Serialize(snapshot, new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            WriteIndented = false,
        });

        // 仅在内容变化时写入：Rust 端以文件指纹作为快照缓存键，
        // 无谓的重写会让整个物品快照缓存失效。
        if (File.Exists(filePath) && File.ReadAllText(filePath) == json)
        {
            Log.Debug($"[导出] {Path.GetFileName(filePath)} 无变化，跳过写入");
            return;
        }

        File.WriteAllText(filePath, json);
        Log.Info(logMessage);
    }

    /// <summary>原版物品/作物/动物 ID 都是纯数字，模组添加的使用字符串 ID。</summary>
    private static bool IsModAddedId(string id) =>
        !string.IsNullOrEmpty(id) && !int.TryParse(id, out _);

    /// <summary>
    /// 解析 <c>[LocalizedText Strings\Objects:Parsnip_Name]</c> 格式的本地化令牌，
    /// 用 Game1.content.LoadString 保持与游戏内部一致。
    /// </summary>
    private static string ResolveToken(string? text)
    {
        if (string.IsNullOrEmpty(text) || !text.StartsWith("[LocalizedText ") || !text.EndsWith("]"))
            return text ?? "";

        try
        {
            var key = text[14..^1].Trim();
            var resolved = Game1.content.LoadString(key);
            if (!string.IsNullOrEmpty(resolved) && resolved != key)
                return resolved;
        }
        catch
        {
            // 解析失败返回原文
        }

        return text;
    }

    // ── 采集 ────────────────────────────────────────────────

    private static List<ModExportItemEntry> CollectAllItems()
    {
        var result = new List<ModExportItemEntry>();
        try
        {
            foreach (var entry in DataLoader.Objects(Game1.content))
            {
                var data = entry.Value;
                result.Add(new ModExportItemEntry(
                    Id: entry.Key,
                    Name: ResolveToken(data.DisplayName),
                    InternalName: data.Name,
                    Description: ResolveToken(data.Description),
                    Category: data.Category,
                    Price: data.Price,
                    Edibility: data.Edibility,
                    Type: data.Type
                ));
            }
        }
        catch (Exception ex)
        {
            Log.Warn($"[导出] 读取物品数据失败: {ex.Message}");
        }

        return result;
    }

    private static List<ModExportCropEntry> CollectAllCrops()
    {
        var result = new List<ModExportCropEntry>();
        try
        {
            foreach (var entry in DataLoader.Crops(Game1.content))
            {
                var data = entry.Value;
                result.Add(new ModExportCropEntry(
                    Id: entry.Key,
                    Seasons: data.Seasons?.Select(s => s.ToString()).ToList() ?? new List<string>(),
                    HarvestItemId: data.HarvestItemId,
                    RegrowDays: data.RegrowDays,
                    Phases: data.DaysInPhase ?? new List<int>(),
                    NeedsWatering: data.NeedsWatering
                ));
            }
        }
        catch (Exception ex)
        {
            Log.Warn($"[导出] 读取作物数据失败: {ex.Message}");
        }

        return result;
    }

    private static List<ModExportAnimalEntry> CollectAllAnimals()
    {
        var result = new List<ModExportAnimalEntry>();
        try
        {
            foreach (var entry in DataLoader.FarmAnimals(Game1.content))
            {
                var data = entry.Value;
                result.Add(new ModExportAnimalEntry(
                    Id: entry.Key,
                    DisplayName: ResolveToken(data.DisplayName),
                    House: data.House,
                    PurchasePrice: data.PurchasePrice,
                    SellPrice: data.SellPrice,
                    DaysToMature: data.DaysToMature,
                    DaysToProduce: data.DaysToProduce,
                    CanGetPregnant: data.CanGetPregnant,
                    HarvestType: (int)data.HarvestType,
                    HarvestTool: data.HarvestTool ?? "",
                    ProduceItemIds: data.ProduceItemIds?.Select(p => p.ItemId).ToList() ?? new List<string>(),
                    DeluxeProduceItemIds: data.DeluxeProduceItemIds?.Select(p => p.ItemId).ToList() ?? new List<string>(),
                    DeluxeProduceMinFriendship: data.DeluxeProduceMinimumFriendship,
                    CanSwim: data.CanSwim,
                    CanEatGoldenCrackers: data.CanEatGoldenCrackers
                ));
            }
        }
        catch (Exception ex)
        {
            Log.Warn($"[导出] 读取动物数据失败: {ex.Message}");
        }

        return result;
    }

    private static List<ModExportVillagerEntry> CollectModAddedVillagers()
    {
        var result = new List<ModExportVillagerEntry>();
        try
        {
            var characters = DataLoader.Characters(Game1.content);
            var giftTastes = DataLoader.NpcGiftTastes(Game1.content);

            foreach (var entry in characters)
            {
                if (!IsModAddedId(entry.Key))
                    continue;

                var data = entry.Value;

                var birthday = data.BirthSeason.HasValue && data.BirthDay > 0
                    ? $"{data.BirthSeason.Value} {data.BirthDay}"
                    : "";

                // 好感礼物格式: "love_id1 love_id2/like_id1 like_id2/dislike/hate/neutral"
                var loves = new List<string>();
                var likes = new List<string>();
                if (giftTastes.TryGetValue(entry.Key, out var tasteStr))
                {
                    var parts = tasteStr.Split('/');
                    if (parts.Length > 0 && !string.IsNullOrEmpty(parts[0]))
                        loves = parts[0].Split(' ').Where(s => !string.IsNullOrEmpty(s)).ToList();
                    if (parts.Length > 1 && !string.IsNullOrEmpty(parts[1]))
                        likes = parts[1].Split(' ').Where(s => !string.IsNullOrEmpty(s)).ToList();
                }

                result.Add(new ModExportVillagerEntry(
                    Id: entry.Key,
                    DisplayName: data.DisplayName,
                    Birthday: birthday,
                    HomeRegion: data.HomeRegion ?? "",
                    CanSocialize: data.CanSocialize ?? "",
                    Loves: loves,
                    Likes: likes
                ));
            }
        }
        catch (Exception ex)
        {
            Log.Warn($"[导出] 读取村民数据失败: {ex.Message}");
        }

        return result;
    }
}
