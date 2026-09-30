use tauri::State;

use crate::errors::ErrorResponse;
use crate::services::discord_presence::{DiscordPresence, PresencePayload};

/// Push a now-playing snapshot to Discord.
#[tauri::command]
pub async fn set_discord_presence(
    payload: PresencePayload,
    presence: State<'_, DiscordPresence>,
) -> Result<(), ErrorResponse> {
    presence.set(payload);
    Ok(())
}

/// Clear the Discord activity.
#[tauri::command]
pub async fn clear_discord_presence(
    presence: State<'_, DiscordPresence>,
) -> Result<(), ErrorResponse> {
    presence.clear();
    Ok(())
}
