import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react"
import { AlertTriangle, CheckCircle2, Info } from "lucide-react"
import { cn } from "../lib/utils"
import type { ToastType } from "@shared/account/social-provider"

interface ToastItem {
  id: number
  message: string
  type: ToastType
}

interface ToastApi {
  showToast: (message: string, type?: ToastType) => void
}

const ToastContext = createContext<ToastApi | undefined>(undefined)

const TONE: Record<ToastType, { icon: ReactNode; className: string }> = {
  success: { icon: <CheckCircle2 />, className: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400" },
  info: { icon: <Info />, className: "border-primary/40 text-primary" },
  warning: { icon: <AlertTriangle />, className: "border-amber-500/40 text-amber-600 dark:text-amber-400" },
}

const AUTO_DISMISS_MS = 3200

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const seqRef = useRef(0)

  const showToast = useCallback((message: string, type: ToastType = "info") => {
    const id = ++seqRef.current
    // 最多同时保留 3 条，避免连续的好友 / 房间事件把屏幕占满
    setItems((prev) => [...prev.slice(-2), { id, message, type }])
    setTimeout(() => setItems((prev) => prev.filter((i) => i.id !== id)), AUTO_DISMISS_MS)
  }, [])

  const value = useMemo<ToastApi>(() => ({ showToast }), [showToast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex flex-col items-center gap-2 px-4 pt-safe">
        {items.map((item) => {
          const tone = TONE[item.type]
          return (
            <div
              key={item.id}
              onClick={() => setItems((prev) => prev.filter((i) => i.id !== item.id))}
              className={cn(
                "pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-2xl border bg-card px-4 py-3 shadow-xl",
                tone.className,
              )}
            >
              <span className="mt-0.5 shrink-0 [&_svg]:h-5 [&_svg]:w-5">{tone.icon}</span>
              <p className="min-w-0 flex-1 break-words text-sm font-medium text-card-foreground">{item.message}</p>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (ctx === undefined) {
    throw new Error("useToast must be used within a ToastProvider")
  }
  return ctx
}
