use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, RwLock};

use super::live_state::{ItemPricesPayload, LiveGameState, NpcLocationsPayload};

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
///
/// Keeps the pipe always available by creating the next server instance immediately
/// after the current one accepts a connection, before processing messages.
pub async fn start_pipe_server(state: LiveGameState) -> Result<(), String> {
    use tokio::net::windows::named_pipe::ServerOptions;

    let (tx, _rx) = mpsc::channel::<TauriMessage>(32);
    let tx = Arc::new(RwLock::new(tx));

    let state_clone = state.clone();
    tokio::spawn(async move {
        // Create the first pipe instance
        let mut server = match ServerOptions::new()
            .first_pipe_instance(true)
            .create(PIPE_NAME)
        {
            Ok(s) => s,
            Err(e) => {
                eprintln!("创建命名管道失败: {}", e);
                return;
            }
        };

        println!("等待 Mod 连接管道: {}", PIPE_NAME);

        loop {
            // Wait for a client to connect
            match server.connect().await {
                Ok(()) => {
                    println!("Mod 已连接");
                }
                Err(e) => {
                    eprintln!("等待连接失败: {}", e);
                    // Recreate the pipe instance and retry
                    tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                    server = match ServerOptions::new()
                        .first_pipe_instance(false)
                        .create(PIPE_NAME)
                    {
                        Ok(s) => s,
                        Err(e) => {
                            eprintln!("重建命名管道失败: {}", e);
                            return;
                        }
                    };
                    println!("等待 Mod 连接管道: {}", PIPE_NAME);
                    continue;
                }
            }

            // Create the next instance IMMEDIATELY so the pipe stays available
            // for other clients while we process this one
            let next_server = match ServerOptions::new()
                .first_pipe_instance(false)
                .create(PIPE_NAME)
            {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("创建下一个管道实例失败: {}", e);
                    return;
                }
            };

            // Process current connection in a background task
            let state = state_clone.clone();
            let tx = tx.clone();
            tokio::spawn(async move {
                process_connection(server, &state, &tx).await;
                println!("Mod 断开连接，等待重新连接...");
            });

            // The next server instance is now ready for the next client
            server = next_server;
            println!("等待 Mod 连接管道: {}", PIPE_NAME);
        }
    });

    Ok(())
}

/// Read and handle messages from a connected client until it disconnects.
async fn process_connection(
    server: tokio::net::windows::named_pipe::NamedPipeServer,
    state: &LiveGameState,
    tx: &Arc<RwLock<mpsc::Sender<TauriMessage>>>,
) {
    let (reader, mut writer) = tokio::io::split(server);
    let mut reader = BufReader::new(reader);
    let mut line = String::new();

    loop {
        line.clear();
        match reader.read_line(&mut line).await {
            Ok(0) => {
                return;
            }
            Ok(_) => {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }

                match serde_json::from_str::<ModMessage>(trimmed) {
                    Ok(msg) => {
                        handle_mod_message(msg, state, tx, &mut writer).await;
                    }
                    Err(e) => {
                        eprintln!("解析 Mod 消息失败: {}", e);
                    }
                }
            }
            Err(e) => {
                eprintln!("读取管道数据失败: {}", e);
                return;
            }
        }
    }
}

async fn handle_mod_message(
    msg: ModMessage,
    state: &LiveGameState,
    _tx: &Arc<RwLock<mpsc::Sender<TauriMessage>>>,
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

