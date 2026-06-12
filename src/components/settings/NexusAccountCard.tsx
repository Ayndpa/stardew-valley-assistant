import { Globe, User, LogOut, Loader2, KeyRound, Copy, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

interface NexusAccountCardProps {
  nexusChecking: boolean
  nexusLoggedIn: boolean
  nexusUsername: string
  nexusLoggingIn: boolean
  nexusApiKey: string
  nexusApiKeyLoading: boolean
  nexusApiKeyCopied: boolean
  onLogin: () => void
  onLogout: () => void
  onCopyApiKey: () => void
  onRefreshApiKey: () => void
}

export function NexusAccountCard({
  nexusChecking,
  nexusLoggedIn,
  nexusUsername,
  nexusLoggingIn,
  nexusApiKey,
  nexusApiKeyLoading,
  nexusApiKeyCopied,
  onLogin,
  onLogout,
  onCopyApiKey,
  onRefreshApiKey,
}: NexusAccountCardProps) {
  return (
    <Card className="overflow-hidden border border-border/80">
      <CardHeader className="bg-gradient-to-r from-orange-500/10 via-transparent to-transparent pb-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-orange-500/10 flex items-center justify-center border border-orange-500/20 shrink-0">
            <Globe className="h-5 w-5 text-orange-500" />
          </div>
          <div>
            <CardTitle className="text-lg font-bold">NexusMods 账号</CardTitle>
            <CardDescription>
              登录 NexusMods 以便下载模组时获取链接
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-2">
        {nexusChecking ? (
          <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>正在检查登录状态...</span>
          </div>
        ) : nexusLoggedIn ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-full bg-emerald-500/15 flex items-center justify-center">
                  <User className="h-4 w-4 text-emerald-500" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {nexusUsername || "已登录"}
                  </p>
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <User className="h-3 w-3" />
                    已登录 NexusMods
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={onLogout}
                className="flex items-center gap-2 text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <LogOut className="h-4 w-4" />
                退出登录
              </Button>
            </div>

            {/* API Key Section */}
            <div className="p-3 rounded-lg bg-accent/30 border border-border/60 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-orange-500" />
                  <p className="text-sm font-medium">API Key</p>
                </div>
                <div className="flex items-center gap-2">
                  {nexusApiKey && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={onCopyApiKey}
                      className="flex items-center gap-1.5 h-7 text-xs"
                    >
                      {nexusApiKeyCopied ? (
                        <>
                          <Check className="h-3 w-3 text-emerald-500" />
                          <span className="text-emerald-500">已复制</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          复制
                        </>
                      )}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onRefreshApiKey}
                    disabled={nexusApiKeyLoading}
                    className="flex items-center gap-1.5 h-7 text-xs"
                  >
                    {nexusApiKeyLoading ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : null}
                    刷新
                  </Button>
                </div>
              </div>
              {nexusApiKeyLoading && !nexusApiKey ? (
                <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>正在获取 API Key...</span>
                </div>
              ) : nexusApiKey ? (
                <div className="relative">
                  <Input
                    readOnly
                    value={nexusApiKey}
                    className="font-mono text-xs pr-2 bg-translucent-dark-400 opacity-70 truncate"
                  />
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">未获取到 API Key，点击刷新重试</p>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between p-3 rounded-lg bg-accent/30 border border-border/60">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center">
                <Globe className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium">未登录</p>
                <p className="text-xs text-muted-foreground">
                  登录后可获取模组下载链接
                </p>
              </div>
            </div>
            <Button
              variant="default"
              size="sm"
              onClick={onLogin}
              disabled={nexusLoggingIn}
              className="flex items-center gap-2"
            >
              {nexusLoggingIn ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Globe className="h-4 w-4" />
              )}
              {nexusLoggingIn ? "等待登录..." : "登录 NexusMods"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
