import { useState, useEffect } from "react"
import { Languages, Eye, EyeOff } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export function TranslationSettingsCard() {
  const [engine, setEngine] = useState<"builtin" | "openai">("builtin")
  const [apiKey, setApiKey] = useState("")
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1")
  const [model, setModel] = useState("gpt-4o-mini")
  const [showApiKey, setShowApiKey] = useState(false)

  // Load values from localStorage on mount
  useEffect(() => {
    const savedEngine = localStorage.getItem("translationEngine") as "builtin" | "openai"
    const savedApiKey = localStorage.getItem("openaiApiKey") || ""
    const savedBaseUrl = localStorage.getItem("openaiBaseUrl") || "https://api.openai.com/v1"
    const savedModel = localStorage.getItem("openaiModel") || "gpt-4o-mini"

    if (savedEngine) setEngine(savedEngine)
    if (savedApiKey) setApiKey(savedApiKey)
    if (savedBaseUrl) setBaseUrl(savedBaseUrl)
    if (savedModel) setModel(savedModel)
  }, [])

  const saveSettings = (
    newEngine: "builtin" | "openai",
    newKey: string,
    newUrl: string,
    newModel: string
  ) => {
    localStorage.setItem("translationEngine", newEngine)
    localStorage.setItem("openaiApiKey", newKey)
    localStorage.setItem("openaiBaseUrl", newUrl)
    localStorage.setItem("openaiModel", newModel)
  }

  const handleEngineChange = (val: "builtin" | "openai") => {
    setEngine(val)
    saveSettings(val, apiKey, baseUrl, model)
  }

  const handleApiKeyChange = (val: string) => {
    setApiKey(val)
    saveSettings(engine, val, baseUrl, model)
  }

  const handleBaseUrlChange = (val: string) => {
    setBaseUrl(val)
    saveSettings(engine, apiKey, val, model)
  }

  const handleModelChange = (val: string) => {
    setModel(val)
    saveSettings(engine, apiKey, baseUrl, val)
  }

  return (
    <Card className="border border-border/80 overflow-hidden">
      <CardHeader className="bg-gradient-to-r from-primary/10 via-transparent to-transparent pb-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20 shrink-0">
            <Languages className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle className="text-lg font-bold">模组汉化与翻译引擎设置</CardTitle>
            <CardDescription>配置在一键翻译本地安装的模组名称与描述时使用的翻译引擎。</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6 pt-6">
        {/* Engine Selection */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-foreground">选择翻译引擎</label>
          <div className="grid grid-cols-2 gap-3">
            <Button
              variant={engine === "builtin" ? "default" : "outline"}
              onClick={() => handleEngineChange("builtin")}
              className={cn(
                "flex items-center justify-center gap-2 py-4 h-auto transition-all duration-200 cursor-pointer",
                engine === "builtin" ? "shadow-md scale-[1.02] font-semibold" : "hover:bg-accent/40"
              )}
            >
              <span>内置翻译引擎 (Edge + 共享库)</span>
            </Button>
            <Button
              variant={engine === "openai" ? "default" : "outline"}
              onClick={() => handleEngineChange("openai")}
              className={cn(
                "flex items-center justify-center gap-2 py-4 h-auto transition-all duration-200 cursor-pointer",
                engine === "openai" ? "shadow-md scale-[1.02] font-semibold" : "hover:bg-accent/40"
              )}
            >
              <span>OpenAI API (大语言模型)</span>
            </Button>
          </div>
        </div>

        {/* OpenAI Configurations */}
        {engine === "openai" && (
          <div className="space-y-4 border border-border/60 bg-accent/10 p-4 rounded-xl animate-in fade-in duration-200">
            <h4 className="text-xs font-bold text-foreground">OpenAI 接口设置</h4>
            
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-foreground/80">API Key</label>
              <div className="relative">
                <Input
                  type={showApiKey ? "text" : "password"}
                  placeholder="sk-..."
                  value={apiKey}
                  onChange={(e) => handleApiKeyChange(e.target.value)}
                  className="text-xs h-9 bg-card border-border pr-10 rounded-lg font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-foreground/80">API Base URL</label>
                <Input
                  placeholder="https://api.openai.com/v1"
                  value={baseUrl}
                  onChange={(e) => handleBaseUrlChange(e.target.value)}
                  className="text-xs h-9 bg-card border-border rounded-lg font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-foreground/80">Model (模型名称)</label>
                <Input
                  placeholder="gpt-4o-mini"
                  value={model}
                  onChange={(e) => handleModelChange(e.target.value)}
                  className="text-xs h-9 bg-card border-border rounded-lg font-mono"
                />
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">
              注意：请确保你填写的 API Key 和 Base URL 有效，且模型支持 JSON 响应格式（大部分主流模型如 gpt-4o-mini, gpt-4o 等均支持）。
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
