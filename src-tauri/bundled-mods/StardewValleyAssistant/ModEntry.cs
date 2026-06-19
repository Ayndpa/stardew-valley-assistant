using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Pipes;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;
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
        WriteIndented = false,
    };

    private const string PipeName = "stardew-valley-assistant";

    private NamedPipeClientStream? PipeStream;
    private StreamWriter? PipeWriter;
    private CancellationTokenSource? CancellationToken;
    private volatile bool IsConnected;
    private Thread? ConnectThread;

    public override void Entry(IModHelper helper)
    {
        helper.Events.GameLoop.SaveLoaded += this.OnSaveLoaded;
        helper.Events.GameLoop.DayStarted += this.OnDayStarted;
        helper.Events.GameLoop.OneSecondUpdateTicked += this.OnOneSecondUpdateTicked;
        helper.Events.GameLoop.ReturnedToTitle += this.OnReturnedToTitle;
    }

    private void OnSaveLoaded(object? sender, SaveLoadedEventArgs e)
    {
        this.EnsureConnected();
        this.SendAllData();
    }

    private void OnDayStarted(object? sender, DayStartedEventArgs e)
    {
        this.SendItemPrices();
    }

    private void OnOneSecondUpdateTicked(object? sender, OneSecondUpdateTickedEventArgs e)
    {
        if (this.IsConnected)
        {
            this.SendNpcLocations();
        }
        else
        {
            // Connection lost or never established — try to reconnect
            this.EnsureConnected();
        }
    }

    private void OnReturnedToTitle(object? sender, ReturnedToTitleEventArgs e)
    {
        this.SendClear();
        this.Disconnect();
    }

    private void EnsureConnected()
    {
        if (this.IsConnected && this.PipeStream?.IsConnected == true)
            return;

        // Stop any existing connection attempt
        this.Disconnect();
        this.CancellationToken = new CancellationTokenSource();

        // Spawn a background thread that retries connection until success
        var token = this.CancellationToken.Token;
        this.ConnectThread = new Thread(() => this.ConnectLoop(token))
        {
            IsBackground = true,
            Name = "SVA-PipeConnect",
        };
        this.ConnectThread.Start();
    }

    private void ConnectLoop(CancellationToken token)
    {
        while (!token.IsCancellationRequested)
        {
            try
            {
                var stream = new NamedPipeClientStream(".", PipeName, PipeDirection.InOut);
                stream.Connect(5000);

                if (token.IsCancellationRequested)
                {
                    stream.Dispose();
                    return;
                }

                this.PipeStream = stream;
                this.PipeWriter = new StreamWriter(stream, Encoding.UTF8)
                {
                    AutoFlush = true,
                };

                this.IsConnected = true;
                this.Monitor.Log("已连接到助手管道", LogLevel.Debug);

                // Start reading responses in background
                _ = Task.Run(() => this.ReadResponsesAsync());
                return; // Connection succeeded, exit retry loop
            }
            catch (TimeoutException)
            {
                // Expected when assistant is not running — keep retrying
            }
            catch (OperationCanceledException)
            {
                return;
            }
            catch (Exception ex)
            {
                this.Monitor.Log($"连接管道失败: {ex.Message}", LogLevel.Debug);
            }

            // Wait before retrying
            Thread.Sleep(3000);
        }
    }

    private void Disconnect()
    {
        this.IsConnected = false;
        this.CancellationToken?.Cancel();
        this.ConnectThread = null;
        this.PipeWriter?.Dispose();
        this.PipeStream?.Dispose();
        this.PipeWriter = null;
        this.PipeStream = null;
        this.CancellationToken = null;
    }

    private async Task ReadResponsesAsync()
    {
        var stream = this.PipeStream;
        if (stream == null)
            return;

        try
        {
            using var reader = new StreamReader(stream, Encoding.UTF8, leaveOpen: true);
            while (!this.CancellationToken?.IsCancellationRequested ?? true)
            {
                var line = await reader.ReadLineAsync();
                if (line == null)
                {
                    // Connection closed — mark disconnected so EnsureConnected can retry
                    this.IsConnected = false;
                    this.Monitor.Log("管道连接已断开，等待重连...", LogLevel.Debug);
                    break;
                }

                // Handle responses from Tauri if needed
                this.Monitor.Log($"收到响应: {line}", LogLevel.Trace);
            }
        }
        catch (Exception ex)
        {
            this.Monitor.Log($"读取响应失败: {ex.Message}", LogLevel.Debug);
            this.IsConnected = false;
        }
    }

    private void SendAllData()
    {
        this.SendNpcLocations();
        this.SendItemPrices();
    }

    private void SendNpcLocations()
    {
        if (!Context.IsWorldReady || !this.IsConnected)
            return;

        try
        {
            var snapshot = new NpcLocationsSnapshot(
                SaveId: this.GetSaveId(),
                GameTime: Game1.timeOfDay,
                GeneratedAt: DateTimeOffset.Now.ToString("O"),
                Npcs: this.GetNpcLocations().ToList()
            );

            var message = new ModMessageWrapper
            {
                Type = "npcLocations",
                Data = snapshot,
            };

            this.SendMessage(message);
        }
        catch (Exception ex)
        {
            this.Monitor.Log($"发送 NPC 位置失败: {ex.Message}", LogLevel.Debug);
        }
    }

    private void SendItemPrices()
    {
        if (!Context.IsWorldReady || !this.IsConnected)
            return;

        try
        {
            var prices = this.CollectItemPrices();

            var snapshot = new ItemPricesSnapshot(
                SaveId: this.GetSaveId(),
                GeneratedAt: DateTimeOffset.Now.ToString("O"),
                Prices: prices
            );

            var message = new ModMessageWrapper
            {
                Type = "itemPrices",
                Data = snapshot,
            };

            this.SendMessage(message);
        }
        catch (Exception ex)
        {
            this.Monitor.Log($"发送物品价格失败: {ex.Message}", LogLevel.Debug);
        }
    }

    private void SendClear()
    {
        if (!this.IsConnected)
            return;

        try
        {
            var message = new ModMessageWrapper
            {
                Type = "clear",
                Data = null,
            };

            this.SendMessage(message);
        }
        catch (Exception ex)
        {
            this.Monitor.Log($"发送清除消息失败: {ex.Message}", LogLevel.Debug);
        }
    }

    private void SendMessage(ModMessageWrapper message)
    {
        if (this.PipeWriter == null || !this.IsConnected)
            return;

        try
        {
            var json = JsonSerializer.Serialize(message, JsonOptions);
            this.PipeWriter.WriteLine(json);
        }
        catch (Exception ex)
        {
            this.Monitor.Log($"发送消息失败: {ex.Message}", LogLevel.Debug);
            this.IsConnected = false;
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
            this.Monitor.Log($"读取物品数据失败: {ex.Message}", LogLevel.Warn);
        }

        return prices;
    }
}

// Message wrapper for JSON serialization
internal sealed class ModMessageWrapper
{
    [JsonPropertyName("type")]
    public string Type { get; set; } = "";

    [JsonPropertyName("data")]
    public object? Data { get; set; }
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
