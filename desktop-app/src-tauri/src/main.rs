// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // 虚拟局域网提权辅助进程模式（REALTIME.md §7.4）：以 `--vlan-helper <管道> --wintun-dll <路径> --token <串>`
    // 启动时，不初始化 Tauri（也就不会触发单实例插件），直接进入辅助进程主循环，管道断开即退出。
    #[cfg(windows)]
    if let Some(args) = p2p_vlan::helper::HelperArgs::parse(std::env::args()) {
        std::process::exit(p2p_vlan::helper::run_helper_main(args));
    }

    stardew_valley_assistant_lib::run()
}
