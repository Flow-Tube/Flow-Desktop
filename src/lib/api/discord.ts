import { invokeBackend } from "./errors";
import { isTauriEnv } from "./env";

export type DiscordPresenceKind = "video" | "music" | "live";

// Mirrors the backend PresencePayload (serde camelCase).
export interface DiscordPresencePayload {
  kind: DiscordPresenceKind;
  title?: string;
  subtitle?: string;
  album?: string;
  artworkUrl?: string;
  elapsedSeconds?: number;
  durationSeconds?: number;
  isPaused?: boolean;
  url?: string;
  buttonLabel?: string;
}

export async function setDiscordPresence(payload: DiscordPresencePayload): Promise<void> {
  if (!(await isTauriEnv())) return;
  try {
    await invokeBackend<void>("set_discord_presence", { payload });
  } catch (error) {
    console.warn("Failed to set Discord presence", error);
  }
}

export async function clearDiscordPresence(): Promise<void> {
  if (!(await isTauriEnv())) return;
  try {
    await invokeBackend<void>("clear_discord_presence", {});
  } catch (error) {
    console.warn("Failed to clear Discord presence", error);
  }
}
