import type {
  PlaylistSummary,
  SearchChannel,
  SearchCorrection,
  SearchShelf,
  SearchVideosResponse,
  ShortVideoSummary,
  VideoSummary,
} from '../types/video';
import type {
  AlbumItem,
  ArtistItem,
  EpisodeItem,
  MusicSearchSection,
  PlaylistItem,
  PodcastItem,
  SongItem,
} from '../types/music';

export type TopResult =
  | { kind: 'artist'; item: ArtistItem }
  | { kind: 'channel'; item: SearchChannel }
  | { kind: 'song'; item: SongItem }
  | { kind: 'video'; item: VideoSummary }
  | { kind: 'album'; item: AlbumItem };

export interface CombinedSearchResults {
  topResult: TopResult | null;
  songs: SongItem[];
  videos: VideoSummary[];
  live: VideoSummary[];
  channels: SearchChannel[];
  /** Shorts from the results' Shorts grids. */
  shorts: ShortVideoSummary[];
  /** "Latest from …" and other titled runs of videos. */
  shelves: SearchShelf[];
  /** Playlists from a YouTube playlist search, beside the YouTube Music ones in `playlists`. */
  videoPlaylists: PlaylistSummary[];
  albums: AlbumItem[];
  playlists: PlaylistItem[];
  artists: ArtistItem[];
  podcasts: PodcastItem[];
  episodes: EpisodeItem[];
  correction: SearchCorrection | null;
}

export function emptyResults(): CombinedSearchResults {
  return {
    topResult: null,
    songs: [],
    videos: [],
    live: [],
    channels: [],
    shorts: [],
    shelves: [],
    videoPlaylists: [],
    albums: [],
    playlists: [],
    artists: [],
    podcasts: [],
    episodes: [],
    correction: null,
  };
}

export type MusicBucket = Pick<CombinedSearchResults, 'songs' | 'albums' | 'playlists' | 'artists' | 'podcasts' | 'episodes'>;

export function emptyBucket(): MusicBucket {
  return { songs: [], albums: [], playlists: [], artists: [], podcasts: [], episodes: [] };
}

export function bucketMusicSections(sections: MusicSearchSection[]): MusicBucket {
  const out = emptyBucket();
  for (const section of sections) {
    for (const item of section.items) {
      switch (item.type) {
        case 'song':
          out.songs.push(item);
          break;
        case 'album':
          out.albums.push(item);
          break;
        case 'playlist':
          out.playlists.push(item);
          break;
        case 'artist':
          out.artists.push(item);
          break;
        case 'podcast':
          out.podcasts.push(item);
          break;
        case 'episode':
          out.episodes.push(item);
          break;
      }
    }
  }
  return out;
}

export function dedupe<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = key(item);
    if (!k) return true;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** The YouTube side of a page of results, as the result sections hold it. */
export function videoSections(response: SearchVideosResponse) {
  return {
    videos: response.items,
    channels: response.channels ?? [],
    shorts: (response.shorts ?? []).map((short): ShortVideoSummary => ({ ...short, type: 'short' })),
    shelves: response.shelves ?? [],
    videoPlaylists: (response.playlists ?? []).map((playlist): PlaylistSummary => ({ ...playlist, type: 'playlist' })),
    correction: response.correction ?? null,
  };
}

export function pickTopResult(
  summaries: MusicSearchSection[],
  channels: SearchChannel[],
  artists: ArtistItem[],
): TopResult | null {
  const top = summaries.find((s) => /top result/i.test(s.title))?.items[0];
  if (top) {
    switch (top.type) {
      case 'artist':
        return { kind: 'artist', item: top };
      case 'song':
        return { kind: 'song', item: top };
      case 'album':
        return { kind: 'album', item: top };
    }
  }
  if (channels[0]) return { kind: 'channel', item: channels[0] };
  if (artists[0]) return { kind: 'artist', item: artists[0] };
  return null;
}

/** Drop the hero item from its bucket so it isn't rendered twice. */
export function dedupeTopFromBuckets(r: CombinedSearchResults): CombinedSearchResults {
  const t = r.topResult;
  if (!t) return r;
  switch (t.kind) {
    case 'artist':
      return { ...r, artists: r.artists.filter((a) => a.id !== t.item.id) };
    case 'song':
      return { ...r, songs: r.songs.filter((s) => s.id !== t.item.id) };
    case 'album':
      return { ...r, albums: r.albums.filter((a) => a.browseId !== t.item.browseId) };
    case 'channel':
      return { ...r, channels: r.channels.filter((c) => c.channelId !== t.item.channelId) };
    case 'video':
      return { ...r, videos: r.videos.filter((v) => v.id !== t.item.id) };
  }
}
