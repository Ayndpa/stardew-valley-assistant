import type { SmapiMod } from "./OnlineMods"

export interface NexusDependencyFile {
  uid: number
  name: string
  version: string
  downloadUrl: string
  vortexDownloadUrl: string
  dependencyCount: number
  mod: {
    name: string
    url: string
    thumbnailUrl: string
    adultContent: boolean
  }
}

export interface NexusDependencyGroup {
  files: NexusDependencyFile[]
}

export interface ParsedModDetails {
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
  dependencies: NexusDependencyGroup[]
}

export interface NexusErrorPage {
  type: "not_found" | "removed" | "hidden"
  message: string
}

/**
 * Detect Nexus error pages (not found, removed by author, hidden).
 * Returns null if the page is a normal mod page.
 */
export function detectNexusErrorPage(htmlString: string): NexusErrorPage | null {
  const parser = new DOMParser()
  const doc = parser.parseFromString(htmlString, "text/html")
  const bodyText = doc.body?.textContent?.trim() || ""

  // "Not found" — The mod you were looking for couldn't be found
  if (bodyText.includes("The mod you were looking for couldn't be found") ||
      (bodyText.includes("Not found") && bodyText.includes("couldn't be found"))) {
    return { type: "not_found", message: "该模组不存在，可能是 ID 错误或模组已被删除。" }
  }

  // "Removed by author" — The mod you were looking for was removed by its author
  if (bodyText.includes("was removed by its author") ||
      bodyText.includes("Removed by author")) {
    return { type: "removed", message: "该模组已被作者从 NexusMods 移除，无法查看。" }
  }

  // "Hidden" — The mod is hidden by the author
  if (bodyText.includes("has been hidden") && bodyText.includes("author")) {
    return { type: "hidden", message: "该模组已被作者暂时隐藏，目前无法查看。" }
  }

  return null
}

export function getNexusId(modItem: SmapiMod): string {
  const nexusPage = modItem.ModPages.find(p => p.Text === "Nexus" || p.Url.includes("nexusmods.com"))
  if (!nexusPage) return ""
  const parts = nexusPage.Url.split("/")
  return parts.pop() || ""
}

export function resolveNexusUrl(href: string): string {
  const value = href.trim()
  if (!value) return ""
  if (value.startsWith("http://") || value.startsWith("https://")) return value
  if (value.startsWith("//")) return `https:${value}`
  if (value.startsWith("/")) return `https://www.nexusmods.com${value}`
  return `https://www.nexusmods.com/stardewvalley/mods/${value}`
}

