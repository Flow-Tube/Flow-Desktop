import type { StringKey } from "./i18n/index";
import type { MusicFeedEntry } from "./musicFeedComposer";

/**
 * The music home sections you can hide. Their names are stored, and match Flow for Android's, so
 * they must never be renamed.
 */
export const MUSIC_HOME_SHELVES = [
  { id: "YOUR_PLAYLISTS", title: "music_home_your_playlists" },
  { id: "YOUR_SUBSCRIPTIONS", title: "music_home_your_subscriptions" },
  { id: "LISTEN_AGAIN", title: "music_listen_again" },
  { id: "ON_REPEAT", title: "music_on_repeat" },
  { id: "ROTATION", title: "music_home_shelf_rotation" },
  { id: "SPEED_DIAL", title: "music_speed_dial" },
  { id: "REDISCOVER", title: "music_rediscover" },
  { id: "DEEP_CUTS", title: "music_deep_cuts" },
  { id: "ARTISTS_FOR_YOU", title: "music_artists_for_you" },
  { id: "DAILY_DISCOVER", title: "music_daily_discover" },
  { id: "QUICK_PICKS", title: "music_quick_picks" },
  { id: "FROM_COMMUNITY", title: "music_from_community" },
  { id: "SIMILAR_TO", title: "music_home_shelf_similar" },
  { id: "LIVE_PERFORMANCES", title: "music_home_live_performances" },
  { id: "MUSIC_VIDEOS_FOR_YOU", title: "music_home_music_videos_for_you" },
  { id: "MUSIC_VIDEOS", title: "music_home_music_videos" },
  { id: "GENRES", title: "music_home_shelf_genres" },
  { id: "DYNAMIC_HOME", title: "music_home_shelf_more" },
  { id: "FAVORITE_ARTIST_ALBUMS", title: "music_home_favorite_artist_albums" },
  { id: "NEW_RELEASES", title: "music_new_releases" },
  { id: "CHARTS", title: "music_home_shelf_charts" },
  { id: "POPULAR_ARTISTS", title: "music_popular_artists" },
  { id: "MIXED_FOR_YOU", title: "music_mixed_for_you" },
  { id: "MOODS_AND_GENRES", title: "music_moods_and_genres" },
  { id: "LASTFM_DISCOVER", title: "music_home_lastfm_discover" },
] as const satisfies ReadonlyArray<{ id: string; title: StringKey }>;

export type MusicHomeShelfId = (typeof MUSIC_HOME_SHELVES)[number]["id"];

const SHELF_BY_SECTION: Record<string, MusicHomeShelfId> = {
  "your-playlists": "YOUR_PLAYLISTS",
  "your-subscriptions": "YOUR_SUBSCRIPTIONS",
  "listen-again": "LISTEN_AGAIN",
  "on-repeat": "ON_REPEAT",
  rotation: "ROTATION",
  "speed-dial": "SPEED_DIAL",
  rediscover: "REDISCOVER",
  "deep-cuts": "DEEP_CUTS",
  "artists-for-you": "ARTISTS_FOR_YOU",
  "daily-discover": "DAILY_DISCOVER",
  "from-community": "FROM_COMMUNITY",
  vibes: "FROM_COMMUNITY",
  "live-performances": "LIVE_PERFORMANCES",
  "music-videos-for-you": "MUSIC_VIDEOS_FOR_YOU",
  "music-videos": "MUSIC_VIDEOS",
  "favorite-artist-albums": "FAVORITE_ARTIST_ALBUMS",
  "popular-songs": "CHARTS",
  "popular-artists": "POPULAR_ARTISTS",
  "mixed-for-you": "MIXED_FOR_YOU",
  "lastfm-discover": "LASTFM_DISCOVER",
};

const SHELF_BY_PREFIX: Array<[string, MusicHomeShelfId]> = [
  ["similar-", "SIMILAR_TO"],
  ["performances-", "SIMILAR_TO"],
  ["artist-albums-", "SIMILAR_TO"],
  ["mix-", "SIMILAR_TO"],
  ["fans-", "SIMILAR_TO"],
  ["genre-", "GENRES"],
];

/** The switch a home entry answers to. */
export function shelfOfEntry(entry: MusicFeedEntry): MusicHomeShelfId {
  if (entry.kind === "quickPicks") return "QUICK_PICKS";
  if (entry.kind === "moods") return "MOODS_AND_GENRES";
  const { section } = entry;
  if (section.source?.startsWith("chart")) return "CHARTS";
  if (section.source === "newReleases") return "NEW_RELEASES";
  const known = SHELF_BY_SECTION[section.id];
  if (known) return known;
  const prefixed = SHELF_BY_PREFIX.find(([prefix]) => section.id.startsWith(prefix));
  return prefixed?.[1] ?? "DYNAMIC_HOME";
}

export function parseHiddenShelves(raw: string | undefined): ReadonlySet<string> {
  try {
    const parsed: unknown = JSON.parse(raw ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

export function withShelfShown(hidden: ReadonlySet<string>, id: MusicHomeShelfId, shown: boolean): string[] {
  const next = new Set(hidden);
  if (shown) next.delete(id);
  else next.add(id);
  return [...next];
}

export const isShelfShown = (entry: MusicFeedEntry, hidden: ReadonlySet<string>): boolean =>
  !hidden.has(shelfOfEntry(entry));
