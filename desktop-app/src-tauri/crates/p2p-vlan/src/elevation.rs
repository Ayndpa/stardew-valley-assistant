//! Windows 提权工具（REALTIME.md §7.4）：判断当前进程是否已提权、
//! 以 `runas` 拉起辅助进程、为命名管道生成"仅当前用户可访问"的安全描述符。

use std::ffi::c_void;
use std::os::windows::ffi::OsStrExt;
use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::{Command, Stdio};
use std::ptr;

use anyhow::{anyhow, bail, Result};
use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, LocalFree, ERROR_CANCELLED, HANDLE};
use windows_sys::Win32::Security::Authorization::{
    ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
};
use windows_sys::Win32::Security::{
    GetTokenInformation, TokenElevation, TokenUser, SECURITY_ATTRIBUTES, TOKEN_ELEVATION,
    TOKEN_QUERY, TOKEN_USER,
};
use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
use windows_sys::Win32::UI::Shell::{
    ShellExecuteExW, SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW,
};

/// 用户拒绝 UAC / 提权失败时错误文本的固定前缀（前端据此显示「重试」）
pub const ELEVATION_DENIED: &str = "未获得管理员权限";

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const SW_HIDE: i32 = 0;

/// 辅助进程的命令行参数
pub const ARG_HELPER: &str = "--vlan-helper";
pub const ARG_WINTUN_DLL: &str = "--wintun-dll";
pub const ARG_TOKEN: &str = "--token";

fn wide(s: &str) -> Vec<u16> {
    std::ffi::OsStr::new(s)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

/// 打开当前进程令牌（TOKEN_QUERY），用完需 CloseHandle
fn open_process_token() -> Result<HANDLE> {
    let mut token: HANDLE = ptr::null_mut();
    // SAFETY: 标准 Win32 调用，参数均有效
    let ok = unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) };
    if ok == 0 {
        bail!("OpenProcessToken 失败: {}", unsafe { GetLastError() });
    }
    Ok(token)
}

/// 当前进程是否以管理员身份（已提权的令牌）运行
pub fn is_elevated() -> bool {
    let Ok(token) = open_process_token() else {
        return false;
    };
    let mut info = TOKEN_ELEVATION { TokenIsElevated: 0 };
    let mut len = 0u32;
    // SAFETY: 缓冲区大小与 TOKEN_ELEVATION 一致
    let ok = unsafe {
        GetTokenInformation(
            token,
            TokenElevation,
            &mut info as *mut TOKEN_ELEVATION as *mut c_void,
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut len,
        )
    };
    unsafe { CloseHandle(token) };
    ok != 0 && info.TokenIsElevated != 0
}

/// 当前用户 SID 的字符串形式（S-1-5-…）
pub fn current_user_sid() -> Result<String> {
    let token = open_process_token()?;
    let result = (|| {
        let mut len = 0u32;
        // 先问所需长度（预期失败并返回 ERROR_INSUFFICIENT_BUFFER）
        unsafe { GetTokenInformation(token, TokenUser, ptr::null_mut(), 0, &mut len) };
        if len == 0 {
            bail!("GetTokenInformation(TokenUser) 未返回长度");
        }
        let mut buf = vec![0u8; len as usize];
        // SAFETY: 缓冲区长度即系统要求的长度
        let ok = unsafe {
            GetTokenInformation(
                token,
                TokenUser,
                buf.as_mut_ptr() as *mut c_void,
                len,
                &mut len,
            )
        };
        if ok == 0 {
            bail!("GetTokenInformation(TokenUser) 失败: {}", unsafe { GetLastError() });
        }
        // SAFETY: 缓冲区开头就是 TOKEN_USER
        let user = unsafe { &*(buf.as_ptr() as *const TOKEN_USER) };
        let mut sid_str: *mut u16 = ptr::null_mut();
        let ok = unsafe { ConvertSidToStringSidW(user.User.Sid, &mut sid_str) };
        if ok == 0 || sid_str.is_null() {
            bail!("ConvertSidToStringSid 失败: {}", unsafe { GetLastError() });
        }
        let mut n = 0usize;
        // SAFETY: 以 0 结尾的宽字符串
        while unsafe { *sid_str.add(n) } != 0 {
            n += 1;
        }
        let s = String::from_utf16_lossy(unsafe { std::slice::from_raw_parts(sid_str, n) });
        unsafe { LocalFree(sid_str as *mut c_void) };
        Ok(s)
    })();
    unsafe { CloseHandle(token) };
    result
}

/// 仅当前用户（与 SYSTEM）可访问的安全描述符；用于命名管道的 `SECURITY_ATTRIBUTES`。
/// 提权后的辅助进程仍以同一用户 SID 运行，因此能通过访问检查。
pub struct OwnerOnlySecurity {
    descriptor: *mut c_void,
    attributes: SECURITY_ATTRIBUTES,
}

