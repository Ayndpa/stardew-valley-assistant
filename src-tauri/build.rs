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
    tauri_build::build()
}
