/**
 * 联机状态机已抽到 shared/account/social-provider.tsx 与手机端共用。
 * 桌面专有的能力（多窗口同步、提权虚拟局域网、以 Page 判断是否停留在联机页）在这里注入，
 * 调用方的用法保持不变：<SocialProvider role="main" notify={...} activePage={currentPage}>
 */
import type { ReactNode } from "react"
import type { Page } from "@/App"
import { SocialProvider as SharedSocialProvider, type Notifier, type SocialRole } from "@shared/account/social-provider"
import { DESKTOP_VLAN_CONFIG } from "@shared/account/vlan"
import { desktopWindowSync } from "./window-signals"

// 逐个转发而不是 export *：本文件另有同名的 SocialProvider 包装，显式列出避免歧义
export { useSocial, RoomJoinError } from "@shared/account/social-provider"
export type {
  HubStatus,
  Notifier,
  RoomState,
  RoomStatus,
  SignalHandler,
  SocialRole,
  SocialWindowSync,
  ToastType,
} from "@shared/account/social-provider"

interface DesktopSocialProviderProps {
  children: ReactNode
  /** 主窗口 / 弹窗，见 SocialRole */
  role: SocialRole
  /** 提示回调（主窗口为 App 的 showGlobalToast，弹窗为窗口内的小提示） */
  notify?: Notifier
  /** 主窗口当前页面：不在联机页面时房间类事件才弹 toast；弹窗可省略 */
  activePage?: Page
}

export function SocialProvider({ children, role, notify, activePage }: DesktopSocialProviderProps) {
  return (
    <SharedSocialProvider
      role={role}
      notify={notify}
      socialActive={activePage === "social"}
      windowSync={desktopWindowSync}
      vlanConfig={DESKTOP_VLAN_CONFIG}
    >
      {children}
    </SharedSocialProvider>
  )
}
