import { useState, useEffect, useRef, useCallback } from "react"
import { openUrl } from "@tauri-apps/plugin-opener"
import { 
  X, 
  ExternalLink, 
  Download, 
  Info, 
  Loader2, 
  AlertTriangle,
  RefreshCw,
  Languages,
  ChevronLeft,
  ChevronRight,
  Calendar,
  User,
  Tag,
  Eye,
  ZoomIn
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

// Import types from OnlineMods
import type { SmapiMod } from "./OnlineMods"

interface OnlineModDetailModalProps {
  isOpen: boolean
  onClose: () => void
  mod: SmapiMod | null
  onNavigate?: (page: "settings") => void
}

interface ParsedModDetails {
  title: string
  author: string
  imageUrl: string
  galleryImages: string[]
  description: string
  condensedDescription: string
  version: string
  uniqueDls: string
  totalDls: string
  endorsements: string
  lastUpdated: string
  downloadUrl?: string
}

interface CondensedTranslateState extends TranslateState {
  condensedDescriptionTranslated: string | null
  condensedDescLoading: boolean
}

import {
  TranslateState,
  edgeTranslate
} from "@/lib/translate"
import { useNexus } from "@/lib/nexus-provider"

async function translateHtmlTextOnly(html: string, toLanguage: string) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(`<div id="translate-root">${html}</div>`, "text/html")
  const root = doc.querySelector("#translate-root")
  if (!root) return html

  const isInExclusionTag = (node: Node) => {
    let parent = node.parentElement
    while (parent) {
      const tag = parent.tagName.toLowerCase()
      if (tag === "script" || tag === "style") return true
      parent = parent.parentElement
    }
    return false
  }

  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node.textContent || ""
      if (!text || !text.trim()) return NodeFilter.FILTER_REJECT
      if (isInExclusionTag(node)) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })

  const textNodes: Text[] = []
  let currentNode = walker.nextNode()
  while (currentNode) {
    textNodes.push(currentNode as Text)
    currentNode = walker.nextNode()
  }

  if (textNodes.length === 0) return html

  const originalTexts = textNodes.map(node => node.textContent || "")
  const chunkLimit = 4500
  const chunkedTasks: { nodeIndex: number; text: string }[] = []

  originalTexts.forEach((text, index) => {
    if (text.length <= chunkLimit) {
      chunkedTasks.push({ nodeIndex: index, text })
      return
    }
    for (let i = 0; i < text.length; i += chunkLimit) {
      chunkedTasks.push({ nodeIndex: index, text: text.substring(i, i + chunkLimit) })
    }
  })

  if (chunkedTasks.length === 0) return html

  const translatedByNode: string[][] = originalTexts.map(() => [])
  const batchSize = 10
  const batchChars = 4800
  let cursor = 0

  while (cursor < chunkedTasks.length) {
    let end = cursor
    let batchCharCount = 0
    while (end < chunkedTasks.length) {
      const nextText = chunkedTasks[end].text
      if (end > cursor && batchCharCount + nextText.length > batchChars) break
      batchCharCount += nextText.length
      end += 1
    }

    const batch = chunkedTasks.slice(cursor, end)
    if (batch.length > batchSize) {
      end = cursor + batchSize
    }

    const batchTexts = chunkedTasks.slice(cursor, end).map(task => task.text)
    const translatedBatch = await edgeTranslate(batchTexts, toLanguage)

    translatedBatch.forEach((translatedText, offset) => {
      const task = chunkedTasks[cursor + offset]
      if (!task) return
      translatedByNode[task.nodeIndex].push(translatedText ?? task.text)
    })

    cursor = end
  }

  for (let i = 0; i < textNodes.length; i += 1) {
    textNodes[i].textContent = (translatedByNode[i].length ? translatedByNode[i].join("") : originalTexts[i])
  }

  return root.innerHTML
}

// Helper for dynamic imports
async function getTauriInvoke() {
  if (typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__) {
    try {
      const mod = await import("@tauri-apps/api/core");
      return mod.invoke;
    } catch (err) {
      console.error("Failed to load Tauri core invoke plugin", err);
    }
  }
  return null;
}

