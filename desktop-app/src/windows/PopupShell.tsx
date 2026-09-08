import { useCallback, useEffect, useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { SocialProvider, type Notifier, type ToastType } from "@/lib/account/social-provider"
import { TOKEN_KEY, onStorageKey } from "@/lib/account/window-signals"
import { closeCurrentWindow, setCurrentWindowTitle } from "@/lib/account/windows"

interface PopupShellProps {
  /** 窗口标题（同时写到 document.title 与原生窗口标题） */
  title: string
  children: (showToast: Notifier) => ReactNode
}

/**
 * 弹窗公共外壳：
 * - 自己的 SocialProvider（role=popup，独立 hub 连接）
 * - 窗口内的小提示（弹窗没有 App 的全局 toast）
 * - 主窗口登出（accountToken 被删除）时自动关闭本窗口
 */
export function PopupShell({ title, children }: PopupShellProps) {
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null)

  const showToast = useCallback<Notifier>((message, type) => {
    setToast({ message, type })
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    void setCurrentWindowTitle(title)
  }, [title])

  useEffect(() => {
    return onStorageKey(TOKEN_KEY, (value) => {
      if (!value) void closeCurrentWindow()
    })
  }, [])

  return (
    <SocialProvider role="popup" notify={showToast}>
      <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
        {children(showToast)}
        {toast && (
          <div
            className={cn(
              "fixed bottom-3 left-3 right-3 z-50 rounded-lg border px-3 py-2 text-xs font-medium shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200",
              toast.type === "success"
                ? "border-green-200 bg-green-50/95 text-green-800 dark:border-green-800 dark:bg-green-950/90 dark:text-green-200"
                : toast.type === "warning"
                  ? "border-amber-200 bg-amber-50/95 text-amber-800 dark:border-amber-800 dark:bg-amber-950/90 dark:text-amber-200"
                  : "border-blue-200 bg-blue-50/95 text-blue-800 dark:border-blue-800 dark:bg-blue-950/90 dark:text-blue-200",
            )}
            onClick={() => setToast(null)}
          >
            {toast.message}
          </div>
        )}
      </div>
    </SocialProvider>
  )
}
