import { useState } from "react"
import { User, LogOut, Loader2, KeyRound, Copy, Check, Eye, EyeOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useTranslation } from "react-i18next"
import nexusLogo from "@/assets/Nexus_Mods_Logo.svg"

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
  const { t } = useTranslation()
  const [showApiKey, setShowApiKey] = useState(false)

  return (
    <Card className="overflow-hidden border border-border/80">
      <CardHeader className="bg-gradient-to-r from-orange-500/10 via-transparent to-transparent pb-4">
        <div className="flex items-center gap-3">
          <div className="h-9 px-2.5 rounded-md bg-black/40 flex items-center justify-center shrink-0 border border-white/5">
            <img src={nexusLogo} alt="NexusMods" className="h-5 w-auto object-contain" />
          </div>
          <div>
            <CardTitle className="text-lg font-bold">{t("settings.nexus.title")}</CardTitle>
            <CardDescription>
              {t("settings.nexus.description")}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-2">
        {nexusChecking ? (
          <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>{t("settings.nexus.checking")}</span>
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
                    {nexusUsername || t("settings.nexus.loggedIn")}
                  </p>
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <User className="h-3 w-3" />
                    {t("settings.nexus.loggedInStatus")}
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
                {t("settings.nexus.logout")}
              </Button>
            </div>

            {/* API Key Section */}
            <div className="p-3 rounded-lg bg-accent/30 border border-border/60 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-orange-500" />
                  <p className="text-sm font-medium">{t("settings.nexus.apiKey")}</p>
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
                          <span className="text-emerald-500">{t("settings.nexus.copied")}</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          {t("settings.nexus.copy")}
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
                    {t("settings.nexus.refresh")}
                  </Button>
                </div>
              </div>
              {nexusApiKeyLoading && !nexusApiKey ? (
                <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>{t("settings.nexus.fetchingApiKey")}</span>
                </div>
              ) : nexusApiKey ? (
                <div className="relative">
                  <Input
                    type={showApiKey ? "text" : "password"}
                    readOnly
                    value={nexusApiKey}
                    className="font-mono text-xs pr-8 bg-translucent-dark-400 opacity-70 truncate"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showApiKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">{t("settings.nexus.noApiKey")}</p>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between p-3 rounded-lg bg-accent/30 border border-border/60">
            <div className="flex items-center gap-3">
              <div className="h-8 px-2 rounded-md bg-black/40 flex items-center justify-center shrink-0 border border-white/5">
                <img src={nexusLogo} alt="NexusMods" className="h-4 w-auto object-contain" />
              </div>
              <div>
                <p className="text-sm font-medium">{t("settings.nexus.notLoggedIn")}</p>
                <p className="text-xs text-muted-foreground">
                  {t("settings.nexus.loginDescription")}
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
                <img src={nexusLogo} alt="" className="h-4 w-auto object-contain" />
              )}
              {nexusLoggingIn ? t("settings.nexus.waitingLogin") : t("settings.nexus.loginButton")}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