async function getTauriListen() {
  if (typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__) {
    try {
      const mod = await import("@tauri-apps/api/event");
      return mod.listen;
    } catch (err) {
      console.error("Failed to load Tauri event listen plugin", err);
    }
  }
  return null;
}

export function OnlineModDetailModal({
  isOpen,
  onClose,
  mod,
  onNavigate
}: OnlineModDetailModalProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [details, setDetails] = useState<ParsedModDetails | null>(null)
  const [scrapeStatus, setScrapeStatus] = useState<"loading" | "challenge">("loading")
  const unlistenRef = useRef<(() => void) | null>(null)
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
  const [lightboxImage, setLightboxImage] = useState<string | null>(null)
  const [currentGalleryIndex, setCurrentGalleryIndex] = useState(0)
  const [isInstalling, setIsInstalling] = useState(false)
  const [installMessage, setInstallMessage] = useState<string | null>(null)
  const [installError, setInstallError] = useState<string | null>(null)
  const { nexusLoggedIn, nexusChecking } = useNexus()
  const nexusUrl = mod?.ModPages.find(p => p.Text === "Nexus" || p.Url.includes("nexusmods.com"))?.Url || ""

  const resolveNexusUrl = (href: string) => {
    const value = href.trim()
    if (!value) return ""
    if (value.startsWith("http://") || value.startsWith("https://")) return value
    if (value.startsWith("//")) return `https:${value}`
    if (value.startsWith("/")) return `https://www.nexusmods.com${value}`
    return `https://www.nexusmods.com/stardewvalley/mods/${value}`
  }

  const extractDownloadUrl = (htmlString: string) => {
    const hrefCandidates = new Set<string>()
    const parser = new DOMParser()
    const doc = parser.parseFromString(htmlString, "text/html")

    const pushCandidate = (candidate: string | null) => {
      const normalized = resolveNexusUrl(candidate || "")
      if (!normalized) return
      const lower = normalized.toLowerCase()
      if (!lower.includes("nexusmods.com")) return
      hrefCandidates.add(normalized)
    }

    doc.querySelectorAll("a[href]").forEach((a) => {
      const href = a.getAttribute("href") || ""
      const lower = href.toLowerCase()
      if (!href) return
      if (lower.includes("file_id=") || lower.includes("/files/") || lower.includes("download")) {
        pushCandidate(href)
      }
    })

    const htmlCandidates = [...htmlString.matchAll(/https?:\/\/[^\s"']*?(?:file_id|download)[^"'\s]*/gi)].map(match => match[0])
    htmlCandidates.forEach(pushCandidate)

    doc.querySelectorAll("[data-file-id][href]").forEach((el) => {
      const fileId = el.getAttribute("data-file-id")
      if (!fileId) return
      const fileIdDigits = fileId.trim()
      if (!fileIdDigits) return
      if (hrefCandidates.size === 0 && nexusUrl) {
        const base = resolveNexusUrl(nexusUrl).split("?")[0]
        hrefCandidates.add(`${base}?tab=files&file_id=${encodeURIComponent(fileIdDigits)}&nmm=1`)
      }
    })

    const rawFileIdMatches = [...htmlString.matchAll(/(?:file_id|fid)\s*=\s*([0-9]{3,})/gi)]
    if (rawFileIdMatches.length > 0 && hrefCandidates.size === 0 && nexusUrl) {
      const base = resolveNexusUrl(nexusUrl).split("?")[0]
      hrefCandidates.add(`${base}?tab=files&file_id=${rawFileIdMatches[0][1]}&nmm=1`)
    }

    const candidates = [...hrefCandidates]
    const directZip = candidates.find((item) => item.toLowerCase().includes(".zip") && (item.includes("file_id") || item.includes("download")))
    if (directZip) return directZip

    const fileApi = candidates.find(item => item.includes("file_id"))
    return fileApi || candidates[0] || ""
  }

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
    setLightboxImage(null)
    setCurrentGalleryIndex(0)
  }, [mod])

  const handleDownloadAndInstall = useCallback(async () => {
    if (!mod || !details) return

    setInstallError(null)
    setInstallMessage(null)

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

    setIsInstalling(true)
    setInstallMessage("正在下载并安装...")
    try {
      await invoke("install_nexus_mod", { gameDir, downloadUrl })
      setInstallMessage("已成功安装：模组已写入 Mods 目录。")
    } catch (err: any) {
      console.error("Install mod failed:", err)
      setInstallError(`安装失败: ${err}`)
      setInstallMessage(null)
    } finally {
      setIsInstalling(false)
    }
  }, [details, mod, nexusChecking, nexusLoggedIn, onNavigate, nexusUrl])

  // Extract Nexus ID from URL
  const getNexusId = (modItem: SmapiMod) => {
    const nexusPage = modItem.ModPages.find(p => p.Text === "Nexus" || p.Url.includes("nexusmods.com"))
    if (!nexusPage) return ""
    const parts = nexusPage.Url.split("/")
    return parts.pop() || ""
  }

  const parseHtml = (htmlString: string): ParsedModDetails => {
    const parser = new DOMParser()
    const doc = parser.parseFromString(htmlString, "text/html")

    // 1. Extract Title
    let title = doc.querySelector('meta[property="og:title"]')?.getAttribute("content") || ""
    if (!title) title = doc.querySelector("#pagetitle h1")?.textContent?.trim() || ""
    if (!title) title = doc.querySelector("h1")?.textContent?.trim() || (mod ? mod.Name : "未知模组")
    title = title.replace(/\s+at Stardew Valley Nexus.*/i, "")

    // 2. Extract Author from sideitems "Created by" block
    let author = ""
    const sideItems = doc.querySelectorAll(".sideitems .sideitem")
    sideItems.forEach(item => {
      const h3 = item.querySelector("h3")
      if (h3 && h3.textContent?.trim().toLowerCase().includes("created by")) {
        // Get text content excluding the h3 itself
        const clone = item.cloneNode(true) as HTMLElement
        clone.querySelector("h3")?.remove()
        author = clone.textContent?.trim() || ""
      }
    })
    if (!author) author = doc.querySelector(".author-name")?.textContent?.trim() || ""
    if (!author) author = doc.querySelector(".member-name a")?.textContent?.trim() || ""
    if (!author) author = mod ? mod.Author : "未知作者"
    author = author.replace(/^created by\s+/i, "").trim()

    // 3. Extract Gallery Images from thumbgallery (data-src has full-size URLs)
    const galleryImages: string[] = []
    const thumbs = doc.querySelectorAll("ul.thumbgallery.gallery > li.thumb[data-src]")
    thumbs.forEach(thumb => {
      const src = thumb.getAttribute("data-src")
      if (src && src.startsWith("http") && !galleryImages.includes(src)) {
        galleryImages.push(src)
      }
    })

    // Hero image: prefer og:image, fallback to first gallery image
    let imageUrl = doc.querySelector('meta[property="og:image"]')?.getAttribute("content") || ""
    if (!imageUrl && galleryImages.length > 0) imageUrl = galleryImages[0]

    // 4. Extract Full Description from .tab-description container
    //    Remove non-content elements (headings, share buttons, actions, accordion, scripts)
    const sanitizeDescriptionHtml = (html: string) => {
      const safeDoc = parser.parseFromString(`<div>${html}</div>`, "text/html")
      const tempContainer = safeDoc.body.firstElementChild
      if (!tempContainer) return html

      tempContainer.querySelectorAll("*").forEach(el => {
        const node = el as HTMLElement
        const style = node.getAttribute("style")
        if (!style) return

        // Remove problematic constraints regardless of spacing/casing, and keep remaining inline styles.
        node.style.removeProperty("min-width")
        node.style.removeProperty("width")
        const displayValue = node.style.getPropertyValue("display").trim().toLowerCase()
        if (displayValue === "table" || displayValue === "inline-table" || displayValue.startsWith("table-")) {
          node.style.removeProperty("display")
        }

        if (node.style.cssText.trim()) {
          node.setAttribute("style", node.style.cssText.endsWith(";") ? node.style.cssText : `${node.style.cssText};`)
        } else {
          node.removeAttribute("style")
        }

        const lowerStyle = style.toLowerCase()
        if (lowerStyle.includes("min-width") || lowerStyle.includes("width") || lowerStyle.includes("display: table")) {
          node.removeAttribute("style")
        }
      })

      const cleaned = tempContainer.innerHTML
        .replace(/<\s*br\s*\/?\s*>/gi, "")
        .replace(/<\s*\/\s*p\s*>\s*<\s*p[^>]*>/gi, "")

      return cleaned
    }

    let description = ""
    let condensedDescription = ""
    const descContainer = doc.querySelector(".tab-description")
    if (descContainer) {
      const clone = descContainer.cloneNode(true) as HTMLElement
      // Remove non-content elements
      const removeSelectors = [
        "h2", ".modhistory", "ul.actions", ".accordionitems",
        "script", ".share-button", "share-button", ".report-abuse-btn",
        ".clearfix:empty"
      ]
      clone.querySelectorAll(removeSelectors.join(",")).forEach(el => el.remove())
      description = sanitizeDescriptionHtml(clone.innerHTML?.trim() || "")
    }
    condensedDescription = sanitizeDescriptionHtml(doc.querySelector(".container.mod_description_container.condensed")?.innerHTML || "")
    // Fallback: try other known selectors
    if (!description) description = sanitizeDescriptionHtml(doc.querySelector("#description-content")?.innerHTML || "")
    if (!description) description = sanitizeDescriptionHtml(doc.querySelector(".mod-description")?.innerHTML || "")
    if (!description) description = sanitizeDescriptionHtml(doc.querySelector("#description")?.innerHTML || "")
    if (!description) {
      description = doc.querySelector('meta[property="og:description"]')?.getAttribute("content") || "暂无详细描述。"
    }

    // 5. Extract Stats from .statitem elements
    let version = mod?.Compatibility?.UnofficialVersion?.Text || ""
    let uniqueDls = "—"
    let totalDls = "—"
    let endorsements = "—"

    const statItems = doc.querySelectorAll(".statitem")
    statItems.forEach(item => {
      const titleEl = item.querySelector(".titlestat")
      const valueEl = item.querySelector(".stat")
      if (!titleEl || !valueEl) return
      const key = titleEl.textContent?.trim().toLowerCase() || ""
      const val = valueEl.textContent?.trim() || ""
      if (key.includes("version") && val) version = val
      else if (key.includes("unique") && val) uniqueDls = val
      else if (key === "total downloads" && val) totalDls = val
      else if (key.includes("endorsement") && val) endorsements = val
    })
    if (!version) version = mod?.Compatibility?.UnofficialVersion?.Text || "1.0.0"
    const downloadUrl = extractDownloadUrl(htmlString)

    // 6. Extract Last Updated from sideitems
    let lastUpdated = ""
    sideItems.forEach(item => {
      const h3 = item.querySelector("h3")
      if (h3 && h3.textContent?.trim().toLowerCase().includes("last updated")) {
        const timeEl = item.querySelector("time")
        lastUpdated = timeEl?.textContent?.trim() || item.textContent?.replace(/last updated/i, "").trim() || ""
      }
    })

    return {
      title,
      author,
      imageUrl,
      galleryImages,
      description,
      condensedDescription,
      version,
      uniqueDls,
      totalDls,
      endorsements,
      lastUpdated,
      downloadUrl
    }
  }

  const startScrape = async () => {
    if (!mod) return
    setLoading(true)
    setError(null)
    setDetails(null)
    setScrapeStatus("loading")

    const nexusId = getNexusId(mod)
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
        lastUpdated: "—"
      })
      setLoading(false)
      return
    }

    const invoke = await getTauriInvoke()
    const listen = await getTauriListen()

    if (invoke && listen) {
      try {
        // 1. Listen for the HTML response
        const unlisten = await listen<{ html?: string; error?: string; status?: "loading" | "challenge" }>("respond-nexus-html", (event) => {
          if (event.payload.status === "challenge") {
            setScrapeStatus("challenge")
            return
          }
          if (event.payload.status === "loading") {
            setScrapeStatus("loading")
            return
          }

          if (event.payload.error) {
            setError(event.payload.error)
            setLoading(false)
            if (unlistenRef.current) {
              unlistenRef.current()
              unlistenRef.current = null
            }
            return
          }

          if (!event.payload.html) {
            setError("未收到 Nexus 页面内容，请重试。")
            setLoading(false)
            if (unlistenRef.current) {
              unlistenRef.current()
              unlistenRef.current = null
            }
            return
          }

          console.log("Successfully received HTML payload from scraper window!")
          const parsed = parseHtml(event.payload.html)
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
        setTimeout(() => {
          if (unlistenRef.current) {
            setError("加载超时。这可能是由于网络不稳定或验证未能通过。请尝试重新打开。")
            setLoading(false)
            unlistenRef.current()
            unlistenRef.current = null
          }
        }, 185000)

      } catch (err: any) {
        console.error("Scraper invocation error:", err)
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
          lastUpdated: "2024年3月"
        })
        setLoading(false)
      }, 1500)
    }
  }

  useEffect(() => {
    if (isOpen && mod) {
      startScrape()
    }
    return () => {
      // Cleanup listener if modal unmounts
      if (unlistenRef.current) {
        unlistenRef.current()
        unlistenRef.current = null
      }
    }
  }, [isOpen, mod])

  useEffect(() => {
    const detailNode = detailBodyRef.current
    if (!detailNode) return

    detailNode.style.setProperty("display", "block", "important")
    detailNode.style.setProperty("overflow", "hidden", "important")
  }, [details, isOpen, currentGalleryIndex, showTranslated.title, showTranslated.desc, showTranslated.condensedDesc])

  if (!isOpen || !mod) return null

  // Render Status Badge
  const renderStatusBadge = (status: string) => {
    switch (status) {
      case "ok":
        return <Badge className="bg-green-500/10 text-green-500 border border-green-500/20 rounded-full font-semibold px-2.5 py-0.5 text-xs">完美兼容</Badge>
      case "workaround":
        return <Badge className="bg-amber-500/10 text-amber-500 border border-amber-500/20 rounded-full font-semibold px-2.5 py-0.5 text-xs">有解决方法</Badge>
      case "broken":
        return <Badge className="bg-red-500/10 text-red-500 border border-red-500/20 rounded-full font-semibold px-2.5 py-0.5 text-xs">已损坏</Badge>
      case "unofficial":
        return <Badge className="bg-blue-500/10 text-blue-500 border border-blue-500/20 rounded-full font-semibold px-2.5 py-0.5 text-xs">非官方更新</Badge>
      case "abandoned":
        return <Badge className="bg-gray-500/10 text-gray-500 border border-gray-500/20 rounded-full font-semibold px-2.5 py-0.5 text-xs">已弃用</Badge>
      case "obsolete":
        return <Badge className="bg-slate-500/10 text-slate-500 border border-slate-500/20 rounded-full font-semibold px-2.5 py-0.5 text-xs">已过时</Badge>
      default:
        return <Badge className="bg-green-500/10 text-green-500 border border-green-500/20 rounded-full font-semibold px-2.5 py-0.5 text-xs">兼容</Badge>
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4 animate-in fade-in duration-200" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
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
            onClick={onClose} 
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

            {/* Lightbox Overlay */}
                {lightboxImage && (
              <div
                className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center"
                onClick={() => setLightboxImage(null)}
              >
                <button
                  className="absolute top-4 right-4 p-2 text-white/80 hover:text-white rounded-full bg-white/10 hover:bg-white/20 transition-colors cursor-pointer"
                  onClick={() => setLightboxImage(null)}
                >
                  <X className="h-5 w-5" />
                </button>
                {details.galleryImages.length > 1 && (
                  <>
                    <button
                      className="absolute left-4 top-1/2 -translate-y-1/2 p-2 text-white/70 hover:text-white rounded-full bg-white/10 hover:bg-white/20 transition-colors cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation()
                        const newIndex = currentGalleryIndex > 0 ? currentGalleryIndex - 1 : details.galleryImages.length - 1
                        setCurrentGalleryIndex(newIndex)
                        setLightboxImage(details.galleryImages[newIndex])
                      }}
                    >
                      <ChevronLeft className="h-6 w-6" />
                    </button>
                    <button
                      className="absolute right-4 top-1/2 -translate-y-1/2 p-2 text-white/70 hover:text-white rounded-full bg-white/10 hover:bg-white/20 transition-colors cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation()
                        const newIndex = currentGalleryIndex < details.galleryImages.length - 1 ? currentGalleryIndex + 1 : 0
                        setCurrentGalleryIndex(newIndex)
                        setLightboxImage(details.galleryImages[newIndex])
                      }}
                    >
                      <ChevronRight className="h-6 w-6" />
                    </button>
                  </>
                )}
                <img
                  src={lightboxImage}
                  alt={details.title}
                  className="w-auto h-auto max-w-[90vw] max-h-[85vh] object-contain rounded-lg shadow-2xl block"
                  onClick={(e) => e.stopPropagation()}
                />
                {details.galleryImages.length > 1 && (
                  <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-black/60 text-white text-xs px-3 py-1.5 rounded-full">
                    {currentGalleryIndex + 1} / {details.galleryImages.length}
                  </div>
                )}
              </div>
            )}

            {/* Scrollable Content */}
            <div className="flex-1 min-h-0 overflow-auto">
              <div
                ref={detailBodyRef}
                className="p-5 space-y-5 w-full max-w-full min-w-0"
                style={{ width: "100%", minWidth: 0, maxWidth: "100%" }}
              >

                {/* Image Gallery */}
                {details.galleryImages.length > 0 && (
                  <div className="space-y-3">
                    {/* Main large image */}
                    <div
                      className="relative w-full h-[34vh] max-h-[320px] rounded-xl overflow-hidden border border-border bg-black/5 cursor-pointer group flex items-center justify-center"
                      onClick={() => {
                        setLightboxImage(details.galleryImages[currentGalleryIndex])
                      }}
                    >
                      <img
                        src={details.galleryImages[currentGalleryIndex]}
                        alt={details.title}
                        className="w-auto h-auto max-w-full max-h-full object-contain p-2 box-border block transition-transform group-hover:scale-[1.02] mx-auto"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none" }}
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                        <ZoomIn className="h-8 w-8 text-white/0 group-hover:text-white/70 transition-colors drop-shadow-lg" />
                      </div>
                      {details.galleryImages.length > 1 && (
                        <>
                          <button
                            className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/40 text-white/80 hover:bg-black/60 hover:text-white opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                            onClick={(e) => {
                              e.stopPropagation()
                              const newIndex = currentGalleryIndex > 0 ? currentGalleryIndex - 1 : details.galleryImages.length - 1
                              setCurrentGalleryIndex(newIndex)
                            }}
                          >
                            <ChevronLeft className="h-4 w-4" />
                          </button>
                          <button
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/40 text-white/80 hover:bg-black/60 hover:text-white opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                            onClick={(e) => {
                              e.stopPropagation()
                              const newIndex = currentGalleryIndex < details.galleryImages.length - 1 ? currentGalleryIndex + 1 : 0
                              setCurrentGalleryIndex(newIndex)
                            }}
                          >
                            <ChevronRight className="h-4 w-4" />
                          </button>
                          <div className="absolute bottom-2 right-2 bg-black/50 text-white text-[10px] px-2 py-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                            {currentGalleryIndex + 1} / {details.galleryImages.length}
                          </div>
                        </>
                      )}
                    </div>
                    {/* Thumbnail strip */}
                    {details.galleryImages.length > 1 && (
                      <div className="flex gap-2 overflow-x-auto pb-1">
                        {details.galleryImages.map((img, index) => (
                          <button
                            key={index}
                            className={`shrink-0 rounded-lg overflow-hidden border-2 transition-all cursor-pointer ${
                              index === currentGalleryIndex
                                ? "border-primary shadow-md"
                                : "border-transparent opacity-60 hover:opacity-100 hover:border-border"
                            }`}
                            style={{ width: "88px", height: "52px" }}
                            onClick={() => setCurrentGalleryIndex(index)}
                          >
                            <img
                              src={img}
                              alt={`Screenshot ${index + 1}`}
                              className="w-full h-full object-cover block"
                            />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Stats Row */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-accent/20 border border-border/50 rounded-xl p-3 text-center space-y-1">
                    <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider flex items-center justify-center gap-1">
                      <Tag className="h-3 w-3" />
                      <span>版本</span>
                    </p>
                    <p className="text-sm font-bold text-foreground">{details.version}</p>
                  </div>
                  <div className="bg-accent/20 border border-border/50 rounded-xl p-3 text-center space-y-1">
                    <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider flex items-center justify-center gap-1">
                      <Eye className="h-3 w-3" />
                      <span>独立下载</span>
                    </p>
                    <p className="text-sm font-bold text-foreground">{details.uniqueDls}</p>
                  </div>
                  <div className="bg-accent/20 border border-border/50 rounded-xl p-3 text-center space-y-1">
                    <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider flex items-center justify-center gap-1">
                      <Download className="h-3 w-3" />
                      <span>总下载</span>
                    </p>
                    <p className="text-sm font-bold text-foreground">{details.totalDls}</p>
                  </div>
                  <div className="bg-accent/20 border border-border/50 rounded-xl p-3 text-center space-y-1">
                    <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider flex items-center justify-center gap-1">
                      <Info className="h-3 w-3" />
                      <span>推荐数</span>
                    </p>
                    <p className="text-sm font-bold text-foreground">{details.endorsements}</p>
                  </div>
                </div>

                {/* Author & Date Info */}
                <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5" />
                    <span>作者：</span>
                    <span className="font-semibold text-foreground">{details.author}</span>
                  </span>
                  {details.lastUpdated && details.lastUpdated !== "—" && (
                    <span className="flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5" />
                      <span>最后更新：</span>
                      <span className="font-semibold text-foreground">{details.lastUpdated}</span>
                    </span>
                  )}
                  {mod.Compatibility && (
                    <span className="flex items-center gap-1.5">
                      {renderStatusBadge(mod.Compatibility.Status)}
                    </span>
                  )}
                </div>

                {/* Compatibility Notice */}
                <div className="bg-accent/10 border border-border/50 rounded-xl p-3.5 text-xs leading-relaxed space-y-1">
                  <p className="font-bold text-foreground flex items-center gap-1.5">
                    <Info className="h-3.5 w-3.5 text-primary shrink-0" />
                    <span>{mod.Compatibility ? "兼容性报告" : "兼容性说明"}</span>
                  </p>
                  <p className="text-muted-foreground text-[11px]">
                    {mod.Compatibility
                      ? "此处的报告是经 SMAPI 社区及作者核验后的准确记录，用以替代落后的游戏日志检查。"
                      : "该模组暂未收录在 SMAPI 兼容列表中，通常适用于不需要 SMAPI 兼容特殊报告的模组。"}
                  </p>
                </div>

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
          <Button variant="outline" size="sm" onClick={onClose} className="h-8 text-xs rounded-lg cursor-pointer">
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
            disabled={isInstalling}
            onClick={handleDownloadAndInstall}
            className="h-8 text-xs rounded-lg gap-1 bg-primary text-primary-foreground hover:bg-primary/95 cursor-pointer group relative"
          >
            {isInstalling ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
            <span>{isInstalling ? "安装中..." : "下载并安装"}</span>
            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block bg-popover text-popover-foreground border text-[9px] px-2 py-1 rounded shadow-lg whitespace-nowrap z-50">
              尝试从详情页抓取下载链接并解压到 Mods 目录
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
