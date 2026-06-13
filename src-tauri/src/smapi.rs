use crate::utils::{copy_dir_all, download_file, extract_zip};
use serde::Serialize;
use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SmapiStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub path: Option<String>,
}

#[tauri::command]
pub fn check_smapi_status(game_dir: String) -> SmapiStatus {
    let game_path = Path::new(&game_dir);
    if !game_path.exists() {
        return SmapiStatus {
            installed: false,
            version: None,
            path: None,
        };
    }

    let api_exe = find_smapi_launcher(game_path);
    let deps_json = game_path.join("StardewModdingAPI.deps.json");
    let installed = api_exe.is_some() || deps_json.exists();

    let mut version = None;
    if installed {
        // Strategy 1: Read from SMAPI log file (most accurate, reflects actual runtime version)
        let log_path = get_smapi_log_path();
        if let Some(path) = log_path {
            if path.exists() {
                version = read_version_from_log(&path);
            }
        }

        // Strategy 2 (Windows): Read from EXE file version info
        #[cfg(target_os = "windows")]
        if version.is_none() {
            if let Some(path) = api_exe.as_deref() {
                version = read_version_from_exe(path);
            }
        }

        // Strategy 3: Read from StardewModdingAPI.deps.json
        if version.is_none() {
            if deps_json.exists() {
                version = read_version_from_deps_json(&deps_json);
            }
        }
    }

    SmapiStatus {
        installed,
        version,
        path: api_exe.as_ref().map(|p| p.to_string_lossy().to_string()),
    }
}

/// Read version from SMAPI-latest.txt log file
fn read_version_from_log(path: &Path) -> Option<String> {
    let file = File::open(path).ok()?;
    let reader = BufReader::new(file);
    for line in reader.lines() {
        if let Ok(line_str) = line {
            if line_str.contains("INFO  SMAPI]") {
                if let Some(ver_idx) = line_str.find("SMAPI ") {
                    let rest = &line_str[ver_idx + 6..];
                    let parts: Vec<&str> = rest.split_whitespace().collect();
                    if !parts.is_empty() {
                        return Some(parts[0].to_string());
                    }
                }
            }
        }
    }
    None
}

/// Read version from EXE file version info (Windows only)
#[cfg(target_os = "windows")]
fn read_version_from_exe(exe_path: &Path) -> Option<String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::ptr;

    #[link(name = "version")]
    extern "system" {
        fn GetFileVersionInfoSizeW(lptstrFilename: *const u16, lpdwHandle: *mut u32) -> u32;
        fn GetFileVersionInfoW(
            lptstrFilename: *const u16,
            dwHandle: u32,
            dwLen: u32,
            lpData: *mut std::ffi::c_void,
        ) -> i32;
        fn VerQueryValueW(
            pBlock: *const std::ffi::c_void,
            lpSubBlock: *const u16,
            lplpBuffer: *mut *const std::ffi::c_void,
            puLen: *mut u32,
        ) -> i32;
    }

    let wide_path: Vec<u16> = OsStr::new(exe_path)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let mut handle: u32 = 0;
    let size = unsafe { GetFileVersionInfoSizeW(wide_path.as_ptr(), &mut handle) };
    if size == 0 {
        return None;
    }

    let mut buffer = vec![0u8; size as usize];
    let ok = unsafe {
        GetFileVersionInfoW(
            wide_path.as_ptr(),
            handle,
            size,
            buffer.as_mut_ptr() as *mut std::ffi::c_void,
        )
    };
    if ok == 0 {
        return None;
    }

    // Query available translations to find the correct language/codepage
    let translation_block: Vec<u16> = OsStr::new("\\VarFileInfo\\Translation")
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let mut trans_ptr: *const std::ffi::c_void = ptr::null();
    let mut trans_len: u32 = 0;
    let ok = unsafe {
        VerQueryValueW(
            buffer.as_ptr() as *const std::ffi::c_void,
            translation_block.as_ptr(),
            &mut trans_ptr,
            &mut trans_len,
        )
    };
    if ok == 0 || trans_ptr.is_null() || trans_len < 4 {
        return None;
    }

    // Read the first translation entry (language + codepage)
    let trans_slice =
        unsafe { std::slice::from_raw_parts(trans_ptr as *const u8, trans_len as usize) };
    let lang = u16::from_le_bytes([trans_slice[0], trans_slice[1]]);
    let codepage = u16::from_le_bytes([trans_slice[2], trans_slice[3]]);

    let query = format!(
        "\\StringFileInfo\\{:04x}{:04x}\\FileVersion\0",
        lang, codepage
    );
    let query_wide: Vec<u16> = OsStr::new(&query)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let mut ptr: *const std::ffi::c_void = ptr::null();
    let mut len: u32 = 0;
    let ok = unsafe {
        VerQueryValueW(
            buffer.as_ptr() as *const std::ffi::c_void,
            query_wide.as_ptr(),
            &mut ptr,
            &mut len,
        )
    };
    if ok == 0 || ptr.is_null() {
        return None;
    }

    let slice = unsafe { std::slice::from_raw_parts(ptr as *const u16, len as usize) };
    let version_str = String::from_utf16_lossy(slice)
        .trim_end_matches('\0')
        .to_string();
    if version_str.is_empty() {
        return None;
    }
    // Strip trailing ".0" segments (e.g. "4.5.2.0" -> "4.5.2")
    let mut parts: Vec<&str> = version_str.split('.').collect();
    while parts.len() > 1 && parts.last() == Some(&"0") {
        parts.pop();
    }
    Some(parts.join("."))
}

