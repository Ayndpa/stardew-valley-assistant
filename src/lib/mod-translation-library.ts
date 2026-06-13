import type { Mod } from "@/components/mods/ModList"
import type { SmapiMod } from "@/components/mods/OnlineMods"
import { edgeTranslate, translateHtmlTextOnly } from "@/lib/translate"

const SUPABASE_URL = "https://mrmllvptnjlggskghkka.supabase.co"
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1ybWxsdnB0bmpsZ2dza2doa2thIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzNTg0MDMsImV4cCI6MjA5NjkzNDQwM30.GUnNkZN4dCAm27TyGzpSFYf7SWqJiIA60IzwqITMH70"

const MODS_CATEGORY = "Mods"
const TARGET_LANGUAGE = "zh-CN"
const TRANSLATION_CACHE_KEY = "mod_translation_library_cache_v1"
const TRANSLATION_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

type TranslationCategory = {
  id: string
  name: string
}

type TranslationKey = {
  id: string
  key_path: string
  category_id: string
}

type Translation = {
  key_id: string
  language_code: string
  content: string
}

type TranslationCache = Record<string, { content: string; expiresAt: number }>

type SyncStats = {
  applied: number
  submitted: number
}

export type ModTranslationSyncResult = {
  mods: Mod[]
  stats: SyncStats
}

export type OnlineModTranslationSyncResult = {
  mods: SmapiMod[]
  stats: SyncStats
}

export type NexusModNameTranslationSyncResult<T extends { nexusId: string; name: string }> = {
  mods: T[]
  stats: SyncStats
}

type TranslationFieldRequest = {
  id: string
  label: string
  field: "name" | "description"
  fallbackContent: string
  html?: boolean
}

type TranslationFieldResult = {
  id: string
  field: "name" | "description"
  content: string
  applied: number
  submitted: number
}

let translationCacheMemory: TranslationCache | null = null

function supabaseHeaders(extra?: HeadersInit) {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  }
}

async function supabaseRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: supabaseHeaders(init?.headers),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(`Supabase request failed (${response.status}): ${body || response.statusText}`)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return response.json() as Promise<T>
}

function readTranslationCache() {
  if (translationCacheMemory) return translationCacheMemory

  try {
    const raw = localStorage.getItem(TRANSLATION_CACHE_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    translationCacheMemory = parsed && typeof parsed === "object" ? parsed as TranslationCache : {}
  } catch {
    translationCacheMemory = {}
  }

  return translationCacheMemory
}

function writeTranslationCache(cache: TranslationCache) {
  translationCacheMemory = cache
  try {
    localStorage.setItem(TRANSLATION_CACHE_KEY, JSON.stringify(cache))
  } catch {}
}

function getCachedTranslation(keyPath: string) {
  const cache = readTranslationCache()
  const cached = cache[`${TARGET_LANGUAGE}:${keyPath}`]
  if (!cached) return null
  if (cached.expiresAt <= Date.now()) {
    delete cache[`${TARGET_LANGUAGE}:${keyPath}`]
    writeTranslationCache(cache)
    return null
  }
  return cached.content
}

function setCachedTranslation(keyPath: string, content: string) {
  const cache = readTranslationCache()
  cache[`${TARGET_LANGUAGE}:${keyPath}`] = {
    content,
    expiresAt: Date.now() + TRANSLATION_CACHE_TTL_MS,
  }
  writeTranslationCache(cache)
}

async function findCategory(name: string) {
  const rows = await supabaseRequest<TranslationCategory[]>(
    `translation_categories?select=id,name&name=eq.${encodeURIComponent(name)}&limit=1`
  )
  return rows[0] ?? null
}

async function createCategory(name: string) {
  const rows = await supabaseRequest<TranslationCategory[]>("translation_categories?select=id,name", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ name }),
  })
  return rows[0] ?? null
}

async function ensureCategory(name: string) {
  const existing = await findCategory(name)
  if (existing) return existing

  try {
    return await createCategory(name)
  } catch (error) {
    const createdByAnotherClient = await findCategory(name)
    if (createdByAnotherClient) return createdByAnotherClient
    throw error
  }
}

function postgrestInList(values: string[]) {
  return `(${values.map((value) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")})`
}

async function findTranslationKeys(categoryId: string, keyPaths: string[]) {
  if (keyPaths.length === 0) return []
  return supabaseRequest<TranslationKey[]>(
    `translation_keys?select=id,key_path,category_id&category_id=eq.${encodeURIComponent(categoryId)}&key_path=in.${encodeURIComponent(postgrestInList(keyPaths))}`
  )
}

async function createTranslationKeys(categoryId: string, requests: TranslationFieldRequest[]) {
  if (requests.length === 0) return

  await supabaseRequest<TranslationKey[]>("translation_keys?on_conflict=category_id,key_path", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify(
      requests.map((request) => ({
        category_id: categoryId,
        key_path: modKeyPath(request.id, request.field),
        description: `${request.label} ${request.field}`,
      }))
    ),
  })
}

