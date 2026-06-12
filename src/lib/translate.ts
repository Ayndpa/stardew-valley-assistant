// Edge Translate state
export interface TranslateState {
  titleTranslated: string | null
  descriptionTranslated: string | null
  titleLoading: boolean
  descLoading: boolean
  error: string | null
}

// Edge Translate token cache
let edgeTokenCache: { token: string; expiry: number } | null = null

export async function getEdgeToken(): Promise<string> {
  if (edgeTokenCache && Date.now() < edgeTokenCache.expiry) {
    return edgeTokenCache.token
  }
  const resp = await fetch("https://edge.microsoft.com/translate/auth")
  if (!resp.ok) throw new Error("获取 Edge 翻译令牌失败")
  const token = await resp.text()
  edgeTokenCache = { token, expiry: Date.now() + 8 * 60 * 1000 } // ~10min, refresh at 8min
  return token
}

export async function edgeTranslate(texts: string[], to: string): Promise<string[]> {
  const token = await getEdgeToken()
  const resp = await fetch(
    `https://api-edge.cognitive.microsofttranslator.com/translate?api-version=3.0&from=en&to=${to}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(texts.map(t => ({ Text: t }))),
    }
  )
  if (!resp.ok) throw new Error("翻译请求失败")
  const data = await resp.json()
  return data.map((item: any) => item.translations[0].text as string)
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
