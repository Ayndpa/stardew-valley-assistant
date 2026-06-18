using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using StardewModdingAPI;
using StardewModdingAPI.Events;
using StardewValley;
using StardewValley.GameData;

namespace StardewValleyAssistant;

public sealed class ModEntry : Mod
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
    };

    private string? SnapshotDirectory;
    private string? NpcLocationsPath;
    private string? ItemPricesPath;

    public override void Entry(IModHelper helper)
    {
        this.SnapshotDirectory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "StardewValley",
            "StardewValleyAssistant"
        );
        this.NpcLocationsPath = Path.Combine(this.SnapshotDirectory, "npc-locations.json");
        this.ItemPricesPath = Path.Combine(this.SnapshotDirectory, "item-prices.json");

        helper.Events.GameLoop.SaveLoaded += this.OnSaveLoaded;
        helper.Events.GameLoop.DayStarted += this.OnDayStarted;
        helper.Events.GameLoop.OneSecondUpdateTicked += this.OnOneSecondUpdateTicked;
        helper.Events.GameLoop.ReturnedToTitle += this.OnReturnedToTitle;
    }

    private void OnSaveLoaded(object? sender, SaveLoadedEventArgs e)
    {
        this.WriteAllSnapshots();
    }

    private void OnDayStarted(object? sender, DayStartedEventArgs e)
    {
        this.WriteAllSnapshots();
    }

    private void OnOneSecondUpdateTicked(object? sender, OneSecondUpdateTickedEventArgs e)
    {
        this.WriteNpcLocationsSnapshot();
    }

    private void OnReturnedToTitle(object? sender, ReturnedToTitleEventArgs e)
    {
        this.DeleteSnapshot(this.NpcLocationsPath);
        this.DeleteSnapshot(this.ItemPricesPath);
    }

    private void WriteAllSnapshots()
    {
        this.WriteNpcLocationsSnapshot();
        this.WriteItemPricesSnapshot();
    }

    private void WriteNpcLocationsSnapshot()
    {
        if (!Context.IsWorldReady || this.NpcLocationsPath is null)
            return;

        try
        {
            this.EnsureDirectoryExists();

            var snapshot = new NpcLocationsSnapshot(
                SaveId: this.GetSaveId(),
                GameTime: Game1.timeOfDay,
                GeneratedAt: DateTimeOffset.Now.ToString("O"),
                Npcs: this.GetNpcLocations().ToList()
            );

            File.WriteAllText(this.NpcLocationsPath, JsonSerializer.Serialize(snapshot, JsonOptions));
        }
        catch (Exception ex)
        {
            this.Monitor.Log($"Failed to write NPC location snapshot: {ex.Message}", LogLevel.Warn);
        }
    }

    private void WriteItemPricesSnapshot()
    {
        if (!Context.IsWorldReady || this.ItemPricesPath is null)
            return;

        try
        {
            this.EnsureDirectoryExists();

            var prices = this.CollectItemPrices();

            var snapshot = new ItemPricesSnapshot(
                SaveId: this.GetSaveId(),
                GeneratedAt: DateTimeOffset.Now.ToString("O"),
                Prices: prices
            );

            File.WriteAllText(this.ItemPricesPath, JsonSerializer.Serialize(snapshot, JsonOptions));
        }
        catch (Exception ex)
        {
            this.Monitor.Log($"Failed to write item price snapshot: {ex.Message}", LogLevel.Warn);
        }
    }

    private void EnsureDirectoryExists()
    {
        if (!string.IsNullOrWhiteSpace(this.SnapshotDirectory))
            Directory.CreateDirectory(this.SnapshotDirectory);
    }

    private void DeleteSnapshot(string? path)
    {
        if (path is null)
            return;

        try
        {
            File.Delete(path);
        }
        catch (Exception ex)
        {
            this.Monitor.Log($"Failed to remove snapshot {Path.GetFileName(path)}: {ex.Message}", LogLevel.Trace);
        }
    }

    private string? GetSaveId()
    {
        if (Game1.player is null)
            return null;

        string farmerName = Game1.player.Name?.Trim() ?? "";
        if (string.IsNullOrWhiteSpace(farmerName))
            return Game1.uniqueIDForThisGame.ToString();

        return $"{SaveGame.FilterFileName(farmerName)}_{Game1.uniqueIDForThisGame}";
    }

    private IEnumerable<NpcLocationEntry> GetNpcLocations()
    {
        foreach (NPC npc in Utility.getAllVillagers())
        {
            if (npc.currentLocation is null || string.IsNullOrWhiteSpace(npc.Name))
                continue;

            yield return new NpcLocationEntry(
                NpcName: npc.Name,
                Location: npc.currentLocation.NameOrUniqueName,
                TileX: npc.TilePoint.X,
                TileY: npc.TilePoint.Y,
                Direction: npc.FacingDirection
            );
        }
    }

    private Dictionary<string, int> CollectItemPrices()
    {
        var prices = new Dictionary<string, int>();

        try
        {
            var objects = DataLoader.Objects(Game1.content);
            foreach (var entry in objects)
            {
                string id = entry.Key;
                var objectData = entry.Value;

                if (objectData.Price > 0)
                {
                    prices[id] = objectData.Price;
                }
            }
        }
        catch (Exception ex)
        {
            this.Monitor.Log($"Failed to read object data: {ex.Message}", LogLevel.Warn);
        }

        return prices;
    }
}

// NPC Locations data structures
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

// Item Prices data structures
internal sealed record ItemPricesSnapshot(
    string? SaveId,
    string GeneratedAt,
    Dictionary<string, int> Prices
);
