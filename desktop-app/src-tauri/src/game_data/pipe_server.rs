use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, Mutex};

use super::live_state::{LiveGameState, NpcLocationsPayload};

/// 管道名。游戏内运行时用的是 `NamedPipeClientStream(".", PIPE_BASE_NAME)`
/// （见 runtime-src/Assistant.Runtime/PipeClient.cs），两端必须一致。
const PIPE_BASE_NAME: &str = "stardew-valley-assistant";

#[derive(Serialize, Deserialize, Debug)]
#[serde(tag = "type")]
pub enum ModMessage {
    #[serde(rename = "npcLocations")]
    NpcLocations { data: NpcLocationsPayload },
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

/// 承载管道的具体传输层。
///
/// Windows 用命名管道；macOS / Linux 上 .NET 的 `NamedPipeClientStream` 实际是
/// 一个 Unix 域套接字，路径为 `<临时目录>/CoreFxPipe_<管道名>`，所以这里在同一
/// 位置监听，游戏内运行时那边不用改一行代码。
#[cfg(windows)]
mod transport {
    use super::PIPE_BASE_NAME;
    use tokio::net::windows::named_pipe::{NamedPipeServer, ServerOptions};

    pub type Stream = NamedPipeServer;

    /// 命名管道没有「监听套接字」这一层：每接受一个客户端都要新建一个实例。
    pub struct Listener {
        name: String,
    }

    impl Listener {
        pub fn bind() -> Result<Self, String> {
            Ok(Self {
                name: format!(r"\\.\pipe\{PIPE_BASE_NAME}"),
            })
        }

        pub fn endpoint(&self) -> String {
            self.name.clone()
        }

        pub async fn accept(&self) -> Result<Stream, String> {
            let server = ServerOptions::new()
                .create(&self.name)
                .map_err(|e| format!("创建命名管道失败: {e}"))?;
            server
                .connect()
                .await
                .map_err(|e| format!("等待连接失败: {e}"))?;
            Ok(server)
        }
    }
}

#[cfg(unix)]
mod transport {
    use super::PIPE_BASE_NAME;
    use std::path::PathBuf;
    use tokio::net::{UnixListener, UnixStream};

    pub type Stream = UnixStream;

    /// 与 .NET 的 `PipeStream.GetPipePath` 保持一致：`Path.GetTempPath()` 即
    /// `$TMPDIR`（缺省 `/tmp`），前缀固定是 `CoreFxPipe_`。
    fn socket_path() -> PathBuf {
        std::env::temp_dir().join(format!("CoreFxPipe_{PIPE_BASE_NAME}"))
    }

    pub struct Listener {
        inner: UnixListener,
        path: PathBuf,
    }

    impl Listener {
        pub fn bind() -> Result<Self, String> {
            let path = socket_path();
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("创建套接字目录 {} 失败: {e}", parent.display()))?;
            }
            // 上次非正常退出会把套接字文件留在盘上，bind 会因「地址已被占用」失败。
            let _ = std::fs::remove_file(&path);
            let inner = UnixListener::bind(&path)
                .map_err(|e| format!("监听 {} 失败: {e}", path.display()))?;
            Ok(Self { inner, path })
        }

        pub fn endpoint(&self) -> String {
            self.path.display().to_string()
        }

        pub async fn accept(&self) -> Result<Stream, String> {
            self.inner
                .accept()
                .await
                .map(|(stream, _)| stream)
                .map_err(|e| format!("等待连接失败: {e}"))
        }
    }

    impl Drop for Listener {
        fn drop(&mut self) {
            // 套接字文件不会随进程退出自动消失，留下来会让下次 bind 失败。
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

pub async fn start_pipe_server(state: LiveGameState, writer_handle: PipeWriterHandle) {
    loop {
        let listener = match transport::Listener::bind() {
            Ok(listener) => listener,
            Err(e) => {
                eprintln!("[管道] {}", e);
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                continue;
            }
        };

        // 同时只服务一个客户端：助手的实时数据只有一份，两个客户端会互相抢。
        loop {
            println!("[管道] 等待 Mod 连接（{}）...", listener.endpoint());
            match listener.accept().await {
                Ok(stream) => serve(stream, &state, &writer_handle).await,
                Err(e) => {
                    eprintln!("[管道] {}", e);
                    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                    // 传输层可能已经失效（管道实例被删、套接字文件被删），重新绑定
                    break;
                }
            }
        }
    }
}

/// 单个连接的事件循环：一边把 Mod 发来的行解析成 [`ModMessage`]，
/// 一边把 Tauri 命令排队的 [`TauriMessage`] 写回去。任一方向出错即断开。
async fn serve<S>(stream: S, state: &LiveGameState, writer_handle: &PipeWriterHandle)
where
    S: AsyncRead + AsyncWrite,
{
    println!("[管道] Mod 已连接");
    state.set_pipe_connected(true).await;

    let (tx, mut rx) = mpsc::channel::<TauriMessage>(32);
    writer_handle.set(tx).await;

    let (reader, mut writer) = tokio::io::split(stream);
    let mut reader = BufReader::new(reader);
    let mut line_buf = String::new();

    loop {
        tokio::select! {
            // 事件：从 Mod 收到一行数据
            result = reader.read_line(&mut line_buf) => {
                match result {
                    Ok(0) => {
                        println!("[管道←] 连接关闭 (EOF)");
                        break;
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
                                Ok(msg) => handle_mod_message(msg, state).await,
                                Err(e) => eprintln!("[管道←] 解析失败: {}", e),
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("[管道←] 读取失败: {}", e);
                        break;
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
                                break;
                            }
                        }
                    }
                    // 发送端已关闭
                    None => break,
                }
            }
        }
    }

    writer_handle.clear().await;
    state.set_pipe_connected(false).await;
    println!("[管道] Mod 断开连接，等待重新连接...");
}

async fn handle_mod_message(msg: ModMessage, state: &LiveGameState) {
    match msg {
        ModMessage::NpcLocations { data } => {
            println!("[处理] npcLocations: {} 个NPC, 时间={:?}", data.npcs.len(), data.game_time);
            state.update_npc_locations(data).await;
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
