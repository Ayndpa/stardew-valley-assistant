using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using StardewModdingAPI;
using StardewModdingAPI.Events;
using StardewValley;

namespace StardewValleyAssistantNpcLocations;

public sealed class ModEntry : Mod
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
    };

    private string? SnapshotPath;

    public override void Entry(IModHelper helper)
    {
        this.SnapshotPath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "StardewValley",
            "StardewValleyAssistant",
            "npc-locations.json"
        );

        helper.Events.GameLoop.SaveLoaded += this.OnSaveLoaded;
        helper.Events.GameLoop.DayStarted += this.OnDayStarted;
        helper.Events.GameLoop.OneSecondUpdateTicked += this.OnOneSecondUpdateTicked;
        helper.Events.GameLoop.ReturnedToTitle += this.OnReturnedToTitle;
    }

    private void OnSaveLoaded(object? sender, SaveLoadedEventArgs e)
    {
        this.WriteSnapshot();
    }

    private void OnDayStarted(object? sender, DayStartedEventArgs e)
    {
        this.WriteSnapshot();
    }

    private void OnOneSecondUpdateTicked(object? sender, OneSecondUpdateTickedEventArgs e)
    {
        this.WriteSnapshot();
    }

    private void OnReturnedToTitle(object? sender, ReturnedToTitleEventArgs e)
    {
        if (this.SnapshotPath is null)
            return;

        try
        {
            File.Delete(this.SnapshotPath);
        }
        catch (Exception ex)
        {
            this.Monitor.Log($"Failed to remove NPC location snapshot: {ex.Message}", LogLevel.Trace);
        }
    }

    private void WriteSnapshot()
    {
        if (!Context.IsWorldReady || this.SnapshotPath is null)
            return;

        try
        {
            string? directory = Path.GetDirectoryName(this.SnapshotPath);
            if (!string.IsNullOrWhiteSpace(directory))
                Directory.CreateDirectory(directory);

            var snapshot = new RealtimeSnapshot(
                SaveId: this.GetSaveId(),
                GameTime: Game1.timeOfDay,
                GeneratedAt: DateTimeOffset.Now.ToString("O"),
                Npcs: this.GetNpcLocations().ToList()
            );

            File.WriteAllText(this.SnapshotPath, JsonSerializer.Serialize(snapshot, JsonOptions));
        }
        catch (Exception ex)
        {
            this.Monitor.Log($"Failed to write NPC location snapshot: {ex.Message}", LogLevel.Warn);
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

    private IEnumerable<RealtimeNpcLocation> GetNpcLocations()
    {
        foreach (NPC npc in Utility.getAllVillagers())
        {
            if (npc.currentLocation is null || string.IsNullOrWhiteSpace(npc.Name))
                continue;

            yield return new RealtimeNpcLocation(
                NpcName: npc.Name,
                Location: npc.currentLocation.NameOrUniqueName,
                TileX: npc.TilePoint.X,
                TileY: npc.TilePoint.Y,
                Direction: npc.FacingDirection
            );
        }
    }
}

internal sealed record RealtimeSnapshot(
    string? SaveId,
    int GameTime,
    string GeneratedAt,
    List<RealtimeNpcLocation> Npcs
);

internal sealed record RealtimeNpcLocation(
    string NpcName,
    string Location,
    int TileX,
    int TileY,
    int Direction
);
