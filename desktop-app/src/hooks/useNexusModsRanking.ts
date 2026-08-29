import { useState, useEffect, useRef, useCallback } from "react"

export interface NexusRankedMod {
  rank: number
  name: string
  author: string
  imageUrl: string
  downloads: string
  endorsements: string
  nexusUrl: string
  nexusId: string
}

interface CachePage {
  mods: NexusRankedMod[]
  totalCount: number
  fetchedAt: number
}

interface QueryCache {
  pages: { [pageNum: number]: CachePage }
}

interface SystemCache {
  [queryKey: string]: QueryCache
}

const getCacheKey = (
  sortField: string,
  sortDirection: string,
  searchQuery: string,
  authorQuery: string = "",
  uploaderQuery: string = ""
) => {
  return `${sortField}_${sortDirection}_${searchQuery.trim().toLowerCase()}_${authorQuery.trim().toLowerCase()}_${uploaderQuery.trim().toLowerCase()}`
}

const getCachedPage = (queryKey: string, pageNum: number): CachePage | null => {
  try {
    const raw = localStorage.getItem("nexus_mods_browse_cache")
    if (!raw) return null
    const cache: SystemCache = JSON.parse(raw)
    return cache[queryKey]?.pages[pageNum] || null
  } catch {
    return null
  }
}

const setCachedPage = (queryKey: string, pageNum: number, mods: NexusRankedMod[], totalCount: number) => {
  try {
    const raw = localStorage.getItem("nexus_mods_browse_cache")
    const cache: SystemCache = raw ? JSON.parse(raw) : {}
    if (!cache[queryKey]) {
      cache[queryKey] = { pages: {} }
    }
    cache[queryKey].pages[pageNum] = {
      mods,
      totalCount,
      fetchedAt: Date.now()
    }
    localStorage.setItem("nexus_mods_browse_cache", JSON.stringify(cache))
  } catch (e) {
    console.error("Failed to write nexus cache:", e)
  }
}

const invalidateSubsequentPages = (queryKey: string) => {
  try {
    const raw = localStorage.getItem("nexus_mods_browse_cache")
    if (!raw) return
    const cache: SystemCache = JSON.parse(raw)
    if (cache[queryKey]) {
      const page1 = cache[queryKey].pages[1]
      cache[queryKey].pages = {}
      if (page1) {
        cache[queryKey].pages[1] = page1
      }
      localStorage.setItem("nexus_mods_browse_cache", JSON.stringify(cache))
    }
  } catch {}
}

async function getTauriInvoke() {
  if (typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__) {
    try {
      const mod = await import("@tauri-apps/api/core")
      return mod.invoke
    } catch (err) {
      console.error("Failed to load Tauri core invoke plugin", err)
    }
  }
  return null
}

async function getTauriListen() {
  if (typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__) {
    try {
      const mod = await import("@tauri-apps/api/event")
      return mod.listen
    } catch (err) {
      console.error("Failed to load Tauri event listen plugin", err)
    }
  }
  return null
}

const MOCK_ALL_MODS = Array.from({ length: 85 }).map((_, idx) => ({
  rank: idx + 1,
  name: `Stardew Mod ${idx + 1} - ${["Expansion", "Helper", "UI Toolkit", "Retexture", "Cheats Menu", "Automation"][idx % 6]}`,
  author: ["FlashShifter", "Pathoschild", "Annosz", "Bouhm", "DaisyNiko"][idx % 5],
  imageUrl: "",
  downloads: `${(100 - idx * 1.1).toFixed(1)}K`,
  endorsements: `${(5000 - idx * 55)}`,
  nexusUrl: `https://www.nexusmods.com/stardewvalley/mods/${1000 + idx}`,
  nexusId: String(1000 + idx),
  createdAt: Date.now() - idx * 24 * 3600 * 1000,
  updatedAt: Date.now() - (idx % 3) * 24 * 3600 * 1000,
}))

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M"
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K"
  return n.toString()
}

