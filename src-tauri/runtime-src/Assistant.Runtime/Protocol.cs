using System.Text.Json.Serialization;

namespace StardewValleyAssistant.Runtime;

// 管道协议的载荷定义。字段名与 Rust 端 game_data/pipe_server.rs 和 live_state.rs
// 的 serde 定义一一对应（camelCase），改动必须两边同步。

/// <summary>外层信封：<c>{"type": "...", "data": {...}}</c></summary>
internal sealed class ModMessageWrapper
{
    [JsonPropertyName("type")]
    public string Type { get; set; } = "";

    [JsonPropertyName("data")]
    public object? Data { get; set; }
}

internal sealed record NpcLocationsSnapshot(
    string? SaveId,
    int GameTime,
    string GeneratedAt,
    List<NpcLocationEntry> Npcs
);

internal sealed record NpcLocationEntry(
    string NpcName,
    string Location,
    int TileX,
    int TileY,
    int Direction
);

internal sealed record CheatResultPayload(
    string Action,
    bool Success,
    string Message
);

internal sealed record ModExportSnapshot(
    string? SaveId,
    string GeneratedAt,
    List<ModExportItemEntry> Items,
    List<ModExportCropEntry> Crops,
    List<ModExportAnimalEntry> Animals,
    List<ModExportVillagerEntry> Villagers
);

internal sealed record ModExportItemEntry(
    string Id,
    string Name,
    string InternalName,
    string Description,
    int Category,
    int Price,
    int Edibility,
    string Type
);

internal sealed record ModExportCropEntry(
    string Id,
    List<string> Seasons,
    string HarvestItemId,
    int RegrowDays,
    List<int> Phases,
    bool NeedsWatering
);

internal sealed record ModExportAnimalEntry(
    string Id,
    string DisplayName,
    string House,
    int PurchasePrice,
    int SellPrice,
    int DaysToMature,
    int DaysToProduce,
    bool CanGetPregnant,
    int HarvestType,
    string HarvestTool,
    List<string> ProduceItemIds,
    List<string> DeluxeProduceItemIds,
    int DeluxeProduceMinFriendship,
    bool CanSwim,
    bool CanEatGoldenCrackers
);

internal sealed record ModExportVillagerEntry(
    string Id,
    string DisplayName,
    string Birthday,
    string HomeRegion,
    string CanSocialize,
    List<string> Loves,
    List<string> Likes
);
