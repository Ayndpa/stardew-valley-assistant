use serde::Serialize;
use tauri::State;

use super::live_state::LiveGameState;
use super::pipe_server::{PipeWriterHandle, TauriMessage};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheatResponse {
    pub success: bool,
    pub message: String,
    pub speed_enabled: bool,
    pub freeze_time_enabled: bool,
}

/// 发送作弊指令并等待结果
async fn send_cheat_command(
    writer: &PipeWriterHandle,
    state: &LiveGameState,
    msg: TauriMessage,
    action_name: &str,
) -> Result<CheatResponse, String> {
    if !writer.send(msg).await {
        return Err("未连接到游戏模组，请确认游戏已启动并安装了助手模组".to_string());
    }

    // 等待结果，最多3秒
    let mut attempts = 0;
    loop {
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        attempts += 1;

        let results = state.take_cheat_results().await;
        if let Some(result) = results.into_iter().find(|r| r.action == action_name) {
            let (speed, freeze) = state.get_cheat_states().await;
            return Ok(CheatResponse {
                success: result.success,
                message: result.message,
                speed_enabled: speed,
                freeze_time_enabled: freeze,
            });
        }

        if attempts >= 30 {
            let (speed, freeze) = state.get_cheat_states().await;
            return Ok(CheatResponse {
                success: false,
                message: "操作超时，请检查游戏是否响应".to_string(),
                speed_enabled: speed,
                freeze_time_enabled: freeze,
            });
        }
    }
}

#[tauri::command]
pub async fn cheat_refill_energy(
    writer: State<'_, PipeWriterHandle>,
    state: State<'_, LiveGameState>,
) -> Result<CheatResponse, String> {
    send_cheat_command(&writer, &state, TauriMessage::CheatRefillEnergy, "refillEnergy").await
}

#[tauri::command]
pub async fn cheat_refill_health(
    writer: State<'_, PipeWriterHandle>,
    state: State<'_, LiveGameState>,
) -> Result<CheatResponse, String> {
    send_cheat_command(&writer, &state, TauriMessage::CheatRefillHealth, "refillHealth").await
}

#[tauri::command]
pub async fn cheat_toggle_speed(
    writer: State<'_, PipeWriterHandle>,
    state: State<'_, LiveGameState>,
    enabled: bool,
) -> Result<CheatResponse, String> {
    send_cheat_command(&writer, &state, TauriMessage::CheatToggleSpeed { enabled }, "toggleSpeed").await
}

#[tauri::command]
pub async fn cheat_toggle_freeze_time(
    writer: State<'_, PipeWriterHandle>,
    state: State<'_, LiveGameState>,
    enabled: bool,
) -> Result<CheatResponse, String> {
    send_cheat_command(&writer, &state, TauriMessage::CheatToggleFreezeTime { enabled }, "toggleFreezeTime").await
}

#[tauri::command]
pub async fn cheat_water_crops(
    writer: State<'_, PipeWriterHandle>,
    state: State<'_, LiveGameState>,
) -> Result<CheatResponse, String> {
    send_cheat_command(&writer, &state, TauriMessage::CheatWaterCrops, "waterCrops").await
}

#[tauri::command]
pub async fn cheat_grow_crops(
    writer: State<'_, PipeWriterHandle>,
    state: State<'_, LiveGameState>,
) -> Result<CheatResponse, String> {
    send_cheat_command(&writer, &state, TauriMessage::CheatGrowCrops, "growCrops").await
}

#[tauri::command]
pub async fn cheat_teleport(
    writer: State<'_, PipeWriterHandle>,
    state: State<'_, LiveGameState>,
    location: String,
) -> Result<CheatResponse, String> {
    send_cheat_command(&writer, &state, TauriMessage::CheatTeleport { location }, "teleport").await
}

#[tauri::command]
pub async fn cheat_add_item(
    writer: State<'_, PipeWriterHandle>,
    state: State<'_, LiveGameState>,
    item_id: String,
    count: i32,
) -> Result<CheatResponse, String> {
    send_cheat_command(&writer, &state, TauriMessage::CheatAddItem { item_id, count }, "addItem").await
}

#[tauri::command]
pub async fn cheat_add_money(
    writer: State<'_, PipeWriterHandle>,
    state: State<'_, LiveGameState>,
    amount: i32,
) -> Result<CheatResponse, String> {
    send_cheat_command(&writer, &state, TauriMessage::CheatAddMoney { amount }, "addMoney").await
}

#[tauri::command]
pub async fn cheat_max_friendship(
    writer: State<'_, PipeWriterHandle>,
    state: State<'_, LiveGameState>,
) -> Result<CheatResponse, String> {
    send_cheat_command(&writer, &state, TauriMessage::CheatMaxFriendship, "maxFriendship").await
}

#[tauri::command]
pub async fn cheat_kill_monsters(
    writer: State<'_, PipeWriterHandle>,
    state: State<'_, LiveGameState>,
) -> Result<CheatResponse, String> {
    send_cheat_command(&writer, &state, TauriMessage::CheatKillMonsters, "killMonsters").await
}

#[tauri::command]
pub async fn cheat_set_weather(
    writer: State<'_, PipeWriterHandle>,
    state: State<'_, LiveGameState>,
    weather: String,
) -> Result<CheatResponse, String> {
    send_cheat_command(&writer, &state, TauriMessage::CheatSetWeather { weather }, "setWeather").await
}

/// 获取当前作弊状态（速度加成、冻结时间的开关状态）
#[tauri::command]
pub async fn get_cheat_states(
    state: State<'_, LiveGameState>,
) -> Result<CheatResponse, String> {
    let (speed, freeze) = state.get_cheat_states().await;
    Ok(CheatResponse {
        success: true,
        message: String::new(),
        speed_enabled: speed,
        freeze_time_enabled: freeze,
    })
}
