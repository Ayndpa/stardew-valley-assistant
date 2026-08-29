using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;
using StardewValley;

namespace StardewValleyAssistant.Runtime;

/// <summary>
/// 把物品与动物图标从游戏精灵图裁切成 PNG 导出，供助手界面显示模组新增内容的图标。
/// 纹理访问需要 GraphicsDevice，全部操作必须在游戏主线程；因此改为排队后分帧处理，
/// 避免一次性导出上千张图导致卡顿。
/// </summary>
internal static class IconExport
{
    private const int IconSize = 16;
    private const int BatchPerFrame = 20;

    private static readonly Queue<IconTask> Pending = new();

    private static int _exported;
    private static int _skipped;
    private static int _failed;
    private static bool _reported = true;

    /// <summary>在游戏主线程收集待导出的图标任务。</summary>
    public static void Enqueue()
    {
        try
        {
            Directory.CreateDirectory(Paths.IconsDir);

            Pending.Clear();
            _exported = 0;
            _skipped = 0;
            _failed = 0;
            _reported = false;

            foreach (var entry in DataLoader.Objects(Game1.content))
            {
                var iconPath = Path.Combine(Paths.IconsDir, $"{entry.Key}.png");
                if (File.Exists(iconPath))
                {
                    _skipped++;
                    continue;
                }

                var data = entry.Value;
                var texturePath = string.IsNullOrWhiteSpace(data.Texture) ? "Maps/springobjects" : data.Texture;
                Pending.Enqueue(new IconTask(entry.Key, texturePath, data.SpriteIndex, IconSize, IconSize, iconPath));
            }

            foreach (var entry in DataLoader.FarmAnimals(Game1.content))
            {
                var iconPath = Path.Combine(Paths.IconsDir, $"animal_{entry.Key}.png");
                if (File.Exists(iconPath))
                {
                    _skipped++;
                    continue;
                }

                var data = entry.Value;
                var texturePath = string.IsNullOrWhiteSpace(data.Texture) ? $"Animals/{entry.Key}" : data.Texture;
                Pending.Enqueue(new IconTask(
                    $"animal_{entry.Key}",
                    texturePath,
                    0,
                    Math.Max(data.SpriteWidth, 1),
                    Math.Max(data.SpriteHeight, 1),
                    iconPath));
            }

            Log.Info($"[导出] 图标队列: {Pending.Count} 待处理, {_skipped} 已跳过");
        }
        catch (Exception ex)
        {
            Log.Error("[导出] 收集图标任务失败", ex);
            Pending.Clear();
            _reported = true;
        }
    }

    /// <summary>每帧调用：处理一批图标，全部完成后汇报一次。</summary>
    public static void ProcessBatch()
    {
        if (Pending.Count == 0)
        {
            if (!_reported)
            {
                _reported = true;
                Log.Info($"[导出] 图标: 新增 {_exported}, 跳过 {_skipped}, 失败 {_failed}");
                GameContext.Toast($"助手：图标导出完成 ({_exported} 新增)");
            }

            return;
        }

        for (var i = 0; i < BatchPerFrame && Pending.Count > 0; i++)
        {
            var task = Pending.Dequeue();
            try
            {
                var texture = Game1.content.Load<Texture2D>(task.TexturePath);
                if (texture is not null && SaveSpriteAsPng(texture, task))
                    _exported++;
                else
                    _failed++;
            }
            catch (Exception ex)
            {
                _failed++;
                Log.Debug($"[导出] 图标失败 {task.Id}: {ex.Message}");
            }
        }
    }

    /// <summary>从精灵图中裁剪指定索引的图标并保存为 PNG。</summary>
    private static bool SaveSpriteAsPng(Texture2D texture, IconTask task)
    {
        var columns = texture.Width / task.Width;
        if (columns == 0)
            return false;

        var srcX = task.SpriteIndex % columns * task.Width;
        var srcY = task.SpriteIndex / columns * task.Height;
        if (srcX + task.Width > texture.Width || srcY + task.Height > texture.Height)
            return false;

        var fullData = new Color[texture.Width * texture.Height];
        texture.GetData(fullData);

        var pixels = new Color[task.Width * task.Height];
        for (var y = 0; y < task.Height; y++)
        {
            for (var x = 0; x < task.Width; x++)
                pixels[y * task.Width + x] = fullData[(srcY + y) * texture.Width + (srcX + x)];
        }

        using var cropped = new Texture2D(texture.GraphicsDevice, task.Width, task.Height);
        cropped.SetData(pixels);

        var dir = Path.GetDirectoryName(task.OutputPath);
        if (!string.IsNullOrEmpty(dir))
            Directory.CreateDirectory(dir);

        using var stream = File.Create(task.OutputPath);
        cropped.SaveAsPng(stream, task.Width, task.Height);
        return true;
    }

    private readonly record struct IconTask(
        string Id,
        string TexturePath,
        int SpriteIndex,
        int Width,
        int Height,
        string OutputPath);
}
