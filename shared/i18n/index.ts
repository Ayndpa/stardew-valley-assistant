/**
 * 两端共用的 `social.*` 词条。
 * 语言包本身很大，所以和各端一样按语言按需加载；各端自己的语言包可以在
 * `social` 下补充或覆盖平台专有的文案（例如手机端的底部导航、VPN 授权提示）。
 */

type Json = Record<string, unknown>

const socialLoaders: Record<string, () => Promise<{ default: Json }>> = {
  zh: () => import("./locales/zh/social.json"),
  en: () => import("./locales/en/social.json"),
}

export const SHARED_SOCIAL_LANGUAGES = Object.keys(socialLoaders)

/** 取某个语言的共享 social 词条；未收录的语言回退到中文 */
export async function loadSharedSocial(lng: string): Promise<Json> {
  const loader = socialLoaders[lng] ?? socialLoaders.zh
  const mod = await loader()
  return mod.default
}

function isPlainObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** 深合并：override 里出现的叶子覆盖 base，其余保留 base */
export function deepMerge(base: Json, override: Json): Json {
  const out: Json = { ...base }
  for (const [key, value] of Object.entries(override)) {
    const current = out[key]
    out[key] = isPlainObject(current) && isPlainObject(value) ? deepMerge(current, value) : value
  }
  return out
}

/**
 * 把共享 social 词条合并进某端的语言包：
 * 该端语言包里的 `social` 节点作为覆盖层，缺省时直接使用共享版本。
 */
export function withSharedSocial(appBundle: Json, sharedSocial: Json): Json {
  const own = isPlainObject(appBundle.social) ? appBundle.social : {}
  return { ...appBundle, social: deepMerge(sharedSocial, own) }
}
