import { normalizeBackendError } from "./api/errors";
import { getString, type StringKey } from "./i18n/index";

/** What to tell the viewer about a failed load: a title and the sentence under it. */
export interface LoadErrorCopy {
  title: StringKey;
  hint: StringKey;
}

// The failures worth naming apart. Anything else gets the screen's own message: the
// backend's text carries hosts and request details and is never translated.
const COPY: Record<string, LoadErrorCopy> = {
  network: { title: "player_error_network_title", hint: "player_error_network_hint" },
  rateLimited: { title: "player_error_rate_limited_title", hint: "player_error_rate_limited_hint" },
  botCheckRequired: { title: "search_error_bot_title", hint: "load_error_bot_hint" },
  networkWall: { title: "player_error_network_wall_title", hint: "player_error_network_wall_hint" },
};

/** The copy for a backend error kind, or null when the screen's own message fits better. */
export function loadErrorCopy(kind: string | null | undefined): LoadErrorCopy | null {
  return (kind && COPY[kind]) || null;
}

/**
 * A screen's own title and body for a failed load, unless the failure has a name of its own.
 * Offline keeps the screen's copy, which already says to check the connection.
 */
export function screenErrorCopy(kind: string | null | undefined, screen: LoadErrorCopy): LoadErrorCopy {
  if (kind === "network") return screen;
  return loadErrorCopy(kind) ?? screen;
}

/**
 * One line for a failed load beside a Retry button: why it failed when that is known,
 * else `fallback`. Offline says it will load again by itself, which the screens do.
 */
export function describeLoadError(error: unknown, fallback: StringKey): string {
  const kind = normalizeBackendError(error).kind;
  if (kind === "network") return getString("load_error_offline");
  const copy = loadErrorCopy(kind);
  return getString(copy ? copy.title : fallback);
}
