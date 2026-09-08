import { useEffect, useRef, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Send } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { ChatMessage } from "@/lib/account/types"
import { displayName, formatTime } from "@/lib/account/utils"
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
  className?: string
}

export function ChatBox({ messages, onSend, disabled, placeholder, emptyText, renderMeta, className }: ChatBoxProps) {
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
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
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
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <div ref={listRef} onScroll={handleScroll} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            {emptyText ?? t("social.chat.empty")}
          </div>
        )}
        {messages.map((msg) => {
          if (msg.system) {
            const name = msg.from === "me" ? t("social.room.you") : displayName(msg.from)
            return (
              <div key={msg.id} className="py-1 text-center text-[11px] text-muted-foreground">
                {t(`social.chat.system.${msg.system}`, { name })}
              </div>
            )
          }
          const mine = msg.from === "me"
          return (
            <div key={msg.id} className={cn("flex items-end gap-2", mine ? "flex-row-reverse" : "flex-row")}>
              {!mine && <UserAvatar user={msg.from === "me" ? null : msg.from} size="sm" />}
              <div className={cn("flex max-w-[75%] flex-col gap-0.5", mine ? "items-end" : "items-start")}>
                {!mine && (
                  <span className="px-1 text-[10px] font-medium text-muted-foreground">
                    {displayName(msg.from === "me" ? null : msg.from)}
                  </span>
                )}
                <div
                  className={cn(
                    "whitespace-pre-wrap break-words rounded-2xl px-3 py-1.5 text-sm leading-relaxed shadow-sm",
                    mine
                      ? cn("rounded-br-sm bg-primary text-primary-foreground", msg.pending && "opacity-60")
                      : "rounded-bl-sm border border-border/60 bg-accent/40 text-foreground",
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
      <div className="border-t border-border/60 p-2">
        <div className="flex items-center gap-2">
          <Input
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              if (failed) setFailed(false)
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void submit()
              }
            }}
            placeholder={placeholder ?? t("social.chat.placeholder")}
            disabled={disabled}
            maxLength={2000}
            className="h-9 text-sm"
          />
          <Button size="sm" onClick={() => void submit()} disabled={disabled || sending || !text.trim()} className="h-9 gap-1.5 px-3">
            <Send className="h-3.5 w-3.5" />
            {t("social.chat.send")}
          </Button>
        </div>
        {failed && <p className="mt-1 px-1 text-[11px] text-destructive">{t("social.chat.notConnected")}</p>}
      </div>
    </div>
  )
}
