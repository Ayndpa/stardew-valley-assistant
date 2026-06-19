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
    private readonly object WriteLock = new();
    private CancellationTokenSource? CancellationToken;
    private volatile bool IsConnected;
    private Thread? ConnectThread;

    public override void Entry(IModHelper helper)
    {
        this.Monitor.Log("助手 Mod 已加载，开始连接管道...", LogLevel.Info);
        this.EnsureConnected();
        helper.Events.GameLoop.SaveLoaded += this.OnSaveLoaded;
        helper.Events.GameLoop.TimeChanged += this.OnTimeChanged;
        helper.Events.GameLoop.OneSecondUpdateTicked += this.OnOneSecondUpdateTicked;
        helper.Events.GameLoop.ReturnedToTitle += this.OnReturnedToTitle;
        helper.Events.Player.Warped += this.OnWarped;
    }

    private void OnSaveLoaded(object? sender, SaveLoadedEventArgs e)
    {
        this.Monitor.Log($"[发送] 存档已加载, IsConnected={this.IsConnected}, IsWorldReady={Context.IsWorldReady}", LogLevel.Info);
        this.SendNpcLocationsAsync();
    }

    private void OnOneSecondUpdateTicked(object? sender, OneSecondUpdateTickedEventArgs e)
    {
        if (!this.IsConnected)
        {
            this.EnsureConnected();
        }
    }

    private void OnTimeChanged(object? sender, TimeChangedEventArgs e)
    {
        this.Monitor.Log($"[发送] 时间变化 {e.NewTime}, IsConnected={this.IsConnected}", LogLevel.Info);
        this.SendNpcLocationsAsync();
    }

    private void OnWarped(object? sender, WarpedEventArgs e)
    {
        if (e.IsLocalPlayer)
        {
            this.Monitor.Log($"[发送] 切换地图 → {e.NewLocation.Name}, IsConnected={this.IsConnected}", LogLevel.Info);
            this.SendNpcLocationsAsync();
        }
    }

    /// <summary>
    /// Send NPC locations on a background thread to avoid blocking the game.
    /// </summary>
    private void SendNpcLocationsAsync()
    {
        if (!this.IsConnected)
        {
            this.Monitor.Log("[发送] 跳过: 未连接", LogLevel.Debug);
            return;
        }
        Task.Run(() => this.SendNpcLocations());
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
        int attempt = 0;
        while (!token.IsCancellationRequested)
        {
            attempt++;
            try
            {
                this.Monitor.Log($"正在尝试连接管道 (第{attempt}次)...", LogLevel.Debug);
                var stream = new NamedPipeClientStream(".", PipeName, PipeDirection.InOut);
                stream.Connect(5000);

                if (token.IsCancellationRequested)
                {
                    stream.Dispose();
                    return;
                }

                this.PipeStream = stream;

                this.IsConnected = true;
                this.Monitor.Log("已连接到助手管道!", LogLevel.Info);

                // Start reading responses in background
                _ = Task.Run(() => this.ReadResponsesAsync());

                // If a save is already loaded, send current NPC locations immediately
                if (Context.IsWorldReady)
                {
                    this.SendNpcLocationsAsync();
                }

                return; // Connection succeeded, exit retry loop
            }
            catch (TimeoutException)
            {
                if (attempt == 1 || attempt % 10 == 0)
                {
                    this.Monitor.Log($"连接超时 (第{attempt}次)，请确认助手应用已启动。3秒后重试...", LogLevel.Warn);
                }
            }
            catch (OperationCanceledException)
            {
                return;
            }
            catch (Exception ex)
            {
                this.Monitor.Log($"连接管道失败: {ex.Message}", LogLevel.Warn);
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
        this.PipeStream?.Dispose();
        this.PipeStream = null;
        this.CancellationToken = null;
    }

    private async Task ReadResponsesAsync()
    {
        var stream = this.PipeStream;
        if (stream == null)
            return;

        this.Monitor.Log("[管道] 读取响应线程已启动", LogLevel.Debug);
        try
        {
            // 直接使用 Stream.ReadAsync 读取原始字节，逐行解析
            // 避免 StreamReader 内部锁与 Write 操作冲突
            var buffer = new byte[4096];
            var lineBuffer = new StringBuilder();

            while (!this.CancellationToken?.IsCancellationRequested ?? true)
            {
                var bytesRead = await stream.ReadAsync(buffer, 0, buffer.Length, this.CancellationToken?.Token ?? default);
                if (bytesRead == 0)
                {
                    this.IsConnected = false;
                    this.Monitor.Log("[管道←] 连接已断开 (EOF)，等待重连...", LogLevel.Warn);
                    break;
                }

                // 按换行符分割，逐行处理
                for (int i = 0; i < bytesRead; i++)
                {
                    if (buffer[i] == (byte)'\n')
                    {
                        var line = lineBuffer.ToString().Trim();
                        lineBuffer.Clear();
                        if (!string.IsNullOrEmpty(line))
                        {
                            this.Monitor.Log($"[管道←] 收到: {line}", LogLevel.Debug);
                            this.HandleTauriMessage(line);
                        }
                    }
                    else
                    {
                        lineBuffer.Append((char)buffer[i]);
                    }
                }
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            this.Monitor.Log($"[管道←] 读取失败: {ex.Message}", LogLevel.Warn);
            this.IsConnected = false;
        }
    }

    private void HandleTauriMessage(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (!root.TryGetProperty("type", out var typeProp))
            {
                this.Monitor.Log($"[处理] 消息缺少 type 字段: {json}", LogLevel.Warn);
                return;
            }

            var type = typeProp.GetString();
            this.Monitor.Log($"[处理] 消息类型: {type}", LogLevel.Info);
            switch (type)
            {
                case "requestItemPrices":
                    this.Monitor.Log("[处理] 收到物品价格请求，开始收集...", LogLevel.Info);
                    this.SendItemPrices();
                    break;
                case "requestNpcLocations":
                    this.Monitor.Log("[处理] 收到 NPC 位置请求", LogLevel.Info);
                    this.SendNpcLocations();
                    break;
                case "pong":
                    break;
                default:
                    this.Monitor.Log($"[处理] 未知消息类型: {type}", LogLevel.Warn);
                    break;
            }
        }
        catch (Exception ex)
        {
            this.Monitor.Log($"[处理] 解析消息失败: {ex.Message}", LogLevel.Warn);
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
        {
            this.Monitor.Log($"[发送] 跳过NPC位置: IsWorldReady={Context.IsWorldReady}, IsConnected={this.IsConnected}", LogLevel.Debug);
            return;
        }

        try
        {
            var npcs = this.GetNpcLocations().ToList();
            var snapshot = new NpcLocationsSnapshot(
                SaveId: this.GetSaveId(),
                GameTime: Game1.timeOfDay,
                GeneratedAt: DateTimeOffset.Now.ToString("O"),
                Npcs: npcs
            );

            var message = new ModMessageWrapper
            {
                Type = "npcLocations",
                Data = snapshot,
            };

            this.Monitor.Log($"[发送] npcLocations: {npcs.Count} 个NPC, 时间={Game1.timeOfDay}", LogLevel.Info);
            this.SendMessage(message);
        }
        catch (Exception ex)
        {
            this.Monitor.Log($"[发送] NPC 位置失败: {ex.Message}", LogLevel.Warn);
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
        if (this.PipeStream == null || !this.IsConnected)
        {
            this.Monitor.Log($"[管道] 跳过发送 {message.Type}: PipeStream={this.PipeStream != null}, IsConnected={this.IsConnected}", LogLevel.Debug);
            return;
        }

        this.Monitor.Log($"[管道→] 准备发送 {message.Type}, 获取锁...", LogLevel.Debug);
        lock (this.WriteLock)
        {
            this.Monitor.Log($"[管道→] 已获取锁, 序列化...", LogLevel.Debug);
            try
            {
                var json = JsonSerializer.Serialize(message, JsonOptions);
                var bytes = Encoding.UTF8.GetBytes(json + "\n");
                this.Monitor.Log($"[管道→] 序列化完成 ({bytes.Length} bytes), 写入管道...", LogLevel.Debug);
                this.PipeStream.Write(bytes, 0, bytes.Length);
                this.Monitor.Log($"[管道→] {message.Type} 写入成功!", LogLevel.Info);
            }
            catch (Exception ex)
            {
                this.Monitor.Log($"[管道] 发送失败 {message.Type}: {ex.Message}", LogLevel.Warn);
                this.IsConnected = false;
            }
        }
        this.Monitor.Log($"[管道→] 已释放锁", LogLevel.Debug);
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
