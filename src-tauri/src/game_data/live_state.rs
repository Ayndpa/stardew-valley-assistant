use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::RwLock;

/// Shared state for live game data received from the SMAPI mod via HTTP.
#[derive(Clone)]
pub struct LiveGameState {
    inner: Arc<RwLock<LiveGameStateInner>>,
}

struct LiveGameStateInner {
    npc_locations: Option<NpcLocationsPayload>,
    item_prices: Option<ItemPricesPayload>,
    last_npc_update: Option<Instant>,
    last_price_update: Option<Instant>,
    pipe_connected: bool,
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

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ItemPricesPayload {
    pub save_id: Option<String>,
    pub generated_at: Option<String>,
    pub prices: HashMap<String, i32>,
}

impl LiveGameState {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(RwLock::new(LiveGameStateInner {
                npc_locations: None,
                item_prices: None,
                last_npc_update: None,
                last_price_update: None,
                pipe_connected: false,
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

    /// Update item prices from the mod.
    pub async fn update_item_prices(&self, payload: ItemPricesPayload) {
        let mut state = self.inner.write().await;
        state.item_prices = Some(payload);
        state.last_price_update = Some(Instant::now());
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

    /// Get item prices if available and fresh (within 30 seconds).
    pub async fn get_item_prices(&self) -> Option<ItemPricesPayload> {
        let state = self.inner.read().await;
        if let Some(ref payload) = state.item_prices {
            if let Some(last_update) = state.last_price_update {
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
        let npc_fresh = state
            .last_npc_update
            .map(|t| t.elapsed().as_secs() < 30)
            .unwrap_or(false);
        let price_fresh = state
            .last_price_update
            .map(|t| t.elapsed().as_secs() < 30)
            .unwrap_or(false);
        npc_fresh || price_fresh
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

    /// Clear all data (called when game exits).
    pub async fn clear(&self) {
        let mut state = self.inner.write().await;
        state.npc_locations = None;
        state.item_prices = None;
        state.last_npc_update = None;
        state.last_price_update = None;
    }
}
