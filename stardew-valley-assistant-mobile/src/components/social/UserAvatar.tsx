import { cn } from "../../lib/utils"
import type { UserBrief } from "@shared/account/types"
import { displayName, initialOf } from "@shared/account/utils"

interface UserAvatarProps {
  user: UserBrief | null | undefined
  size?: "sm" | "md" | "lg"
  /** undefined = 不显示在线点 */
  online?: boolean
  className?: string
}

const SIZE_CLASS = {
  sm: "h-9 w-9 text-sm",
  md: "h-11 w-11 text-base",
  lg: "h-16 w-16 text-xl",
}

export function UserAvatar({ user, size = "md", online, className }: UserAvatarProps) {
  return (
    <div className={cn("relative shrink-0", className)}>
      <div
        className={cn(
          "flex items-center justify-center overflow-hidden rounded-full border border-primary/20 bg-primary/10 font-bold text-primary select-none",
          SIZE_CLASS[size],
        )}
      >
        {user?.avatar_url ? (
          <img src={user.avatar_url} alt={displayName(user)} className="h-full w-full object-cover" draggable={false} />
        ) : (
          initialOf(user)
        )}
      </div>
      {online !== undefined && (
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card",
            online ? "bg-emerald-500" : "bg-muted-foreground/40",
          )}
        />
      )}
    </div>
  )
}
