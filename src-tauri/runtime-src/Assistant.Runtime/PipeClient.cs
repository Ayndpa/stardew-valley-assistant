using System.IO.Pipes;
using System.Text;
using System.Text.Json;

namespace StardewValleyAssistant.Runtime;

/// <summary>
/// 与助手主进程之间的命名管道客户端。协议与服务端 game_data/pipe_server.rs 对应：
/// 每条消息一行 UTF-8 JSON，以 <c>\n</c> 分隔。
/// </summary>
internal static class PipeClient
{
    private const string PipeName = "stardew-valley-assistant";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false,
    };

    private static readonly SemaphoreSlim WriteSemaphore = new(1, 1);

    private static NamedPipeClientStream? _stream;
    private static CancellationTokenSource? _cancellation;
    private static volatile bool _isConnecting;
    private static volatile bool _isConnected;
    private static int _connectAttempt;

    public static bool IsConnected => _isConnected;

    /// <summary>收到助手指令。参数为消息的 type 字段与 JSON 根节点的独立副本。</summary>
    public static event Action<string, JsonElement>? MessageReceived;

    /// <summary>管道连接建立。</summary>
    public static event Action? Connected;

    // ── 连接（单次尝试，由每秒事件驱动重试） ──────────────────

    public static async void TryConnectAsync()
    {
        if (_isConnecting || _isConnected)
            return;

        _isConnecting = true;
        var attempt = ++_connectAttempt;

        try
        {
            Log.Debug($"正在尝试连接管道 (第{attempt}次)...");
            var stream = new NamedPipeClientStream(".", PipeName, PipeDirection.InOut, PipeOptions.Asynchronous);

            // Connect 本身是同步阻塞的，用 Task.Run 卸载到线程池避免卡游戏
            await Task.Run(() => stream.Connect(5000));

            _cancellation = new CancellationTokenSource();
            _stream = stream;
            _isConnected = true;
            Log.Info("已连接到助手管道!");

            StartReading();

            try
            {
                Connected?.Invoke();
            }
            catch (Exception ex)
            {
                Log.Error("[管道] 连接回调失败", ex);
            }
        }
        catch (TimeoutException)
        {
            if (attempt == 1 || attempt % 10 == 0)
                Log.Warn($"连接超时 (第{attempt}次)，请确认助手应用已启动。等待下一次重试...");
        }
        catch (Exception ex)
        {
            Log.Warn($"连接管道失败: {ex.Message}");
        }
        finally
        {
            _isConnecting = false;
        }
    }

    public static void Disconnect()
    {
        _isConnected = false;
        _cancellation?.Cancel();
        _stream?.Dispose();
        _stream = null;
        _cancellation = null;
    }

    // ── 读取（回调链，无循环） ─────────────────────────────

    private static void StartReading()
    {
        var stream = _stream;
        if (stream is null)
            return;

        Log.Debug("[管道] 读取回调已注册");
        ReadNextChunk(stream, new byte[4096], new StringBuilder());
    }

    /// <summary>
    /// 读取下一个数据块，处理后注册下一次读取 — 纯事件驱动，无循环。
    /// </summary>
    private static void ReadNextChunk(NamedPipeClientStream stream, byte[] buffer, StringBuilder lineBuffer)
    {
        var token = _cancellation?.Token ?? default;

        stream.ReadAsync(buffer, 0, buffer.Length, token).ContinueWith(task =>
        {
            try
            {
                if (task.IsCanceled || task.IsFaulted)
                {
                    if (task.Exception?.InnerException is not OperationCanceledException)
                        Log.Warn($"[管道←] 读取失败: {task.Exception?.InnerException?.Message}");
                    _isConnected = false;
                    return;
                }

                var bytesRead = task.Result;
                if (bytesRead == 0)
                {
                    _isConnected = false;
                    Log.Warn("[管道←] 连接已断开 (EOF)，等待重连...");
                    return;
                }

                // 按换行符分割，逐行处理
                for (var i = 0; i < bytesRead; i++)
                {
                    if (buffer[i] == (byte)'\n')
                    {
                        var line = lineBuffer.ToString().Trim();
                        lineBuffer.Clear();
                        if (!string.IsNullOrEmpty(line))
                        {
                            Log.Debug($"[管道←] 收到: {line}");
                            Dispatch(line);
                        }
                    }
                    else
                    {
                        lineBuffer.Append((char)buffer[i]);
                    }
                }

                // 注册下一次读取（回调链延续）
                ReadNextChunk(stream, buffer, lineBuffer);
            }
            catch (Exception ex)
            {
                Log.Warn($"[管道←] 回调异常: {ex.Message}");
                _isConnected = false;
            }
        }, token, TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
    }

    private static void Dispatch(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (!root.TryGetProperty("type", out var typeProp))
            {
                Log.Warn($"[处理] 消息缺少 type 字段: {json}");
                return;
            }

            var type = typeProp.GetString();
            if (string.IsNullOrEmpty(type))
                return;

            // 订阅方通常会把处理排队到游戏主线程，届时 doc 早已释放，
            // 因此必须传出与 JsonDocument 解耦的副本。
            MessageReceived?.Invoke(type, root.Clone());
        }
        catch (Exception ex)
        {
            Log.Warn($"[处理] 解析消息失败: {ex.Message}");
        }
    }

    // ── 发送 ────────────────────────────────────────────────

    public static Task SendAsync(string type, object? data) =>
        SendAsync(new ModMessageWrapper { Type = type, Data = data });

    private static async Task SendAsync(ModMessageWrapper message)
    {
        if (_stream is null || !_isConnected)
        {
            Log.Debug($"[管道] 跳过发送 {message.Type}: PipeStream={_stream is not null}, IsConnected={_isConnected}");
            return;
        }

        await WriteSemaphore.WaitAsync();
        try
        {
            var json = JsonSerializer.Serialize(message, JsonOptions);
            var bytes = Encoding.UTF8.GetBytes(json + "\n");
            await _stream.WriteAsync(bytes, 0, bytes.Length);
            await _stream.FlushAsync();
            Log.Debug($"[管道→] {message.Type} 写入成功 ({bytes.Length} bytes)");
        }
        catch (Exception ex)
        {
            Log.Warn($"[管道] 发送失败 {message.Type}: {ex.Message}");
            _isConnected = false;
        }
        finally
        {
            WriteSemaphore.Release();
        }
    }
}
