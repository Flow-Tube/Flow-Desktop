use std::sync::Mutex;

use tauri::{Runtime, State, WebviewWindow};

use crate::errors::ErrorResponse;
use crate::services::discord_presence::{DiscordPresence, PresencePayload};

/// The window whose playback Discord shows. With several Flow windows, a pause
/// in one must not wipe what another is playing.
#[derive(Default)]
pub struct DiscordPresenceOwner(Mutex<Option<String>>);

/// Push a now-playing snapshot to Discord.
#[tauri::command]
pub async fn set_discord_presence<R: Runtime>(
    window: WebviewWindow<R>,
    payload: PresencePayload,
    presence: State<'_, DiscordPresence>,
    owner: State<'_, DiscordPresenceOwner>,
) -> Result<(), ErrorResponse> {
    if let Ok(mut current) = owner.0.lock() {
        *current = Some(window.label().to_owned());
    }
    presence.set(payload);
    Ok(())
}

/// Clear the Discord activity, unless another window set it since.
#[tauri::command]
pub async fn clear_discord_presence<R: Runtime>(
    window: WebviewWindow<R>,
    presence: State<'_, DiscordPresence>,
    owner: State<'_, DiscordPresenceOwner>,
) -> Result<(), ErrorResponse> {
    if let Ok(mut current) = owner.0.lock() {
        if current
            .as_deref()
            .is_some_and(|label| label != window.label())
        {
            return Ok(());
        }
        *current = None;
    }
    presence.clear();
    Ok(())
}
