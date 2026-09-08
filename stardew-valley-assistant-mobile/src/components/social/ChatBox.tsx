import { useEffect, useRef, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Send } from "lucide-react"
import { cn } from "../../lib/utils"
import type { ChatMessage } from "@shared/account/types"
import { displayName, formatTime } from "@shared/account/utils"
import { UserAvatar } from "./UserAvatar"

interface ChatBoxProps {
  messages: ChatMessage[]
  /** 返回 false 表示发送失败（未连接等） */
  onSend: (text: string) => boolean | Promise<boolean>
  disabled?: boolean
  placeholder?: string
  emptyText?: string
  /** 每条消息下方的附加信息（如私聊的送达状态） */
  renderMeta?: (msg: ChatMessage) => ReactNode
}

export function ChatBox({ messages, onSend, disabled, placeholder, emptyText, renderMeta }: ChatBoxProps) {
  const { t } = useTranslation()
  const [text, setText] = useState("")
  const [failed, setFailed] = useState(false)
  const [sending, setSending] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)

  useEffect(() => {
    const el = listRef.current
    if (!el || !stickToBottomRef.current) return
    el.scrollTop = el.scrollHeight
  }, [messages])

  const handleScroll = () => {
    const el = listRef.current
    if (!el) return
    // 用户往上翻看历史时不再自动吸底
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
  }

  const submit = async () => {
    const value = text.trim()
    if (!value || disabled || sending) return
    setSending(true)
    try {
      const ok = await onSend(value)
      if (ok) {
        setText("")
        setFailed(false)
        stickToBottomRef.current = true
      } else {
        setFailed(true)
      }
    } catch {
      setFailed(true)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={listRef} onScroll={handleScroll} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {emptyText ?? t("social.chat.empty")}
          </div>
        )}
        {messages.map((msg) => {
          if (msg.system) {
            const name = msg.from === "me" ? t("social.room.you") : displayName(msg.from)
            return (
              <div key={msg.id} className="py-1 text-center text-xs text-muted-foreground">
                {t(`social.chat.system.${msg.system}`, { name })}
              </div>
            )
          }
          const mine = msg.from === "me"
          const peer = msg.from === "me" ? null : msg.from
          return (
            <div key={msg.id} className={cn("flex items-end gap-2", mine ? "flex-row-reverse" : "flex-row")}>
              {!mine && <UserAvatar user={peer} size="sm" />}
              <div className={cn("flex max-w-[76%] flex-col gap-1", mine ? "items-end" : "items-start")}>
                {!mine && <span className="px-1 text-[11px] font-medium text-muted-foreground">{displayName(peer)}</span>}
                <div
                  className={cn(
                    "whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm leading-relaxed shadow-sm",
                    mine
                      ? cn("rounded-br-md bg-primary text-primary-foreground", msg.pending && "opacity-60")
                      : "rounded-bl-md border border-border/60 bg-accent/40 text-foreground",
                  )}
                >
                  {msg.text}
                </div>
                <div className="flex items-center gap-1.5 px-1 text-[10px] text-muted-foreground">
                  <span>{formatTime(msg.ts)}</span>
                  {renderMeta?.(msg)}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="border-t border-border/60 bg-card px-3 py-2.5 pb-safe">
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            rows={1}
            onChange={(e) => {
              setText(e.target.value)
              if (failed) setFailed(false)
            }}
            placeholder={placeholder ?? t("social.chat.placeholder")}
            disabled={disabled}
            maxLength={2000}
            className="max-h-28 min-h-11 flex-1 resize-none rounded-2xl border border-input bg-background px-3.5 py-2.5 text-base leading-6 text-foreground outline-none placeholder:text-muted-foreground/70 focus:border-primary/60 disabled:opacity-60"
          />
          <button
            type="button"
            onClick={() => void submit()}
            disabled={disabled || sending || !text.trim()}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm shadow-primary/20 disabled:opacity-40"
          >
            <Send className="h-5 w-5" />
          </button>
        </div>
        {failed && <p className="mt-1.5 px-1 text-xs text-destructive">{t("social.chat.notConnected")}</p>}
      </div>
    </div>
  )
}
