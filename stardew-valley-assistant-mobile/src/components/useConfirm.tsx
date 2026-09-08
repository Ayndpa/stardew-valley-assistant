import { useCallback, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Button, Sheet } from "./ui"

interface ConfirmOptions {
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}

/** 二次确认：手机端用底部抽屉呈现，桌面端对应 useConfirm 的模态对话框 */
export function useConfirm() {
  const { t } = useTranslation()
  const [options, setOptions] = useState<ConfirmOptions | null>(null)
  const resolveRef = useRef<((ok: boolean) => void) | null>(null)

  const confirm = useCallback((opts: ConfirmOptions) => {
    setOptions(opts)
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve
    })
  }, [])

  const settle = useCallback((ok: boolean) => {
    setOptions(null)
    const resolve = resolveRef.current
    resolveRef.current = null
    resolve?.(ok)
  }, [])

  const element = (
    <Sheet open={!!options} onClose={() => settle(false)} title={options?.title ?? ""}>
      <p className="text-sm leading-relaxed text-muted-foreground">{options?.message}</p>
      <div className="mt-5 flex gap-3">
        <Button variant="outline" className="flex-1" onClick={() => settle(false)}>
          {options?.cancelText ?? t("common.cancel")}
        </Button>
        <Button
          variant={options?.danger ? "danger" : "primary"}
          className="flex-1"
          onClick={() => settle(true)}
        >
          {options?.confirmText ?? t("common.confirm")}
        </Button>
      </div>
    </Sheet>
  )

  return { confirm, element }
}
