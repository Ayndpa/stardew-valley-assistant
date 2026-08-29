import { useState, useEffect, useRef, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { openUrl } from "@tauri-apps/plugin-opener"
import {
  X,
  ExternalLink,
  Download,
  Loader2,
  AlertTriangle,
  RefreshCw,
  Languages,
  CheckCircle2,
  ArrowUpCircle
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
  /** 点击依赖项时的回调，用于在应用内导航到该模组详情 */
  onModClick?: (nexusUrl: string) => boolean
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
  isGameRunning = false,
  onModClick
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
  const [installedMod, setInstalledMod] = useState<{ name: string; version: string } | null>(null)
  const { nexusLoggedIn, nexusChecking } = useNexus()
  const { i18n, t } = useTranslation()
  const isChineseLang = (i18n.resolvedLanguage || i18n.language || "zh").startsWith("zh")
  const nexusUrl = mod?.ModPages.find(p => p.Text === "Nexus" || p.Url.includes("nexusmods.com"))?.Url || ""
  const isUpToDate = !!installedMod && installedMod.version === details?.version
  const installDisabled = loading || !details || isInstalling || isGameRunning || isUpToDate
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
      setTranslate(prev => ({ ...prev, titleLoading: false, error: t("mods.onlineDetail.translateTitleFailed") + err.message }))
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
      setTranslate(prev => ({ ...prev, descLoading: false, error: t("mods.onlineDetail.translateDescFailed") + err.message }))
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
      setTranslate(prev => ({ ...prev, condensedDescLoading: false, error: t("mods.onlineDetail.translateCondensedFailed") + err.message }))
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

  // Check if this mod is already installed
  useEffect(() => {
    if (!isOpen || !mod) { setInstalledMod(null); return }

    const nexusUrl = mod.ModPages.find(p => p.Text === "Nexus" || p.Url.includes("nexusmods.com"))?.Url || ""
    const match = nexusUrl.match(/nexusmods\.com\/stardewvalley\/mods\/(\d+)/)
    const nexusId = match ? match[1] : null

    if (!nexusId) { setInstalledMod(null); return }

    let cancelled = false
    ;(async () => {
      if (typeof window === "undefined" || !(window as any).__TAURI_INTERNALS__) return
      try {
        const { invoke } = await import("@tauri-apps/api/core")
        const gameDir = localStorage.getItem("stardewGameDirectory") || ""
        if (!gameDir) return
        const mods = await invoke("list_installed_mods", { gameDir }) as any[]
        if (cancelled) return
        const found = mods.find((m: any) => m.nexusId && String(m.nexusId) === nexusId)
        setInstalledMod(found ? { name: found.name, version: found.version } : null)
      } catch {
        if (!cancelled) setInstalledMod(null)
      }
    })()
    return () => { cancelled = true }
  }, [isOpen, mod])

  const handleDownloadAndInstall = useCallback(async () => {
    if (!mod || !details) return

    setInstallError(null)
    setInstallMessage(null)

    if (isGameRunning) {
      setInstallError(t("mods.onlineDetail.installGameRunning"))
      return
    }

    const gameDir = localStorage.getItem("stardewGameDirectory") || ""
    if (!gameDir) {
      setInstallError(t("mods.onlineDetail.installNoGameDir"))
      return
    }

    if (nexusChecking) {
      setInstallError(t("mods.onlineDetail.installNexusChecking"))
      return
    }

    if (!nexusLoggedIn) {
      setInstallMessage(t("mods.onlineDetail.installNexusNotLoggedIn"))
      onNavigate?.("settings")
      return
    }

    const downloadUrl = details.downloadUrl?.trim()
    if (!downloadUrl) {
      setInstallError(t("mods.onlineDetail.installNoDownloadUrl"))
      if (nexusUrl) {
        openUrl(nexusUrl)
      }
      return
    }

    const invoke = await getTauriInvoke()
    if (!invoke) {
      setInstallError(t("mods.onlineDetail.installNotSupported"))
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
    setInstallMessage(t("mods.onlineDetail.installDownloading"))
    try {
      await invoke("install_nexus_mod", { gameDir, downloadUrl })
      setInstallMessage(t("mods.onlineDetail.installSuccess"))
    } catch (err: any) {
      setInstallError(t("mods.onlineDetail.installFailed", { error: String(err) }))
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
          description: mod.Compatibility?.Summary || t("mods.onlineDetail.noNexusPage"),
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
            setError(t("mods.onlineDetail.errorNoContent"))
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
            setError(t("mods.onlineDetail.errorTimeout"))
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
        setError(t("mods.onlineDetail.errorScraperFailed") + err)
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
              {loading ? t("mods.onlineDetail.titleLoading") : (showTranslated.title && translate.titleTranslated ? translate.titleTranslated : details?.title)}
            </h3>
            {!loading && details && isChineseLang && (
              <button
                onClick={handleTranslateTitle}
                disabled={translate.titleLoading}
                className={`shrink-0 p-1 rounded-md transition-colors cursor-pointer ${
                  showTranslated.title
                    ? "bg-primary/15 text-primary hover:bg-primary/25"
                    : "hover:bg-black/5 dark:hover:bg-white/5 text-muted-foreground hover:text-foreground"
                } ${translate.titleLoading ? "opacity-50 cursor-wait" : ""}`}
                title={showTranslated.title ? t("mods.onlineDetail.switchToOriginal") : t("mods.onlineDetail.translateTitle")}
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
                {scrapeStatus === "challenge" ? t("mods.onlineDetail.cloudflareVerifyNeeded") : t("mods.onlineDetail.startingScraper")}
              </p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {scrapeStatus === "challenge"
                  ? t("mods.onlineDetail.cloudflareDesc")
                  : t("mods.onlineDetail.scraperDesc")}
              </p>
            </div>
          </div>
        )}

        {/* Error State */}
        {!loading && error && (
          <div className="flex-1 flex flex-col items-center justify-center p-8 space-y-4 min-h-[300px]">
            <AlertTriangle className="h-8 w-8 text-amber-500" />
            <div className="text-center space-y-2 max-w-md">
              <p className="text-xs font-bold text-foreground">{t("mods.onlineDetail.loadFailed")}</p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">{error}</p>
              <div className="pt-2">
                <Button variant="outline" size="sm" onClick={startScrape} className="h-8 text-xs gap-1 cursor-pointer">
                  <RefreshCw className="h-3 w-3" />
                  <span>{t("mods.onlineDetail.reload")}</span>
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

                <ModDependencies dependencies={details.dependencies} onModClick={onModClick} />

                {/* Description Section */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                      {showTranslated.desc ? `${t("mods.onlineDetail.descTitle")} ${t("mods.onlineDetail.translatedSuffix")}` : t("mods.onlineDetail.descTitle")}
                    </h4>
                    {isChineseLang && (
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
                      <span>{showTranslated.desc ? t("mods.onlineDetail.switchToOriginal") : translate.descriptionTranslated ? t("mods.onlineDetail.translated") : t("mods.onlineDetail.translate")}</span>
                    </button>
                    )}
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
                          {t("mods.onlineDetail.condensedDesc")}
                        </h5>
                        {isChineseLang && (
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
                          <span>{showTranslated.condensedDesc ? t("mods.onlineDetail.switchToOriginal") : translate.condensedDescriptionTranslated ? t("mods.onlineDetail.translated") : t("mods.onlineDetail.translate")}</span>
                        </button>
                        )}
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
            {t("mods.onlineDetail.close")}
          </Button>
          
          {nexusUrl && (
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => openUrl(nexusUrl)}
              className="h-8 text-xs rounded-lg gap-1 border-border/80 hover:bg-accent cursor-pointer"
            >
              <ExternalLink className="h-3 w-3" />
              <span>{t("mods.onlineDetail.openInBrowser")}</span>
            </Button>
          )}

          <Button
            variant={installedMod ? "outline" : "default"}
            size="sm"
            disabled={installDisabled}
            onClick={handleDownloadAndInstall}
            className={`h-8 text-xs rounded-lg gap-1 cursor-pointer group relative ${
              installedMod
                ? installedMod.version !== details?.version
                  ? "border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                  : "border-green-300 dark:border-green-700 text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-950/30"
                : "bg-primary text-primary-foreground hover:bg-primary/95"
            }`}
            title={
              loading || !details
                ? t("mods.onlineDetail.tooltipNeedLoad")
                : isGameRunning
                  ? t("mods.onlineDetail.tooltipGameRunning")
                  : installedMod
                    ? installedMod.version !== details?.version
                      ? t("mods.onlineDetail.tooltipUpdate", { current: `v${installedMod.version}`, latest: `v${details?.version}` })
                      : t("mods.onlineDetail.tooltipUpToDate")
                    : undefined
            }
          >
            {isInstalling ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : installedMod ? (
              installedMod.version !== details?.version ? (
                <ArrowUpCircle className="h-3 w-3" />
              ) : (
                <CheckCircle2 className="h-3 w-3" />
              )
            ) : (
              <Download className="h-3 w-3" />
            )}
            <span>
              {loading || !details ? t("mods.onlineDetail.btnLoading")
                : isGameRunning ? t("mods.onlineDetail.btnGameRunning")
                : isInstalling ? t("mods.onlineDetail.btnInstalling")
                : installedMod
                  ? installedMod.version !== details?.version
                    ? `${t("mods.onlineDetail.btnUpdate")} (v${installedMod.version})`
                    : t("mods.onlineDetail.btnInstalled")
                : t("mods.onlineDetail.btnInstall")
              }
            </span>
            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block bg-popover text-popover-foreground border text-[9px] px-2 py-1 rounded shadow-lg whitespace-nowrap z-50">
              {loading || !details ? t("mods.onlineDetail.tooltipWaitLoad")
                : isGameRunning ? t("mods.onlineDetail.tooltipExitGame")
                : installedMod
                  ? installedMod.version !== details?.version
                    ? t("mods.onlineDetail.tooltipUpdate", { current: `v${installedMod.version}`, latest: `v${details?.version}` })
                    : t("mods.onlineDetail.tooltipUpToDate")
                : t("mods.onlineDetail.tooltipAddQueue")
              }
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
