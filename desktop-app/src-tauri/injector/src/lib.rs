//! 注入到《星露谷物语》进程内的原生垫片。
//!
//! 助手优先通过 `DOTNET_STARTUP_HOOKS` 在游戏启动时加载运行时；当玩家从 Steam
//! 或桌面快捷方式直接启动、游戏已经在跑时，这个 DLL 作为兜底被注入进去，
//! 走 hostfxr 把托管的 Assistant.Bootstrap 载入已有的 CoreCLR。
//!
//! 关键点：游戏进程里的运行时**早已初始化**，所以
//! `hostfxr_initialize_for_runtime_config` 会返回 `Success_HostAlreadyInitialized`，
//! 我们复用那个上下文拿到 `load_assembly_and_get_function_pointer` 委托即可，
//! 不会（也不能）再起第二个运行时。

#![cfg(windows)]

use std::ffi::c_void;
use std::path::PathBuf;

use windows_sys::core::PCWSTR;
use windows_sys::Win32::Foundation::{CloseHandle, HMODULE};
use windows_sys::Win32::System::LibraryLoader::{
    GetModuleFileNameW, GetModuleHandleW, GetProcAddress,
};
use windows_sys::Win32::System::SystemServices::DLL_PROCESS_ATTACH;
use windows_sys::Win32::System::Threading::CreateThread;

/// 本 DLL 自身的模块句柄，用来推导同目录下的其它文件路径。
static mut SELF_MODULE: HMODULE = std::ptr::null_mut();

// ── hostfxr FFI ─────────────────────────────────────────────

type HostfxrHandle = *mut c_void;

/// `hdt_load_assembly_and_get_function_pointer`
const HDT_LOAD_ASSEMBLY_AND_GET_FUNCTION_POINTER: i32 = 5;

/// 传给 `delegate_type_name` 表示目标方法带 `[UnmanagedCallersOnly]`。
const UNMANAGED_CALLERS_ONLY_METHOD: PCWSTR = usize::MAX as PCWSTR;

type InitForConfigFn = unsafe extern "system" fn(PCWSTR, *const c_void, *mut HostfxrHandle) -> i32;
type GetDelegateFn = unsafe extern "system" fn(HostfxrHandle, i32, *mut *mut c_void) -> i32;
type CloseFn = unsafe extern "system" fn(HostfxrHandle) -> i32;

type LoadAssemblyAndGetFnPtr = unsafe extern "system" fn(
    assembly_path: PCWSTR,
    type_name: PCWSTR,
    method_name: PCWSTR,
    delegate_type_name: PCWSTR,
    reserved: *mut c_void,
    delegate: *mut *mut c_void,
) -> i32;

/// `Assistant.Bootstrap.Entry.Initialize` 的签名。
type BootstrapEntryFn = unsafe extern "system" fn(*const u16, i32) -> i32;

// ── 入口 ────────────────────────────────────────────────────

#[no_mangle]
#[allow(non_snake_case)]
pub extern "system" fn DllMain(module: HMODULE, reason: u32, _reserved: *mut c_void) -> i32 {
    if reason == DLL_PROCESS_ATTACH {
        unsafe {
            SELF_MODULE = module;
            // 不能在 DllMain 里做实际工作（加载器锁），只起一个线程就返回。
            // 这里用 Win32 CreateThread 而非 std::thread：后者的线程初始化
            // 会再次触碰加载器锁，有死锁风险。
            let handle = CreateThread(
                std::ptr::null(),
                0,
                Some(worker),
                std::ptr::null(),
                0,
                std::ptr::null_mut(),
            );
            if !handle.is_null() {
                CloseHandle(handle);
            }
        }
    }
    1
}

unsafe extern "system" fn worker(_param: *mut c_void) -> u32 {
    match bootstrap() {
        Ok(()) => {
            log("注入成功：助手运行时已载入游戏进程");
            0
        }
        Err(message) => {
            log(&format!("注入失败：{message}"));
            1
        }
    }
}

