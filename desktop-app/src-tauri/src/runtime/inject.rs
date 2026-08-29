//! 把原生垫片 `assistant_inject.dll` 载入正在运行的游戏进程。
//!
//! 用的是最常规的 `LoadLibraryW` + `CreateRemoteThread` 方案：在目标进程里分配
//! 一段内存写入 DLL 路径，然后让目标进程自己调用 `LoadLibraryW`。垫片的 DllMain
//! 会接手后续的 hostfxr 流程。
//!
//! 注意：这是助手启动游戏之外的兜底路径。玩家从 Steam 直接启动时钩子来不及挂，
//! 只能事后注入。远程线程注入是杀软的重点关注行为，若被拦截，功能会退化为
//! 「必须从助手启动游戏」——调用方需要把这个结果如实告诉用户。

#![allow(clippy::missing_safety_doc)]

// 与 game_data/pipe_server.rs 一样，这里是 Windows 专属实现（命名管道亦然）。

use std::os::windows::ffi::OsStrExt;
use std::path::Path;

use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
use windows_sys::Win32::System::Diagnostics::Debug::WriteProcessMemory;
use windows_sys::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress};
use windows_sys::Win32::System::Memory::{
    VirtualAllocEx, VirtualFreeEx, MEM_COMMIT, MEM_RELEASE, MEM_RESERVE, PAGE_READWRITE,
};
use windows_sys::Win32::System::Threading::{
    CreateRemoteThread, GetExitCodeThread, OpenProcess, WaitForSingleObject, PROCESS_CREATE_THREAD,
    PROCESS_QUERY_INFORMATION, PROCESS_VM_OPERATION, PROCESS_VM_READ, PROCESS_VM_WRITE,
};

/// 等待远程 LoadLibraryW 返回的上限。正常情况远快于此；设上限是为了避免
/// 目标进程卡死时把助手一起拖住。
const REMOTE_THREAD_TIMEOUT_MS: u32 = 15_000;

/// 把 `dll` 注入到 `pid` 指向的进程。重复注入是安全的：
/// Windows 对同一路径的 `LoadLibraryW` 只增加引用计数，不会再次触发 DllMain。
pub fn inject(pid: u32, dll: &Path) -> Result<(), String> {
    if !dll.exists() {
        return Err(format!("注入器不存在: {}", dll.display()));
    }

    // LoadLibraryW 在 kernel32 中的地址在同一次开机内对所有进程一致，
    // 因此可以直接把本进程解析到的地址交给目标进程使用。
    let load_library = resolve_load_library()?;

    let mut path_utf16: Vec<u16> = dll.as_os_str().encode_wide().collect();
    path_utf16.push(0);
    let path_bytes = path_utf16.len() * std::mem::size_of::<u16>();

    unsafe {
        let process = OpenProcess(
            PROCESS_CREATE_THREAD
                | PROCESS_QUERY_INFORMATION
                | PROCESS_VM_OPERATION
                | PROCESS_VM_WRITE
                | PROCESS_VM_READ,
            0,
            pid,
        );
        if process.is_null() {
            return Err(format!(
                "无法打开游戏进程 (PID {pid})：{}。若游戏以管理员身份运行，助手也需要以管理员身份运行。",
                std::io::Error::last_os_error()
            ));
        }

        let result = inject_into_open_process(process, load_library, &path_utf16, path_bytes);
        CloseHandle(process);
        result
    }
}

unsafe fn inject_into_open_process(
    process: HANDLE,
    load_library: unsafe extern "system" fn() -> isize,
    path_utf16: &[u16],
    path_bytes: usize,
) -> Result<(), String> {
    let remote = VirtualAllocEx(
        process,
        std::ptr::null(),
        path_bytes,
        MEM_COMMIT | MEM_RESERVE,
        PAGE_READWRITE,
    );
    if remote.is_null() {
        return Err(format!(
            "在游戏进程中分配内存失败: {}",
            std::io::Error::last_os_error()
        ));
    }

    let result = write_and_run(process, remote, load_library, path_utf16, path_bytes);
    VirtualFreeEx(process, remote, 0, MEM_RELEASE);
    result
}

unsafe fn write_and_run(
    process: HANDLE,
    remote: *mut std::ffi::c_void,
    load_library: unsafe extern "system" fn() -> isize,
    path_utf16: &[u16],
    path_bytes: usize,
) -> Result<(), String> {
    let mut written = 0usize;
    let ok = WriteProcessMemory(
        process,
        remote,
        path_utf16.as_ptr().cast(),
        path_bytes,
        &mut written,
    );
    if ok == 0 || written != path_bytes {
        return Err(format!(
            "写入游戏进程内存失败: {}",
            std::io::Error::last_os_error()
        ));
    }

    let thread = CreateRemoteThread(
        process,
        std::ptr::null(),
        0,
        Some(std::mem::transmute::<
            unsafe extern "system" fn() -> isize,
            unsafe extern "system" fn(*mut std::ffi::c_void) -> u32,
        >(load_library)),
        remote,
        0,
        std::ptr::null_mut(),
    );
    if thread.is_null() {
        return Err(format!(
            "在游戏进程中创建远程线程失败: {}。这类操作常被安全软件拦截，可尝试将助手加入白名单，或改用「从助手启动游戏」。",
            std::io::Error::last_os_error()
        ));
    }

    let wait = WaitForSingleObject(thread, REMOTE_THREAD_TIMEOUT_MS);
    let mut exit_code = 0u32;
    GetExitCodeThread(thread, &mut exit_code);
    CloseHandle(thread);

    // WAIT_OBJECT_0 == 0
    if wait != 0 {
        return Err("等待游戏进程加载注入器超时。".to_string());
    }

    // 退出码是 LoadLibraryW 返回的 HMODULE 的低 32 位，0 表示加载失败。
    if exit_code == 0 {
        return Err("游戏进程加载注入器失败（LoadLibraryW 返回 NULL）。".to_string());
    }

    Ok(())
}

fn resolve_load_library() -> Result<unsafe extern "system" fn() -> isize, String> {
    unsafe {
        let kernel32: Vec<u16> = "kernel32.dll"
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let module = GetModuleHandleW(kernel32.as_ptr());
        if module.is_null() {
            return Err("无法获取 kernel32.dll 句柄".to_string());
        }

        GetProcAddress(module, c"LoadLibraryW".as_ptr().cast())
            .ok_or_else(|| "无法解析 LoadLibraryW 地址".to_string())
    }
}
