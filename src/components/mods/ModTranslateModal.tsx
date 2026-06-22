import { useState, useEffect } from "react"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Languages, X, Loader2, Eye, EyeOff, AlertCircle } from "lucide-react"
import { syncModTranslations } from "@/lib/mod-translation-library"
import type { Mod } from "./ModList"

interface ModTranslateModalProps {
  isOpen: boolean
  onClose: () => void
  mods: Mod[]
  onScan: () => void
}

async function getTauriInvoke() {
  if (typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__) {
    try {
      const mod = await import("@tauri-apps/api/core")
      return mod.invoke
    } catch (err) {
      console.error("Failed to load Tauri core invoke plugin", err)
    }
  }
  return null
}

async function translateModWithOpenAI(
  modName: string,
  modDesc: string,
  apiKey: string,
  baseUrl: string,
  model: string
): Promise<{ name: string; description: string }> {
  const url = baseUrl.replace(/\/$/, "") + "/chat/completions"
  const systemPrompt = `You are a professional Stardew Valley mod translator. Translate the given mod name and description into natural-sounding Chinese (Simplified). Return your response strictly as a JSON object containing the keys "name" and "description". Do not wrap the JSON in markdown code blocks.`
  const userContent = JSON.stringify({ name: modName, description: modDesc })
  
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent }
      ],
      temperature: 0.3,
      response_format: { type: "json_object" }
    })
  })

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "")
    throw new Error(`OpenAI API request failed: ${response.status} ${errorBody}`)
  }

  const data = await response.json()
  const rawContent = data.choices?.[0]?.message?.content?.trim()
  if (!rawContent) {
    throw new Error("Empty response from OpenAI API")
  }
  
  const parsed = JSON.parse(rawContent)
  return {
    name: parsed.name || modName,
    description: parsed.description || modDesc
  }
}