export function extractDownloadUrl(htmlString: string, nexusUrl: string): string {
  const hrefCandidates = new Set<string>()
  const parser = new DOMParser()
  const doc = parser.parseFromString(htmlString, "text/html")
  const normalizedNexusUrl = resolveNexusUrl(nexusUrl)
  const expectedBasePath = normalizedNexusUrl ? normalizedNexusUrl.split("?")[0].toLowerCase() : ""

  const isBlockedDownloadCandidate = (value: string) => {
    const lower = value.toLowerCase()
    return (
      lower.includes("/users/myaccount") ||
      lower.includes("tab=download+history") ||
      lower.includes("tab=download%20history") ||
      lower.includes("download-history") ||
      lower.includes("/collections") ||
      lower.includes("cookiebot.renew") ||
      lower.includes("imasdk.googleapis.com") ||
      lower.includes("googlesyndication.com") ||
      lower.includes("doubleclick.net") ||
      lower.endsWith("#") ||
      lower.includes("#maincontent")
    )
  }

  const pushCandidate = (candidate: string | null) => {
    const normalized = resolveNexusUrl(candidate || "")
    if (!normalized) return
    const lower = normalized.toLowerCase()
    if (!lower.includes("nexusmods.com")) return
    if (isBlockedDownloadCandidate(lower)) return
    if (expectedBasePath && !lower.startsWith(expectedBasePath)) return
    hrefCandidates.add(normalized)
  }

  const explicitDownloadSelectors = [
    "#action-nmm a[href]",
    "#action-manual a[href]",
    "li#action-nmm a[href]",
    "li#action-manual a[href]",
  ]
  explicitDownloadSelectors.forEach((selector) => {
    doc.querySelectorAll(selector).forEach((el) => {
      pushCandidate(el.getAttribute("href"))
    })
  })

  const filePageLinks = [
    ...doc.querySelectorAll("a[href*='tab=files'][href*='file_id=']"),
    ...doc.querySelectorAll("a[href*='tab=files'][href*='nmm=1']"),
  ]
  filePageLinks.forEach((el) => {
    pushCandidate(el.getAttribute("href"))
  })

  doc.querySelectorAll("a[href]").forEach((a) => {
    const href = a.getAttribute("href") || ""
    const lower = href.toLowerCase()
    if (!href) return
    if (
      lower.includes("file_id=") ||
      lower.includes("&nmm=1") ||
      lower.includes("?nmm=1") ||
      (lower.includes("/mods/") && lower.includes("tab=files"))
    ) {
      pushCandidate(href)
    }
  })

  const htmlCandidates = [...htmlString.matchAll(/https?:\/\/(?:www\.)?nexusmods\.com\/[^\s"']*?(?:file_id|nmm=1)[^"'\s]*/gi)].map(match => match[0])
  htmlCandidates.forEach(pushCandidate)

  doc.querySelectorAll("[data-file-id][href]").forEach((el) => {
    const fileId = el.getAttribute("data-file-id")
    if (!fileId) return
    const fileIdDigits = fileId.trim()
    if (!fileIdDigits) return
    if (hrefCandidates.size === 0 && normalizedNexusUrl) {
      const base = normalizedNexusUrl.split("?")[0]
      hrefCandidates.add(`${base}?tab=files&file_id=${encodeURIComponent(fileIdDigits)}&nmm=1`)
    }
  })

  const rawFileIdMatches = [...htmlString.matchAll(/file_id\s*=\s*([0-9]{3,})/gi)]
  if (rawFileIdMatches.length > 0 && hrefCandidates.size === 0 && normalizedNexusUrl) {
    const base = normalizedNexusUrl.split("?")[0]
    hrefCandidates.add(`${base}?tab=files&file_id=${rawFileIdMatches[0][1]}&nmm=1`)
  }

  const candidates = [...hrefCandidates]
  const directZip = candidates.find((item) => item.toLowerCase().includes(".zip") && (item.includes("file_id") || item.includes("nmm=1")))
  if (directZip) return directZip

  const nmmCandidate = candidates.find(item => item.includes("nmm=1") && item.includes("file_id"))
  if (nmmCandidate) return nmmCandidate

  const fileApi = candidates.find(item => item.includes("file_id"))
  return fileApi || candidates[0] || ""
}

function extractDependencies(htmlString: string): NexusDependencyGroup[] {
  const parser = new DOMParser()
  const doc = parser.parseFromString(htmlString, "text/html")
  const allGroups: NexusDependencyGroup[] = []

  // Primary: parse from <main-file-requirements> web component's download-links attribute
  const requirementEls = doc.querySelectorAll("main-file-requirements[download-links]")
  requirementEls.forEach(el => {
    const raw = el.getAttribute("download-links")
    if (!raw) return
    try {
      const data = JSON.parse(raw)
      if (Array.isArray(data.dependencies)) {
        for (const group of data.dependencies) {
          if (Array.isArray(group.files) && group.files.length > 0) {
            allGroups.push({ files: group.files })
          }
        }
      }
    } catch {
      // ignore parse errors
    }
  })

  // Deduplicate by file uid across all groups
  const seenUids = new Set<number>()
  const dedupedGroups: NexusDependencyGroup[] = []
  for (const group of allGroups) {
    const uniqueFiles = group.files.filter(f => {
      if (seenUids.has(f.uid)) return false
      seenUids.add(f.uid)
      return true
    })
    if (uniqueFiles.length > 0) {
      dedupedGroups.push({ files: uniqueFiles })
    }
  }

  return dedupedGroups
}

export function parseHtml(htmlString: string, mod: SmapiMod | null, nexusUrl: string): ParsedModDetails {
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
      const clone = item.cloneNode(true) as HTMLElement
      clone.querySelector("h3")?.remove()
      author = clone.textContent?.trim() || ""
    }
  })
  if (!author) author = doc.querySelector(".author-name")?.textContent?.trim() || ""
  if (!author) author = doc.querySelector(".member-name a")?.textContent?.trim() || ""
  if (!author) author = mod ? mod.Author : "未知作者"
  author = author.replace(/^created by\s+/i, "").trim()

  // 3. Extract Gallery Images from thumbgallery
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

  // 4. Extract Full Description
  const sanitizeDescriptionHtml = (html: string) => {
    const safeDoc = parser.parseFromString(`<div>${html}</div>`, "text/html")
    const tempContainer = safeDoc.body.firstElementChild
    if (!tempContainer) return html

    tempContainer.querySelectorAll("*").forEach(el => {
      const node = el as HTMLElement
      const style = node.getAttribute("style")
      if (!style) return

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
    const removeSelectors = [
      "h2", ".modhistory", "ul.actions", ".accordionitems",
      "script", ".share-button", "share-button", ".report-abuse-btn",
      ".clearfix:empty"
    ]
    clone.querySelectorAll(removeSelectors.join(",")).forEach(el => el.remove())
    description = sanitizeDescriptionHtml(clone.innerHTML?.trim() || "")
  }
  condensedDescription = sanitizeDescriptionHtml(doc.querySelector(".container.mod_description_container.condensed")?.innerHTML || "")
  if (!description) description = sanitizeDescriptionHtml(doc.querySelector("#description-content")?.innerHTML || "")
  if (!description) description = sanitizeDescriptionHtml(doc.querySelector(".mod-description")?.innerHTML || "")
  if (!description) description = sanitizeDescriptionHtml(doc.querySelector("#description")?.innerHTML || "")
  if (!description) {
    description = doc.querySelector('meta[property="og:description"]')?.getAttribute("content") || "暂无详细描述。"
  }

  // 5. Extract Stats
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
  const downloadUrl = extractDownloadUrl(htmlString, nexusUrl)

  // 6. Extract Dependencies
  const dependencies = extractDependencies(htmlString)

  // 7. Extract Last Updated
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
    downloadUrl,
    dependencies
  }
}
