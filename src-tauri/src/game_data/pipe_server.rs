use serde::{Deserialize, Serialize};
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::windows::named_pipe::{NamedPipeServer, ServerOptions};
use tokio::sync::{mpsc, Mutex};

use super::live_state::{ItemPricesPayload, LiveGameState, NpcLocationsPayload};

const PIPE_NAME: &str = r"\\.\pipe\stardew-valley-assistant";

#[derive(Serialize, Deserialize, Debug)]
#[serde(tag = "type")]
pub enum ModMessage {
    #[serde(rename = "npcLocations")]
    NpcLocations { data: NpcLocationsPayload },
    #[serde(rename = "itemPrices")]
    ItemPrices { data: ItemPricesPayload },
    #[serde(rename = "cheatResult")]
    CheatResult { data: CheatResultPayload },
    #[serde(rename = "clear")]
    Clear,
    #[serde(rename = "ping")]
    Ping,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CheatResultPayload {
    pub action: String,
    pub success: bool,
    pub message: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(tag = "type")]
pub enum TauriMessage {
    #[serde(rename = "requestNpcLocations")]
    RequestNpcLocations,
    #[serde(rename = "requestItemPrices")]
    RequestItemPrices,
    #[serde(rename = "pong")]
    Pong,

    // 作弊指令
    #[serde(rename = "cheatRefillEnergy")]
    CheatRefillEnergy,
    #[serde(rename = "cheatRefillHealth")]
    CheatRefillHealth,
    #[serde(rename = "cheatToggleSpeed")]
    CheatToggleSpeed { enabled: bool },
    #[serde(rename = "cheatToggleFreezeTime")]
    CheatToggleFreezeTime { enabled: bool },
    #[serde(rename = "cheatWaterCrops")]
    CheatWaterCrops,
    #[serde(rename = "cheatGrowCrops")]
    CheatGrowCrops,
    #[serde(rename = "cheatTeleport")]
    CheatTeleport { location: String },
    #[serde(rename = "cheatAddItem")]
    CheatAddItem { item_id: String, count: i32 },
    #[serde(rename = "cheatAddMoney")]
    CheatAddMoney { amount: i32 },
    #[serde(rename = "cheatMaxFriendship")]
    CheatMaxFriendship,
    #[serde(rename = "cheatKillMonsters")]
    CheatKillMonsters,
    #[serde(rename = "cheatSetWeather")]
    CheatSetWeather { weather: String },
}

#[derive(Clone)]
pub struct PipeWriterHandle {
    inner: Arc<Mutex<Option<mpsc::Sender<TauriMessage>>>>,
}

impl PipeWriterHandle {
    pub fn new() -> Self {
        Self { inner: Arc::new(Mutex::new(None)) }
    }

    pub async fn send(&self, msg: TauriMessage) -> bool {
        let guard = self.inner.lock().await;
        if let Some(ref tx) = *guard {
            tx.send(msg).await.is_ok()
        } else {
            false
        }
    }

    pub(crate) async fn set(&self, tx: mpsc::Sender<TauriMessage>) {
        let mut guard = self.inner.lock().await;
        *guard = Some(tx);
    }

    pub(crate) async fn clear(&self) {
        let mut guard = self.inner.lock().await;
        *guard = None;
    }
}

pub async fn start_pipe_server(state: LiveGameState, writer_handle: PipeWriterHandle) {
    run_pipe_server(state, writer_handle).await;
}

/// 管道服务器主状态机 — 纯事件驱动，通过 Box::pin 递归实现状态转换
fn run_pipe_server(
    state: LiveGameState,
    writer_handle: PipeWriterHandle,
) -> Pin<Box<dyn Future<Output = ()> + Send>> {
    Box::pin(async move {
        // 状态 1：创建管道实例
        let server = match ServerOptions::new().create(PIPE_NAME) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[管道] 创建命名管道失败: {}", e);
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                return run_pipe_server(state, writer_handle).await;
            }
        };

        // 状态 2：等待客户端连接
        println!("[管道] 等待 Mod 连接...");
        on_connect(server, state, writer_handle).await;
    })
}

