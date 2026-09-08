/**
 * 虚拟局域网实现已抽到 shared/account/vlan.ts 与手机端共用：命令名、参数与事件名两端完全一致，
 * 平台差异（授权失败的错误前缀、手机端多一步 vlan_prepare）由 DESKTOP_VLAN_CONFIG / MOBILE_VLAN_CONFIG 注入。
 * 桌面端的配置在 social-provider.tsx 里传给 SocialProvider。
 */
export * from "@shared/account/vlan"