unsafe fn bootstrap() -> Result<(), String> {
    let dir = self_dir().ok_or("无法确定注入器自身所在目录")?;

    let bootstrap_dll = dir.join("Assistant.Bootstrap.dll");
    let bootstrap_config = dir.join("Assistant.Bootstrap.runtimeconfig.json");
    let runtime_dll = dir.join("Assistant.Runtime.dll");

    for path in [&bootstrap_dll, &bootstrap_config, &runtime_dll] {
        if !path.exists() {
            return Err(format!("缺少文件: {}", path.display()));
        }
    }

    // hostfxr 已经被游戏的 apphost 加载进来了，直接取现成的模块。
    let hostfxr = GetModuleHandleW(wide("hostfxr.dll").as_ptr());
    if hostfxr.is_null() {
        return Err("目标进程内未找到 hostfxr.dll（该进程可能不是 .NET 应用）".into());
    }

    let init: InitForConfigFn = std::mem::transmute(
        GetProcAddress(hostfxr, c"hostfxr_initialize_for_runtime_config".as_ptr().cast())
            .ok_or("找不到 hostfxr_initialize_for_runtime_config")?,
    );
    let get_delegate: GetDelegateFn = std::mem::transmute(
        GetProcAddress(hostfxr, c"hostfxr_get_runtime_delegate".as_ptr().cast())
            .ok_or("找不到 hostfxr_get_runtime_delegate")?,
    );
    let close: CloseFn = std::mem::transmute(
        GetProcAddress(hostfxr, c"hostfxr_close".as_ptr().cast())
            .ok_or("找不到 hostfxr_close")?,
    );

    let mut context: HostfxrHandle = std::ptr::null_mut();
    // 负值为错误码；0 = Success，1 = Success_HostAlreadyInitialized，
    // 2 = Success_DifferentRuntimeProperties。后两者正是我们预期的结果。
    let rc = init(
        wide(&bootstrap_config.to_string_lossy()).as_ptr(),
        std::ptr::null(),
        &mut context,
    );
    if rc < 0 || context.is_null() {
        return Err(format!("hostfxr_initialize_for_runtime_config 失败: 0x{rc:08X}"));
    }

    let result = (|| -> Result<(), String> {
        let mut raw: *mut c_void = std::ptr::null_mut();
        let rc = get_delegate(context, HDT_LOAD_ASSEMBLY_AND_GET_FUNCTION_POINTER, &mut raw);
        if rc < 0 || raw.is_null() {
            return Err(format!("hostfxr_get_runtime_delegate 失败: 0x{rc:08X}"));
        }
        let load_assembly: LoadAssemblyAndGetFnPtr = std::mem::transmute(raw);

        let mut entry_raw: *mut c_void = std::ptr::null_mut();
        let rc = load_assembly(
            wide(&bootstrap_dll.to_string_lossy()).as_ptr(),
            wide("StardewValleyAssistant.Bootstrap.Entry, Assistant.Bootstrap").as_ptr(),
            wide("Initialize").as_ptr(),
            UNMANAGED_CALLERS_ONLY_METHOD,
            std::ptr::null_mut(),
            &mut entry_raw,
        );
        if rc < 0 || entry_raw.is_null() {
            return Err(format!("加载 Assistant.Bootstrap 失败: 0x{rc:08X}"));
        }

        let entry: BootstrapEntryFn = std::mem::transmute(entry_raw);
        let runtime_path: Vec<u16> = runtime_dll.to_string_lossy().encode_utf16().collect();
        let rc = entry(runtime_path.as_ptr(), runtime_path.len() as i32);
        if rc != 0 {
            return Err(format!("Assistant.Bootstrap.Entry.Initialize 返回 {rc}"));
        }

        Ok(())
    })();

    close(context);
    result
}

// ── 辅助 ────────────────────────────────────────────────────

/// 转成以 NUL 结尾的 UTF-16。返回值必须在调用期间保持存活。
fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

unsafe fn self_dir() -> Option<PathBuf> {
    let mut buffer = [0u16; 32768];
    let len = GetModuleFileNameW(SELF_MODULE, buffer.as_mut_ptr(), buffer.len() as u32);
    if len == 0 {
        return None;
    }

    let path = PathBuf::from(String::from_utf16_lossy(&buffer[..len as usize]));
    path.parent().map(PathBuf::from)
}

/// 注入过程发生在托管日志可用之前，因此单独写一份诊断日志。
fn log(message: &str) {
    let Ok(appdata) = std::env::var("APPDATA") else {
        return;
    };

    let dir = PathBuf::from(appdata)
        .join("StardewValley")
        .join("StardewValleyAssistant");
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }

    use std::io::Write;
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("inject.log"))
    {
        let _ = writeln!(file, "[pid {}] {message}", std::process::id());
    }
}
