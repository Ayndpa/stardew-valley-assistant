/**
 * 轻量 className 拼接。手机端没有引入 clsx / tailwind-merge：
 * 所有样式类都由本仓库自己书写，不存在需要"后者覆盖前者"的第三方类冲突。
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ")
}
