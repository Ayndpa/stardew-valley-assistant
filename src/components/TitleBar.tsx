import { type MouseEvent, useEffect, useMemo, useState } from "react"
import { Minus, Square, SquareStack, X } from "lucide-react"
import appIcon from "@/assets/app-icon.png"
import { useTranslation } from "react-i18next"

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

export function TitleBar() {
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
    <div className="titlebar-controls flex items-center gap-2" data-titlebar-no-drag="true">
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
    </div>
  )

  const brand = (
    <div className="titlebar-brand flex max-w-full items-center gap-2 px-2 py-1">
      <img
        src={appIcon}
        alt={t("titlebar.brand")}
        className="h-4.5 w-4.5 rounded-sm object-cover"
        draggable={false}
      />
      <p className="truncate text-[12px] font-medium text-foreground">{t("titlebar.brand")}</p>
    </div>
  )

  return (
    <header
      className="titlebar absolute inset-x-0 top-0 z-50 flex h-13 items-center border-b border-border/60 px-3"
      onMouseDown={(event) => void handleDragMouseDown(event)}
    >
      <div className="flex min-w-0 flex-1 items-center">
        {!isWindows && <div className="w-28 shrink-0">{controls}</div>}
      </div>

      <div
        className="pointer-events-none absolute inset-x-0 top-0 flex h-full items-center justify-center px-30"
      >
        {brand}
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-end">
        {isWindows ? <div className="w-28 shrink-0">{controls}</div> : <div className="w-28 shrink-0" />}
      </div>
    </header>
  )
}
