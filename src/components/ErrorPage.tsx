import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"

interface ErrorPageProps {
  error: Error | null
  errorInfo?: string | null
  onReset?: () => void
}

export function ErrorPage({ error, errorInfo, onReset }: ErrorPageProps) {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-2xl border-destructive/20 shadow-2xl">
        <CardHeader className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" x2="12" y1="8" y2="12" />
                <line x1="12" x2="12.01" y1="16" y2="16" />
              </svg>
            </div>
            <CardTitle className="text-2xl text-destructive">{t("errorPage.title")}</CardTitle>
          </div>
          <CardDescription className="text-base">{t("errorPage.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="rounded-md border border-destructive/20 bg-destructive/5 p-4">
              <p className="text-sm font-semibold text-destructive">{t("errorPage.errorMessage")}</p>
              <p className="mt-1 break-all font-mono text-sm text-destructive/90">{error.message || String(error)}</p>
            </div>
          )}
          {(errorInfo || error?.stack) && (
            <div className="rounded-md border bg-muted p-4">
              <p className="text-xs font-semibold text-muted-foreground">{t("errorPage.stackTrace")}</p>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs text-muted-foreground">
                {errorInfo || error?.stack}
              </pre>
            </div>
          )}
        </CardContent>
        <CardFooter className="flex flex-wrap gap-3">
          <Button onClick={onReset} variant="default">
            {t("errorPage.retry")}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              window.location.reload()
            }}
          >
            {t("errorPage.reload")}
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
