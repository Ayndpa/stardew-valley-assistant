use axum::{
    extract::State,
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use std::net::SocketAddr;
use std::path::PathBuf;
use tower_http::cors::{Any, CorsLayer};

use super::live_state::{
    ItemPricesPayload, LiveGameState, NpcLocationsPayload,
};

/// Start the local HTTP server for receiving live game data from the SMAPI mod.
/// Returns the port number the server is listening on.
pub async fn start_live_server(state: LiveGameState) -> Result<u16, String> {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/api/health", get(health_handler))
        .route("/api/npc-locations", post(npc_locations_handler))
        .route("/api/item-prices", post(item_prices_handler))
        .route("/api/clear", post(clear_handler))
        .layer(cors)
        .with_state(state);

    // Bind to a random available port on localhost
    let addr = SocketAddr::from(([127, 0, 0, 1], 0));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| format!("无法启动本地服务器: {}", e))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("无法获取服务器端口: {}", e))?
        .port();

    // Write port to file for the mod to discover
    write_port_file(port)?;

    // Spawn the server in the background
    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            eprintln!("本地服务器错误: {}", e);
        }
    });

    Ok(port)
}

async fn health_handler() -> StatusCode {
    StatusCode::OK
}

async fn npc_locations_handler(
    State(state): State<LiveGameState>,
    Json(payload): Json<NpcLocationsPayload>,
) -> StatusCode {
    state.update_npc_locations(payload).await;
    StatusCode::OK
}

async fn item_prices_handler(
    State(state): State<LiveGameState>,
    Json(payload): Json<ItemPricesPayload>,
) -> StatusCode {
    state.update_item_prices(payload).await;
    StatusCode::OK
}

async fn clear_handler(State(state): State<LiveGameState>) -> StatusCode {
    state.clear().await;
    StatusCode::OK
}

/// Write the server port to a file so the mod can discover it.
fn write_port_file(port: u16) -> Result<(), String> {
    let path = port_file_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("无法创建端口文件目录: {}", e))?;
    }
    std::fs::write(&path, port.to_string())
        .map_err(|e| format!("无法写入端口文件: {}", e))?;
    Ok(())
}

/// Remove the port file (called on app exit).
pub fn remove_port_file() {
    let path = port_file_path();
    let _ = std::fs::remove_file(path);
}

/// Get the path to the port file.
fn port_file_path() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var("APPDATA").unwrap_or_default();
        PathBuf::from(appdata)
            .join("StardewValley")
            .join("StardewValleyAssistant")
            .join("server-port.txt")
    }
    #[cfg(not(target_os = "windows"))]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        PathBuf::from(home)
            .join(".config")
            .join("StardewValley")
            .join("StardewValleyAssistant")
            .join("server-port.txt")
    }
}