/// Read version from StardewModdingAPI.deps.json
fn read_version_from_deps_json(path: &Path) -> Option<String> {
    let content = fs::read_to_string(path).ok()?;
    // Look for "SMAPI/x.y.z" pattern in the deps.json
    if let Some(idx) = content.find("SMAPI/") {
        let rest = &content[idx + 6..];
        let end = rest
            .find(|c: char| !c.is_ascii_digit() && c != '.')
            .unwrap_or(rest.len());
        let ver = &rest[..end];
        if !ver.is_empty() {
            return Some(ver.to_string());
        }
    }
    None
}

pub fn get_smapi_log_path() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var("APPDATA").ok()?;
        Some(
            PathBuf::from(appdata)
                .join("StardewValley")
                .join("ErrorLogs")
                .join("SMAPI-latest.txt"),
        )
    }
    #[cfg(not(target_os = "windows"))]
    {
        let home = std::env::var("HOME").ok()?;
        Some(
            PathBuf::from(home)
                .join(".config")
                .join("StardewValley")
                .join("ErrorLogs")
                .join("SMAPI-latest.txt"),
        )
    }
}

fn find_smapi_launcher(game_path: &Path) -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let exe = game_path.join("StardewModdingAPI.exe");
        if exe.exists() {
            return Some(exe);
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let exe = game_path.join("StardewModdingAPI");
        if exe.exists() {
            return Some(exe);
        }

        let renamed_exe = game_path.join("StardewValley");
        if renamed_exe.exists() {
            return Some(renamed_exe);
        }
    }

    None
}

