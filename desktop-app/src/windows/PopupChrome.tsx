import type { MouseEvent, ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Minus, X } from "lucide-react"
import appIcon from "@/assets/app-icon.png"
import { cn } from "@/lib/utils"
import { closeCurrentWindow, minimizeCurrentWindow, startDraggingCurrentWindow } from "@/lib/account/windows"

interface PopupChromeProps {
  title: string
  subtitle?: ReactNode
  /** 标题栏右侧的额外按钮（放在最小化 / 关闭之前） */
  right?: ReactNode
  className?: string
}

/**
 * 弹窗的自绘标题栏（弹窗与主窗口一样 decorations=false）：
 * 拖拽区域 + 标题 + 最小化 / 关闭。关闭是真正 close（不是 hide）。
 */
export function PopupChrome({ title, subtitle, right, className }: PopupChromeProps) {
  const { t } = useTranslation()

  const handleMouseDown = (event: MouseEvent<HTMLElement>) => {
    if (event.button !== 0) return
    if ((event.target as HTMLElement).closest("[data-no-drag='true']")) return
    void startDraggingCurrentWindow()
  }

  return (
    <header
      data-tauri-drag-region
      onMouseDown={handleMouseDown}
      className={cn("titlebar flex h-11 shrink-0 select-none items-center gap-2.5 border-b border-border/60 px-3", className)}
    >
      <img src={appIcon} alt="" className="h-6 w-6 shrink-0 rounded-md object-cover" draggable={false} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold leading-tight text-foreground">{title}</p>
        {subtitle && <div className="truncate text-[10px] leading-tight text-muted-foreground">{subtitle}</div>}
      </div>
      {right && (
        <div data-no-drag="true" className="flex shrink-0 items-center gap-1">
          {right}
        </div>
      )}
      <div data-no-drag="true" className="titlebar-controls flex shrink-0 items-center gap-1.5 pl-1">
        <button
          type="button"
          className="titlebar-control titlebar-minimize"
          onClick={() => void minimizeCurrentWindow()}
          aria-label={t("titlebar.minimize")}
          title={t("titlebar.minimize")}
        >
          <Minus className="h-2.5 w-2.5" />
        </button>
        <button
          type="button"
          className="titlebar-control titlebar-close"
          onClick={() => void closeCurrentWindow()}
          aria-label={t("titlebar.close")}
          title={t("titlebar.close")}
        >
          <X className="h-2.5 w-2.5" />
        </button>
      </div>
    </header>
  )
}
