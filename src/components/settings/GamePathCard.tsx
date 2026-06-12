import { FolderOpen, Search, CheckCircle2, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

interface GamePathCardProps {
  gameDir: string
  isValidPath: boolean | null
  onAutoDetect: () => void
  onBrowse: () => void
  onChangeDir: (val: string) => void
}

export function GamePathCard({
  gameDir,
  isValidPath,
  onAutoDetect,
  onBrowse,
  onChangeDir,
}: GamePathCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <FolderOpen className="h-5 w-5" />
          游戏目录配置
        </CardTitle>
        <CardDescription>配置星露谷物语安装文件夹，以读取游戏数据与模组</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">安装目录路径</label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                placeholder="输入或选择游戏目录"
                value={gameDir}
                onChange={(e) => onChangeDir(e.target.value)}
                className="pr-10 font-mono text-sm"
              />
              {isValidPath !== null && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  {isValidPath ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                  )}
                </div>
              )}
            </div>
            <Button
              variant="default"
              onClick={onAutoDetect}
              className="flex gap-2 font-medium bg-primary text-primary-foreground hover:bg-primary/95 shrink-0"
            >
              <Search className="h-4 w-4" />
              自动检测
            </Button>
            <Button
              variant="outline"
              onClick={onBrowse}
              className="flex gap-2 font-medium shrink-0"
            >
              <FolderOpen className="h-4 w-4" />
              浏览
            </Button>
          </div>
          {isValidPath === false && (
            <p className="text-xs text-amber-500 flex items-center gap-1 mt-1 font-medium">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>路径格式可能不正确，标准路径通常包含 "Stardew Valley"</span>
            </p>
          )}
          {isValidPath === true && (
            <p className="text-xs text-emerald-500 flex items-center gap-1 mt-1 font-medium">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>已识别到合法的星露谷物语目录</span>
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
