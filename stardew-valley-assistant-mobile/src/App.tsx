import type { ReactNode } from "react";
import {
  Sprout,
  Users,
  CalendarDays,
  PackageOpen,
  Play,
  Puzzle,
  Trophy,
  Map,
} from "lucide-react";
import appIcon from "./assets/app-icon.png";
import "./index.css";

const FEATURES: { icon: ReactNode; label: string }[] = [
  { icon: <Trophy />, label: "收藏图鉴" },
  { icon: <Sprout />, label: "作物收益" },
  { icon: <Users />, label: "村民好感" },
  { icon: <CalendarDays />, label: "日程日历" },
  { icon: <PackageOpen />, label: "献祭收集" },
  { icon: <Map />, label: "钓鱼点位" },
  { icon: <Puzzle />, label: "模组管理" },
  { icon: <Play />, label: "一键启动" },
];

function App() {
  return (
    <div className="mobile-shell flex min-h-full flex-col overflow-hidden">
      <main className="mobile-panel relative flex flex-1 flex-col px-6 pt-16 pb-safe">
        {/* 顶部品牌区 */}
        <div className="flex flex-col items-center text-center">
          <div className="relative">
            <div className="absolute -inset-4 rounded-full bg-primary/15 blur-2xl" />
            <img
              src={appIcon}
              alt="星露谷物语助手"
              draggable={false}
              className="pixelated relative h-24 w-24 rounded-3xl border border-primary/25 object-cover shadow-xl shadow-primary/10"
            />
          </div>
          <h1 className="mt-6 bg-gradient-to-r from-primary to-green-600 bg-clip-text text-3xl font-extrabold tracking-tight text-transparent">
            星露谷物语助手
          </h1>
          <p className="mt-2 text-sm font-medium text-muted-foreground">
            Stardew Valley Assistant
          </p>
        </div>

        {/* 功能预告卡片 */}
        <div className="mt-10">
          <div className="flex items-center gap-2 px-1">
            <span className="h-4 w-1 rounded-full bg-primary" />
            <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              即将上线
            </h2>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {FEATURES.map((feature) => (
              <div
                key={feature.label}
                className="flex items-center gap-3 rounded-xl border border-border/70 bg-card/70 px-4 py-3.5 transition-colors hover:border-primary/40 hover:bg-accent/50 active:scale-[0.98]"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary [&_svg]:h-5 [&_svg]:w-5">
                  {feature.icon}
                </span>
                <span className="min-w-0 text-sm font-medium text-card-foreground">
                  {feature.label}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* 占位提示 */}
        <div className="mt-auto flex flex-col items-center gap-4 pt-10">
          <p className="text-center text-xs leading-relaxed text-muted-foreground/80">
            移动端助手正在开发中，敬请期待。
          </p>
          <button
            type="button"
            disabled
            className="w-full cursor-not-allowed rounded-2xl bg-primary py-4 text-base font-bold text-primary-foreground opacity-60 shadow-lg shadow-primary/20"
          >
            开始使用
          </button>
          <span className="text-[10px] font-medium tracking-wider text-muted-foreground/60">
            v0.1.0 · 移动端预览
          </span>
        </div>
      </main>
    </div>
  );
}

export default App;