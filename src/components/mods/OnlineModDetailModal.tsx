import { useState, useEffect, useRef, useCallback } from "react"
import { openUrl } from "@tauri-apps/plugin-opener"
import { 
  X, 
  ExternalLink, 
  Download, 
  Loader2, 
  AlertTriangle,
  RefreshCw,
  Languages
} from "lucide-react"
import { Button } from "@/components/ui/button"

// Import types from OnlineMods
import type { SmapiMod } from "./OnlineMods"

interface OnlineModDetailModalProps {
  isOpen: boolean
  onClose: () => void
  mod: SmapiMod | null
  onNavigate?: (page: "settings") => void
  onQueueDownload?: (task: { modName: string; author: string; downloadUrl: string }) => { ok: boolean; message: string }
  isGameRunning?: boolean
}

import {
  TranslateState,
  edgeTranslate,
  translateHtmlTextOnly
} from "@/lib/translate"
import { useNexus } from "@/lib/nexus-provider"
import { ParsedModDetails, parseHtml, getNexusId, detectNexusErrorPage } from "./online-mod-parser"
import { ModGallery } from "./ModGallery"
import { ModSpecs, renderStatusBadge } from "./ModSpecs"
import { ModDependencies } from "./ModDependencies"
interface CondensedTranslateState extends TranslateState {
  condensedDescriptionTranslated: string | null
  condensedDescLoading: boolean
}

// Helper for dynamic imports
async function getTauriInvoke() {
  if (typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__) {
    try {
      const mod = await import("@tauri-apps/api/core");
      return mod.invoke;
    } catch {
    }
  }
  return null;
}

async function getTauriListen() {
  if (typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__) {
    try {
      const mod = await import("@tauri-apps/api/event");
      return mod.listen;
    } catch {
    }
  }
  return null;
}