// SAFETY: 描述符只在本对象生命周期内由本线程使用（同步创建管道），不跨线程共享
unsafe impl Send for OwnerOnlySecurity {}

impl OwnerOnlySecurity {
    pub fn new() -> Result<Self> {
        let sid = current_user_sid()?;
        // D:P —— 受保护的 DACL（不继承）；GA = 完全访问；SY = SYSTEM
        let sddl = wide(&format!("D:P(A;;GA;;;{sid})(A;;GA;;;SY)"));
        let mut descriptor: *mut c_void = ptr::null_mut();
        // SAFETY: 传入合法的 SDDL 宽字符串；返回的描述符由 LocalFree 释放
        let ok = unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                sddl.as_ptr(),
                SDDL_REVISION_1,
                &mut descriptor,
                ptr::null_mut(),
            )
        };
        if ok == 0 || descriptor.is_null() {
            bail!("生成安全描述符失败: {}", unsafe { GetLastError() });
        }
        Ok(Self {
            descriptor,
            attributes: SECURITY_ATTRIBUTES {
                nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
                lpSecurityDescriptor: descriptor,
                bInheritHandle: 0,
            },
        })
    }

    /// 传给 `CreateNamedPipeW` 一类 API 的 `LPSECURITY_ATTRIBUTES`
    pub fn attributes_ptr(&mut self) -> *mut c_void {
        &mut self.attributes as *mut SECURITY_ATTRIBUTES as *mut c_void
    }
}

impl Drop for OwnerOnlySecurity {
    fn drop(&mut self) {
        if !self.descriptor.is_null() {
            unsafe { LocalFree(self.descriptor) };
        }
    }
}

/// 辅助进程的参数列表（不含 exe）
pub fn helper_args(pipe: &str, token: &str, wintun_dll: &Path) -> Vec<String> {
    vec![
        ARG_HELPER.to_string(),
        pipe.to_string(),
        ARG_WINTUN_DLL.to_string(),
        wintun_dll.display().to_string(),
        ARG_TOKEN.to_string(),
        token.to_string(),
    ]
}

/// 给 ShellExecute 的参数串：含空格的参数加引号
fn quote_args(args: &[String]) -> String {
    args.iter()
        .map(|a| {
            if a.contains(' ') || a.contains('\t') {
                format!("\"{}\"", a.replace('"', "\\\""))
            } else {
                a.clone()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// 启动辅助进程：`elevate` 为真时经 `ShellExecuteEx(runas)` 弹出 UAC，否则普通无窗口子进程。
/// 用户在 UAC 中取消 → 错误文本以 [`ELEVATION_DENIED`] 开头。
pub fn launch_helper(
    exe: &Path,
    pipe: &str,
    token: &str,
    wintun_dll: &Path,
    elevate: bool,
) -> Result<()> {
    let args = helper_args(pipe, token, wintun_dll);
    if !elevate {
        Command::new(exe)
            .args(&args)
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| anyhow!("启动辅助进程失败: {e}（{}）", exe.display()))?;
        return Ok(());
    }

    let verb = wide("runas");
    let file = wide(&exe.display().to_string());
    let params = wide(&quote_args(&args));
    let dir = exe
        .parent()
        .map(|d| wide(&d.display().to_string()))
        .unwrap_or_else(|| wide("."));
    // SAFETY: 结构体按 Win32 约定填写，所有指针在调用期间有效
    let mut info: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
    info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
    info.fMask = SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC;
    info.lpVerb = verb.as_ptr();
    info.lpFile = file.as_ptr();
    info.lpParameters = params.as_ptr();
    info.lpDirectory = dir.as_ptr();
    info.nShow = SW_HIDE;
    let ok = unsafe { ShellExecuteExW(&mut info) };
    if ok == 0 {
        let err = unsafe { GetLastError() };
        if err == ERROR_CANCELLED {
            bail!("{ELEVATION_DENIED}：已在 UAC 提示中取消授权");
        }
        bail!("{ELEVATION_DENIED}：启动辅助进程失败（ShellExecuteEx 错误码 {err}）");
    }
    if !info.hProcess.is_null() {
        unsafe { CloseHandle(info.hProcess) };
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sid_and_descriptor() {
        let sid = current_user_sid().expect("sid");
        assert!(sid.starts_with("S-1-"), "{sid}");
        let mut sec = OwnerOnlySecurity::new().expect("descriptor");
        assert!(!sec.attributes_ptr().is_null());
        // 只是查询，不会失败
        let _ = is_elevated();
    }

    #[test]
    fn args_are_quoted() {
        let args = helper_args(r"\\.\pipe\x", "t", Path::new(r"C:\Program Files\app\wintun.dll"));
        let s = quote_args(&args);
        assert!(s.contains("\"C:\\Program Files\\app\\wintun.dll\""));
        assert!(s.starts_with("--vlan-helper \\\\.\\pipe\\x --wintun-dll"));
    }
}
