import { useCallback, useState } from "react"
import { useTranslation } from "react-i18next"
import { useSocial } from "@/lib/account/social-provider"
import { describeError } from "@/lib/account/errors"
import { JoinRoomDialog } from "./JoinRoomDialog"

interface JoinTarget {
  code: string
  name: string
}

/**
 * 加入房间的通用流程：无密码直接加入；有密码（或首次加入失败）弹出密码框重试。
 * 浏览器 WebSocket 拿不到升级失败的 HTTP 状态码，所以失败统一提示"不存在 / 密码错误 / 已满"。
 */
export function useJoinRoomFlow(onJoined?: () => void, onError?: (message: string) => void) {
  const { t } = useTranslation()
  const { joinRoom } = useSocial()
  const [target, setTarget] = useState<JoinTarget | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const start = useCallback(
    async (code: string, name: string, locked: boolean) => {
      if (locked) {
        setError(null)
        setTarget({ code, name })
        return
      }
      setBusy(true)
      try {
        await joinRoom(code)
        onJoined?.()
      } catch (err) {
        const message = describeError(err, t, "social.room.joinFailed")
        onError?.(message)
        // 可能是房间加了密码：给用户一次输入密码的机会
        setError(message)
        setTarget({ code, name })
      } finally {
        setBusy(false)
      }
    },
    [joinRoom, onJoined, onError, t],
  )

  const submit = useCallback(
    async (password: string) => {
      if (!target) return
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
    },
    [target, joinRoom, onJoined, t],
  )

  const element = (
    <JoinRoomDialog
      isOpen={!!target}
      roomName={target?.name ?? ""}
      roomCode={target?.code ?? ""}
      busy={busy}
      error={error}
      onSubmit={(pw) => void submit(pw)}
      onCancel={() => setTarget(null)}
    />
  )

  return { start, busy, element }
}
