import { type MouseEvent, useEffect, useMemo, useState } from "react"
import { Minus, Square, SquareStack, X } from "lucide-react"
import appIcon from "@/assets/app-icon.png"
import { useTranslation } from "react-i18next"
import type { Page, SaveSummary } from "@/App"

type WindowApi = {
  minimize: () => Promise<void>
  toggleMaximize: () => Promise<void>
  close: () => Promise<void>
  isMaximized: () => Promise<boolean>
  onResized: (handler: () => void) => Promise<() => void>
  startDragging: () => Promise<void>
}

function useWindowControls() {
  const [windowApi, setWindowApi] = useState<WindowApi | null>(null)
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    if (typeof window === "undefined" || !(window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
      return
    }

    let mounted = true
    let unlisten: (() => void) | null = null

    const syncWindowState = async (api: WindowApi) => {
      try {
        const maximized = await api.isMaximized()
        if (mounted) {
          setIsMaximized(maximized)
        }
      } catch (error) {
        console.debug("Failed to read maximized state:", error)
      }
    }

    const setup = async () => {
      try {
        const windowModule = await import("@tauri-apps/api/window")
        const api = windowModule.getCurrentWindow()
        if (!mounted) return

        setWindowApi(api)
        await syncWindowState(api)
        unlisten = await api.onResized(() => {
          void syncWindowState(api)
        })
      } catch (error) {
        console.debug("Failed to setup custom titlebar controls:", error)
      }
    }

    void setup()

    return () => {
      mounted = false
      unlisten?.()
    }
  }, [])

  return { windowApi, isMaximized }
}

interface TitleBarProps {
  currentPage: Page
  currentSave?: SaveSummary
}

export function TitleBar({ currentPage, currentSave }: TitleBarProps) {
  const { t } = useTranslation()
  const { windowApi, isMaximized } = useWindowControls()
  const [isWindows, setIsWindows] = useState(false)

  const controlsEnabled = useMemo(() => windowApi !== null, [windowApi])

  useEffect(() => {
    if (typeof window === "undefined") return
    setIsWindows(window.navigator.userAgent.includes("Windows"))
  }, [])

  const handleMinimize = async () => {
    if (!windowApi) return
    await windowApi.minimize()
  }

  const handleToggleMaximize = async () => {
    if (!windowApi) return
    await windowApi.toggleMaximize()
  }

  const handleClose = async () => {
    if (!windowApi) return
    await windowApi.close()
  }

  const handleDragMouseDown = async (event: MouseEvent<HTMLElement>) => {
    if (!windowApi || event.button !== 0) return
    if ((event.target as HTMLElement).closest("[data-titlebar-no-drag='true']")) {
      return
    }

    if (event.detail === 2) {
      await windowApi.toggleMaximize()
      return
    }

    await windowApi.startDragging()
  }

  const controls = (
    <div className="titlebar-controls flex items-center gap-1.5" data-titlebar-no-drag="true">
      <button
        type="button"
        className="titlebar-control titlebar-minimize"
        onClick={() => void handleMinimize()}
        disabled={!controlsEnabled}
        aria-label={t("titlebar.minimize")}
        title={t("titlebar.minimize")}
      >
        <Minus className="h-2.5 w-2.5" />
      </button>
      <button
        type="button"
        className="titlebar-control titlebar-maximize"
        onClick={() => void handleToggleMaximize()}
        disabled={!controlsEnabled}
        aria-label={isMaximized ? t("titlebar.restore") : t("titlebar.maximize")}
        title={isMaximized ? t("titlebar.restore") : t("titlebar.maximize")}
      >
        {isMaximized ? <SquareStack className="h-2.5 w-2.5" /> : <Square className="h-2.5 w-2.5" />}
      </button>
      <button
        type="button"
        className="titlebar-control titlebar-close"
        onClick={() => void handleClose()}
        disabled={!controlsEnabled}
        aria-label={t("titlebar.close")}
        title={t("titlebar.close")}
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </div>
  )

  const pageLabel = t(`sidebar.${currentPage}`)
  const saveLabel = currentSave
    ? t("sidebar.farmNameSuffix", { name: currentSave.farmName })
    : t("sidebar.noSaveSelected")

  return (
    <header
      className="titlebar relative z-20 flex h-13 shrink-0 items-center gap-3 border-b border-border/60 px-4"
      onMouseDown={(event) => void handleDragMouseDown(event)}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {!isWindows && <div className="w-20 shrink-0">{controls}</div>}
        <div className="titlebar-brand flex min-w-0 items-center gap-3 px-1 py-1">
          <img
            src={appIcon}
            alt={t("titlebar.brand")}
            className="h-8 w-8 rounded-lg object-cover"
            draggable={false}
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{t("titlebar.brand")}</p>
            <div className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
              <span className="truncate">{pageLabel}</span>
              <span className="shrink-0 text-border">/</span>
              <span className="truncate">{currentSave ? currentSave.playerName : saveLabel}</span>
              {currentSave && (
                <>
                  <span className="shrink-0 text-border">/</span>
                  <span className="truncate">{saveLabel}</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex min-w-0 items-center justify-end">
        {isWindows ? <div className="w-20 shrink-0">{controls}</div> : <div className="w-20 shrink-0" />}
      </div>
    </header>
  )
}
