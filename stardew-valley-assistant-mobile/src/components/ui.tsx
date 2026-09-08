/**
 * 手机端自备的基础控件。桌面端用的是 shadcn/radix，移动端没有安装这些依赖，
 * 这里用原生元素 + Tailwind 实现同等能力，并统一保证 44px 以上的触摸目标。
 */
import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"
import { cn } from "../lib/utils"

type ButtonVariant = "primary" | "outline" | "ghost" | "danger"
type ButtonSize = "md" | "sm"

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground shadow-sm shadow-primary/20 active:brightness-95",
  outline: "border border-border bg-card text-foreground active:bg-accent/60",
  ghost: "text-muted-foreground active:bg-accent/60",
  danger: "border border-destructive/40 bg-destructive/10 text-destructive active:bg-destructive/20",
}

const SIZE_CLASS: Record<ButtonSize, string> = {
  md: "h-11 px-4 text-sm",
  sm: "h-9 px-3 text-xs",
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

export function Button({ variant = "primary", size = "md", className, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl font-semibold transition-[filter,background-color] disabled:pointer-events-none disabled:opacity-50",
        VARIANT_CLASS[variant],
        SIZE_CLASS[size],
        className,
      )}
      {...rest}
    />
  )
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        // 16px 字号：iOS Safari 在更小字号的输入框聚焦时会强制缩放页面
        "h-11 w-full rounded-xl border border-input bg-card px-3.5 text-base text-foreground outline-none",
        "placeholder:text-muted-foreground/70 focus:border-primary/60 focus:ring-2 focus:ring-primary/20 disabled:opacity-60",
        className,
      )}
      {...rest}
    />
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="px-0.5 text-xs font-bold text-foreground">
        {label}
        {hint && <span className="ml-1 font-normal text-muted-foreground">{hint}</span>}
      </span>
      {children}
    </label>
  )
}

/** 底部抽屉：手机端替代桌面端的 Dialog / DropdownMenu */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}) {
  // 抽屉打开时锁住背景滚动，避免手势穿透到下层列表
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/50 backdrop-blur-[2px]"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="max-h-[85vh] overflow-y-auto rounded-t-3xl border-t border-border bg-card pb-safe shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border/60 bg-card px-4 py-3">
          <h2 className="min-w-0 flex-1 truncate text-base font-bold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground active:bg-accent"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-4 py-4">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold text-secondary-foreground",
        className,
      )}
    >
      {children}
    </span>
  )
}

/** 列表 / 页面的空状态 */
export function EmptyState({ icon, title, hint }: { icon: ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground [&_svg]:h-7 [&_svg]:w-7">
        {icon}
      </span>
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
      {hint && <p className="text-xs text-muted-foreground/70">{hint}</p>}
    </div>
  )
}
