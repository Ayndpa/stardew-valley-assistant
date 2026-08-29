use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::RwLock;

/// Shared state for live game data received from the SMAPI mod via HTTP.
#[derive(Clone)]
pub struct LiveGameState {
    inner: Arc<RwLock<LiveGameStateInner>>,
}

use super::pipe_server::CheatResultPayload;

struct LiveGameStateInner {
    npc_locations: Option<NpcLocationsPayload>,
    last_npc_update: Option<Instant>,
    pipe_connected: bool,
    cheat_results: Vec<CheatResultPayload>,
    speed_enabled: bool,
    freeze_time_enabled: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NpcLocationsPayload {
    pub save_id: Option<String>,
    pub game_time: Option<i32>,
    pub generated_at: Option<String>,
    pub npcs: Vec<NpcLocationEntry>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NpcLocationEntry {
    pub npc_name: String,
    pub location: String,
    pub tile_x: i32,
    pub tile_y: i32,
    pub direction: i32,
}

impl LiveGameState {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(RwLock::new(LiveGameStateInner {
                npc_locations: None,
                last_npc_update: None,
                pipe_connected: false,
                cheat_results: Vec::new(),
                speed_enabled: false,
                freeze_time_enabled: false,
            })),
        }
    }

    /// Update NPC locations from the mod.
    pub async fn update_npc_locations(&self, payload: NpcLocationsPayload) {
        let count = payload.npcs.len();
        let game_time = payload.game_time;
        let mut state = self.inner.write().await;
        state.npc_locations = Some(payload);
        state.last_npc_update = Some(Instant::now());
        println!("[状态] NPC 位置已更新: {} 个NPC, 游戏时间={:?}, is_game_running=true", count, game_time);
    }

    /// Get NPC locations if available and fresh (within 30 seconds).
    pub async fn get_npc_locations(&self) -> Option<NpcLocationsPayload> {
        let state = self.inner.read().await;
        if let Some(ref payload) = state.npc_locations {
            if let Some(last_update) = state.last_npc_update {
                if last_update.elapsed().as_secs() < 30 {
                    return Some(payload.clone());
                }
            }
        }
        None
    }

    /// Check if the game is running (any data received within 30 seconds).
    pub async fn is_game_running(&self) -> bool {
        let state = self.inner.read().await;
        state
            .last_npc_update
            .map(|t| t.elapsed().as_secs() < 30)
            .unwrap_or(false)
    }

    /// Set the pipe connection state.
    pub async fn set_pipe_connected(&self, connected: bool) {
        let mut state = self.inner.write().await;
        state.pipe_connected = connected;
    }

    /// Check if the named pipe has an active connection.
    pub async fn is_pipe_connected(&self) -> bool {
        let state = self.inner.read().await;
        state.pipe_connected
    }

    /// Update cheat result from the mod.
    pub async fn update_cheat_result(&self, payload: CheatResultPayload) {
        let mut state = self.inner.write().await;
        // Track toggle states
        if payload.success {
            match payload.action.as_str() {
                "toggleSpeed" => {
                    state.speed_enabled = !state.speed_enabled;
                }
                "toggleFreezeTime" => {
                    state.freeze_time_enabled = !state.freeze_time_enabled;
                }
                _ => {}
            }
        }
        // Keep last 50 results
        state.cheat_results.push(payload);
        if state.cheat_results.len() > 50 {
            state.cheat_results.remove(0);
        }
    }

    /// Get cheat results and clear the buffer.
    pub async fn take_cheat_results(&self) -> Vec<CheatResultPayload> {
        let mut state = self.inner.write().await;
        std::mem::take(&mut state.cheat_results)
    }

    /// Get current cheat toggle states.
    pub async fn get_cheat_states(&self) -> (bool, bool) {
        let state = self.inner.read().await;
        (state.speed_enabled, state.freeze_time_enabled)
    }

    /// Clear all data (called when game exits).
    pub async fn clear(&self) {
        let mut state = self.inner.write().await;
        state.npc_locations = None;
        state.last_npc_update = None;
        state.cheat_results.clear();
        state.speed_enabled = false;
        state.freeze_time_enabled = false;
    }
}
