//! 跨模块共用的文件与压缩包工具。

use std::fs::{self, File};
use std::io::{self, Read, Seek, Write};
use std::path::{Component, Path, PathBuf};

/// 递归复制目录内容到目标目录。
pub fn copy_dir_all(src: &Path, dst: &Path) -> io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let target = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_all(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

/// 把压缩包里的相对路径拼到目标目录下，并挡掉路径穿越。
///
/// 压缩包是用户提供的，`../` 条目（zip slip）会让解压写到应用目录之外，
/// 所以任何非普通路径段都直接拒绝。
pub fn safe_join(root: &Path, relative: &str) -> Option<PathBuf> {
    let relative = relative.replace('\\', "/");
    let mut out = root.to_path_buf();
    for segment in relative.split('/') {
        if segment.is_empty() || segment == "." {
            continue;
        }
        if segment == ".." {
            return None;
        }
        // Windows 上 `C:` 这类前缀也要挡掉。
        let candidate = Path::new(segment);
        if candidate.components().any(|c| !matches!(c, Component::Normal(_))) {
            return None;
        }
        out.push(segment);
    }
    if out == root {
        return None;
    }
    Some(out)
}

/// 计算目录里的文件数与总字节数。
pub fn dir_stats(dir: &Path) -> (u64, u64) {
    let mut files = 0u64;
    let mut bytes = 0u64;
    let mut stack = vec![dir.to_path_buf()];
    while let Some(current) = stack.pop() {
        let Ok(entries) = fs::read_dir(&current) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_dir() {
                stack.push(entry.path());
            } else if let Ok(meta) = entry.metadata() {
                files += 1;
                bytes += meta.len();
            }
        }
    }
    (files, bytes)
}

/// 把整个压缩包解到目标目录。
pub fn extract_zip(archive: &Path, target: &Path) -> Result<(), String> {
    let file = File::open(archive).map_err(|e| format!("打开压缩包失败: {}", e))?;
    let mut zip =
        zip::ZipArchive::new(file).map_err(|e| format!("压缩包格式不正确: {}", e))?;
    extract_zip_entries(&mut zip, target, |_| true, |_, _| {})
}

/// 按条件解压压缩包条目。
///
/// - `filter` 决定某个条目是否解出来（按压缩包内路径判断）。
/// - `on_progress` 每写完一个文件回调一次，参数是已写字节数与刚写完的条目名。
pub fn extract_zip_entries<R, F, P>(
    zip: &mut zip::ZipArchive<R>,
    target: &Path,
    mut filter: F,
    mut on_progress: P,
) -> Result<(), String>
where
    R: Read + Seek,
    F: FnMut(&str) -> bool,
    P: FnMut(u64, &str),
{
    fs::create_dir_all(target).map_err(|e| format!("创建目标目录失败: {}", e))?;

    let mut written: u64 = 0;
    let mut buffer = vec![0u8; 128 * 1024];

    for index in 0..zip.len() {
        let mut entry = zip
            .by_index(index)
            .map_err(|e| format!("读取压缩包条目失败: {}", e))?;

        // `enclosed_name` 已经挡掉了绝对路径与穿越，但压缩包里的名字仍要自己再核一遍：
        // 它是唯一能拿到原始条目名的地方，而 `safe_join` 的规则要对所有解压路径一致。
        let name = entry.name().to_string();
        if name.ends_with('/') {
            continue;
        }
        if !filter(&name) {
            continue;
        }

        let Some(out_path) = safe_join(target, &name) else {
            return Err(format!("压缩包内含非法路径: {}", name));
        };

        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
        }

        let mut out = File::create(&out_path)
            .map_err(|e| format!("写入 {} 失败: {}", out_path.display(), e))?;
        loop {
            let read = entry
                .read(&mut buffer)
                .map_err(|e| format!("解压 {} 失败: {}", name, e))?;
            if read == 0 {
                break;
            }
            out.write_all(&buffer[..read])
                .map_err(|e| format!("写入 {} 失败: {}", out_path.display(), e))?;
            written += read as u64;
        }
        drop(out);

        on_progress(written, &name);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_join_rejects_traversal() {
        let root = Path::new("/tmp/root");
        assert!(safe_join(root, "../escape").is_none());
        assert!(safe_join(root, "a/../../escape").is_none());
        assert!(safe_join(root, "").is_none());
        assert!(safe_join(root, ".").is_none());
    }

    #[test]
    fn safe_join_accepts_normal_paths() {
        let root = Path::new("/tmp/root");
        assert_eq!(
            safe_join(root, "Content/Data/Crops.xnb"),
            Some(root.join("Content").join("Data").join("Crops.xnb"))
        );
        // 反斜杠分隔符也要能正确切分。
        assert_eq!(
            safe_join(root, "Content\\Maps\\Town.xnb"),
            Some(root.join("Content").join("Maps").join("Town.xnb"))
        );
    }
}
