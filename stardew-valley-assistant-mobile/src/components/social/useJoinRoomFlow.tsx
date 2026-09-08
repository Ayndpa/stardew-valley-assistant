import { useCallback, useState, type FormEvent } from "react"
import { useTranslation } from "react-i18next"
import { Loader2 } from "lucide-react"
import { describeError } from "@shared/account/errors"
import { useSocial } from "@shared/account/social-provider"
import { useToast } from "../Toast"
import { Button, Input, Sheet } from "../ui"

interface JoinTarget {
  code: string
  name: string
}

/**
 * 加入房间的通用流程：无密码直接加入；有密码（或首次加入失败）弹出密码输入重试。
 * 浏览器 WebSocket 拿不到升级失败的 HTTP 状态码，所以失败统一提示"不存在 / 密码错误 / 已满"。
 */
export function useJoinRoomFlow(onJoined?: () => void) {
  const { t } = useTranslation()
  const { joinRoom } = useSocial()
  const { showToast } = useToast()
  const [target, setTarget] = useState<JoinTarget | null>(null)
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const start = useCallback(
    async (code: string, name: string, locked: boolean) => {
      if (locked) {
        setError(null)
        setPassword("")
        setTarget({ code, name })
        return
      }
      setBusy(true)
      try {
        await joinRoom(code)
        onJoined?.()
      } catch (err) {
        const message = describeError(err, t, "social.room.joinFailed")
        showToast(message, "warning")
        // 也可能只是房间加了密码：给用户一次输入密码的机会
        setError(message)
        setPassword("")
        setTarget({ code, name })
      } finally {
        setBusy(false)
      }
    },
    [joinRoom, onJoined, showToast, t],
  )

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!target || busy) return
    setBusy(true)
    setError(null)
    try {
      await joinRoom(target.code, password)
      setTarget(null)
      onJoined?.()
    } catch (err) {
      setError(describeError(err, t, "social.room.joinFailed"))
    } finally {
      setBusy(false)
    }
  }

  const element = (
    <Sheet open={!!target} onClose={() => setTarget(null)} title={t("social.room.joinDialogTitle")}>
      <form onSubmit={submit} className="space-y-3">
        <p className="truncate text-xs text-muted-foreground">
          {target?.name} · <span className="font-mono">{target?.code}</span>
        </p>
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t("social.room.joinDialogPassword")}
          maxLength={32}
          disabled={busy}
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex gap-3 pt-1">
          <Button type="button" variant="outline" className="flex-1" onClick={() => setTarget(null)} disabled={busy}>
            {t("social.room.joinDialogCancel")}
          </Button>
          <Button type="submit" className="flex-1" disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("social.room.joinDialogSubmit")}
          </Button>
        </div>
      </form>
    </Sheet>
  )

  return { start, busy, element }
}
