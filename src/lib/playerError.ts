import { normalizeBackendError } from "./api/errors";
import { getString, type StringKey } from "./i18n/index";

/**
 * A fully-classified, display-ready playback failure. Both the video and the
 * music player map their raw `ErrorResponse { message, kind }` (or a plain
 * media-element failure) into this shape so a single `PlayerErrorState`
 * component can render the same actionable UI for every surface
 */
export interface PlayerErrorInfo {
  /** The backend error `kind` (or `"unknown"` for a client-side failure). */
  kind: string;
  /** Short, localized headline (e.g. "Age-restricted content"). */
  title: string;
  /** Localized secondary line explaining the cause / suggested action. */
  hint: string;
  /** The raw backend message — surfaced in the copyable diagnostics report. */
  rawMessage: string;
  /** Whether retrying could plausibly succeed (network / bot-check / extractor). */
  retryable: boolean;
  /** Whether "Open in browser" is a meaningful next step for this failure. */
  canOpenInBrowser: boolean;
  /** When an upcoming premiere or stream starts, in epoch milliseconds. */
  startsAtMs?: number;
}

interface KindSpec {
  titleKey: StringKey;
  hintKey: StringKey;
  retryable: boolean;
  openable: boolean;
}

// Per-kind copy + affordances 
const SPECS: Record<string, KindSpec> = {
  ageRestricted: {
    titleKey: "player_error_age_restricted_title",
    hintKey: "player_error_age_restricted_hint",
    retryable: false,
    openable: true,
  },
  privateContent: {
    titleKey: "player_error_private_title",
    hintKey: "player_error_private_hint",
    retryable: false,
    openable: true,
  },
  paidContent: {
    titleKey: "player_error_paid_title",
    hintKey: "player_error_paid_hint",
    retryable: false,
    openable: true,
  },
  geographicRestriction: {
    titleKey: "player_error_geo_title",
    hintKey: "player_error_geo_hint",
    retryable: false,
    openable: true,
  },
  musicPremium: {
    titleKey: "player_error_music_premium_title",
    hintKey: "player_error_music_premium_hint",
    retryable: false,
    openable: true,
  },
  botCheckRequired: {
    titleKey: "player_error_bot_check_title",
    hintKey: "player_error_bot_check_hint",
    retryable: true,
    openable: true,
  },
  accountTerminated: {
    titleKey: "player_error_account_terminated_title",
    hintKey: "player_error_account_terminated_hint",
    retryable: false,
    openable: true,
  },
  contentNotAvailable: {
    titleKey: "player_error_not_available_title",
    hintKey: "player_error_not_available_hint",
    retryable: true,
    openable: true,
  },
  extractor: {
    titleKey: "player_error_extractor_title",
    hintKey: "player_error_extractor_hint",
    retryable: true,
    openable: true,
  },
  streaming: {
    titleKey: "player_error_streaming_title",
    hintKey: "player_error_streaming_hint",
    retryable: true,
    openable: true,
  },
  network: {
    titleKey: "player_error_network_title",
    hintKey: "player_error_network_hint",
    retryable: true,
    openable: true,
  },
  membersOnly: {
    titleKey: "player_error_members_only_title",
    hintKey: "player_error_members_only_hint",
    retryable: false,
    openable: true,
  },
  networkWall: {
    titleKey: "player_error_network_wall_title",
    hintKey: "player_error_network_wall_hint",
    retryable: true,
    openable: true,
  },
  liveUpcoming: {
    titleKey: "player_error_upcoming_title",
    hintKey: "player_error_upcoming_hint",
    retryable: true,
    openable: true,
  },
  rateLimited: {
    titleKey: "player_error_rate_limited_title",
    hintKey: "player_error_rate_limited_hint",
    retryable: true,
    openable: true,
  },
  validation: {
    titleKey: "player_error_validation_title",
    hintKey: "player_error_validation_hint",
    retryable: false,
    openable: false,
  },
  database: {
    titleKey: "player_error_internal_title",
    hintKey: "player_error_internal_hint",
    retryable: true,
    openable: false,
  },
  internal: {
    titleKey: "player_error_internal_title",
    hintKey: "player_error_internal_hint",
    retryable: true,
    openable: false,
  },
};

const FALLBACK: KindSpec = {
  titleKey: "player_error_generic_title",
  hintKey: "player_error_generic_hint",
  retryable: true,
  openable: true,
};

/**
 * Detects the client-side "the network is down" case that the backend can't
 * report (the `invoke` itself never reaches Rust), so we can show the more
 * specific "No internet" copy instead of the generic fallback.
 */
function looksLikeNetworkFailure(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("network") ||
    lower.includes("failed to fetch") ||
    lower.includes("offline") ||
    lower.includes("connection") ||
    lower.includes("timed out") ||
    lower.includes("timeout") ||
    lower.includes("dns")
  );
}

/**
 * Turns any caught playback error — a `BackendApiError`, a raw
 * `{ message, kind }` object, or a plain string from a media-element failure —
 * into a display-ready `PlayerErrorInfo`.
 */
export function classifyPlayerError(error: unknown): PlayerErrorInfo {
  const normalized = normalizeBackendError(error);
  let kind = normalized.kind || "unknown";

  if (kind === "unknown" && looksLikeNetworkFailure(normalized.message)) {
    kind = "network";
  }

  const spec = SPECS[kind] ?? FALLBACK;
  return {
    kind,
    title: getString(spec.titleKey),
    hint: getString(spec.hintKey),
    rawMessage: normalized.message,
    retryable: spec.retryable,
    canOpenInBrowser: spec.openable,
    startsAtMs: normalized.startsAtMs,
  };
}
