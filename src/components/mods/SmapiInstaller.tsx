import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { AlertTriangle, Download, RefreshCw, Loader2, X, Info } from "lucide-react"

interface SmapiInstallerProps {
  smapiLatestVersion: string | null
  smapiMirror: "ghproxy" | "official"
  setSmapiMirror: (mirror: "ghproxy" | "official") => void
  onInstall: () => void
  onOpenOfficialSite: () => void
  installStatus: "idle" | "fetching" | "downloading" | "extracting" | "copying" | "success" | "error"
  installProgress: number
  installError: string | null
  gameVersion: string | null
}

export function SmapiInstaller({
  smapiLatestVersion,
  smapiMirror,
  setSmapiMirror,
  onInstall,
  onOpenOfficialSite,
  installStatus,
  installProgress,
  installError,
  gameVersion,
}: SmapiInstallerProps) {


  return (
    <div className="max-w-2xl mx-auto space-y-8 py-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Main Hero Card */}
      <Card className="border border-border shadow-xl bg-card rounded-3xl overflow-hidden relative">
        <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-red-400 via-orange-400 to-amber-400"></div>
        
        <CardContent className="p-8 space-y-8">
          {/* Icon and Title */}
          <div className="text-center space-y-3">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-red-500/10 text-red-500 shadow-inner">
              <AlertTriangle className="h-10 w-10 text-red-500 animate-pulse" />
            </div>
            <div className="space-y-1">
              <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
                SMAPI 安装
              </h1>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                您需要安装 Stardew Modding API (SMAPI) 才能在《星露谷物语》中使用各种丰富的模组。
              </p>
            </div>
          </div>

          {/* Status Details */}
          <div className="bg-accent/20 dark:bg-accent/5 rounded-2xl p-6 border border-border/60 space-y-4">
            <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">系统检测环境</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="space-y-1">
                <span className="text-muted-foreground block font-medium">游戏安装目录</span>
                <span className="font-semibold text-foreground font-mono truncate block max-w-xs" title={localStorage.getItem("stardewGameDirectory") || ""}>
                  {localStorage.getItem("stardewGameDirectory") || "未配置"}
                </span>
              </div>
              <div className="space-y-1">
                <span className="text-muted-foreground block font-medium">Stardew Valley 版本</span>
                <span className="font-semibold text-foreground font-mono bg-accent/40 px-2 py-0.5 rounded text-[11px]">
                  {gameVersion === null ? "检测中..." : gameVersion}
                </span>
              </div>
              <div className="space-y-1">
                <span className="text-muted-foreground block font-medium">SMAPI 状态</span>
                <span className="font-semibold text-red-500 flex items-center gap-1 font-medium">
                  <X className="h-3.5 w-3.5" /> 未安装
                </span>
              </div>
              <div className="space-y-1">
                <span className="text-muted-foreground block font-medium">最新可用 SMAPI</span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400 font-mono bg-emerald-500/10 px-2 py-0.5 rounded text-[11px]">
                  {smapiLatestVersion === null ? "检查中..." : `v${smapiLatestVersion}`}
                </span>
              </div>
            </div>
          </div>

          {/* 下载设置 */}
          {installStatus === "idle" && (
            <div className="bg-accent/20 dark:bg-accent/5 rounded-2xl p-5 border border-border/60 space-y-3">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <h4 className="text-xs font-bold text-foreground">GitHub 下载源设置</h4>
                  <p className="text-[10px] text-muted-foreground">国内网络下载缓慢时，推荐开启加速镜像</p>
                </div>
                <div className="flex bg-accent/40 rounded-xl p-1 border border-border/30 w-full sm:w-auto">
                  <button
                    onClick={() => setSmapiMirror("ghproxy")}
                    type="button"
                    className={`flex-1 sm:flex-none text-[11px] font-semibold px-3 py-1.5 rounded-lg transition-all ${
                      smapiMirror === "ghproxy"
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    GHProxy 加加速 (推荐)
                  </button>
                  <button
                    onClick={() => setSmapiMirror("official")}
                    type="button"
                    className={`flex-1 sm:flex-none text-[11px] font-semibold px-3 py-1.5 rounded-lg transition-all ${
                      smapiMirror === "official"
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    GitHub 官方源
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Action and Progress Bar */}
          <div className="space-y-4 pt-4 border-t border-border/60">
            {installStatus === "idle" ? (
              <div className="flex flex-col sm:flex-row justify-center gap-3">
                <Button
                  onClick={onInstall}
                  disabled={smapiLatestVersion === null}
                  className="bg-primary hover:bg-primary/95 text-primary-foreground font-bold text-sm px-8 py-6 rounded-2xl shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-2"
                >
                  <Download className="h-5 w-5" />
                  一键安装 SMAPI {smapiLatestVersion && `v${smapiLatestVersion}`}
                </Button>
                <Button
                  variant="outline"
                  onClick={onOpenOfficialSite}
                  className="border-border text-foreground hover:bg-accent font-semibold text-sm px-6 py-6 rounded-2xl"
                >
                  手动去官网下载
                </Button>
              </div>
            ) : installStatus === "error" ? (
              <div className="space-y-4">
                <div className="bg-red-500/15 border border-red-500/20 text-red-700 dark:text-red-400 text-xs rounded-xl p-4 font-mono break-all">
                  <p className="font-bold flex items-center gap-1.5 mb-1 text-sm">
                    <AlertTriangle className="h-4 w-4" /> 安装出错:
                  </p>
                  {installError}
                </div>
                <div className="flex justify-center gap-3">
                  <Button
                    onClick={onInstall}
                    className="bg-primary hover:bg-primary/95 text-primary-foreground font-bold text-xs px-6 py-4 rounded-xl"
                  >
                    <RefreshCw className="h-4 w-4 mr-1.5 animate-spin" style={{ animationDuration: '3s' }} /> 重新尝试安装
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex justify-between text-xs font-bold text-foreground">
                  <span className="flex items-center gap-1.5">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                    {installStatus === "fetching" && "正在准备网络请求..."}
                    {installStatus === "downloading" && `正在下载 SMAPI 安装包 (从 GitHub Releases)...`}
                    {installStatus === "extracting" && "正在解压缩安装包文件..."}
                    {installStatus === "copying" && "正在部署 SMAPI 核心组件到游戏目录..."}
                    {installStatus === "success" && "SMAPI 安装完成！"}
                  </span>
                  <span>{installProgress}%</span>
                </div>
                <div className="h-2 w-full bg-accent/40 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-primary transition-all duration-300 rounded-full" 
                    style={{ width: `${installProgress}%` }}
                  ></div>
                </div>
                <p className="text-[10px] text-muted-foreground text-center">
                  正在自动为您下载平台特定的运行库并完成目录重定向，请勿关闭程序。
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Installation Details Info Card */}
      <Card className="border border-border bg-card rounded-2xl p-6">
        <CardHeader className="p-0 pb-3 flex flex-row items-center gap-2">
          <Info className="h-5 w-5 text-primary" />
          <CardTitle className="text-sm font-bold text-foreground">关于 SMAPI 的一键安装</CardTitle>
        </CardHeader>
        <CardContent className="p-0 text-xs text-muted-foreground/90 space-y-2 leading-relaxed font-medium">
          <p>1. 星露谷助手会从 GitHub 下载对应您游戏平台的最新版 SMAPI 安装包。</p>
          <p>2. 程序将执行静默手动解压，并将安装包中 <code className="bg-accent/40 px-1 py-0.5 rounded text-[10px]">internal</code> 的对应文件递归移动部署至您的游戏主目录，与官方脚本安装效果完全一致。</p>
          <p>3. 卸载十分方便：若将来您希望清除 SMAPI，可以在右上角的管理面板中点击一键卸载，游戏文件会重回官方无模组的纯净版，且您的个人 Mods 目录不受任何损伤。</p>
        </CardContent>
      </Card>
    </div>
  )
}
