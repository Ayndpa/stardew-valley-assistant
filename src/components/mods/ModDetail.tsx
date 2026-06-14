import { Card } from "@/components/ui/card"
import { openUrl } from "@tauri-apps/plugin-opener"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import {
  Puzzle,
  ExternalLink,
  Info,
  Sliders,
  FileCode,
  Terminal,
  AlertTriangle,
  Power,
  FolderOpen,
  Save
} from "lucide-react"
import { Mod } from "./ModList"

interface ModDetailProps {
  selectedMod: Mod | undefined
  activeDetailTab: string
  setActiveDetailTab: (tab: string) => void
  onToggleMod: (id: string) => void
  onOpenFolder: () => void
  onConfigChange: (modId: string, key: string, value: any) => void
  onSaveConfig: () => void
  isGameRunning?: boolean
}

export function ModDetail({
  selectedMod,
  activeDetailTab,
  setActiveDetailTab,
  onToggleMod,
  onOpenFolder,
  onConfigChange,
  onSaveConfig,
  isGameRunning = false,
}: ModDetailProps) {
  if (!selectedMod) {
    return (
      <Card className="border border-border p-8 text-center flex flex-col items-center justify-center h-[400px]">
        <Puzzle className="h-10 w-10 text-muted-foreground/30 mb-2" />
        <p className="text-muted-foreground">请在左侧选择一个模组查看详细信息与配置项</p>
      </Card>
    )
  }

  const hasUpdate = !!selectedMod.latestVersion && selectedMod.version !== selectedMod.latestVersion
  const canEdit = selectedMod.isEnabled && !isGameRunning

  return (
    <Card className="border border-border shadow-md rounded-xl overflow-hidden bg-card">
      {/* Card Banner / Title */}
      <div className="p-6 pb-4 bg-gradient-to-b from-accent/30 dark:from-accent/15 to-transparent border-b border-border/50">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-xl font-bold flex items-center gap-2">
              <Puzzle className="h-5 w-5 text-primary" />
              {selectedMod.name}
            </h3>
            <p className="text-xs text-muted-foreground font-mono mt-1">
              {selectedMod.englishName}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={selectedMod.isEnabled ? "default" : "secondary"} className={selectedMod.isEnabled ? "bg-green-600 hover:bg-green-600" : ""}>
              {selectedMod.isEnabled ? "已启用" : "已禁用"}
            </Badge>
          </div>
        </div>

        {/* Subinfo Row */}
        <div className="flex items-center gap-x-4 gap-y-2 flex-wrap mt-4 text-xs text-muted-foreground">
          <div>
            作者: <span className="font-semibold text-foreground">{selectedMod.author}</span>
          </div>
          <div>
            当前版本: <span className="font-semibold text-foreground">v{selectedMod.version}</span>
          </div>
          {selectedMod.latestVersion && selectedMod.latestVersion !== selectedMod.version && (
            <div>
              最新版本: <span className="font-semibold text-amber-600 dark:text-amber-400">v{selectedMod.latestVersion}</span>
            </div>
          )}
          {selectedMod.latestVersion && selectedMod.latestVersion === selectedMod.version && (
            <div>
              最新版本: <span className="font-semibold text-green-600 dark:text-green-400">v{selectedMod.latestVersion} ✓</span>
            </div>
          )}
          {selectedMod.nexusId && (
            <button
              onClick={() => openUrl(`https://www.nexusmods.com/stardewvalley/mods/${selectedMod.nexusId}`)}
              className="text-primary hover:underline flex items-center gap-0.5 cursor-pointer"
            >
              Nexus ID: {selectedMod.nexusId}
              <ExternalLink className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Tabs list inside details panel */}
      <Tabs value={activeDetailTab} onValueChange={setActiveDetailTab} className="w-full">
        <div className="px-6 border-b border-border/60">
          <TabsList className="bg-transparent h-10 p-0 gap-4 w-full justify-start border-none">
            <TabsTrigger
              value="info"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-1 py-2 text-xs font-semibold text-muted-foreground data-[state=active]:text-foreground"
            >
              <Info className="h-3.5 w-3.5 mr-1" />
              模组信息
            </TabsTrigger>
            <TabsTrigger
              value="config"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-1 py-2 text-xs font-semibold text-muted-foreground data-[state=active]:text-foreground"
            >
              <Sliders className="h-3.5 w-3.5 mr-1" />
              参数配置
            </TabsTrigger>
            <TabsTrigger
              value="files"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-1 py-2 text-xs font-semibold text-muted-foreground data-[state=active]:text-foreground"
            >
              <FileCode className="h-3.5 w-3.5 mr-1" />
              配置文件
            </TabsTrigger>
            <TabsTrigger
              value="logs"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-1 py-2 text-xs font-semibold text-muted-foreground data-[state=active]:text-foreground"
            >
              <Terminal className="h-3.5 w-3.5 mr-1" />
              运行日志
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Tab: Info */}
        <TabsContent value="info" className="p-6 space-y-4 outline-none">
          <div>
            <h4 className="text-sm font-semibold text-foreground mb-1.5">模组描述</h4>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {selectedMod.description}
            </p>
          </div>

          <Separator />

          <div className="grid grid-cols-2 gap-4 text-xs">
            <div>
              <span className="text-muted-foreground block mb-0.5">SMAPI 依赖项</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {selectedMod.dependencies.length > 0 ? (
                  selectedMod.dependencies.map((dep) => (
                    <Badge key={dep} variant="outline" className="text-[10px] py-0 px-1.5">
                      {dep}
                    </Badge>
                  ))
                ) : (
                  <span className="text-muted-foreground italic">无依赖项</span>
                )}
              </div>
            </div>
            <div>
              <span className="text-muted-foreground block mb-0.5">本地存放路径</span>
              <span className="font-mono bg-accent/40 px-1.5 py-0.5 rounded text-[10px] break-all inline-block mt-1 text-foreground">
                {selectedMod.localPath}
              </span>
            </div>
          </div>

          {hasUpdate && (
            <div className="bg-amber-500/10 border border-amber-200/50 dark:border-amber-900/30 p-3.5 rounded-xl flex items-start gap-2.5">
              <AlertTriangle className="h-4.5 w-4.5 text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">
                  发现新版本 v{selectedMod.latestVersion} 可升级
                </p>
                <p className="text-[11px] text-amber-700/90 dark:text-amber-300/80 mt-0.5">
                  当前安装版本为 v{selectedMod.version}。建议去 Nexus Mods 下载最新包覆盖更新，以保证与游戏最新版本的兼容性。
                </p>
                <Button 
                  variant="link" 
                  className="text-amber-600 dark:text-amber-400 p-0 h-auto text-[11px] font-bold mt-1.5 hover:underline"
                  onClick={() => {
                    openUrl(`https://www.nexusmods.com/stardewvalley/mods/${selectedMod.nexusId}`)
                  }}
                >
                  前往 Nexus Mods 下载页面 &rarr;
                </Button>
              </div>
            </div>
          )}

          <div className="pt-2 flex gap-2">
            <Button
              variant={selectedMod.isEnabled ? "destructive" : "default"}
              size="sm"
              className="flex-1 gap-1.5 py-2 rounded-xl text-xs font-semibold"
              onClick={() => onToggleMod(selectedMod.id)}
              disabled={isGameRunning}
              title={isGameRunning ? "游戏运行中，不能启用或禁用模组" : undefined}
            >
              <Power className="h-3.5 w-3.5" />
              {selectedMod.isEnabled ? "禁用此模组" : "启用此模组"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 py-2 rounded-xl text-xs font-semibold text-muted-foreground hover:text-foreground border-border hover:bg-accent"
              onClick={onOpenFolder}
            >
              <FolderOpen className="h-3.5 w-3.5" />
              定位文件夹
            </Button>
          </div>
        </TabsContent>

        {/* Tab: Config Form Editor */}
        <TabsContent value="config" className="p-6 space-y-4 outline-none">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-semibold text-foreground">动态参数设置</h4>
              <p className="text-xs text-muted-foreground mt-0.5">
                模拟编辑该模组的 <code className="bg-accent/40 px-1 py-0.5 rounded text-[10px]">config.json</code> 参数。
              </p>
            </div>
            {selectedMod.config.length > 0 && (
              <Button
                size="sm"
                className="bg-primary hover:bg-primary/95 text-primary-foreground gap-1.5 rounded-lg text-xs"
                onClick={onSaveConfig}
                disabled={!canEdit}
                title={isGameRunning ? "游戏运行中，不能保存配置" : undefined}
              >
                <Save className="h-3.5 w-3.5" />
                保存配置
              </Button>
            )}
          </div>

          {!selectedMod.isEnabled && (
            <div className="bg-muted dark:bg-muted/10 border border-border p-3.5 rounded-xl text-center text-xs text-muted-foreground">
              模组当前处于禁用状态，请在“模组信息”中启用模组后再编辑参数配置。
            </div>
          )}
          {isGameRunning && (
            <div className="bg-amber-500/10 border border-amber-500/20 p-3.5 rounded-xl text-center text-xs text-amber-600 dark:text-amber-400">
              游戏运行中，暂时不能修改模组配置。
            </div>
          )}

          <div className="space-y-4 mt-2 max-h-[300px] overflow-y-auto pr-1">
            {selectedMod.config.length > 0 ? (
              selectedMod.config.map((field) => (
                <div
                  key={field.key}
                  className={`p-3 rounded-lg border transition-all ${
                    !canEdit 
                      ? "opacity-50 border-border bg-accent/10" 
                      : "border-border/60 bg-accent/10 hover:border-primary/30"
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-foreground block">
                        {field.label}
                        <span className="text-[10px] text-muted-foreground font-mono ml-2">
                          ({field.key})
                        </span>
                      </label>
                      <span className="text-[10px] text-muted-foreground leading-normal block">
                        {field.description}
                      </span>
                    </div>

                    {/* Render controls based on type */}
                    <div className="flex-shrink-0 mt-0.5">
                      {field.type === "boolean" && (
                        <div 
                          onClick={() => {
                            if(canEdit) {
                              onConfigChange(selectedMod.id, field.key, !field.value)
                            }
                          }}
                        >
                          <button
                            type="button"
                            disabled={!canEdit}
                            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                              field.value ? "bg-primary" : "bg-muted-foreground/30"
                            } ${!canEdit ? "cursor-not-allowed" : ""}`}
                          >
                            <span
                              className={`pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform ${
                                field.value ? "translate-x-4.5" : "translate-x-0.5"
                              }`}
                            />
                          </button>
                        </div>
                      )}

                      {field.type === "number" && (
                        <Input
                          type="number"
                          disabled={!canEdit}
                          className="w-16 h-8 text-xs text-center border-border bg-card rounded-md"
                          value={field.value}
                          onChange={(e) =>
                            onConfigChange(
                              selectedMod.id,
                              field.key,
                              parseInt(e.target.value) || 0
                            )
                          }
                        />
                      )}

                      {field.type === "string" && (
                        <Input
                          type="text"
                          disabled={!canEdit}
                          className="w-24 h-8 text-xs border border-border bg-card rounded-md"
                          value={field.value}
                          onChange={(e) =>
                            onConfigChange(selectedMod.id, field.key, e.target.value)
                          }
                        />
                      )}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-6 text-xs text-muted-foreground italic">
                该模组无需任何自定义参数配置。
              </div>
            )}
          </div>
        </TabsContent>

        {/* Tab: File View Simulation */}
        <TabsContent value="files" className="p-6 space-y-4 outline-none">
          <div>
            <h4 className="text-sm font-semibold text-foreground">配置文件模拟器</h4>
            <p className="text-xs text-muted-foreground mt-0.5">
              以下是该模组的 <code className="bg-accent/40 px-1 py-0.5 rounded text-[10px]">config.json</code> 在磁盘中的真实序列化状态。
            </p>
          </div>

          <div className="bg-zinc-950 dark:bg-black/90 text-zinc-100 rounded-xl p-4 font-mono text-[11px] leading-relaxed overflow-x-auto border border-zinc-800">
            <div className="flex items-center justify-between text-[10px] text-zinc-500 border-b border-zinc-800 pb-2 mb-2">
              <span>{selectedMod.localPath}/config.json</span>
              <span className="text-green-500">JSON Format</span>
            </div>
            <pre className="text-emerald-400">
              {JSON.stringify(
                selectedMod.config.reduce((acc, field) => {
                  acc[field.key] = field.value
                  return acc
                }, {} as Record<string, any>),
                null,
                2
              )}
            </pre>
          </div>
        </TabsContent>

        {/* Tab: Logs Simulation */}
        <TabsContent value="logs" className="p-6 space-y-4 outline-none">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-semibold text-foreground">SMAPI 启动日志流</h4>
              <p className="text-xs text-muted-foreground mt-0.5">
                与此模组相关的加载与生命周期钩子事件监控。
              </p>
            </div>
            <Badge variant="outline" className="text-[10px] border-green-700/30 text-green-600 bg-green-500/5">
              正常载入
            </Badge>
          </div>

          <div className="bg-zinc-950 dark:bg-black/90 text-zinc-300 rounded-xl p-4 font-mono text-[10px] leading-normal space-y-1 border border-zinc-800 h-[240px] overflow-y-auto">
            <p className="text-zinc-500">[06:00:00 INFO  SMAPI] 正在载入模组 {selectedMod.englishName}...</p>
            <p className="text-zinc-500">[06:00:00 INFO  SMAPI] 读取清单文件 manifest.json...</p>
            <p className="text-zinc-400">[06:00:01 TRACE SMAPI] 版本: {selectedMod.version} | 作者: {selectedMod.author} | Nexus ID: {selectedMod.nexusId || "无"}</p>
            {selectedMod.dependencies.length > 0 && (
              <p className="text-zinc-400">[06:00:01 TRACE SMAPI] 检查依赖项: {selectedMod.dependencies.join(", ")} - 全部就绪</p>
            )}
            <p className="text-zinc-500">[06:00:01 INFO  SMAPI] 成功加载模组配置 (config.json)</p>
            {selectedMod.isEnabled ? (
              <>
                <p className="text-green-500">[06:00:01 INFO  SMAPI] 模组 "{selectedMod.name}" 开始初始化钩子...</p>
                <p className="text-green-400">[06:00:02 INFO  {selectedMod.englishName}] 成功监听了游戏内置更新事件。</p>
                <p className="text-zinc-500">[06:00:02 INFO  SMAPI] {selectedMod.englishName} 加载成功，耗时 12ms。</p>
              </>
            ) : (
              <>
                <p className="text-zinc-500">[06:00:01 INFO  SMAPI] 检测到配置已显式禁用该模组 (Enabled=false)</p>
                <p className="text-amber-500">[06:00:01 WARN  SMAPI] 模组 "{selectedMod.name}" 已跳过加载。</p>
              </>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </Card>
  )
}
