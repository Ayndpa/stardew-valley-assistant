using StardewValley;

namespace StardewValleyAssistant.Runtime;

/// <summary>
/// 替代 SMAPI 的 <c>Context.IsWorldReady</c>。SMAPI 用自己的加载阶段状态机判断，
/// 脱离 SMAPI 后只能从 Game1 的公开状态推断——条件取得比 SMAPI 更保守，
/// 宁可晚一两帧就绪，也不要在存档尚未装好时去读 player/currentLocation。
/// </summary>
internal static class GameContext
{
    public static bool IsWorldReady
    {
        get
        {
            try
            {
                return Game1.hasLoadedGame
                    && Game1.gameMode == Game1.playingGameMode
                    && Game1.player is not null
                    && Game1.currentLocation is not null;
            }
            catch
            {
                // 存档切换过程中读这些静态成员可能撞上瞬时的空引用。
                return false;
            }
        }
    }

    /// <summary>存档标识，与旧伴侣模组保持一致的格式，Rust 端按此匹配。</summary>
    public static string? SaveId
    {
        get
        {
            if (Game1.player is null)
                return null;

            var farmerName = Game1.player.Name?.Trim() ?? "";
            if (string.IsNullOrWhiteSpace(farmerName))
                return Game1.uniqueIDForThisGame.ToString();

            return $"{SaveGame.FilterFileName(farmerName)}_{Game1.uniqueIDForThisGame}";
        }
    }

    /// <summary>在游戏内弹一条 HUD 提示；未就绪时静默忽略。</summary>
    public static void Toast(string message)
    {
        try
        {
            if (IsWorldReady)
                Game1.addHUDMessage(new HUDMessage(message, 3500f));
        }
        catch
        {
            // 提示失败无关紧要。
        }
    }
}