function mapGraphQLToRanking(graphqlData: any, offset: number): NexusRankedMod[] {
  const nodes: any[] = graphqlData?.data?.mods?.nodes ?? graphqlData?.mods?.nodes ?? []
  return nodes
    .filter((n: any) => n.modId && n.name)
    .map((node: any, idx: number) => ({
      rank: offset + idx + 1,
      name: node.name || "Unknown",
      author: node.uploader?.name || "Unknown",
      imageUrl: node.thumbnailUrl || "",
      downloads: formatNumber(node.downloads || 0),
      endorsements: formatNumber(node.endorsements || 0),
      nexusUrl: `https://www.nexusmods.com/stardewvalley/mods/${node.modId}`,
      nexusId: String(node.modId),
    }))
}

const verifiedKeysInSession = new Set<string>()
let rankingFetchInProgress = false

let sessionCurrentPage = 1
let sessionSortField = "downloads"
let sessionSearchQuery = ""
let sessionAuthorQuery = ""
let sessionUploaderQuery = ""

export function useNexusModsRanking() {
  const [sortField, setSortField] = useState<string>(() => sessionSortField)
  const [sortDirection] = useState<string>("DESC")
  const [searchQuery, setSearchQuery] = useState<string>(() => sessionSearchQuery)
  const [searchInputValue, setSearchInputValue] = useState<string>(() => sessionSearchQuery)
  const [authorInputValue, setAuthorInputValue] = useState<string>(() => sessionAuthorQuery)
  const [authorQuery, setAuthorQuery] = useState<string>(() => sessionAuthorQuery)
  const [uploaderInputValue, setUploaderInputValue] = useState<string>(() => sessionUploaderQuery)
  const [uploaderQuery, setUploaderQuery] = useState<string>(() => sessionUploaderQuery)
  
  const [currentPage, setCurrentPage] = useState<number>(() => sessionCurrentPage)
  const [totalCount, setTotalCount] = useState<number>(() => {
    const qKey = getCacheKey(sessionSortField, "DESC", sessionSearchQuery)
    const cached = getCachedPage(qKey, sessionCurrentPage)
    return cached ? cached.totalCount : 0
  })
  const [jumpPage, setJumpPage] = useState<string>("")
  const itemsPerPage = 20

  const [ranking, setRanking] = useState<NexusRankedMod[]>(() => {
    const qKey = getCacheKey(sessionSortField, "DESC", sessionSearchQuery)
    const cached = getCachedPage(qKey, sessionCurrentPage)
    return cached ? cached.mods : []
  })

  const [loading, setLoading] = useState(() => {
    const qKey = getCacheKey(sessionSortField, "DESC", sessionSearchQuery)
    const cached = getCachedPage(qKey, sessionCurrentPage)
    return !cached
  })

  const [isBackgroundRefreshing, setIsBackgroundRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scrapeStatus, setScrapeStatus] = useState<"idle" | "loading" | "challenge">("idle")
  
  const unlistenRef = useRef<(() => void) | null>(null)

  const fetchRanking = useCallback(async (
    targetPage: number,
    targetSortField: string,
    targetSortDirection: string,
    targetSearchQuery: string,
    isSilent: boolean,
    targetAuthorQuery: string = "",
    targetUploaderQuery: string = ""
  ) => {
    if (rankingFetchInProgress) {
      return
    }
    rankingFetchInProgress = true

    if (isSilent) {
      setIsBackgroundRefreshing(true)
    } else {
      setLoading(true)
    }
    setError(null)
    setScrapeStatus("loading")

    const targetOffset = (targetPage - 1) * itemsPerPage
    const qKey = getCacheKey(targetSortField, targetSortDirection, targetSearchQuery, targetAuthorQuery, targetUploaderQuery)

    const invoke = await getTauriInvoke()
    const listen = await getTauriListen()

    if (invoke && listen) {
      try {
        if (unlistenRef.current) {
          unlistenRef.current()
          unlistenRef.current = null
        }

        const unlisten = await listen<{
          mods?: any
          error?: string
          status?: string
          offset?: number
          sort_field?: string
          search_query?: string
          name_filter?: string
          author_filter?: string
          uploader_filter?: string
        }>("respond-nexus-ranking-html", (event) => {
          if (event.payload.offset !== undefined && event.payload.offset !== targetOffset) return
          if (event.payload.sort_field !== undefined && event.payload.sort_field !== targetSortField) return
          if (event.payload.name_filter !== undefined && event.payload.name_filter !== targetSearchQuery) return
          if (event.payload.author_filter !== undefined && event.payload.author_filter !== targetAuthorQuery) return
          if (event.payload.uploader_filter !== undefined && event.payload.uploader_filter !== targetUploaderQuery) return

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
            rankingFetchInProgress = false
            setLoading(false)
            setIsBackgroundRefreshing(false)
            if (unlistenRef.current) {
              unlistenRef.current()
              unlistenRef.current = null
            }
            return
          }

          if (!event.payload.mods) {
            setError("未收到 Nexus GraphQL 数据，请重试。")
            rankingFetchInProgress = false
            setLoading(false)
            setIsBackgroundRefreshing(false)
            if (unlistenRef.current) {
              unlistenRef.current()
              unlistenRef.current = null
            }
            return
          }

          const parsed = mapGraphQLToRanking(event.payload.mods, targetOffset)
          const total = event.payload.mods?.data?.mods?.totalCount ?? event.payload.mods?.mods?.totalCount ?? parsed.length
          
          verifiedKeysInSession.add(`${qKey}_p${targetPage}`)

          if (targetPage === 1) {
            const cachedPage1 = getCachedPage(qKey, 1)
            if (cachedPage1) {
              const isSame = cachedPage1.mods.length === parsed.length &&
                cachedPage1.mods.every((m, idx) => m.nexusId === parsed[idx]?.nexusId)
              
              if (isSame) {
                setCachedPage(qKey, 1, parsed, total)
              } else {
                setCachedPage(qKey, 1, parsed, total)
                invalidateSubsequentPages(qKey)
                setRanking(parsed)
                setTotalCount(total)
              }
            } else {
              setCachedPage(qKey, 1, parsed, total)
              setRanking(parsed)
              setTotalCount(total)
            }
          } else {
            setCachedPage(qKey, targetPage, parsed, total)
            setRanking(parsed)
            setTotalCount(total)
          }

          rankingFetchInProgress = false
          setLoading(false)
          setIsBackgroundRefreshing(false)
          setScrapeStatus("idle")

          if (unlistenRef.current) {
            unlistenRef.current()
            unlistenRef.current = null
          }
        })

        unlistenRef.current = unlisten

        await invoke("open_nexus_ranking_scraper", {
          offset: targetOffset,
          sortField: targetSortField,
          sortDirection: targetSortDirection,
          searchQuery: targetSearchQuery,
          nameFilter: targetSearchQuery,
          authorFilter: targetAuthorQuery,
          uploaderFilter: targetUploaderQuery
        })

        setTimeout(() => {
          if (unlistenRef.current) {
            setError("加载超时。这可能是由于网络不稳定或验证未能通过。")
            rankingFetchInProgress = false
            setLoading(false)
            setIsBackgroundRefreshing(false)
            setScrapeStatus("idle")
            unlistenRef.current()
            unlistenRef.current = null
          }
        }, 185000)
      } catch (err: any) {
        console.error("[Ranking] Scraper invocation error:", err)
        setError("启动排行榜抓取器失败: " + err)
        rankingFetchInProgress = false
        setLoading(false)
        setIsBackgroundRefreshing(false)
        setScrapeStatus("idle")
      }
    } else {
      setTimeout(() => {
        let filtered = [...MOCK_ALL_MODS]
        
        if (targetSearchQuery) {
          const s = targetSearchQuery.toLowerCase()
          filtered = filtered.filter(m => m.name.toLowerCase().includes(s))
        }
        if (targetAuthorQuery) {
          const a = targetAuthorQuery.toLowerCase()
          filtered = filtered.filter(m => m.author.toLowerCase().includes(a))
        }
        if (targetUploaderQuery) {
          const u = targetUploaderQuery.toLowerCase()
          filtered = filtered.filter(m => m.author.toLowerCase().includes(u))
        }
        
        if (targetSortField === "downloads") {
          filtered.sort((a, b) => parseFloat(b.downloads) - parseFloat(a.downloads))
        } else if (targetSortField === "endorsements") {
          filtered.sort((a, b) => parseInt(b.endorsements) - parseInt(a.endorsements))
        } else if (targetSortField === "createdAt") {
          filtered.sort((a, b) => b.createdAt - a.createdAt)
        } else if (targetSortField === "updatedAt") {
          filtered.sort((a, b) => b.updatedAt - a.updatedAt)
        }
        
        const mapped = filtered.map((m, idx) => ({
          ...m,
          rank: targetOffset + idx + 1
        }))
        
        const pageMods = mapped.slice(targetOffset, targetOffset + itemsPerPage)
        const total = filtered.length
        
        verifiedKeysInSession.add(`${qKey}_p${targetPage}`)

        if (targetPage === 1) {
          const cachedPage1 = getCachedPage(qKey, 1)
          if (cachedPage1) {
            const isSame = cachedPage1.mods.length === pageMods.length &&
              cachedPage1.mods.every((m, idx) => m.nexusId === pageMods[idx]?.nexusId)
            
            if (isSame) {
              setCachedPage(qKey, 1, pageMods, total)
            } else {
              setCachedPage(qKey, 1, pageMods, total)
              invalidateSubsequentPages(qKey)
              setRanking(pageMods)
              setTotalCount(total)
            }
          } else {
            setCachedPage(qKey, 1, pageMods, total)
            setRanking(pageMods)
            setTotalCount(total)
          }
        } else {
          setCachedPage(qKey, targetPage, pageMods, total)
          setRanking(pageMods)
          setTotalCount(total)
        }
        
        rankingFetchInProgress = false
        setLoading(false)
        setIsBackgroundRefreshing(false)
        setScrapeStatus("idle")
      }, 1000)
    }
  }, [itemsPerPage])

  useEffect(() => {
    sessionCurrentPage = currentPage
    sessionSortField = sortField
    sessionSearchQuery = searchQuery
    sessionAuthorQuery = authorQuery
    sessionUploaderQuery = uploaderQuery

    const qKey = getCacheKey(sortField, sortDirection, searchQuery, authorQuery, uploaderQuery)
    const cached = getCachedPage(qKey, currentPage)
    const sessionKey = `${qKey}_p${currentPage}`

    if (cached) {
      setRanking(cached.mods)
      setTotalCount(cached.totalCount)
      setError(null)
      setLoading(false)

      if (currentPage === 1 && !verifiedKeysInSession.has(sessionKey)) {
        fetchRanking(1, sortField, sortDirection, searchQuery, true, authorQuery, uploaderQuery)
      }
    } else {
      fetchRanking(currentPage, sortField, sortDirection, searchQuery, false, authorQuery, uploaderQuery)
    }
  }, [currentPage, sortField, sortDirection, searchQuery, authorQuery, uploaderQuery, fetchRanking])

  useEffect(() => {
    return () => {
      if (unlistenRef.current) {
        unlistenRef.current()
        unlistenRef.current = null
      }
    }
  }, [])

  const handleSearchSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    setSearchQuery(searchInputValue)
    setAuthorQuery(authorInputValue)
    setUploaderQuery(uploaderInputValue)
    setCurrentPage(1)
  }, [searchInputValue, authorInputValue, uploaderInputValue])

  const totalPages = Math.max(1, Math.ceil(totalCount / itemsPerPage))

  return {
    sortField,
    setSortField,
    searchInputValue,
    setSearchInputValue,
    authorInputValue,
    setAuthorInputValue,
    uploaderInputValue,
    setUploaderInputValue,
    currentPage,
    setCurrentPage,
    jumpPage,
    setJumpPage,
    totalCount,
    ranking,
    loading,
    isBackgroundRefreshing,
    error,
    scrapeStatus,
    handleSearchSubmit,
    totalPages,
  }
}
