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

/** What you said outright you don't want. Inferred signals don't apply, since a search is your own request. */
export interface SearchExclusions {
  videoIds: ReadonlySet<string>;
  channelIds: ReadonlySet<string>;
}

const cleanChannelId = (id?: string | null) => (id ?? '').replace('channel:', '');

export function withoutHidden(results: CombinedSearchResults, hidden: SearchExclusions): CombinedSearchResults {
  if (hidden.videoIds.size === 0 && hidden.channelIds.size === 0) return results;
  const hidesChannel = (id?: string | null) => hidden.channelIds.has(cleanChannelId(id));
  const visible = <T extends { id: string; channelId?: string | null }>(videos: T[]) =>
    videos.filter((video) => !hidden.videoIds.has(video.id) && !hidesChannel(video.channelId));
  const top = results.topResult;
  const topHidden =
    (top?.kind === 'video' && visible([top.item]).length === 0) ||
    (top?.kind === 'channel' && hidesChannel(top.item.channelId));
  return {
    ...results,
    topResult: topHidden ? null : top,
    videos: visible(results.videos),
    live: visible(results.live),
    shorts: visible(results.shorts),
    channels: results.channels.filter((channel) => !hidesChannel(channel.channelId)),
    shelves: results.shelves
      .map((shelf) => ({ ...shelf, videos: visible(shelf.videos) }))
      .filter((shelf) => shelf.videos.length > 0),
  };
}

/**
 * Keeps what the watch filter asks for. Channels and playlists have no watched state: they stay
 * under Unwatched, where they are still new, and go under Watched, which is a list of videos.
 */
export function withWatchState(
  results: CombinedSearchResults,
  state: 'any' | 'unwatched' | 'watched',
  watchedIds: ReadonlySet<string>,
): CombinedSearchResults {
  if (state === 'any') return results;
  const keepWatched = state === 'watched';
  const kept = <T extends { id: string }>(videos: T[]) => videos.filter((video) => watchedIds.has(video.id) === keepWatched);
  return {
    ...results,
    videos: kept(results.videos),
    live: kept(results.live),
    shorts: kept(results.shorts),
    shelves: results.shelves
      .map((shelf) => ({ ...shelf, videos: kept(shelf.videos) }))
      .filter((shelf) => shelf.videos.length > 0),
    channels: keepWatched ? [] : results.channels,
    videoPlaylists: keepWatched ? [] : results.videoPlaylists,
  };
}

/** Results with no Shorts, under the viewer's Show Shorts switch. */
export function withoutShorts(results: CombinedSearchResults): CombinedSearchResults {
  const longForm = <T extends { isShort?: boolean }>(videos: T[]) => videos.filter((video) => !video.isShort);
  return {
    ...results,
    shorts: [],
    videos: longForm(results.videos),
    live: longForm(results.live),
    shelves: results.shelves
      .map((shelf) => ({ ...shelf, videos: longForm(shelf.videos) }))
      .filter((shelf) => shelf.videos.length > 0),
  };
}

export interface SearchCreator {
  channel: SearchChannel;
  latest: SearchShelf;
}

/**
 * YouTube returns a creator's "Latest from" strip as its own shelf beside the channel. The first
 * channel with such a shelf becomes one card, and both leave their own lists.
 */
export function pairCreator(results: CombinedSearchResults): {
  creator: SearchCreator | null;
  results: CombinedSearchResults;
} {
  for (const channel of results.channels) {
    const latest = results.shelves.find(
      (shelf) => shelf.videos.length > 0 && shelf.videos.every((video) => video.channelId === channel.channelId),
    );
    if (!latest) continue;
    const top = results.topResult;
    return {
      creator: { channel, latest },
      results: {
        ...results,
        topResult: top?.kind === 'channel' && top.item.channelId === channel.channelId ? null : top,
        channels: results.channels.filter((other) => other !== channel),
        shelves: results.shelves.filter((other) => other !== latest),
      },
    };
  }
  return { creator: null, results };
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
  const top = summaries.find((s) => s.isTopResult)?.items[0];
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

/** An episode as a track the music player can queue. */
export function episodeAsSong(episode: EpisodeItem): SongItem {
  return {
    id: episode.id,
    title: episode.title,
    artists: episode.author ? [episode.author] : [],
    album: null,
    duration: null,
    musicVideoType: 'MUSIC_VIDEO_TYPE_PODCAST_EPISODE',
    thumbnail: episode.thumbnail,
    explicit: episode.explicit,
    videoId: episode.id,
    playlistId: episode.podcastId ?? null,
    params: null,
  };
}

/** Music categories the site may leave out of a query's chips; the rest always show. */
const OFFERABLE: Partial<Record<string, string[]>> = {
  songs: ['songs'],
  albums: ['albums'],
  playlists: ['community_playlists', 'featured_playlists'],
  podcasts: ['podcasts'],
  episodes: ['episodes'],
};

/** Whether a category has results for the query, as far as the offered filters say. */
export function isCategoryOffered(category: string, offered: string[] | null): boolean {
  const filters = OFFERABLE[category];
  if (!filters || !offered || offered.length === 0) return true;
  return filters.some((filter) => offered.includes(filter));
}
