// TypeScript mirror of the Rust YouTube Music models
// (`src-tauri/src/models/music*.rs`). All keys are camelCase to match serde.

export interface Artist {
  name: string;
  id: string | null;
}

export interface Album {
  name: string;
  id: string;
}

export interface SongItem {
  id: string;
  title: string;
  artists: Artist[];
  album: Album | null;
  duration: number | null;
  musicVideoType: string | null;
  thumbnail: string;
  explicit: boolean;
  videoId: string | null;
  playlistId: string | null;
  params: string | null;
  viewsText?: string | null;
}

export interface AlbumItem {
  browseId: string;
  playlistId: string;
  title: string;
  artists: Artist[] | null;
  year: number | null;
  thumbnail: string;
  explicit: boolean;
}

export interface PlaylistItem {
  id: string;
  title: string;
  author: Artist | null;
  songCountText: string | null;
  thumbnail: string | null;
}

export interface ArtistItem {
  id: string;
  title: string;
  thumbnail: string | null;
  channelId: string | null;
}

export interface EpisodeItem {
  id: string;
  title: string;
  author: Artist | null;
  thumbnail: string;
  explicit: boolean;
  publishDateText: string | null;
}

export interface PodcastItem {
  id: string;
  title: string;
  author: Artist | null;
  episodeCountText: string | null;
  thumbnail: string | null;
}

// Internally-tagged enum (`#[serde(tag = "type")]`) — discriminated union.
export type YTItem =
  | ({ type: "song" } & SongItem)
  | ({ type: "album" } & AlbumItem)
  | ({ type: "playlist" } & PlaylistItem)
  | ({ type: "artist" } & ArtistItem)
  | ({ type: "episode" } & EpisodeItem)
  | ({ type: "podcast" } & PodcastItem);

// --- Sections / pages -----------------------------------------------------

export interface ArtistSection {
  title: string;
  items: YTItem[];
  moreEndpointBrowseId: string | null;
  moreEndpointParams: string | null;
}

export interface ArtistPage {
  artist: ArtistItem;
  sections: ArtistSection[];
  description: string | null;
  subscriberCountText: string | null;
  monthlyListenerCount: string | null;
  isSubscribed: boolean;
}

export interface MoodAndGenreItem {
  title: string;
  stripeColor: number;
  browseId: string;
  params: string | null;
}

export interface ExplorePage {
  newReleaseAlbums: AlbumItem[];
  moodAndGenres: MoodAndGenreItem[];
}

export interface ChartSection {
  title: string;
  items: YTItem[];
  chartType: string; // "Trending" | "Top" | "Genre" | "NewReleases"
}

export interface ChartsPage {
  sections: ChartSection[];
  continuation: string | null;
}

export interface MusicHomeChip {
  title: string;
  browseId: string | null;
  params: string | null;
  orderBy: number;
}

export interface MusicShelf {
  title: string;
  subtitle: string | null;
  browseId: string | null;
  params: string | null;
  items: YTItem[];
}

export interface MusicHomePage {
  chips: MusicHomeChip[];
  sections: MusicShelf[];
  continuation: string | null;
}

export interface MusicSearchSection {
  title: string;
  items: YTItem[];
}

export interface MusicSearchResponse {
  sections: MusicSearchSection[];
  continuation: string | null;
}

export interface SearchSummaryPage {
  summaries: MusicSearchSection[];
}

export interface MusicSearchSuggestions {
  queries: string[];
  recommendedItems: YTItem[];
}

export interface AlbumPage {
  album: AlbumItem;
  description: string | null;
  songCount: number | null;
  durationText: string | null;
  songs: SongItem[];
  continuation: string | null;
}

export interface MusicPlaylistPage {
  id: string;
  title: string;
  author: Artist | null;
  songCountText: string | null;
  thumbnail: string | null;
  description: string | null;
  songs: SongItem[];
  continuation: string | null;
}

export interface RelatedPage {
  songs: SongItem[];
  albums: AlbumItem[];
  artists: ArtistItem[];
  playlists: PlaylistItem[];
}

/** A Daily Mix cluster from the music brain: a label + seed tracks to expand. */
export interface DailyMixSeed {
  label: string;
  seedTrackIds: string[];
}

export type MusicMaturity = "cold_start" | "warming" | "mature";

export interface MusicTopArtist {
  /** Affinity key: a routable browseId when `idKeyed`, else a normalized name. */
  key: string;
  /** Display name (resolved from track metadata); falls back to the key. */
  name: string;
  score: number;
  plays: number;
  liked: boolean;
  /** Whether `key` can be opened at `/music/artist/:key` (and seed an artist-graph fetch). */
  idKeyed: boolean;
}

export interface MusicGenreWeight {
  genre: string;
  weight: number;
}

export interface MusicTimeOfDayBucket {
  /** PascalCase `TimeBucket` variant name (e.g. `"WeekdayMorning"`). */
  bucket: string;
  plays: number;
  topGenres: MusicGenreWeight[];
}

export interface MusicTasteProfile {
  topArtists: MusicTopArtist[];
  topGenres: MusicGenreWeight[];
  discoveryAppetite: number;
  totalPlays: number;
  distinctArtists: number;
  trackedTracks: number;
  onRepeatCount: number;
  maturity: MusicMaturity;
  /** Always all 8 buckets, in canonical order (zero-play buckets included). */
  timeOfDay: MusicTimeOfDayBucket[];
}

export interface QueuePage {
  items: SongItem[];
  currentIndex: number | null;
  continuation: string | null;
  lyricsBrowseId: string | null;
  lyricsParams: string | null;
  relatedBrowseId: string | null;
  radioPlaylistId: string | null;
}

export interface MoodGenrePage {
  title: string;
  items: YTItem[];
  continuation: string | null;
}

export interface MusicStreamInfo {
  videoId: string;
  audioUrl: string;
  mimeType: string;
  itag: number;
  bitrate: number | null;
  approxDurationMs: number | null;
  loudnessDb: number | null;
  perceptualLoudnessDb: number | null;
  expiresInSeconds: number;
  usedClient: string;
}

/// `(songs, continuation)` tuple returned by album/playlist continuation commands.
export type SongContinuation = [SongItem[], string | null];
