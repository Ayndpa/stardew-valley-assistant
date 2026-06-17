import { useState, useEffect } from "react"
import { Info, RefreshCw, CheckCircle, ExternalLink } from "lucide-react"
import { getVersion } from "@tauri-apps/api/app"
import { Separator } from "@/components/ui/separator"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useTranslation } from "react-i18next"
import type { UpdateInfo } from "@/components/UpdateDialog"

interface GitHubUser {
  login: string
  avatar_url: string
  html_url: string
  bio: string | null
  name: string | null
}

interface GitHubRepo {
  name: string
  html_url: string
  description: string | null
  stargazers_count: number
  language: string | null
  fork: boolean
}

async function getTauriInvoke() {
  if (typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__) {
    try {
      const mod = await import("@tauri-apps/api/core");
      return mod.invoke;
    } catch (err) {
      console.error("Failed to load Tauri core invoke plugin", err);
    }
  }
  return null;
}

export function AboutCard({ onUpdateFound }: { onUpdateFound?: (info: UpdateInfo) => void }) {
  const { t } = useTranslation()
  const [appVersion, setAppVersion] = useState<string>("")
  const [checking, setChecking] = useState(false)
  const [upToDate, setUpToDate] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [author, setAuthor] = useState<GitHubUser | null>(null)
  const [authorLoading, setAuthorLoading] = useState(true)
  const [repos, setRepos] = useState<GitHubRepo[]>([])
  const [reposLoading, setReposLoading] = useState(true)

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => setAppVersion(""))
  }, [])

  useEffect(() => {
    const fetchAuthor = async () => {
      try {
        const res = await fetch("https://api.github.com/users/Ayndpa")
        if (res.ok) {
          const data: GitHubUser = await res.json()
          setAuthor(data)
        }
      } catch {
        // Silently ignore — fallback avatar will be used
      } finally {
        setAuthorLoading(false)
      }
    }
    fetchAuthor()
  }, [])

  useEffect(() => {
    const fetchRepos = async () => {
      try {
        const res = await fetch("https://api.github.com/users/Ayndpa/repos?sort=updated&per_page=6")
        if (res.ok) {
          const data: GitHubRepo[] = await res.json()
          setRepos(data.filter(r => !r.fork))
        }
      } catch {
        // Silently ignore
      } finally {
        setReposLoading(false)
      }
    }
    fetchRepos()
  }, [])

  const handleCheckUpdate = async () => {
    setChecking(true)
    setError(null)
    setUpToDate(false)

    try {
      const invoke = await getTauriInvoke()
      if (!invoke) {
        // Browser mock mode
        await new Promise(resolve => setTimeout(resolve, 1000))
        setUpToDate(true)
        return
      }

      const info: UpdateInfo = await invoke("check_for_updates", {
        currentVersion: appVersion,
      })

      if (info.has_update && onUpdateFound) {
        onUpdateFound(info)
      } else if (!info.has_update) {
        setUpToDate(true)
      }
    } catch (err) {
      console.error("Check update error:", err)
      setError(typeof err === "string" ? err : t("settings.about.updateCheckError"))
    } finally {
      setChecking(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Info className="h-5 w-5" />
          {t("settings.about.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{t("settings.about.version")}</span>
          <span>{appVersion || "—"}</span>
        </div>
        <Separator />
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{t("settings.about.framework")}</span>
          <span>Tauri + React</span>
        </div>
        <Separator />
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{t("settings.about.ui")}</span>
          <span>shadcn/ui</span>
        </div>
        <Separator />

        {/* Author Section */}
        <div className="flex items-center gap-4 pt-2">
          {authorLoading ? (
            <div className="h-14 w-14 rounded-full bg-muted animate-pulse shrink-0" />
          ) : (
            <img
              src={author?.avatar_url || "https://github.com/Ayndpa.png"}
              alt="Author avatar"
              className="h-14 w-14 rounded-full border-2 border-primary/20 shadow-sm shrink-0"
              draggable={false}
            />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-tight">
              {author?.name || "Ayndpa"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              @{author?.login || "Ayndpa"}
            </p>
            {author?.bio && (
              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{author.bio}</p>
            )}
          </div>
          <a
            href={author?.html_url || "https://github.com/Ayndpa"}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0"
          >
            <Button variant="outline" size="sm" className="gap-1.5">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
              GitHub
              <ExternalLink className="h-3 w-3" />
            </Button>
          </a>
        </div>

        <Separator />

        {/* Recent Repos Section */}
        <div className="pt-2 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            {t("settings.about.recentProjects")}
          </p>
          {reposLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-12 rounded-lg bg-muted animate-pulse" />
              ))}
            </div>
          ) : repos.length > 0 ? (
            <div className="space-y-1.5">
              {repos.map(repo => (
                <a
                  key={repo.name}
                  href={repo.html_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 rounded-lg border border-border/50 px-3 py-2.5 transition-colors hover:bg-accent/60 group"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                      {repo.name}
                    </p>
                    {repo.description && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{repo.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0 text-xs text-muted-foreground">
                    {repo.language && (
                      <span className="rounded-full border border-border/60 px-2 py-0.5 text-[10px]">
                        {repo.language}
                      </span>
                    )}
                    {repo.stargazers_count > 0 && (
                      <span className="flex items-center gap-0.5">
                        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                        {repo.stargazers_count}
                      </span>
                    )}
                  </div>
                </a>
              ))}
            </div>
          ) : null}
        </div>

        <Separator />

        {/* Update Check Section */}
        <div className="pt-2 space-y-3">
          <Button
            onClick={handleCheckUpdate}
            disabled={checking || !appVersion}
            variant="outline"
            className="w-full"
          >
            {checking ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                {t("settings.about.checking")}
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                {t("settings.about.checkUpdate")}
              </>
            )}
          </Button>

          {/* Up to Date Status */}
          {upToDate && (
            <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20">
              <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                <CheckCircle className="h-4 w-4" />
                <span className="text-sm">{t("settings.about.upToDate")}</span>
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
              <p className="text-xs text-destructive">{error}</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
