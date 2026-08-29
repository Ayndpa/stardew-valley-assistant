use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
    // Read beta flag from tauri.conf.json and expose as compile-time env var
    let conf_path = std::path::Path::new("tauri.conf.json");
    if let Ok(contents) = std::fs::read_to_string(conf_path) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&contents) {
            if json
                .get("plugins")
                .and_then(|p| p.get("stardew-valley-assistant"))
                .and_then(|p| p.get("beta"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
            {
                println!("cargo:rustc-env=APP_BETA=true");
            }
        }
    }

    stage_runtime();
    tauri_build::build()
}

/// 构建并汇集注入到游戏进程的那套产物（托管运行时 + 原生注入垫片），
/// 统一放到 `runtime-dist/`，由 tauri.conf.json 作为资源打包。
///
/// 需要本机具备 .NET SDK 且能定位到游戏目录（编译期引用 Stardew Valley.dll）。
/// 设置 `SKIP_ASSISTANT_RUNTIME_BUILD=1` 可跳过——但产物中将不含实时功能。
fn stage_runtime() {
    println!("cargo:rerun-if-env-changed=SKIP_ASSISTANT_RUNTIME_BUILD");
    println!("cargo:rerun-if-changed=runtime-src");
    println!("cargo:rerun-if-changed=injector/src");
    println!("cargo:rerun-if-changed=injector/Cargo.toml");

    if std::env::var("SKIP_ASSISTANT_RUNTIME_BUILD").is_ok() {
        println!("cargo:warning=已跳过助手运行时构建，游戏内实时数据与作弊功能将不可用。");
        return;
    }

    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let dist = root.join("runtime-dist");

    if let Err(message) = build_and_stage(&root, &dist) {
        panic!(
            "构建助手运行时失败: {message}\n\
             该组件需要 .NET SDK，且需能定位《星露谷物语》安装目录\n\
             （可用 GamePath 环境变量指定）。\n\
             如需先跳过，设置 SKIP_ASSISTANT_RUNTIME_BUILD=1。"
        );
    }
}

fn build_and_stage(root: &Path, dist: &Path) -> Result<(), String> {
    let _ = std::fs::remove_dir_all(dist);
    std::fs::create_dir_all(dist).map_err(|e| format!("创建 runtime-dist 失败: {e}"))?;

    let runtime_src = root.join("runtime-src");

    // 1. 托管程序集
    for project in ["Assistant.Runtime", "Assistant.Bootstrap"] {
        let csproj = runtime_src.join(project).join(format!("{project}.csproj"));
        run(
            Command::new("dotnet")
                .arg("build")
                .arg(&csproj)
                .args(["-c", "Release", "-v", "quiet", "--nologo"]),
            &format!("dotnet build {project}"),
        )?;

        let out = runtime_src.join("build").join(project);
        copy_matching(&out, dist, &["dll", "json"])?;
    }

    // 2. 原生注入垫片。这是一次嵌套 cargo 调用：必须清掉外层 cargo 注入的
    //    环境变量，否则子构建会继承外层的目标目录与 RUSTFLAGS 而互相干扰。
    let injector = root.join("injector");
    let mut command = Command::new(std::env::var("CARGO").unwrap_or_else(|_| "cargo".into()));
    command
        .arg("build")
        .args(["--release", "--manifest-path"])
        .arg(injector.join("Cargo.toml"))
        .current_dir(&injector);
    for (key, _) in std::env::vars() {
        if key.starts_with("CARGO_") || key.starts_with("RUST") {
            command.env_remove(key);
        }
    }
    run(&mut command, "cargo build (injector)")?;

    let injector_dll = injector.join("target").join("release").join("assistant_inject.dll");
    std::fs::copy(&injector_dll, dist.join("assistant_inject.dll"))
        .map_err(|e| format!("复制 {} 失败: {e}", injector_dll.display()))?;

    Ok(())
}

fn copy_matching(from: &Path, to: &Path, extensions: &[&str]) -> Result<(), String> {
    let entries = std::fs::read_dir(from)
        .map_err(|e| format!("读取 {} 失败: {e}", from.display()))?;

    for entry in entries.flatten() {
        let path = entry.path();
        let matches = path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| extensions.contains(&e));

        // .deps.json 只在通过 deps 文件解析依赖时才有意义；我们按路径加载并
        // 自带解析器，带上它反而会让人以为依赖是由它解析的。
        let is_deps = path
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.ends_with(".deps.json"));

        if matches && !is_deps {
            let name = path.file_name().ok_or("文件名无效")?;
            std::fs::copy(&path, to.join(name))
                .map_err(|e| format!("复制 {} 失败: {e}", path.display()))?;
        }
    }

    Ok(())
}

fn run(command: &mut Command, label: &str) -> Result<(), String> {
    let output = command
        .output()
        .map_err(|e| format!("{label} 无法执行: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "{label} 退出码 {:?}\n--- stdout ---\n{}\n--- stderr ---\n{}",
            output.status.code(),
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(())
}
