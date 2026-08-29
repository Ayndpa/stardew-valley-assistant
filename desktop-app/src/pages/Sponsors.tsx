import { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { Heart, Sparkles, AlertCircle, Calendar, Gift, ExternalLink, RefreshCw } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

interface SponsorPlan {
  name: string
  price: string
}

interface SponsorUser {
  user_id: string
  name: string
  avatar: string
}

interface SponsorItem {
  sponsor_plans: SponsorPlan[]
  current_plan: {
    name: string
  }
  all_sum_amount: string
  first_pay_time: number
  last_pay_time: number
  user: SponsorUser
}

interface ApiResponse {
  ec: number
  em: string
  data: {
    list: SponsorItem[]
    total_count: number
    total_page: number
  }
}

export function Sponsors() {
  const { t } = useTranslation()
  const [sponsors, setSponsors] = useState<SponsorItem[]>([])
  const [totalCount, setTotalCount] = useState<number>(0)
  const [currentPage, setCurrentPage] = useState<number>(1)
  const [totalPages, setTotalPages] = useState<number>(1)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState<boolean>(false)

  const fetchSponsors = async (page: number, append = false) => {
    if (append) {
      setLoadingMore(true)
    } else {
      setLoading(true)
    }
    setError(null)

    try {
      const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__
      if (isTauri) {
        const { invoke } = await import("@tauri-apps/api/core")
        const jsonStr = await invoke<string>("fetch_afdian_sponsors", { page })
        const res: ApiResponse = JSON.parse(jsonStr)

        if (res.ec === 200) {
          const rawList = res.data.list || []
          const filteredList = rawList.filter((item) => {
            // Filter out sponsors from before 2026 (timestamp 1767225600)
            if (item.first_pay_time < 1767225600) {
              return false
            }

            const planName = item.current_plan?.name || ""
            if (planName === "") {
              return true
            }
            const hasStardewPlan = planName.includes("星露谷") || planName.toLowerCase().includes("stardew")
            const hasStardewSponsorPlan = item.sponsor_plans?.some(p => 
              (p.name || "").includes("星露谷") || (p.name || "").toLowerCase().includes("stardew")
            )
            return hasStardewPlan || hasStardewSponsorPlan
          })

          if (append) {
            setSponsors((prev) => {
              const newList = [...prev, ...filteredList]
              setTotalCount(newList.length)
              return newList
            })
          } else {
            setSponsors(filteredList)
            setTotalCount(filteredList.length)
          }
          setTotalPages(res.data.total_page || 1)
          setCurrentPage(page)
        } else {
          throw new Error(res.em || "Unknown API error")
        }
      } else {
        // Browser mock mode
        await new Promise((resolve) => setTimeout(resolve, 800))
        const mockList: SponsorItem[] = [
          {
            sponsor_plans: [],
            current_plan: { name: "星露谷超级助手方案" },
            all_sum_amount: "50.00",
            first_pay_time: 1780000000, // May 2026
            last_pay_time: 1790000000,
            user: {
              user_id: "mock1",
              name: "艾米莉的老公",
              avatar: "https://pic1.afdiancdn.com/default/avatar/avatar-purple.png",
            },
          },
          {
            sponsor_plans: [],
            current_plan: { name: "" },
            all_sum_amount: "20.00",
            first_pay_time: 1718500000, // June 2024 (should be filtered out)
            last_pay_time: 1718500000,
            user: {
              user_id: "mock2",
              name: "塞巴斯蒂安的摩托车",
              avatar: "https://pic1.afdiancdn.com/default/avatar/avatar-blue.png",
            },
          },
          {
            sponsor_plans: [],
            current_plan: { name: "超级星露谷助手" },
            all_sum_amount: "5.00",
            first_pay_time: 1792000000, // Oct 2026
            last_pay_time: 1792000000,
            user: {
              user_id: "mock3",
              name: "姜岛椰子树",
              avatar: "https://pic1.afdiancdn.com/default/avatar/avatar-orange.png",
            },
          },
        ]
        const filtered = mockList.filter((item) => {
          // Filter out sponsors from before 2026 (timestamp 1767225600)
          if (item.first_pay_time < 1767225600) {
            return false
          }
          const planName = item.current_plan?.name || ""
          if (planName === "") {
            return true
          }
          return planName.includes("星露谷") || planName.toLowerCase().includes("stardew")
        })
        setSponsors(filtered)
        setTotalCount(filtered.length)
        setTotalPages(1)
      }
    } catch (err) {
      console.error("Fetch sponsors error:", err)
      setError(t("sponsors.error"))
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    fetchSponsors(1)
  }, [])

  const handleLoadMore = () => {
    if (currentPage < totalPages && !loadingMore) {
      fetchSponsors(currentPage + 1, true)
    }
  }

  const handleSupport = async () => {
    const url = "https://afdian.com/a/Ayndpa"
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener")
      await openUrl(url)
    } catch {
      window.open(url, "_blank")
    }
  }

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    })
  }

  // Get status color based on amount sponsored
  const getSumColorClass = (amount: string) => {
    const val = parseFloat(amount)
    if (val >= 100) return "from-rose-500 to-amber-500 text-transparent bg-clip-text font-black"
    if (val >= 50) return "text-amber-500 font-extrabold"
    if (val >= 20) return "text-purple-500 font-bold"
    return "text-muted-foreground font-semibold"
  }

  return (
    <div className="p-8 space-y-8 max-w-6xl mx-auto">
      {/* Decorative Warm Header */}
      <div className="relative overflow-hidden rounded-3xl border border-rose-500/20 bg-gradient-to-br from-rose-500/10 via-amber-500/5 to-transparent p-8 md:p-12 shadow-md">
        <div className="absolute top-0 right-0 -mt-10 -mr-10 h-40 w-40 rounded-full bg-rose-500/10 blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 -mb-10 -ml-10 h-40 w-40 rounded-full bg-amber-500/10 blur-3xl pointer-events-none" />
        
        <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-4 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-rose-500/10 border border-rose-500/25 text-rose-600 dark:text-rose-400 text-xs font-semibold animate-pulse">
              <Heart className="h-3 w-3 fill-rose-500" />
              Special Thanks
            </div>
            <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight bg-gradient-to-r from-rose-600 to-amber-600 bg-clip-text text-transparent">
              {t("sponsors.title")}
            </h1>
            <p className="text-muted-foreground text-sm md:text-base leading-relaxed">
              {t("sponsors.description")}
            </p>
            {totalCount > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground/90 font-medium">
                <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                <span>{t("sponsors.totalSponsors", { count: totalCount })}</span>
              </div>
            )}
          </div>
          
          <Button
            size="lg"
            onClick={handleSupport}
            className="shrink-0 bg-gradient-to-r from-rose-500 to-amber-500 hover:from-rose-600 hover:to-amber-600 text-white font-bold rounded-2xl shadow-lg shadow-rose-500/20 hover:shadow-rose-500/30 transition-all duration-300 hover:scale-[1.03] active:scale-[0.98] cursor-pointer flex items-center gap-2 border-0"
          >
            <Gift className="h-5 w-5" />
            <span>{t("sponsors.sponsorAfdian")}</span>
            <ExternalLink className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3">
          <RefreshCw className="h-8 w-8 animate-spin text-rose-500" />
          <p className="text-sm text-muted-foreground font-medium animate-pulse">{t("sponsors.loading")}</p>
        </div>
      ) : error ? (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 rounded-2xl border border-destructive/20 bg-destructive/5 p-8 text-center">
          <AlertCircle className="h-12 w-12 text-destructive" />
          <p className="text-sm font-semibold text-foreground">{error}</p>
          <Button variant="outline" size="sm" onClick={() => fetchSponsors(1)} className="mt-2">
            重新尝试
          </Button>
        </div>
      ) : sponsors.length === 0 ? (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border/80 p-8 text-center">
          <Heart className="h-12 w-12 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground font-medium">{t("sponsors.noSponsors")}</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Sponsors Cards Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {sponsors.map((item, index) => {
              const user = item.user
              const planName = item.current_plan?.name
              const isTop = parseFloat(item.all_sum_amount) >= 50

              return (
                <Card 
                  key={`${user.user_id}-${index}`}
                  className={`group relative overflow-hidden transition-all duration-300 hover:scale-[1.02] hover:shadow-xl hover:border-rose-500/30 ${
                    isTop ? 'border-amber-500/30 bg-gradient-to-br from-amber-500/5 via-transparent to-transparent' : 'border-border/60'
                  }`}
                >
                  <CardContent className="p-5 flex gap-4 items-center">
                    {/* Glow effect for hover */}
                    <div className="absolute inset-0 bg-gradient-to-br from-rose-500/0 via-rose-500/0 to-amber-500/0 group-hover:from-rose-500/5 group-hover:to-amber-500/5 transition-all duration-500 pointer-events-none" />
                    
                    {/* Avatar */}
                    <div className="relative shrink-0">
                      <img
                        src={user.avatar || "https://pic1.afdiancdn.com/default/avatar/default-avatar@2x.png"}
                        alt={user.name}
                        className="h-14 w-14 rounded-2xl object-cover border border-border/80 group-hover:border-rose-500/40 transition-colors"
                        onError={(e) => {
                          e.currentTarget.src = "https://pic1.afdiancdn.com/default/avatar/default-avatar@2x.png"
                        }}
                      />
                      {isTop && (
                        <div className="absolute -top-1.5 -right-1.5 rounded-full bg-amber-500 p-0.5 shadow-md">
                          <Sparkles className="h-3 w-3 text-white fill-white" />
                        </div>
                      )}
                    </div>

                    {/* Sponsor Info */}
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-bold truncate text-foreground group-hover:text-rose-600 dark:group-hover:text-rose-400 transition-colors">
                          {user.name}
                        </span>
                        <span className={`text-xs ${getSumColorClass(item.all_sum_amount)}`}>
                          ¥{parseFloat(item.all_sum_amount).toFixed(0)}
                        </span>
                      </div>
                      
                      {planName ? (
                        <div className="inline-flex items-center gap-1 text-[10px] font-semibold text-rose-500 bg-rose-500/5 dark:bg-rose-500/10 px-2 py-0.5 rounded-full border border-rose-500/10 max-w-full truncate">
                          <Gift className="h-2.5 w-2.5 shrink-0" />
                          <span className="truncate">{planName}</span>
                        </div>
                      ) : (
                        <p className="text-[10px] text-muted-foreground/80">
                          {t("sponsors.plan")}: —
                        </p>
                      )}
                      
                      <div className="flex items-center gap-1 text-[10px] text-muted-foreground/75">
                        <Calendar className="h-2.5 w-2.5 shrink-0" />
                        <span className="truncate">{formatDate(item.first_pay_time)}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>

          {/* Load More Button */}
          {currentPage < totalPages && (
            <div className="flex justify-center pt-6">
              <Button
                onClick={handleLoadMore}
                disabled={loadingMore}
                variant="outline"
                className="rounded-xl px-6 py-5 border-rose-500/20 hover:border-rose-500/50 text-rose-600 dark:text-rose-400 hover:bg-rose-500/5 cursor-pointer font-semibold flex items-center gap-2"
              >
                {loadingMore ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                <span>{t("sponsors.loadMore")}</span>
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
