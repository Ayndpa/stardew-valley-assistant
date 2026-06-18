use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, RwLock};

use super::live_state::{
    ItemPricesPayload, LiveGameState, NpcLocationEntry, NpcLocationsPayload,
};

const PIPE_NAME: &str = r"\\.\pipe\stardew-valley-assistant";

/// Messages from Mod to Tauri
#[derive(Serialize, Deserialize, Debug)]
#[serde(tag = "type")]
pub enum ModMessage {
    #[serde(rename = "npcLocations")]
    NpcLocations { data: NpcLocationsPayload },
    #[serde(rename = "itemPrices")]
    ItemPrices { data: ItemPricesPayload },
    #[serde(rename = "clear")]
    Clear,
    #[serde(rename = "ping")]
    Ping,
}

/// Messages from Tauri to Mod
#[derive(Serialize, Deserialize, Debug)]
#[serde(tag = "type")]
pub enum TauriMessage {
    #[serde(rename = "requestNpcLocations")]
    RequestNpcLocations,
    #[serde(rename = "requestItemPrices")]
    RequestItemPrices,
    #[serde(rename = "pong")]
    Pong,
}

/// Start the named pipe server for bidirectional communication with the SMAPI mod.
pub async fn start_pipe_server(state: LiveGameState) -> Result<(), String> {
    let (tx, mut rx) = mpsc::channel::<TauriMessage>(32);
    let tx = Arc::new(RwLock::new(tx));

    // Spawn the pipe server
    let state_clone = state.clone();
    tokio::spawn(async move {
        loop {
            match accept_connection(&state_clone, &tx).await {
                Ok(_) => {
                    println!("Mod 断开连接，等待重新连接...");
                }
                Err(e) => {
                    eprintln!("管道连接错误: {}", e);
                }
            }
            // Wait a bit before accepting new connection
            tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
        }
    });

    Ok(())
}

async fn accept_connection(
    state: &LiveGameState,
    tx: &Arc<RwLock<mpsc::Sender<TauriMessage>>>,
) -> Result<(), String> {
    use tokio::net::windows::named_pipe::{ServerOptions, NamedPipeServer};

    let server = ServerOptions::new()
        .first_pipe_instance(true)
        .create(PIPE_NAME)
        .map_err(|e| format!("创建命名管道失败: {}", e))?;

    println!("等待 Mod 连接管道: {}", PIPE_NAME);

    // Wait for client to connect
    server
        .connect()
        .await
        .map_err(|e| format!("等待连接失败: {}", e))?;

    println!("Mod 已连接");

    let (reader, mut writer) = tokio::io::split(server);
    let mut reader = BufReader::new(reader);
    let mut line = String::new();

    loop {
        line.clear();
        match reader.read_line(&mut line).await {
            Ok(0) => {
                // Connection closed
                return Ok(());
            }
            Ok(_) => {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }

                match serde_json::from_str::<ModMessage>(trimmed) {
                    Ok(msg) => {
                        handle_mod_message(msg, state, &tx, &mut writer).await;
                    }
                    Err(e) => {
                        eprintln!("解析 Mod 消息失败: {}", e);
                    }
                }
            }
            Err(e) => {
                eprintln!("读取管道数据失败: {}", e);
                return Ok(());
            }
        }
    }
}

async fn handle_mod_message(
    msg: ModMessage,
    state: &LiveGameState,
    tx: &Arc<RwLock<mpsc::Sender<TauriMessage>>>,
    writer: &mut tokio::io::WriteHalf<tokio::net::windows::named_pipe::NamedPipeServer>,
) {
    match msg {
        ModMessage::NpcLocations { data } => {
            state.update_npc_locations(data).await;
        }
        ModMessage::ItemPrices { data } => {
            state.update_item_prices(data).await;
        }
        ModMessage::Clear => {
            state.clear().await;
        }
        ModMessage::Ping => {
            let response = TauriMessage::Pong;
            if let Ok(json) = serde_json::to_string(&response) {
                let _ = writer.write_all(json.as_bytes()).await;
                let _ = writer.write_all(b"\n").await;
            }
        }
    }
}

/// Send a message to the mod via the named pipe.
/// Returns a channel receiver for the response.
pub async fn send_to_mod(msg: TauriMessage, tx: &mpsc::Sender<TauriMessage>) -> Result<(), String> {
    tx.send(msg)
        .await
        .map_err(|e| format!("发送消息失败: {}", e))
}
