import type { ReactNode } from "react"
import { ChevronLeft } from "lucide-react"

interface PageHeaderProps {
  title: string
  subtitle?: string
  /** 传入即显示返回按钮（会话页等二级页面） */
  onBack?: () => void
  action?: ReactNode
}

/** 各页统一的顶栏：安全区内边距 + 44px 触摸目标 */
export function PageHeader({ title, subtitle, onBack, action }: PageHeaderProps) {
  return (
    <header className="flex shrink-0 items-center gap-2 border-b border-border/60 bg-card px-3 pb-2.5 pt-safe">
      {onBack && (
        <button
          type="button"
          aria-label={title}
          onClick={onBack}
          className="-ml-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-foreground active:bg-accent"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-base font-bold">{title}</h1>
        {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {action}
    </header>
  )
}
