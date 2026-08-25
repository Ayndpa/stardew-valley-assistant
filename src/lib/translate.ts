// Edge Translate state
export interface TranslateState {
  titleTranslated: string | null
  descriptionTranslated: string | null
  titleLoading: boolean
  descLoading: boolean
  error: string | null
}

// 微软已下线 edge.microsoft.com/translate/auth（返回 404），新接口免鉴权，
// 直接 POST 一个字符串数组即可，返回结构与旧的 cognitive 接口一致。
const EDGE_TRANSLATE_ENDPOINT = "https://edge.microsoft.com/translate/translatetext"

export async function edgeTranslate(texts: string[], to: string): Promise<string[]> {
  if (texts.length === 0) return []

  const resp = await fetch(
    `${EDGE_TRANSLATE_ENDPOINT}?from=en&to=${encodeURIComponent(to)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(texts),
    }
  )
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "")
    throw new Error(`翻译请求失败 (${resp.status})${detail ? `: ${detail}` : ""}`)
  }

  const data = await resp.json()
  if (!Array.isArray(data)) {
    throw new Error("翻译接口返回了非预期的数据结构")
  }
  // 单条译文缺失时回退原文，避免整批作废
  return data.map((item: any, index: number) => item?.translations?.[0]?.text ?? texts[index])
}

// Strip HTML tags for translation, then re-apply
export function stripHtml(html: string): { plain: string; tagMap: { index: number; tag: string }[] } {
  const tagMap: { index: number; tag: string }[] = []
  let plain = ""
  let i = 0
  while (i < html.length) {
    if (html[i] === "<") {
      const end = html.indexOf(">", i)
      if (end !== -1) {
        tagMap.push({ index: plain.length, tag: html.substring(i, end + 1) })
        i = end + 1
        continue
      }
    }
    // decode common HTML entities
    if (html.substring(i, i + 4) === "&nbsp;") { plain += " "; i += 6; continue }
    if (html.substring(i, i + 4) === "&amp;") { plain += "&"; i += 5; continue }
    if (html.substring(i, i + 3) === "&lt;") { plain += "<"; i += 4; continue }
    if (html.substring(i, i + 4) === "&gt;") { plain += ">"; i += 4; continue }
    if (html.substring(i, i + 6) === "&quot;") { plain += '"'; i += 6; continue }
    plain += html[i]
    i++
  }
  return { plain, tagMap }
}

export function restoreHtml(translated: string, tagMap: { index: number; tag: string }[]): string {
  // Simple approach: re-insert tags at approximate positions
  let result = translated
  // We insert tags from back to front to avoid index shifting
  for (let i = tagMap.length - 1; i >= 0; i--) {
    const { index, tag } = tagMap[i]
    if (index <= result.length) {
      result = result.substring(0, index) + tag + result.substring(index)
    }
  }
  return result
}

export async function translateHtmlTextOnly(html: string, toLanguage: string) {
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

