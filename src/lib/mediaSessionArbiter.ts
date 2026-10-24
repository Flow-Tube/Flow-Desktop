/**
 * One owner for `navigator.mediaSession`, so the music player and the video
 * player stop overwriting each other's OS controls. Each registers while it has
 * something loaded; whichever started playing last owns the media keys and the
 * Now Playing card, and starting one pauses the other.
 */

export type MediaSessionOwner = "music" | "video";

export interface MediaPosition {
  position: number;
  duration: number;
  playbackRate?: number;
}

export interface MediaSessionClient {
  metadata: () => MediaMetadataInit | null;
  isPlaying: () => boolean;
  position: () => MediaPosition | null;
  actions: Partial<Record<MediaSessionAction, MediaSessionActionHandler>>;
  /** Called when the other player starts, since only one plays at a time. */
  pause: () => void;
}

const ACTIONS: MediaSessionAction[] = [
  "play",
  "pause",
  "stop",
  "previoustrack",
  "nexttrack",
  "seekto",
  "seekforward",
  "seekbackward",
];

/** The OS scrubber only needs about one update a second. */
const POSITION_INTERVAL_MS = 1_000;

const clients = new Map<MediaSessionOwner, MediaSessionClient>();
let owner: MediaSessionOwner | null = null;
let positionWrittenAt = 0;

const mediaSession = (): MediaSession | null =>
  typeof navigator !== "undefined" && "mediaSession" in navigator ? navigator.mediaSession : null;

function writePosition(session: MediaSession, client: MediaSessionClient | null): void {
  positionWrittenAt = Date.now();
  if (typeof session.setPositionState !== "function") return;
  const state = client?.position();
  try {
    if (!state || !Number.isFinite(state.duration) || state.duration <= 0) {
      session.setPositionState();
      return;
    }
    session.setPositionState({
      duration: state.duration,
      position: Math.min(Math.max(0, state.position), state.duration),
      playbackRate: state.playbackRate ?? 1,
    });
  } catch {
    // A stream that reports no usable length has no position to show.
  }
}

function apply(client: MediaSessionClient | null): void {
  const session = mediaSession();
  if (!session) return;
  for (const action of ACTIONS) {
    try {
      session.setActionHandler(action, client?.actions[action] ?? null);
    } catch {
      // Some WebViews expose Media Session but not every action.
    }
  }
  try {
    const metadata = client?.metadata();
    session.metadata = metadata ? new MediaMetadata(metadata) : null;
  } catch {
    // An artwork entry the WebView rejects leaves the old card up.
  }
  session.playbackState = client ? (client.isPlaying() ? "playing" : "paused") : "none";
  writePosition(session, client);
}

/** Registers a player that has something loaded; returns the unregister call. */
export function registerMediaSessionClient(name: MediaSessionOwner, client: MediaSessionClient): () => void {
  clients.set(name, client);
  if (owner === null || owner === name) {
    owner = name;
    apply(client);
  }
  return () => {
    if (clients.get(name) !== client) return;
    clients.delete(name);
    if (owner !== name) return;
    // The other player, if it still has something loaded, gets the keys back.
    const next = clients.entries().next().value;
    owner = next?.[0] ?? null;
    apply(next?.[1] ?? null);
  };
}

/** A player started: it takes the OS controls and the other one pauses. */
export function claimMediaSession(name: MediaSessionOwner): void {
  const client = clients.get(name);
  if (!client) return;
  for (const [other, rival] of clients) {
    if (other !== name && rival.isPlaying()) rival.pause();
  }
  owner = name;
  apply(client);
}

/**
 * Publishes the owner's state again after a pause, a track change or new
 * metadata. Handlers are re-registered too, since a WebView can drop them.
 */
export function refreshMediaSession(name: MediaSessionOwner): void {
  if (owner === name) apply(clients.get(name) ?? null);
}

/** Feeds the OS scrubber from the player's own clock, at most once a second. */
export function reportMediaPosition(name: MediaSessionOwner): void {
  const session = mediaSession();
  if (!session || owner !== name || Date.now() - positionWrittenAt < POSITION_INTERVAL_MS) return;
  writePosition(session, clients.get(name) ?? null);
}