export function OnlineModDetailModal({
  isOpen,
  onClose,
  mod,
  onNavigate,
  onQueueDownload,
  isGameRunning = false
}: OnlineModDetailModalProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [details, setDetails] = useState<ParsedModDetails | null>(null)
  const [scrapeStatus, setScrapeStatus] = useState<"loading" | "challenge">("loading")
  const detailBodyRef = useRef<HTMLDivElement | null>(null)
  const [translate, setTranslate] = useState<CondensedTranslateState>({
    titleTranslated: null,
    descriptionTranslated: null,
    condensedDescriptionTranslated: null,
    titleLoading: false,
    descLoading: false,
    condensedDescLoading: false,
    error: null,
  })
  const [showTranslated, setShowTranslated] = useState({ title: false, desc: false, condensedDesc: false })
  const [isInstalling, setIsInstalling] = useState(false)
  const [installMessage, setInstallMessage] = useState<string | null>(null)
  const [installError, setInstallError] = useState<string | null>(null)
  const { nexusLoggedIn, nexusChecking } = useNexus()
  const nexusUrl = mod?.ModPages.find(p => p.Text === "Nexus" || p.Url.includes("nexusmods.com"))?.Url || ""
  const installDisabled = loading || !details || isInstalling || isGameRunning
  const unlistenRef = useRef<(() => void) | null>(null)
  const scrapeTimeoutRef = useRef<number | null>(null)
  const activeRequestIdRef = useRef(0)
  const activeNexusIdRef = useRef<string | null>(null)

  // Translate title
  const handleTranslateTitle = useCallback(async () => {
    if (!details?.title || translate.titleLoading) return
    if (showTranslated.title) {
      setShowTranslated(prev => ({ ...prev, title: false }))
      return
    }
    if (translate.titleTranslated) {
      setShowTranslated(prev => ({ ...prev, title: true }))
      return
    }
    setTranslate(prev => ({ ...prev, titleLoading: true, error: null }))
    try {
      const [translated] = await edgeTranslate([details.title], "zh-Hans")
      setTranslate(prev => ({ ...prev, titleTranslated: translated, titleLoading: false }))
      setShowTranslated(prev => ({ ...prev, title: true }))
    } catch (err: any) {
      setTranslate(prev => ({ ...prev, titleLoading: false, error: "标题翻译失败: " + err.message }))
    }
  }, [details, translate.titleLoading, showTranslated.title, translate.titleTranslated])

  // Translate description (HTML)
  const handleTranslateDesc = useCallback(async () => {
    if (!details?.description || translate.descLoading) return
    if (showTranslated.desc) {
      setShowTranslated(prev => ({ ...prev, desc: false }))
      return
    }
    if (translate.descriptionTranslated) {
      setShowTranslated(prev => ({ ...prev, desc: true }))
      return
    }
    setTranslate(prev => ({ ...prev, descLoading: true, error: null }))
    try {
      const translatedHtml = await translateHtmlTextOnly(details.description, "zh-Hans")
      setTranslate(prev => ({ ...prev, descriptionTranslated: translatedHtml, descLoading: false }))
      setShowTranslated(prev => ({ ...prev, desc: true }))
    } catch (err: any) {
      setTranslate(prev => ({ ...prev, descLoading: false, error: "描述翻译失败: " + err.message }))
    }
  }, [details, translate.descLoading, showTranslated.desc, translate.descriptionTranslated])

  // Translate condensed description (HTML)
  const handleTranslateCondensedDesc = useCallback(async () => {
    if (!details?.condensedDescription || translate.condensedDescLoading) return
    if (showTranslated.condensedDesc) {
      setShowTranslated(prev => ({ ...prev, condensedDesc: false }))
      return
    }
    if (translate.condensedDescriptionTranslated) {
      setShowTranslated(prev => ({ ...prev, condensedDesc: true }))
      return
    }
    setTranslate(prev => ({ ...prev, condensedDescLoading: true, error: null }))
    try {
      const translatedHtml = await translateHtmlTextOnly(details.condensedDescription, "zh-Hans")
      setTranslate(prev => ({ ...prev, condensedDescriptionTranslated: translatedHtml, condensedDescLoading: false }))
      setShowTranslated(prev => ({ ...prev, condensedDesc: true }))
    } catch (err: any) {
      setTranslate(prev => ({ ...prev, condensedDescLoading: false, error: "补充说明翻译失败: " + err.message }))
    }
  }, [details, translate.condensedDescLoading, showTranslated.condensedDesc, translate.condensedDescriptionTranslated])

  // Reset translation state when mod changes
  useEffect(() => {
    setTranslate({
      titleTranslated: null,
      descriptionTranslated: null,
      condensedDescriptionTranslated: null,
      titleLoading: false,
      descLoading: false,
      condensedDescLoading: false,
      error: null,
    })
    setShowTranslated({ title: false, desc: false, condensedDesc: false })
  }, [mod])

  const handleDownloadAndInstall = useCallback(async () => {
    if (!mod || !details) return

    setInstallError(null)
    setInstallMessage(null)

    if (isGameRunning) {
      setInstallError("游戏运行中不能下载并安装模组，请退出游戏后再试。")
      return
    }

    const gameDir = localStorage.getItem("stardewGameDirectory") || ""
    if (!gameDir) {
      setInstallError("未配置游戏安装目录，请先在设置中配置")
      return
    }

    if (nexusChecking) {
      setInstallError("正在确认 Nexus 登录状态，请稍后重试")
      return
    }

    if (!nexusLoggedIn) {
      setInstallMessage("检测到未登录 NexusMods，正在跳转到设置页...")
      onNavigate?.("settings")
      return
    }

    const downloadUrl = details.downloadUrl?.trim()
    if (!downloadUrl) {
      setInstallError("未能解析到可直接下载链接，请先在 Nexus 页面手动下载。")
      if (nexusUrl) {
        openUrl(nexusUrl)
      }
      return
    }

    const invoke = await getTauriInvoke()
    if (!invoke) {
      setInstallError("当前环境不支持直接安装，请先在 Nexus 页面手动下载并解压到 Mods 目录。")
      openUrl(downloadUrl)
      return
    }

    if (onQueueDownload) {
      const result = onQueueDownload({
        modName: details.title || mod.Name,
        author: details.author || mod.Author,
        downloadUrl,
      })
      if (result.ok) {
        setInstallMessage(result.message)
        setInstallError(null)
        onClose()
      } else {
        setInstallError(result.message)
        setInstallMessage(null)
      }
      return
    }

    setIsInstalling(true)
    setInstallMessage("正在下载并安装...")
    try {
      await invoke("install_nexus_mod", { gameDir, downloadUrl })
      setInstallMessage("已成功安装：模组已写入 Mods 目录。")
    } catch (err: any) {
      setInstallError(`安装失败: ${err}`)
      setInstallMessage(null)
    } finally {
      setIsInstalling(false)
    }
  }, [details, isGameRunning, mod, nexusChecking, nexusLoggedIn, onNavigate, nexusUrl, onQueueDownload])


  const cleanupScrape = useCallback(async () => {
    activeRequestIdRef.current += 1

    if (scrapeTimeoutRef.current !== null) {
      window.clearTimeout(scrapeTimeoutRef.current)
      scrapeTimeoutRef.current = null
    }

    if (unlistenRef.current) {
      unlistenRef.current()
      unlistenRef.current = null
    }

    const closingNexusId = activeNexusIdRef.current
    activeNexusIdRef.current = null
    if (!closingNexusId) return

    const invoke = await getTauriInvoke()
    if (!invoke) return

    try {
      await invoke("close_scraper_window", { modId: closingNexusId })
    } catch {
    }
  }, [])

  const handleClose = useCallback(() => {
    void cleanupScrape()
    onClose()
  }, [cleanupScrape, onClose])

  const startScrape = async () => {
    if (!mod) return
    await cleanupScrape()

    const requestId = activeRequestIdRef.current + 1
    activeRequestIdRef.current = requestId
    setLoading(true)
    setError(null)
    setDetails(null)
    setScrapeStatus("loading")

    const nexusId = getNexusId(mod)
    activeNexusIdRef.current = nexusId
    if (!nexusId) {
      // If it doesn't have a Nexus page, simulate standard details
        setDetails({
          title: mod.Name,
          author: mod.Author,
          imageUrl: "",
          galleryImages: [],
          condensedDescription: "",
          description: mod.Compatibility?.Summary || "该模组没有关联的 NexusMods 页面，仅提供基础兼容性说明。",
          version: "—",
          uniqueDls: "—",
          totalDls: "—",
        endorsements: "—",
        lastUpdated: "—",
        dependencies: []
      })
      setLoading(false)
      return
    }

    const invoke = await getTauriInvoke()
    const listen = await getTauriListen()

    if (invoke && listen) {
      try {
        // 1. Listen for the HTML response
        const requestNexusId = nexusId
        const unlisten = await listen<{ modId?: string; html?: string; error?: string; status?: "loading" | "challenge" }>("respond-nexus-html", (event) => {
          if (activeRequestIdRef.current !== requestId) {
            return
          }
          if (event.payload.modId && event.payload.modId !== requestNexusId) {
            return
          }
          if (event.payload.status === "challenge") {
            setScrapeStatus("challenge")
            return
          }
          if (event.payload.status === "loading") {
            setScrapeStatus("loading")
            return
          }

          if (event.payload.error) {
            if (scrapeTimeoutRef.current !== null) {
              window.clearTimeout(scrapeTimeoutRef.current)
              scrapeTimeoutRef.current = null
            }
            setError(event.payload.error)
            setLoading(false)
            setScrapeStatus("loading")
            if (unlistenRef.current) {
              unlistenRef.current()
              unlistenRef.current = null
            }
            return
          }

          if (!event.payload.html) {
            if (scrapeTimeoutRef.current !== null) {
              window.clearTimeout(scrapeTimeoutRef.current)
              scrapeTimeoutRef.current = null
            }
            setError("未收到 Nexus 页面内容，请重试。")
            setLoading(false)
            if (unlistenRef.current) {
              unlistenRef.current()
              unlistenRef.current = null
            }
            return
          }

          // Check for Nexus error pages before parsing
          const nexusError = detectNexusErrorPage(event.payload.html)
          if (nexusError) {
            if (scrapeTimeoutRef.current !== null) {
              window.clearTimeout(scrapeTimeoutRef.current)
              scrapeTimeoutRef.current = null
            }
            setError(nexusError.message)
            setLoading(false)
            setScrapeStatus("loading")
            if (unlistenRef.current) {
              unlistenRef.current()
              unlistenRef.current = null
            }
            return
          }

          const parsed = parseHtml(event.payload.html, mod, nexusUrl)
          if (scrapeTimeoutRef.current !== null) {
            window.clearTimeout(scrapeTimeoutRef.current)
            scrapeTimeoutRef.current = null
          }
          setDetails(parsed)
          setLoading(false)
          setScrapeStatus("loading")
          
          if (unlistenRef.current) {
            unlistenRef.current()
            unlistenRef.current = null
          }
        })
        
        unlistenRef.current = unlisten

        // 2. Call backend to open scraper
        await invoke("open_scraper_window", { modId: nexusId })

        // 3. Set a safety timeout in case of total failure
        scrapeTimeoutRef.current = window.setTimeout(() => {
          if (activeRequestIdRef.current === requestId && unlistenRef.current) {
            setError("加载超时。这可能是由于网络不稳定或验证未能通过。请尝试重新打开。")
            setLoading(false)
            unlistenRef.current()
            unlistenRef.current = null
          }
        }, 185000)

      } catch (err: any) {
        if (activeRequestIdRef.current !== requestId) {
          return
        }
        if (scrapeTimeoutRef.current !== null) {
          window.clearTimeout(scrapeTimeoutRef.current)
          scrapeTimeoutRef.current = null
        }
        setError("启动网页抓取器失败: " + err)
        setLoading(false)
      }
    } else {
      // Mock Browser Environment Preview
      setTimeout(() => {
        setDetails({
          title: mod.Name,
          author: mod.Author,
          imageUrl: "https://staticdelivery.nexusmods.com/mods/1303/images/1915/1915-1711204213-790176840.png",
          galleryImages: [
            "https://staticdelivery.nexusmods.com/mods/1303/images/1915/1915-1711204213-790176840.png",
          ],
          condensedDescription: "",
          description: `<h3>关于此模组</h3><p>这是一个高级的预览内容，模拟了从 NexusMods 抓取到的 HTML 格式文本。</p><p>${mod.Compatibility?.Summary || "本模组是 Stardew Valley 的经典必备模组，没有任何已知问题。"}</p><h4>特点:</h4><ul><li>实时解析与序列化</li><li>支持 Markdown 与 HTML 转化</li><li>微距渲染，性能极佳</li></ul>`,
          version: "2.3.0",
          uniqueDls: "4.8M",
          totalDls: "12.1M",
          endorsements: "128,490",
          lastUpdated: "2024年3月",
          dependencies: []
        })
        setLoading(false)
      }, 1500)
    }
  }

  useEffect(() => {
    if (isOpen && mod) {
      void startScrape()
    }
    return () => {
      void cleanupScrape()
    }
  }, [cleanupScrape, isOpen, mod])

  useEffect(() => {
    const detailNode = detailBodyRef.current
    if (!detailNode) return

    detailNode.style.setProperty("display", "block", "important")
    detailNode.style.setProperty("overflow", "hidden", "important")
  }, [details, isOpen, showTranslated.title, showTranslated.desc, showTranslated.condensedDesc])

  if (!isOpen || !mod) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4 animate-in fade-in duration-200" onClick={(e) => { if (e.target === e.currentTarget) handleClose() }}>
      <div className="w-full max-w-5xl max-h-[90vh] bg-card border border-border/80 shadow-2xl rounded-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
        
        {/* Header Panel */}
        <div className="p-5 border-b border-border/60 flex items-center justify-between bg-gradient-to-r from-accent/20 to-card">
          <div className="flex items-center gap-3 min-w-0 pr-4">
            <h3 className="text-base font-bold truncate text-foreground">
              {loading ? "正在获取 Nexus 模组信息..." : (showTranslated.title && translate.titleTranslated ? translate.titleTranslated : details?.title)}
            </h3>
            {!loading && details && (
              <button
                onClick={handleTranslateTitle}
                disabled={translate.titleLoading}
                className={`shrink-0 p-1 rounded-md transition-colors cursor-pointer ${
                  showTranslated.title
                    ? "bg-primary/15 text-primary hover:bg-primary/25"
                    : "hover:bg-black/5 dark:hover:bg-white/5 text-muted-foreground hover:text-foreground"
                } ${translate.titleLoading ? "opacity-50 cursor-wait" : ""}`}
                title={showTranslated.title ? "切换回原文" : "翻译标题"}
              >
                {translate.titleLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Languages className="h-3.5 w-3.5" />}
              </button>
            )}
            {!loading && details && mod.Compatibility && renderStatusBadge(mod.Compatibility.Status)}
          </div>
          <button 
            onClick={handleClose} 
            className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 text-muted-foreground hover:text-foreground transition-colors shrink-0 cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="flex-1 flex flex-col items-center justify-center p-8 space-y-4 min-h-[300px]">
            <Loader2 className="h-8 w-8 text-primary animate-spin" />
            <div className="text-center space-y-2 max-w-md">
              <p className="text-xs font-bold text-foreground">
                {scrapeStatus === "challenge" ? "需要完成 Cloudflare 验证" : "正在启动后台安全解析通道..."}
              </p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {scrapeStatus === "challenge"
                  ? "Nexus 的验证页面已在独立窗口显示。请在该窗口中点击验证框，验证通过后这里会自动继续加载模组详情。"
                  : "正在通过 WebView 加载 Nexus 页面并同步解析结果。遇到 Cloudflare 人机验证时，验证窗口会自动显示。"}
              </p>
            </div>
          </div>
        )}

        {/* Error State */}
        {!loading && error && (
          <div className="flex-1 flex flex-col items-center justify-center p-8 space-y-4 min-h-[300px]">
            <AlertTriangle className="h-8 w-8 text-amber-500" />
            <div className="text-center space-y-2 max-w-md">
              <p className="text-xs font-bold text-foreground">模组详情加载失败</p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">{error}</p>
              <div className="pt-2">
                <Button variant="outline" size="sm" onClick={startScrape} className="h-8 text-xs gap-1 cursor-pointer">
                  <RefreshCw className="h-3 w-3" />
                  <span>重新加载</span>
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Details State */}
        {!loading && details && (
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">

            {/* Scrollable Content */}
            <div className="flex-1 min-h-0 overflow-auto">
              <div
                ref={detailBodyRef}
                className="p-5 space-y-5 w-full max-w-full min-w-0"
                style={{ width: "100%", minWidth: 0, maxWidth: "100%" }}
              >
                <ModGallery key={details.title} galleryImages={details.galleryImages} title={details.title} />

                <ModSpecs details={details} mod={mod} />

                <ModDependencies dependencies={details.dependencies} />

                {/* Description Section */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                      {showTranslated.desc ? "模组详细介绍 (已翻译)" : "模组详细介绍 (Description)"}
                    </h4>
                    <button
                      onClick={handleTranslateDesc}
                      disabled={translate.descLoading}
                      className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] transition-colors cursor-pointer ${
                        showTranslated.desc
                          ? "bg-primary/15 text-primary hover:bg-primary/25 font-semibold"
                          : "hover:bg-black/5 dark:hover:bg-white/5 text-muted-foreground hover:text-foreground"
                      } ${translate.descLoading ? "opacity-50 cursor-wait" : ""}`}
                    >
                      {translate.descLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Languages className="h-3 w-3" />}
                      <span>{showTranslated.desc ? "显示原文" : translate.descriptionTranslated ? "已翻译" : "翻译"}</span>
                    </button>
                  </div>
                  {translate.error && (
                    <div className="text-[11px] text-amber-500 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-1.5">
                      {translate.error}
                    </div>
                  )}
                  <div
                    className="prose dark:prose-invert max-w-none text-xs leading-relaxed text-muted-foreground nexus-description"
                    style={{ maxWidth: "100%", overflow: "hidden", overflowX: "hidden", minWidth: 0 }}
                    dangerouslySetInnerHTML={{ __html: showTranslated.desc && translate.descriptionTranslated ? translate.descriptionTranslated : details.description }}
                  />
                  {details.condensedDescription && (
                    <div className="space-y-1 pt-0.5">
                      <div className="flex items-center justify-between">
                        <h5 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                          补充说明
                        </h5>
                        <button
                          onClick={handleTranslateCondensedDesc}
                          disabled={translate.condensedDescLoading}
                          className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] transition-colors cursor-pointer ${
                            showTranslated.condensedDesc
                              ? "bg-primary/15 text-primary hover:bg-primary/25 font-semibold"
                              : "hover:bg-black/5 dark:hover:bg-white/5 text-muted-foreground hover:text-foreground"
                          } ${translate.condensedDescLoading ? "opacity-50 cursor-wait" : ""}`}
                        >
                          {translate.condensedDescLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Languages className="h-3 w-3" />}
                          <span>{showTranslated.condensedDesc ? "显示原文" : translate.condensedDescriptionTranslated ? "已翻译" : "翻译"}</span>
                        </button>
                      </div>
                      <div
                        className="prose dark:prose-invert max-w-none text-xs leading-tight text-muted-foreground nexus-description"
                        style={{ maxWidth: "100%", overflow: "hidden", overflowX: "hidden", minWidth: 0 }}
                        dangerouslySetInnerHTML={{
                          __html: showTranslated.condensedDesc && translate.condensedDescriptionTranslated
                            ? translate.condensedDescriptionTranslated
                            : details.condensedDescription
                        }}
                      />
                    </div>
                  )}
                </div>

              </div>
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className="p-4 border-t border-border/60 bg-accent/15 flex justify-end gap-2.5 shrink-0">
          <Button variant="outline" size="sm" onClick={handleClose} className="h-8 text-xs rounded-lg cursor-pointer">
            关闭
          </Button>
          
          {nexusUrl && (
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => openUrl(nexusUrl)}
              className="h-8 text-xs rounded-lg gap-1 border-border/80 hover:bg-accent cursor-pointer"
            >
              <ExternalLink className="h-3 w-3" />
              <span>在浏览器中打开 Nexus</span>
            </Button>
          )}

          <Button 
            variant="default" 
            size="sm" 
            disabled={installDisabled}
            onClick={handleDownloadAndInstall}
            className="h-8 text-xs rounded-lg gap-1 bg-primary text-primary-foreground hover:bg-primary/95 cursor-pointer group relative"
            title={
              loading || !details
                ? "模组详情加载完成后才能安装"
                : isGameRunning
                  ? "游戏运行中，不能下载并安装模组"
                  : undefined
            }
          >
            {isInstalling ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
            <span>
              {loading || !details ? "加载中..." : isGameRunning ? "游戏运行中" : isInstalling ? "安装中..." : "安装"}
            </span>
            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block bg-popover text-popover-foreground border text-[9px] px-2 py-1 rounded shadow-lg whitespace-nowrap z-50">
              {loading || !details ? "请等待详情和下载信息加载完成" : isGameRunning ? "退出游戏后可加入下载队列" : "加入侧边栏的全局下载队列"}
            </span>
          </Button>
        </div>
        {installMessage && (
          <div className="px-4 pb-3 text-[11px] text-emerald-500">{installMessage}</div>
        )}
        {installError && (
          <div className="px-4 pb-3 text-[11px] text-amber-500">{installError}</div>
        )}
        
      </div>
    </div>
  )
}
