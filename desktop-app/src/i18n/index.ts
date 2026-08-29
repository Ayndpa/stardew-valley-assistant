import i18n from "i18next"
import { initReactI18next } from "react-i18next"
import LanguageDetector from "i18next-browser-languagedetector"

// 两份语言包各约 85–90 KB，静态 import 会把它们一起打进启动就要解析的主 chunk。
// 改为按需加载：启动只取当前语言，切换语言时再拉另一份。
const loaders: Record<string, () => Promise<{ default: Record<string, unknown> }>> = {
  zh: () => import("./locales/zh/translation.json"),
  en: () => import("./locales/en/translation.json"),
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
  const mod = await loaders[code]()
  i18n.addResourceBundle(code, "translation", mod.default, true, true)
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
  const initialBundle = await loaders[initialLanguage]()
  loaded.add(initialLanguage)

  await i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      resources: {
        [initialLanguage]: { translation: initialBundle.default },
      },
      lng: initialLanguage,
      fallbackLng: FALLBACK,
      supportedLngs: SUPPORTED,
      interpolation: {
        escapeValue: false, // react already safes from xss
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
