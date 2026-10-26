import { invokeBackend } from "./errors";
import { isTauriEnv } from "./env";
import type { SongItem } from "../../types/music";

export type ScrobbleService = "LASTFM" | "LIBREFM" | "LISTENBRAINZ";

export const SCROBBLE_SERVICES: readonly ScrobbleService[] = ["LASTFM", "LIBREFM", "LISTENBRAINZ"];

// Mirrors the backend ScrobbleStatus (serde camelCase).
export interface ScrobbleServiceStatus {
  service: ScrobbleService;
  signedIn: boolean;
  userName: string | null;
  waiting: number;
}

export interface ScrobbleStatus {
  services: ScrobbleServiceStatus[];
  lastFmReady: boolean;
  ownKeyEnabled: boolean;
  ownKeyHint: string | null;
  keychainError: string | null;
}

// Mirrors the backend TrackInfo.
export interface ScrobbleTrack {
  title: string;
  artists: string[];
  album: string | null;
  durationMs: number;
}

export function scrobbleTrack(song: SongItem, durationMs: number): ScrobbleTrack {
  return {
    title: song.title,
    artists: song.artists.map((artist) => artist.name),
    album: song.album?.name ?? null,
    durationMs: Math.max(0, Math.round(durationMs)),
  };
}

export function getScrobbleStatus(): Promise<ScrobbleStatus> {
  return invokeBackend<ScrobbleStatus>("scrobble_status");
}

/** `secret` is the password, or the user token for ListenBrainz. */
export function scrobbleSignIn(service: ScrobbleService, userName: string, secret: string): Promise<void> {
  return invokeBackend<void>("scrobble_sign_in", { service, userName, secret });
}

export function scrobbleSignOut(service: ScrobbleService): Promise<void> {
  return invokeBackend<void>("scrobble_sign_out", { service });
}

/** Leaving out the key and secret keeps the stored ones, so the switch alone can be flipped. */
export function setScrobbleOwnKey(enabled: boolean, keys?: { apiKey: string; secret: string }): Promise<void> {
  return invokeBackend<void>("scrobble_set_own_key", {
    enabled,
    apiKey: keys?.apiKey ?? null,
    secret: keys?.secret ?? null,
  });
}

/** Reads the keychain again after it was refused or locked. */
export function retryScrobbleKeychain(): Promise<void> {
  return invokeBackend<void>("scrobble_retry_keychain");
}

/** Sends waiting listens now; false when some are still waiting. */
export function flushScrobbles(): Promise<boolean> {
  return invokeBackend<boolean>("scrobble_flush");
}

// Player reports are fire-and-forget: a failed report must never disturb playback.
async function report(command: string, args: Record<string, unknown>): Promise<void> {
  if (!(await isTauriEnv())) return;
  try {
    await invokeBackend<unknown>(command, args);
  } catch (error) {
    console.warn(`Scrobbling report ${command} failed`, error);
  }
}

export function reportNowPlaying(track: ScrobbleTrack): Promise<void> {
  return report("scrobble_now_playing", { track });
}

export function reportListened(track: ScrobbleTrack, playedMs: number, startedAtMs: number): Promise<void> {
  return report("scrobble_listened", { track, playedMs: Math.round(playedMs), startedAtMs });
}

export function reportLove(track: ScrobbleTrack, loved: boolean): Promise<void> {
  return report("scrobble_love", { track, loved });
}

export function reportOnline(): Promise<void> {
  return report("scrobble_flush", {});
}