async function findTranslations(keyIds: string[], languageCode: string) {
  if (keyIds.length === 0) return []
  return supabaseRequest<Translation[]>(
    `translations?select=key_id,language_code,content&language_code=eq.${encodeURIComponent(languageCode)}&key_id=in.${encodeURIComponent(postgrestInList(keyIds))}`
  )
}

async function createTranslations(rows: Translation[]) {
  if (rows.length === 0) return
  await supabaseRequest<Translation[]>("translations?on_conflict=key_id,language_code", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify(rows),
  })
}

function modKeyPath(id: string, field: "name" | "description") {
  return `mods.${id}.${field}`
}

async function resolveTranslatedFields(categoryId: string, requests: TranslationFieldRequest[]) {
  if (requests.length === 0) return []

  const results: TranslationFieldResult[] = []
  const uncachedRequests: TranslationFieldRequest[] = []

  for (const request of requests) {
    const keyPath = modKeyPath(request.id, request.field)
    const cached = getCachedTranslation(keyPath)
    if (cached?.trim()) {
      results.push({
        id: request.id,
        field: request.field,
        content: cached,
        applied: 1,
        submitted: 0,
      })
    } else {
      uncachedRequests.push(request)
    }
  }

  if (uncachedRequests.length === 0) return results

  const keyPaths = uncachedRequests.map((request) => modKeyPath(request.id, request.field))
  let keys: TranslationKey[] = []
  try {
    keys = await findTranslationKeys(categoryId, keyPaths)
  } catch (error) {
    console.error("Failed to load translation keys:", error)
    return results.concat(await machineTranslateRequests(uncachedRequests))
  }

  const keyByPath = new Map(keys.map((key) => [key.key_path, key]))

  const missingKeyRequests = uncachedRequests.filter((request) => !keyByPath.has(modKeyPath(request.id, request.field)))
  if (missingKeyRequests.length > 0) {
    try {
      await createTranslationKeys(categoryId, missingKeyRequests)
      keys = await findTranslationKeys(categoryId, keyPaths)
    } catch (error) {
      console.error("Failed to create translation keys:", error)
      return results.concat(await machineTranslateRequests(uncachedRequests))
    }
  }

  const refreshedKeyByPath = new Map(keys.map((key) => [key.key_path, key]))
  let translations: Translation[] = []
  try {
    translations = await findTranslations(keys.map((key) => key.id), TARGET_LANGUAGE)
  } catch (error) {
    console.error("Failed to load translations:", error)
    return results.concat(await machineTranslateRequests(uncachedRequests))
  }

  const translationByKeyId = new Map(translations.map((translation) => [translation.key_id, translation]))
  const translationsToCreate: Translation[] = []

  for (const request of uncachedRequests) {
    const keyPath = modKeyPath(request.id, request.field)
    const key = refreshedKeyByPath.get(keyPath)
    if (!key) {
      results.push(await machineTranslateRequest(request))
      continue
    }

    const existing = translationByKeyId.get(key.id)
    if (existing?.content?.trim()) {
      setCachedTranslation(keyPath, existing.content)
      results.push({
        id: request.id,
        field: request.field,
        content: existing.content,
        applied: 1,
        submitted: 0,
      })
      continue
    }

    const translatedFallbackContent = await machineTranslateText(request.fallbackContent, { html: request.html })
    if (translatedFallbackContent.trim()) {
      translationsToCreate.push({
        key_id: key.id,
        language_code: TARGET_LANGUAGE,
        content: translatedFallbackContent,
      })
      setCachedTranslation(keyPath, translatedFallbackContent)
    }
    results.push({
      id: request.id,
      field: request.field,
      content: translatedFallbackContent,
      applied: 0,
      submitted: translatedFallbackContent.trim() ? 1 : 0,
    })
  }

  try {
    await createTranslations(translationsToCreate)
  } catch (error) {
    console.error("Failed to submit translations:", error)
  }
  return results
}

async function machineTranslateRequests(requests: TranslationFieldRequest[]) {
  const results: TranslationFieldResult[] = []
  for (const request of requests) {
    results.push(await machineTranslateRequest(request))
  }
  return results
}

async function machineTranslateRequest(request: TranslationFieldRequest): Promise<TranslationFieldResult> {
  const keyPath = modKeyPath(request.id, request.field)
  const translatedFallbackContent = await machineTranslateText(request.fallbackContent, { html: request.html })

  if (translatedFallbackContent.trim()) {
    setCachedTranslation(keyPath, translatedFallbackContent)
  }

  return {
    id: request.id,
    field: request.field,
    content: translatedFallbackContent,
    applied: 0,
    submitted: 0,
  }
}

function shouldMachineTranslate(text: string) {
  const trimmed = text.trim()
  if (!trimmed) return false
  return !/[\u3400-\u9fff]/.test(trimmed)
}