/// 状态 2：客户端握手
fn on_connect(
    server: NamedPipeServer,
    state: LiveGameState,
    writer_handle: PipeWriterHandle,
) -> Pin<Box<dyn Future<Output = ()> + Send>> {
    Box::pin(async move {
        if let Err(e) = server.connect().await {
            eprintln!("[管道] 等待连接失败: {}", e);
            return run_pipe_server(state, writer_handle).await;
        }

        println!("[管道] Mod 已连接");
        state.set_pipe_connected(true).await;

        let (tx, rx) = mpsc::channel::<TauriMessage>(32);
        writer_handle.set(tx).await;

        let (reader, writer) = tokio::io::split(server);
        let reader = BufReader::new(reader);

        // 状态 3：事件循环
        on_event(state, writer_handle, reader, writer, rx, String::new()).await;
    })
}

/// 状态 3：事件驱动 I/O — 每次 select 处理一个事件，然后递归等待下一个
fn on_event(
    state: LiveGameState,
    writer_handle: PipeWriterHandle,
    mut reader: BufReader<tokio::io::ReadHalf<NamedPipeServer>>,
    mut writer: tokio::io::WriteHalf<NamedPipeServer>,
    mut rx: mpsc::Receiver<TauriMessage>,
    mut line_buf: String,
) -> Pin<Box<dyn Future<Output = ()> + Send>> {
    Box::pin(async move {
        tokio::select! {
            // 事件：从 Mod 收到一行数据
            result = reader.read_line(&mut line_buf) => {
                match result {
                    Ok(0) => {
                        println!("[管道←] 连接关闭 (EOF)");
                        on_disconnect(state, writer_handle).await;
                    }
                    Ok(n) => {
                        let trimmed = line_buf.trim().to_owned();
                        line_buf.clear();
                        if !trimmed.is_empty() {
                            println!(
                                "[管道←] 收到 {} bytes: {}",
                                n,
                                if trimmed.len() > 120 { format!("{}...", &trimmed[..120]) } else { trimmed.clone() }
                            );
                            match serde_json::from_str::<ModMessage>(&trimmed) {
                                Ok(msg) => handle_mod_message(msg, &state).await,
                                Err(e) => eprintln!("[管道←] 解析失败: {}", e),
                            }
                        }
                        // 继续等待下一个事件
                        on_event(state, writer_handle, reader, writer, rx, line_buf).await;
                    }
                    Err(e) => {
                        eprintln!("[管道←] 读取失败: {}", e);
                        on_disconnect(state, writer_handle).await;
                    }
                }
            }
            // 事件：Tauri 命令请求发送消息给 Mod
            msg = rx.recv() => {
                match msg {
                    Some(msg) => {
                        if let Ok(json) = serde_json::to_string(&msg) {
                            println!(
                                "[管道→] 发送: {}",
                                if json.len() > 120 { format!("{}...", &json[..120]) } else { json.clone() }
                            );
                            let mut bytes = json.into_bytes();
                            bytes.push(b'\n');
                            if writer.write_all(&bytes).await.is_err() {
                                eprintln!("[管道→] 写入失败");
                                on_disconnect(state, writer_handle).await;
                                return;
                            }
                        }
                        // 继续等待下一个事件
                        on_event(state, writer_handle, reader, writer, rx, line_buf).await;
                    }
                    None => {
                        // 发送端已关闭
                        on_disconnect(state, writer_handle).await;
                    }
                }
            }
        }
    })
}

/// 状态转换：断开 → 清理 → 回到等待连接
fn on_disconnect(
    state: LiveGameState,
    writer_handle: PipeWriterHandle,
) -> Pin<Box<dyn Future<Output = ()> + Send>> {
    Box::pin(async move {
        writer_handle.clear().await;
        state.set_pipe_connected(false).await;
        println!("[管道] Mod 断开连接，等待重新连接...");
        run_pipe_server(state, writer_handle).await;
    })
}

async fn handle_mod_message(msg: ModMessage, state: &LiveGameState) {
    match msg {
        ModMessage::NpcLocations { data } => {
            println!("[处理] npcLocations: {} 个NPC, 时间={:?}", data.npcs.len(), data.game_time);
            state.update_npc_locations(data).await;
        }
        ModMessage::ItemPrices { data } => {
            println!("[处理] itemPrices: {} 个物品", data.prices.len());
            state.update_item_prices(data).await;
        }
        ModMessage::CheatResult { data } => {
            println!("[处理] cheatResult: action={}, success={}, message={}", data.action, data.success, data.message);
            state.update_cheat_result(data).await;
        }
        ModMessage::Clear => {
            println!("[处理] clear");
            state.clear().await;
        }
        ModMessage::Ping => {
            println!("[处理] ping");
        }
    }
}