export function ModTranslateModal({ isOpen, onClose, mods, onScan }: ModTranslateModalProps) {
  const [engine, setEngine] = useState<"builtin" | "openai">("builtin")
  const [apiKey, setApiKey] = useState("")
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1")
  const [model, setModel] = useState("gpt-4o-mini")
  const [showApiKey, setShowApiKey] = useState(false)
  const [translateAll, setTranslateAll] = useState(false)

  // Translation progress state
  const [isTranslating, setIsTranslating] = useState(false)
  const [progress, setProgress] = useState(0)
  const [currentModName, setCurrentModName] = useState("")
  const [error, setError] = useState<string | null>(null)

  // Load config on open
  useEffect(() => {
    if (isOpen) {
      const savedEngine = localStorage.getItem("translationEngine") as "builtin" | "openai"
      const savedApiKey = localStorage.getItem("openaiApiKey") || ""
      const savedBaseUrl = localStorage.getItem("openaiBaseUrl") || "https://api.openai.com/v1"
      const savedModel = localStorage.getItem("openaiModel") || "gpt-4o-mini"

      if (savedEngine) setEngine(savedEngine)
      if (savedApiKey) setApiKey(savedApiKey)
      if (savedBaseUrl) setBaseUrl(savedBaseUrl)
      if (savedModel) setModel(savedModel)

      // Reset state
      setIsTranslating(false)
      setProgress(0)
      setCurrentModName("")
      setError(null)
    }
  }, [isOpen])

  if (!isOpen) return null

  // Filter mods
  const untranslatedMods = mods.filter((m) => !/[\u4e00-\u9fa5]/.test(m.name))
  const targetModsCount = translateAll ? mods.length : untranslatedMods.length

  const handleSaveSettings = () => {
    localStorage.setItem("translationEngine", engine)
    localStorage.setItem("openaiApiKey", apiKey)
    localStorage.setItem("openaiBaseUrl", baseUrl)
    localStorage.setItem("openaiModel", model)
  }

  const startTranslation = async () => {
    handleSaveSettings()
    setIsTranslating(true)
    setProgress(0)
    setError(null)
    setCurrentModName("")

    const gameDir = localStorage.getItem("stardewGameDirectory") || ""
    if (!gameDir) {
      setError("未检测到游戏安装目录，请先去设置页面进行配置。")
      setIsTranslating(false)
      return
    }

    if (engine === "openai" && !apiKey) {
      setError("使用 OpenAI API 翻译前请先填写 API Key。")
      setIsTranslating(false)
      return
    }

    const modsToTranslate = translateAll ? mods : untranslatedMods
    if (modsToTranslate.length === 0) {
      setError("没有需要翻译的模组。")
      setIsTranslating(false)
      return
    }

    const invoke = await getTauriInvoke()
    if (!invoke) {
      setError("非桌面客户端环境，无法执行文件写入操作。")
      setIsTranslating(false)
      return
    }

    let successCount = 0

    for (let i = 0; i < modsToTranslate.length; i++) {
      const mod = modsToTranslate[i]
      setCurrentModName(mod.name)
      setProgress(Math.round((i / modsToTranslate.length) * 100))

      try {
        let translatedName = ""
        let translatedDesc = ""

        if (engine === "openai") {
          // Translate using OpenAI API
          const res = await translateModWithOpenAI(
            mod.name,
            mod.description,
            apiKey,
            baseUrl,
            model
          )
          translatedName = res.name
          translatedDesc = res.description
        } else {
          // Translate using Built-in Translation Library
          const res = await syncModTranslations([mod])
          const translatedMod = res.mods[0]
          translatedName = translatedMod.name
          translatedDesc = translatedMod.description
        }

        // Call backend command to write translation to files
        await invoke("write_mod_translation", {
          gameDir,
          folderName: mod.folderName,
          originalName: mod.englishName || mod.name,
          originalDescription: mod.description,
          translatedName,
          translatedDescription: translatedDesc,
        })

        successCount++
      } catch (err: any) {
        console.error(`Failed to translate mod ${mod.name}:`, err)
      }
    }

    setProgress(100)
    setIsTranslating(false)
    setCurrentModName("")
    onScan()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <Card className="w-full max-w-lg border border-border shadow-2xl bg-card rounded-xl overflow-hidden animate-in zoom-in-95 duration-200">
        <CardHeader className="flex flex-row items-center justify-between border-b border-border/60 pb-4">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Languages className="h-5 w-5 text-indigo-500" />
              一键翻译本地模组名称与描述
            </CardTitle>
            <CardDescription className="text-xs mt-1">
              通过在本地模组文件夹中创建 i18n 翻译文件和修改 manifest.json，使游戏内配置菜单直接显示中文。
            </CardDescription>
          </div>
          <button
            onClick={onClose}
            disabled={isTranslating}
            className="p-1 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            <X className="h-4.5 w-4.5" />
          </button>
        </CardHeader>

        <CardContent className="p-6 space-y-4">
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-500 p-3 rounded-lg flex items-start gap-2 text-xs">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>{error}</div>
            </div>
          )}

          {isTranslating ? (
            <div className="space-y-4 py-4 animate-in fade-in duration-200">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-muted-foreground">正在翻译模组:</span>
                <span className="font-mono font-bold text-primary truncate max-w-[200px]" title={currentModName}>
                  {currentModName}
                </span>
              </div>
              <div className="w-full h-2 bg-accent rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300 rounded-full"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="flex justify-between items-center text-[10px] text-muted-foreground">
                <span>进度: {progress}%</span>
                <span className="flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin text-primary" />
                  请勿关闭软件...
                </span>
              </div>
            </div>
          ) : (
            <>
              {/* Engine Selector */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-foreground">选择翻译引擎</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setEngine("builtin")}
                    className={`py-2 text-[11px] font-bold border rounded-lg transition-all ${
                      engine === "builtin"
                        ? "bg-primary/10 text-primary border-primary"
                        : "border-border bg-card hover:bg-accent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    内置翻译引擎 (Edge + 共享库)
                  </button>
                  <button
                    type="button"
                    onClick={() => setEngine("openai")}
                    className={`py-2 text-[11px] font-bold border rounded-lg transition-all ${
                      engine === "openai"
                        ? "bg-primary/10 text-primary border-primary"
                        : "border-border bg-card hover:bg-accent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    OpenAI API (大语言模型)
                  </button>
                </div>
              </div>

              {/* OpenAI Config inside modal for fast tuning */}
              {engine === "openai" && (
                <div className="space-y-3 p-3 bg-accent/20 rounded-lg border border-border/50 animate-in fade-in duration-200">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-muted-foreground">API Key</label>
                    <div className="relative">
                      <Input
                        type={showApiKey ? "text" : "password"}
                        placeholder="sk-..."
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        className="text-xs h-8 bg-card border-border pr-8 rounded-md font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setShowApiKey(!showApiKey)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showApiKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-muted-foreground">API Base URL</label>
                      <Input
                        placeholder="https://api.openai.com/v1"
                        value={baseUrl}
                        onChange={(e) => setBaseUrl(e.target.value)}
                        className="text-xs h-8 bg-card border-border rounded-md font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-muted-foreground">Model Name</label>
                      <Input
                        placeholder="gpt-4o-mini"
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                        className="text-xs h-8 bg-card border-border rounded-md font-mono"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Options */}
              <div className="flex items-center space-x-2 bg-accent/10 p-3 rounded-lg border border-border/40">
                <Checkbox
                  id="translateAll"
                  checked={translateAll}
                  onCheckedChange={(checked) => setTranslateAll(!!checked)}
                />
                <div className="grid gap-1.5 leading-none">
                  <label
                    htmlFor="translateAll"
                    className="text-xs font-bold leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                  >
                    翻译所有模组（包括已包含中文的模组）
                  </label>
                  <p className="text-[10px] text-muted-foreground">
                    默认仅翻译名称不含中文的模组，勾选此项将强制覆盖翻译。
                  </p>
                </div>
              </div>

              {/* Stats */}
              <div className="text-[11px] text-muted-foreground flex justify-between items-center px-1">
                <span>当前已安装模组总数: <b>{mods.length}</b></span>
                <span>未汉化模组数: <b>{untranslatedMods.length}</b></span>
              </div>
            </>
          )}
        </CardContent>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border/60 bg-accent/15">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={isTranslating}
            className="rounded-lg text-xs hover:bg-accent h-9"
          >
            取消
          </Button>
          <Button
            type="button"
            onClick={startTranslation}
            disabled={isTranslating || targetModsCount === 0}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg text-xs h-9 gap-1"
          >
            {isTranslating ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                正在汉化...
              </>
            ) : (
              <>
                <Languages className="h-3.5 w-3.5" />
                开始翻译 ({targetModsCount} 个模组)
              </>
            )}
          </Button>
        </div>
      </Card>
    </div>
  )
}
