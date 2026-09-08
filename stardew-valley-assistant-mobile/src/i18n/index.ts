import i18n from "i18next"
import { initReactI18next } from "react-i18next"
import LanguageDetector from "i18next-browser-languagedetector"
import { loadSharedSocial, withSharedSocial } from "@shared/i18n"

// 与桌面端一致的按需加载：启动只解析当前语言的语言包，切换语言时再拉另一份，
// 避免把所有语言塞进首屏 chunk（移动端首屏解析成本更敏感）。
const loaders: Record<string, () => Promise<{ default: Record<string, unknown> }>> = {
  zh: () => import("./locales/zh/translation.json"),
  en: () => import("./locales/en/translation.json"),
}

/** social.* 主体词条与桌面端共用；本端语言包里的 social 节点只放移动端专有 / 需要改写的条目 */
async function loadBundle(code: string): Promise<Record<string, unknown>> {
  const [own, social] = await Promise.all([loaders[code](), loadSharedSocial(code)])
  return withSharedSocial(own.default, social)
}

const SUPPORTED = Object.keys(loaders)
const FALLBACK = "zh"

function normalize(lng: string | undefined): string {
  if (!lng) return FALLBACK
  const lower = lng.toLowerCase()
  return SUPPORTED.find((code) => lower.startsWith(code)) || FALLBACK
}

const loaded = new Set<string>()

async function ensureBundle(lng: string) {
  const code = normalize(lng)
  if (loaded.has(code)) return code
  i18n.addResourceBundle(code, "translation", await loadBundle(code), true, true)
  loaded.add(code)
  return code
}

function detectInitialLanguage(): string {
  try {
    const stored = localStorage.getItem("i18nextLng")
    if (stored) return normalize(stored)
  } catch {
    // 忽略：无法访问 localStorage 时退回浏览器语言
  }
  return normalize(typeof navigator !== "undefined" ? navigator.language : undefined)
}

/** 在渲染 React 之前调用：先备好当前语言的资源，避免首帧闪出原始 key。 */
export async function initI18n() {
  const initialLanguage = detectInitialLanguage()
  const initialBundle = await loadBundle(initialLanguage)
  loaded.add(initialLanguage)

  await i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      resources: {
        [initialLanguage]: { translation: initialBundle },
      },
      lng: initialLanguage,
      fallbackLng: FALLBACK,
      supportedLngs: SUPPORTED,
      interpolation: {
        escapeValue: false, // React 自身已做转义
      },
      detection: {
        order: ["localStorage", "navigator"],
        caches: ["localStorage"],
      },
    })

  // 切换到尚未加载的语言时补齐资源
  i18n.on("languageChanged", (lng) => {
    const code = normalize(lng)
    if (loaded.has(code)) return
    void ensureBundle(code).then(() => i18n.changeLanguage(code))
  })

  return i18n
}

export default i18n