async function machineTranslateText(text: string, options?: { html?: boolean }) {
  if (!shouldMachineTranslate(text)) return text
  try {
    if (options?.html) {
      return await translateHtmlTextOnly(text, "zh-Hans")
    }
    const [translatedText] = await edgeTranslate([text], "zh-Hans")
    return translatedText || text
  } catch (error) {
    console.error("Failed to machine translate mod fields:", error)
    return text
  }
}

export async function syncModTranslations(mods: Mod[]): Promise<ModTranslationSyncResult> {
  if (mods.length === 0) {
    return { mods, stats: { applied: 0, submitted: 0 } }
  }

  const category = await ensureCategory(MODS_CATEGORY)
  if (!category) {
    throw new Error("无法初始化 Mods 翻译分类")
  }

  let applied = 0
  let submitted = 0
  const requests: TranslationFieldRequest[] = mods.flatMap((mod) => [
    {
      id: mod.id,
      label: mod.englishName || mod.id,
      field: "name",
      fallbackContent: mod.name,
    },
    {
      id: mod.id,
      label: mod.englishName || mod.id,
      field: "description",
      fallbackContent: mod.description,
    },
  ])
  const fieldResults = await resolveTranslatedFields(category.id, requests)
  const resultByKey = new Map(fieldResults.map((result) => [`${result.id}:${result.field}`, result]))

  const translatedMods = mods.map((mod) => {
    const nameResult = resultByKey.get(`${mod.id}:name`)
    const descriptionResult = resultByKey.get(`${mod.id}:description`)

    applied += (nameResult?.applied ?? 0) + (descriptionResult?.applied ?? 0)
    submitted += (nameResult?.submitted ?? 0) + (descriptionResult?.submitted ?? 0)
    return {
      ...mod,
      name: nameResult?.content ?? mod.name,
      description: descriptionResult?.content ?? mod.description,
    }
  })

  return { mods: translatedMods, stats: { applied, submitted } }
}

function getOnlineModTranslationId(mod: SmapiMod) {
  return mod.Id?.[0] || mod.Slug || mod.Name
}

export async function syncOnlineModTranslations(mods: SmapiMod[]): Promise<OnlineModTranslationSyncResult> {
  if (mods.length === 0) {
    return { mods, stats: { applied: 0, submitted: 0 } }
  }

  const category = await ensureCategory(MODS_CATEGORY)
  if (!category) {
    throw new Error("无法初始化 Mods 翻译分类")
  }

  let applied = 0
  let submitted = 0
  const requests: TranslationFieldRequest[] = []

  mods.forEach((mod) => {
    const id = getOnlineModTranslationId(mod)
    requests.push({
      id,
      label: mod.Name,
      field: "name",
      fallbackContent: mod.Name,
    })

    if (mod.Compatibility?.Summary) {
      requests.push({
        id,
        label: mod.Name,
        field: "description",
        fallbackContent: mod.Compatibility.Summary,
        html: true,
      })
    }
  })

  const fieldResults = await resolveTranslatedFields(category.id, requests)
  const resultByKey = new Map(fieldResults.map((result) => [`${result.id}:${result.field}`, result]))

  const translatedMods = mods.map((mod) => {
    const id = getOnlineModTranslationId(mod)
    const nameResult = resultByKey.get(`${id}:name`)
    const summaryResult = resultByKey.get(`${id}:description`)

    applied += (nameResult?.applied ?? 0) + (summaryResult?.applied ?? 0)
    submitted += (nameResult?.submitted ?? 0) + (summaryResult?.submitted ?? 0)
    return {
      ...mod,
      Name: nameResult?.content ?? mod.Name,
      Compatibility: mod.Compatibility
        ? {
            ...mod.Compatibility,
            Summary: summaryResult?.content ?? mod.Compatibility.Summary,
          }
        : mod.Compatibility,
    }
  })

  return { mods: translatedMods, stats: { applied, submitted } }
}

export async function syncNexusModNameTranslations<T extends { nexusId: string; name: string }>(
  mods: T[]
): Promise<NexusModNameTranslationSyncResult<T>> {
  if (mods.length === 0) {
    return { mods, stats: { applied: 0, submitted: 0 } }
  }

  const category = await ensureCategory(MODS_CATEGORY)
  if (!category) {
    throw new Error("无法初始化 Mods 翻译分类")
  }

  const requests: TranslationFieldRequest[] = mods.map((mod) => ({
    id: `nexus.${mod.nexusId}`,
    label: mod.name,
    field: "name",
    fallbackContent: mod.name,
  }))

  const fieldResults = await resolveTranslatedFields(category.id, requests)
  const resultById = new Map(fieldResults.map((result) => [result.id, result]))
  let applied = 0
  let submitted = 0

  const translatedMods = mods.map((mod) => {
    const result = resultById.get(`nexus.${mod.nexusId}`)
    applied += result?.applied ?? 0
    submitted += result?.submitted ?? 0
    return {
      ...mod,
      name: result?.content ?? mod.name,
    }
  })

  return { mods: translatedMods, stats: { applied, submitted } }
}
