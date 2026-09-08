import type { TFunction } from "i18next"
import { isAccountApiError } from "./api"

/** 把 API / 网络错误转换为可展示的文案：已知 code / 状态码走 i18n，其余回退到服务端返回的 message */
export function describeError(err: unknown, t: TFunction, fallbackKey = "social.errors.generic"): string {
  if (isAccountApiError(err)) {
    if (err.status === 0) return t("social.errors.network")
    if (err.status === 401) return t("social.errors.unauthorized")
    if (err.code) {
      const key = `social.errors.${err.code}`
      const translated = t(key)
      if (translated !== key) return translated
    }
    if (err.message && !err.message.startsWith("HTTP ")) return err.message
    return t(fallbackKey)
  }
  if (err instanceof Error) {
    // 我们自定义的错误把 i18n key 放在 message 里
    if (err.message.startsWith("social.")) {
      const translated = t(err.message)
      if (translated !== err.message) return translated
    }
    return err.message || t(fallbackKey)
  }
  return t(fallbackKey)
}