fn ensure_smapi_deps_json(game_path: &Path) -> Result<(), String> {
    let source = game_path.join("Stardew Valley.deps.json");
    let target = game_path.join("StardewModdingAPI.deps.json");

    if !source.exists() {
        if target.exists() {
            return Ok(());
        }
        return Err("安装包中未找到 Stardew Valley.deps.json，无法按手动流程创建 StardewModdingAPI.deps.json。".to_string());
    }

    fs::copy(&source, &target).map_err(|e| {
        format!(
            "复制 Stardew Valley.deps.json 到 StardewModdingAPI.deps.json 失败: {}",
            e
        )
    })?;
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn apply_unix_launcher_layout(game_path: &Path) -> Result<(), String> {
    let original = game_path.join("StardewValley-original");
    let launcher = game_path.join("StardewValley");
    let smapi_launcher = game_path.join("StardewModdingAPI");

    if launcher.exists() {
        if !original.exists() {
            fs::rename(&launcher, &original).map_err(|e| {
                format!("重命名 StardewValley 到 StardewValley-original 失败: {}", e)
            })?;
        }
    }

    if smapi_launcher.exists() {
        if launcher.exists() {
            fs::remove_file(&smapi_launcher)
                .map_err(|e| format!("清理重复的 StardewModdingAPI 启动文件失败: {}", e))?;
            return Ok(());
        }

        fs::rename(&smapi_launcher, &launcher)
            .map_err(|e| format!("重命名 StardewModdingAPI 到 StardewValley 失败: {}", e))?;
    }

    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn restore_unix_launcher_layout(game_path: &Path) -> Result<(), String> {
    let original = game_path.join("StardewValley-original");
    let launcher = game_path.join("StardewValley");
    let smapi_launcher = game_path.join("StardewModdingAPI");

    if smapi_launcher.exists() {
        fs::remove_file(&smapi_launcher)
            .map_err(|e| format!("删除 StardewModdingAPI 失败: {}", e))?;
    }

    if original.exists() {
        if launcher.exists() {
            fs::remove_file(&launcher)
                .map_err(|e| format!("移除当前 StardewValley 启动文件失败: {}", e))?;
        }

        fs::rename(&original, &launcher)
            .map_err(|e| format!("恢复 StardewValley-original 到 StardewValley 失败: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn install_smapi(game_dir: String, download_url: String) -> Result<(), String> {
    let game_path = Path::new(&game_dir);
    if !game_path.exists() {
        return Err("游戏安装目录不存在。".to_string());
    }

    let temp_dir = game_path.join(".smapi_temp");
    if temp_dir.exists() {
        let _ = fs::remove_dir_all(&temp_dir);
    }
    fs::create_dir_all(&temp_dir).map_err(|e| format!("无法创建临时文件夹: {}", e))?;

    let zip_path = temp_dir.join("smapi_installer.zip");

    // Download
    download_file(&download_url, &zip_path)?;

    // Extract (handle double-zipped installers)
    let extract_dir = temp_dir.join("extracted");
    fs::create_dir_all(&extract_dir).map_err(|e| format!("无法创建解压文件夹: {}", e))?;
    extract_zip(&zip_path, &extract_dir)?;

    // Check for inner zip files (double-zipped format)
    fn find_zip(dir: &Path) -> Option<PathBuf> {
        if dir.is_dir() {
            if let Ok(entries) = fs::read_dir(dir) {
                for entry in entries.flatten() {
                    let p = entry.path();
                    if p.extension()
                        .map_or(false, |ext| ext.to_string_lossy().to_lowercase() == "zip")
                    {
                        return Some(p);
                    }
                    if let Some(inner) = find_zip(&p) {
                        return Some(inner);
                    }
                }
            }
        }
        None
    }

    if let Some(inner_zip) = find_zip(&extract_dir) {
        let inner_extract_dir = temp_dir.join("extracted_inner");
        fs::create_dir_all(&inner_extract_dir)
            .map_err(|e| format!("无法创建内层解压文件夹: {}", e))?;
        extract_zip(&inner_zip, &inner_extract_dir)?;
        // Replace extract_dir contents by removing old and renaming
        let _ = fs::remove_dir_all(&extract_dir);
        fs::rename(&inner_extract_dir, &extract_dir)
            .map_err(|e| format!("内层解压目录替换失败: {}", e))?;
    }

    // Search for internal folder
    fn find_internal(dir: &Path) -> Option<PathBuf> {
        if let Some(name) = dir.file_name() {
            if name.to_string_lossy().to_lowercase() == "internal" {
                return Some(dir.to_path_buf());
            }
        }
        if dir.is_dir() {
            if let Ok(entries) = fs::read_dir(dir) {
                for entry in entries.flatten() {
                    if let Some(p) = find_internal(&entry.path()) {
                        return Some(p);
                    }
                }
            }
        }
        None
    }

    let found_internal = find_internal(&extract_dir)
        .ok_or_else(|| "在下载的安装包中未找到 internal 文件夹。".to_string())?;

    // Find platform folder
    #[cfg(target_os = "windows")]
    let platform_name = "windows";
    #[cfg(target_os = "macos")]
    let platform_name = "mac";
    #[cfg(target_os = "linux")]
    let platform_name = "linux";

    let mut platform_path = None;
    if let Ok(entries) = fs::read_dir(&found_internal) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_lowercase();
            if name == platform_name || (platform_name == "mac" && name.contains("mac")) {
                platform_path = Some(entry.path());
                break;
            }
        }
    }

    let plat_path = platform_path.unwrap_or(found_internal);

    // Find install.dat inside the platform folder (it's a zip archive containing the actual SMAPI files)
    let install_dat = plat_path.join("install.dat");
    if !install_dat.exists() {
        let _ = fs::remove_dir_all(&temp_dir);
        return Err(format!(
            "在平台目录中未找到 install.dat: {}",
            plat_path.display()
        ));
    }

    // Extract install.dat (it's a zip) to get the actual SMAPI files
    let install_extract_dir = temp_dir.join("install_files");
    fs::create_dir_all(&install_extract_dir)
        .map_err(|e| format!("无法创建 install.dat 解压文件夹: {}", e))?;
    extract_zip(&install_dat, &install_extract_dir)?;

    // Copy the extracted SMAPI files to game folder
    copy_dir_all(&install_extract_dir, game_path)
        .map_err(|e| format!("拷贝文件到游戏目录失败: {}", e))?;

    // Manual install compatibility: copy Stardew Valley.deps.json to StardewModdingAPI.deps.json
    ensure_smapi_deps_json(game_path)?;

    #[cfg(not(target_os = "windows"))]
    apply_unix_launcher_layout(game_path)?;

    // Cleanup
    let _ = fs::remove_dir_all(&temp_dir);

    Ok(())
}

#[tauri::command]
pub fn uninstall_smapi(game_dir: String) -> Result<(), String> {
    let game_path = Path::new(&game_dir);
    if !game_path.exists() {
        return Err("游戏安装目录不存在。".to_string());
    }

    #[cfg(target_os = "windows")]
    let files_to_delete = vec![
        "StardewModdingAPI.exe",
        "StardewModdingAPI.dll",
        "StardewModdingAPI.deps.json",
        "StardewModdingAPI.runtimeconfig.json",
        "StardewModdingAPI.pdb",
        "StardewModdingAPI.xml",
        "StardewModdingAPI",
    ];

    #[cfg(not(target_os = "windows"))]
    let files_to_delete = vec![
        "StardewModdingAPI",
        "StardewModdingAPI.dll",
        "StardewModdingAPI.deps.json",
        "StardewModdingAPI.runtimeconfig.json",
        "StardewModdingAPI.pdb",
        "StardewModdingAPI.xml",
        "Stardew Valley.deps.json",
    ];

    for file in files_to_delete {
        let p = game_path.join(file);
        if p.exists() {
            fs::remove_file(p).map_err(|e| format!("删除文件 {} 失败: {}", file, e))?;
        }
    }

    #[cfg(not(target_os = "windows"))]
    restore_unix_launcher_layout(game_path)?;

    let dirs_to_delete = vec!["smapi-internal"];

    for dir in dirs_to_delete {
        let p = game_path.join(dir);
        if p.exists() {
            fs::remove_dir_all(p).map_err(|e| format!("删除文件夹 {} 失败: {}", dir, e))?;
        }
    }

    Ok(())
}
