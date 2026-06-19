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
using Microsoft.Xna.Framework;

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
    private readonly SemaphoreSlim WriteSemaphore = new(1, 1);
    private CancellationTokenSource? CancellationToken;
    private volatile bool IsConnecting;
    private volatile bool IsConnected;
    private int ConnectAttempt;

    // ── 作弊状态 ─────────────────────────────────────────
    private bool SpeedBoostActive;
    private bool FreezeTimeActive;

    // ── 数据导出状态 ─────────────────────────────────────
    private volatile bool _exportDone;

    public override void Entry(IModHelper helper)
    {
        this.Monitor.Log("助手 Mod 已加载，开始连接管道...", LogLevel.Info);
        this.TryConnectAsync();
        helper.Events.GameLoop.SaveLoaded += this.OnSaveLoaded;
        helper.Events.GameLoop.TimeChanged += this.OnTimeChanged;
        helper.Events.GameLoop.OneSecondUpdateTicked += this.OnOneSecondUpdateTicked;
        helper.Events.GameLoop.UpdateTicked += this.OnUpdateTicked;
        helper.Events.GameLoop.ReturnedToTitle += this.OnReturnedToTitle;
        helper.Events.Player.Warped += this.OnWarped;
    }

    // ── 事件处理器 ──────────────────────────────────────────

    private void OnSaveLoaded(object? sender, SaveLoadedEventArgs e)
    {
        this.Monitor.Log($"[发送] 存档已加载, IsConnected={this.IsConnected}, IsWorldReady={Context.IsWorldReady}", LogLevel.Info);
        this.SpeedBoostActive = false;
        this.FreezeTimeActive = false;
        _ = this.SendNpcLocationsAsync();

        // 显示 HUD 提示后在后台线程导出数据
        Game1.addHUDMessage(new HUDMessage("助手模组：正在导出游戏数据…", 3500f));
        _ = Task.Run(() => this.ExportModData());
    }

    private void OnOneSecondUpdateTicked(object? sender, OneSecondUpdateTickedEventArgs e)
    {
        if (!this.IsConnected && !this.IsConnecting)
        {
            this.TryConnectAsync();
        }
    }

    private void OnUpdateTicked(object? sender, UpdateTickedEventArgs e)
    {
        if (!Context.IsWorldReady || Game1.player is null)
            return;

        // 冻结时间：每帧将时间间隔重置为0
        if (this.FreezeTimeActive)
        {
            Game1.gameTimeInterval = 0;
        }

        // 数据导出完成提示（从后台线程同步到游戏线程）
        if (this._exportDone)
        {
            this._exportDone = false;
            Game1.addHUDMessage(new HUDMessage("助手模组：游戏数据导出完成", 3500f));
        }
    }

    private void OnTimeChanged(object? sender, TimeChangedEventArgs e)
    {
        this.Monitor.Log($"[发送] 时间变化 {e.NewTime}, IsConnected={this.IsConnected}", LogLevel.Info);
        _ = this.SendNpcLocationsAsync();
    }

    private void OnWarped(object? sender, WarpedEventArgs e)
    {
        if (e.IsLocalPlayer)
        {
            this.Monitor.Log($"[发送] 切换地图 → {e.NewLocation.Name}, IsConnected={this.IsConnected}", LogLevel.Info);
            _ = this.SendNpcLocationsAsync();
        }
    }

    private async void OnReturnedToTitle(object? sender, ReturnedToTitleEventArgs e)
    {
        this.SpeedBoostActive = false;
        this.FreezeTimeActive = false;
        await this.SendClearAsync();
        this.Disconnect();
    }

    // ── 连接（单次尝试，事件驱动重试） ──────────────────────

    private async void TryConnectAsync()
    {
        if (this.IsConnecting || this.IsConnected)
            return;

        this.IsConnecting = true;
        this.ConnectAttempt++;
        var attempt = this.ConnectAttempt;

        try
        {
            this.Monitor.Log($"正在尝试连接管道 (第{attempt}次)...", LogLevel.Debug);
            var stream = new NamedPipeClientStream(".", PipeName, PipeDirection.InOut, PipeOptions.Asynchronous);

            // Connect 本身是同步阻塞的，用 Task.Run 卸载到线程池避免卡游戏
            await Task.Run(() => stream.Connect(5000));

            this.CancellationToken = new CancellationTokenSource();
            this.PipeStream = stream;
            this.IsConnected = true;
            this.Monitor.Log("已连接到助手管道!", LogLevel.Info);

            // 以回调链启动读取（无循环）
            this.StartReading();

            // 如果已有存档，立即发送数据
            if (Context.IsWorldReady)
            {
                _ = this.SendNpcLocationsAsync();
            }
        }
        catch (TimeoutException)
        {
            if (attempt == 1 || attempt % 10 == 0)
            {
                this.Monitor.Log($"连接超时 (第{attempt}次)，请确认助手应用已启动。等待下一次重试...", LogLevel.Warn);
            }
        }
        catch (Exception ex)
        {
            this.Monitor.Log($"连接管道失败: {ex.Message}", LogLevel.Warn);
        }
        finally
        {
            this.IsConnecting = false;
        }
    }

    private void Disconnect()
    {
        this.IsConnected = false;
        this.CancellationToken?.Cancel();
        this.PipeStream?.Dispose();
        this.PipeStream = null;
        this.CancellationToken = null;
    }

    // ── 读取（回调链，无循环） ─────────────────────────────

    private void StartReading()
    {
        var stream = this.PipeStream;
        if (stream == null) return;

        this.Monitor.Log("[管道] 读取回调已注册", LogLevel.Debug);
        var buffer = new byte[4096];
        var lineBuffer = new StringBuilder();
        this.ReadNextChunk(stream, buffer, lineBuffer);
    }

    /// <summary>
    /// 读取下一个数据块，处理后注册下一次读取 — 纯事件驱动，无循环。
    /// </summary>
    private void ReadNextChunk(NamedPipeClientStream stream, byte[] buffer, StringBuilder lineBuffer)
    {
        var token = this.CancellationToken?.Token ?? default;

        stream.ReadAsync(buffer, 0, buffer.Length, token).ContinueWith(task =>
        {
            try
            {
                if (task.IsCanceled || task.IsFaulted)
                {
                    if (task.Exception?.InnerException is not OperationCanceledException)
                    {
                        this.Monitor.Log($"[管道←] 读取失败: {task.Exception?.InnerException?.Message}", LogLevel.Warn);
                    }
                    this.IsConnected = false;
                    return;
                }

                var bytesRead = task.Result;
                if (bytesRead == 0)
                {
                    this.IsConnected = false;
                    this.Monitor.Log("[管道←] 连接已断开 (EOF)，等待重连...", LogLevel.Warn);
                    return;
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

                // 注册下一次读取（回调链延续）
                this.ReadNextChunk(stream, buffer, lineBuffer);
            }
            catch (Exception ex)
            {
                this.Monitor.Log($"[管道←] 回调异常: {ex.Message}", LogLevel.Warn);
                this.IsConnected = false;
            }
        }, token, TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
    }

    // ── 消息处理 ────────────────────────────────────────────

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
                case "requestNpcLocations":
                    this.Monitor.Log("[处理] 收到 NPC 位置请求", LogLevel.Info);
                    _ = this.SendNpcLocationsAsync();
                    break;
                case "pong":
                    break;

                // ── 作弊指令 ──────────────────────────────
                case "cheatRefillEnergy":
                    this.HandleCheatRefillEnergy();
                    break;
                case "cheatRefillHealth":
                    this.HandleCheatRefillHealth();
                    break;
                case "cheatToggleSpeed":
                    this.HandleCheatToggleSpeed(root);
                    break;
                case "cheatToggleFreezeTime":
                    this.HandleCheatToggleFreezeTime(root);
                    break;
                case "cheatWaterCrops":
                    this.HandleCheatWaterCrops();
                    break;
                case "cheatGrowCrops":
                    this.HandleCheatGrowCrops();
                    break;
                case "cheatTeleport":
                    this.HandleCheatTeleport(root);
                    break;
                case "cheatAddItem":
                    this.HandleCheatAddItem(root);
                    break;
                case "cheatAddMoney":
                    this.HandleCheatAddMoney(root);
                    break;
                case "cheatMaxFriendship":
                    this.HandleCheatMaxFriendship();
                    break;
                case "cheatKillMonsters":
                    this.HandleCheatKillMonsters();
                    break;
                case "cheatSetWeather":
                    this.HandleCheatSetWeather(root);
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

    // ── 作弊指令处理 ──────────────────────────────────────

    private void HandleCheatRefillEnergy()
    {
        this.ExecuteCheat("refillEnergy", () =>
        {
            Game1.player.stamina = Game1.player.MaxStamina;
            return $"体力已补满 ({Game1.player.MaxStamina})";
        });
    }

    private void HandleCheatRefillHealth()
    {
        this.ExecuteCheat("refillHealth", () =>
        {
            Game1.player.health = Game1.player.maxHealth;
            return $"生命已补满 ({Game1.player.maxHealth})";
        });
    }

    private void HandleCheatToggleSpeed(JsonElement root)
    {
        bool enabled = false;
        if (root.TryGetProperty("enabled", out var enabledProp))
        {
            enabled = enabledProp.GetBoolean();
        }

        this.ExecuteCheat("toggleSpeed", () =>
        {
            if (enabled)
            {
                // 添加速度Buff (speed index = 9)
                Game1.player.applyBuff("9");
                this.SpeedBoostActive = true;
                return "速度加成已开启";
            }
            else
            {
                Game1.player.buffs.Remove("9");
                this.SpeedBoostActive = false;
                return "速度加成已关闭";
            }
        });
    }

    private void HandleCheatToggleFreezeTime(JsonElement root)
    {
        bool enabled = false;
        if (root.TryGetProperty("enabled", out var enabledProp))
        {
            enabled = enabledProp.GetBoolean();
        }

        this.FreezeTimeActive = enabled;
        this.SendCheatResultAsync("toggleFreezeTime", true, enabled ? "时间已冻结" : "时间已恢复流动").Wait();
    }

    private void HandleCheatWaterCrops()
    {
        this.ExecuteCheat("waterCrops", () =>
        {
            int count = 0;
            var farm = Game1.getFarm();
            if (farm == null) return "未找到农场";

            foreach (var pair in farm.terrainFeatures.Pairs)
            {
                if (pair.Value is StardewValley.TerrainFeatures.HoeDirt dirt)
                {
                    if (dirt.crop != null && dirt.state.Value == 0) // 0 = not watered
                    {
                        dirt.state.Value = 1; // 1 = watered
                        count++;
                    }
                }
            }
            return $"已浇水 {count} 块农田";
        });
    }

    private void HandleCheatGrowCrops()
    {
        this.ExecuteCheat("growCrops", () =>
        {
            int count = 0;
            var farm = Game1.getFarm();
            if (farm == null) return "未找到农场";

            foreach (var pair in farm.terrainFeatures.Pairs)
            {
                if (pair.Value is StardewValley.TerrainFeatures.HoeDirt dirt)
                {
                    if (dirt.crop != null)
                    {
                        while (!dirt.crop.fullyGrown.Value)
                        {
                            dirt.crop.newDay(1);
                        }
                        count++;
                    }
                }
            }
            return $"已催熟 {count} 块作物";
        });
    }

    private void HandleCheatTeleport(JsonElement root)
    {
        string location = "";
        if (root.TryGetProperty("location", out var locProp))
        {
            location = locProp.GetString() ?? "";
        }

        this.ExecuteCheat("teleport", () =>
        {
            if (string.IsNullOrWhiteSpace(location))
                return "未指定传送位置";

            // 常用传送点映射
            var teleportTargets = new Dictionary<string, (string name, int x, int y)>
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
                Game1.warpFarmer(target.name, target.x, target.y, false);
                return $"已传送到 {target.name}";
            }
            else
            {
                // 尝试直接传送到指定位置
                Game1.warpFarmer(location, 64, 64, false);
                return $"已传送到 {location}";
            }
        });
    }

    private void HandleCheatAddItem(JsonElement root)
    {
        string itemId = "";
        int count = 1;

        if (root.TryGetProperty("itemId", out var idProp))
            itemId = idProp.GetString() ?? "";
        if (root.TryGetProperty("count", out var countProp))
            count = countProp.GetInt32();

        this.ExecuteCheat("addItem", () =>
        {
            if (string.IsNullOrWhiteSpace(itemId))
                return "未指定物品ID";

            count = Math.Clamp(count, 1, 999);

            // 尝试创建物品
            var item = ItemRegistry.Create(itemId, count);
            if (item == null)
                return $"无法创建物品: {itemId}";

            Game1.player.addItemByMenuIfNecessary(item);
            return $"已添加 {item.DisplayName} x{count}";
        });
    }

    private void HandleCheatAddMoney(JsonElement root)
    {
        int amount = 0;
        if (root.TryGetProperty("amount", out var amountProp))
            amount = amountProp.GetInt32();

        this.ExecuteCheat("addMoney", () =>
        {
            if (amount == 0) return "未指定金额";
            Game1.player.Money += amount;
            return $"金币 {(amount > 0 ? "+" : "")}{amount:N0}，当前: {Game1.player.Money:N0}";
        });
    }

    private void HandleCheatMaxFriendship()
    {
        this.ExecuteCheat("maxFriendship", () =>
        {
            int count = 0;
            foreach (var pair in Game1.player.friendshipData.Pairs)
            {
                if (pair.Value.Points < 2500)
                {
                    pair.Value.Points = 2500;
                    count++;
                }
            }
            return $"已将 {count} 个NPC好感度设为满值 (10❤)";
        });
    }

    private void HandleCheatKillMonsters()
    {
        this.ExecuteCheat("killMonsters", () =>
        {
            var location = Game1.currentLocation;
            if (location == null) return "未找到当前地图";

            int count = 0;
            var monsters = location.characters.Where(c => c is StardewValley.Monsters.Monster).ToList();
            foreach (var monster in monsters)
            {
                location.characters.Remove(monster);
                count++;
            }
            return $"已清除 {count} 个怪物";
        });
    }

    private void HandleCheatSetWeather(JsonElement root)
    {
        string weather = "";
        if (root.TryGetProperty("weather", out var weatherProp))
            weather = weatherProp.GetString() ?? "";

        this.ExecuteCheat("setWeather", () =>
        {
            if (string.IsNullOrWhiteSpace(weather))
                return "未指定天气类型";

            var weatherMap = new Dictionary<string, (string id, string name)>
            {
                ["sunny"] = ("Sun", "晴天"),
                ["rain"] = ("Rain", "雨天"),
                ["thunder"] = ("Storm", "雷暴"),
                ["snow"] = ("Snow", "雪天"),
            };

            if (weatherMap.TryGetValue(weather.ToLower(), out var target))
            {
                Game1.weatherForTomorrow = target.id;
                return $"明天天气已设为: {target.name}";
            }
            return $"未知天气类型: {weather}";
        });
    }

    /// <summary>
    /// 统一的作弊执行包装器，处理异常和结果发送。
    /// </summary>
    private void ExecuteCheat(string action, Func<string> execute)
    {
        if (!Context.IsWorldReady || Game1.player is null)
        {
            _ = this.SendCheatResultAsync(action, false, "游戏未就绪，请先加载存档");
            return;
        }

        try
        {
            string message = execute();
            this.Monitor.Log($"[作弊] {action}: {message}", LogLevel.Info);
            _ = this.SendCheatResultAsync(action, true, message);
        }
        catch (Exception ex)
        {
            this.Monitor.Log($"[作弊] {action} 失败: {ex.Message}", LogLevel.Warn);
            _ = this.SendCheatResultAsync(action, false, $"执行失败: {ex.Message}");
        }
    }

    // ── 发送 ────────────────────────────────────────────────

    private async Task SendNpcLocationsAsync()
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
            await this.SendMessageAsync(message);
        }
        catch (Exception ex)
        {
            this.Monitor.Log($"[发送] NPC 位置失败: {ex.Message}", LogLevel.Warn);
        }
    }

    private async Task SendCheatResultAsync(string action, bool success, string message)
    {
        if (!this.IsConnected)
            return;

        try
        {
            var result = new CheatResultPayload(
                Action: action,
                Success: success,
                Message: message
            );

            var wrapper = new ModMessageWrapper
            {
                Type = "cheatResult",
                Data = result,
            };

            await this.SendMessageAsync(wrapper);
        }
        catch (Exception ex)
        {
            this.Monitor.Log($"发送作弊结果失败: {ex.Message}", LogLevel.Debug);
        }
    }

    // ── 模组数据导出 ────────────────────────────────────────

    /// <summary>
    /// 导出其他模组添加的物品、作物、动物、村民数据到本地文件。
    /// 仅在数据发生变化时才写入。
    /// </summary>
    private void ExportModData()
    {
        try
        {
            var exportDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "StardewValley", "StardewValleyAssistant");
            Directory.CreateDirectory(exportDir);

            // 收集所有数据（原版 + 模组）
            var allItems = this.CollectAllItems();
            var allCrops = this.CollectAllCrops();
            var allAnimals = this.CollectAllAnimals();

            // 1. 写入 game-data.json（所有数据，供软件使用）
            var gameSnapshot = new ModExportSnapshot(
                SaveId: this.GetSaveId(),
                GeneratedAt: DateTimeOffset.Now.ToString("O"),
                Items: allItems,
                Crops: allCrops,
                Animals: allAnimals,
                Villagers: new List<ModExportVillagerEntry>()
            );
            this.WriteExportFile(Path.Combine(exportDir, "game-data.json"), gameSnapshot,
                $"[导出] 已写入游戏数据: {allItems.Count} 物品, {allCrops.Count} 作物, {allAnimals.Count} 动物");

            // 2. 写入 mod-data.json（仅模组添加的数据，供模组数据页面使用）
            var modSnapshot = new ModExportSnapshot(
                SaveId: this.GetSaveId(),
                GeneratedAt: DateTimeOffset.Now.ToString("O"),
                Items: allItems.Where(i => this.IsModAddedId(i.Id)).ToList(),
                Crops: allCrops.Where(c => this.IsModAddedId(c.Id)).ToList(),
                Animals: allAnimals.Where(a => this.IsModAddedId(a.Id)).ToList(),
                Villagers: this.CollectModAddedVillagers()
            );
            this.WriteExportFile(Path.Combine(exportDir, "mod-data.json"), modSnapshot,
                $"[导出] 已写入模组数据: {modSnapshot.Items.Count} 物品, {modSnapshot.Crops.Count} 作物, {modSnapshot.Animals.Count} 动物, {modSnapshot.Villagers.Count} 村民");
        }
        catch (Exception ex)
        {
            this.Monitor.Log($"[导出] 写入数据失败: {ex.Message}", LogLevel.Warn);
        }
        finally
        {
            // 通知游戏线程显示完成提示
            this._exportDone = true;
        }
    }

    private void WriteExportFile<T>(string filePath, T snapshot, string logMessage)
    {
        var json = JsonSerializer.Serialize(snapshot, new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            WriteIndented = false,
        });

        // 仅在内容变化时写入
        if (File.Exists(filePath))
        {
            var existing = File.ReadAllText(filePath);
            if (existing == json)
            {
                this.Monitor.Log($"[导出] {Path.GetFileName(filePath)} 无变化，跳过写入", LogLevel.Debug);
                return;
            }
        }

        File.WriteAllText(filePath, json);
        this.Monitor.Log(logMessage, LogLevel.Info);
    }

    private bool IsModAddedId(string id)
    {
        // 原版物品/作物/动物 ID 都是纯数字，模组添加的使用字符串 ID
        return !string.IsNullOrEmpty(id) && !int.TryParse(id, out _);
    }

    private List<ModExportItemEntry> CollectAllItems()
    {
        var result = new List<ModExportItemEntry>();
        try
        {
            var objects = DataLoader.Objects(Game1.content);
            foreach (var entry in objects)
            {
                var data = entry.Value;
                result.Add(new ModExportItemEntry(
                    Id: entry.Key,
                    Name: data.DisplayName,
                    InternalName: data.Name,
                    Description: data.Description,
                    Category: data.Category,
                    Price: data.Price,
                    Edibility: data.Edibility,
                    Type: data.Type
                ));
            }
        }
        catch (Exception ex)
        {
            this.Monitor.Log($"[导出] 读取物品数据失败: {ex.Message}", LogLevel.Warn);
        }
        return result;
    }

    private List<ModExportCropEntry> CollectAllCrops()
    {
        var result = new List<ModExportCropEntry>();
        try
        {
            var crops = DataLoader.Crops(Game1.content);
            foreach (var entry in crops)
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
            this.Monitor.Log($"[导出] 读取作物数据失败: {ex.Message}", LogLevel.Warn);
        }
        return result;
    }

    private List<ModExportAnimalEntry> CollectAllAnimals()
    {
        var result = new List<ModExportAnimalEntry>();
        try
        {
            var animals = DataLoader.FarmAnimals(Game1.content);
            foreach (var entry in animals)
            {
                var data = entry.Value;
                result.Add(new ModExportAnimalEntry(
                    Id: entry.Key,
                    DisplayName: data.DisplayName,
                    House: data.House,
                    PurchasePrice: data.PurchasePrice,
                    DaysToMature: data.DaysToMature,
                    DaysToProduce: data.DaysToProduce,
                    ProduceItemIds: data.ProduceItemIds?.Select(p => p.ItemId).ToList() ?? new List<string>()
                ));
            }
        }
        catch (Exception ex)
        {
            this.Monitor.Log($"[导出] 读取动物数据失败: {ex.Message}", LogLevel.Warn);
        }
        return result;
    }

    private List<ModExportVillagerEntry> CollectModAddedVillagers()
    {
        var result = new List<ModExportVillagerEntry>();
        try
        {
            var characters = DataLoader.Characters(Game1.content);
            var giftTastes = DataLoader.NpcGiftTastes(Game1.content);
            foreach (var entry in characters)
            {
                if (!this.IsModAddedId(entry.Key)) continue;
                var data = entry.Value;

                // 生日
                string birthday = "";
                if (data.BirthSeason.HasValue && data.BirthDay > 0)
                {
                    birthday = $"{data.BirthSeason.Value} {data.BirthDay}";
                }

                // 好感礼物 (格式: "love_id1 love_id2/like_id1 like_id2/dislike/hate/neutral")
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
            this.Monitor.Log($"[导出] 读取村民数据失败: {ex.Message}", LogLevel.Warn);
        }
        return result;
    }

    private async Task SendClearAsync()
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

            await this.SendMessageAsync(message);
        }
        catch (Exception ex)
        {
            this.Monitor.Log($"发送清除消息失败: {ex.Message}", LogLevel.Debug);
        }
    }

    private async Task SendMessageAsync(ModMessageWrapper message)
    {
        if (this.PipeStream == null || !this.IsConnected)
        {
            this.Monitor.Log($"[管道] 跳过发送 {message.Type}: PipeStream={this.PipeStream != null}, IsConnected={this.IsConnected}", LogLevel.Debug);
            return;
        }

        this.Monitor.Log($"[管道→] 准备发送 {message.Type}, 获取信号量...", LogLevel.Debug);
        await this.WriteSemaphore.WaitAsync();
        this.Monitor.Log($"[管道→] 已获取信号量, 序列化...", LogLevel.Debug);
        try
        {
            var json = JsonSerializer.Serialize(message, JsonOptions);
            var bytes = Encoding.UTF8.GetBytes(json + "\n");
            this.Monitor.Log($"[管道→] 序列化完成 ({bytes.Length} bytes), 写入管道...", LogLevel.Debug);
            await this.PipeStream.WriteAsync(bytes, 0, bytes.Length);
            await this.PipeStream.FlushAsync();
            this.Monitor.Log($"[管道→] {message.Type} 写入成功!", LogLevel.Info);
        }
        catch (Exception ex)
        {
            this.Monitor.Log($"[管道] 发送失败 {message.Type}: {ex.Message}", LogLevel.Warn);
            this.IsConnected = false;
        }
        finally
        {
            this.WriteSemaphore.Release();
            this.Monitor.Log($"[管道→] 已释放信号量", LogLevel.Debug);
        }
    }

    // ── 辅助方法 ────────────────────────────────────────────

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

// Cheat Result data structure
internal sealed record CheatResultPayload(
    string Action,
    bool Success,
    string Message
);

// Mod Export data structures
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
    int DaysToMature,
    int DaysToProduce,
    List<string> ProduceItemIds
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
