import type {
  PlaylistSummary,
  PostSummary,
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
import type { AiListMatcher } from './aiList/matcher';

/** A block among the video results: after the video with this id, or before them all when null. */
export interface Placed {
  afterId: string | null;
  /** Its place among the blocks of its page, in the order they arrived. */
  blockIndex?: number;
}

export type PlacedShelf = SearchShelf & Placed;

export interface PlacedShortsShelf extends Placed {
  title: string | null;
  shorts: ShortVideoSummary[];
}

export interface PlacedPostShelf extends Placed {
  title: string | null;
  posts: PostSummary[];
}

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
  /** The same Shorts, strip by strip, where YouTube put them among the videos. */
  shortsShelves: PlacedShortsShelf[];
  /** "Latest from …" and other titled runs of videos. */
  shelves: PlacedShelf[];
  /** Community posts, where YouTube put them among the videos. */
  postShelves: PlacedPostShelf[];
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
  /** The AiSList filter: true for a channel it hides. Search is asked on its own, as on Android. */
  hidesAsAi?: (channelId: string, handle?: string | null) => boolean;
}

const cleanChannelId = (id?: string | null) => (id ?? '').replace('channel:', '');

/**
 * Leaves out music the AI filter hides: songs and albums by their credited artists, playlists by
 * their author. Artist cards stay, as channel cards do in video search, so a listed artist can
 * still be found and opened on purpose. The same object comes back when nothing goes.
 */
export function withoutAiMusic(results: CombinedSearchResults, ai: AiListMatcher): CombinedSearchResults {
  if (!ai.isMusicActive) return results;
  const hides = (ids: Array<string | null | undefined>) => ai.musicVerdict(ids) === 'block';
  const byArtists = (item: { artists: Array<{ id?: string | null }> | null }) => hides((item.artists ?? []).map((a) => a.id));
  const keep = <T,>(items: T[], hidden: (item: T) => boolean) => {
    const kept = items.filter((item) => !hidden(item));
    return kept.length === items.length ? items : kept;
  };
  const top = results.topResult;
  const topHidden = (top?.kind === 'song' || top?.kind === 'album') && byArtists(top.item);
  const songs = keep(results.songs, byArtists);
  const albums = keep(results.albums, byArtists);
  const playlists = keep(results.playlists, (playlist) => hides([playlist.author?.id]));
  if (!topHidden && songs === results.songs && albums === results.albums && playlists === results.playlists) return results;
  return { ...results, topResult: topHidden ? null : top, songs, albums, playlists };
}

export function withoutHidden(results: CombinedSearchResults, hidden: SearchExclusions): CombinedSearchResults {
  const asAi = hidden.hidesAsAi;
  if (hidden.videoIds.size === 0 && hidden.channelIds.size === 0 && !asAi) return results;
  const hidesChannel = (id?: string | null, handle?: string | null) =>
    hidden.channelIds.has(cleanChannelId(id)) || (!!asAi && asAi(cleanChannelId(id), handle));
  const visible = <T extends { id: string; channelId?: string | null; channelHandle?: string | null }>(videos: T[]) =>
    videos.filter((video) => !hidden.videoIds.has(video.id) && !hidesChannel(video.channelId, video.channelHandle));
  const top = results.topResult;
  const topHidden =
    (top?.kind === 'video' && visible([top.item]).length === 0) ||
    (top?.kind === 'channel' && hidesChannel(top.item.channelId, top.item.handle));
  return {
    ...results,
    topResult: topHidden ? null : top,
    videos: visible(results.videos),
    live: visible(results.live),
    shorts: visible(results.shorts),
    channels: results.channels.filter((channel) => !hidesChannel(channel.channelId, channel.handle)),
    shortsShelves: results.shortsShelves
      .map((shelf) => ({ ...shelf, shorts: visible(shelf.shorts) }))
      .filter((shelf) => shelf.shorts.length > 0),
    shelves: results.shelves
      .map((shelf) => ({ ...shelf, videos: visible(shelf.videos) }))
      .filter((shelf) => shelf.videos.length > 0),
    postShelves: results.postShelves
      .map((shelf) => ({ ...shelf, posts: shelf.posts.filter((post) => !hidesChannel(post.authorChannelId)) }))
      .filter((shelf) => shelf.posts.length > 0),
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
    shortsShelves: results.shortsShelves
      .map((shelf) => ({ ...shelf, shorts: kept(shelf.shorts) }))
      .filter((shelf) => shelf.shorts.length > 0),
    shelves: results.shelves
      .map((shelf) => ({ ...shelf, videos: kept(shelf.videos) }))
      .filter((shelf) => shelf.videos.length > 0),
    channels: keepWatched ? [] : results.channels,
    postShelves: keepWatched ? [] : results.postShelves,
    videoPlaylists: keepWatched ? [] : results.videoPlaylists,
  };
}

/** Results with no Shorts, under the viewer's Show Shorts switch. */
export function withoutShorts(results: CombinedSearchResults): CombinedSearchResults {
  const longForm = <T extends { isShort?: boolean }>(videos: T[]) => videos.filter((video) => !video.isShort);
  return {
    ...results,
    shorts: [],
    shortsShelves: [],
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
    shortsShelves: [],
    shelves: [],
    postShelves: [],
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

const asShort = (short: Omit<ShortVideoSummary, 'type'>): ShortVideoSummary => ({ ...short, type: 'short' });

/** What earlier pages already showed, for a page that continues them. */
export interface EarlierPages {
  lastVideoId: string | null;
  videoIds: ReadonlySet<string>;
  shortIds: ReadonlySet<string>;
}

/**
 * The YouTube side of a page of results, as the result sections hold it. Each shelf is tied to the
 * last new video before it: a video an earlier page already showed keeps its old place, so a shelf
 * tied to it would jump up the list. One with no new video before it follows the earlier pages.
 * Shorts an earlier strip showed are left out, and strips left empty go.
 */
export function videoSections(response: SearchVideosResponse, earlier?: EarlierPages) {
  const items = response.items;
  const anchor = (afterIndex?: number): string | null => {
    for (let index = Math.min(afterIndex ?? items.length, items.length) - 1; index >= 0; index -= 1) {
      const id = items[index]?.id;
      if (id && !earlier?.videoIds.has(id)) return id;
    }
    return earlier?.lastVideoId ?? null;
  };
  return {
    videos: items,
    channels: response.channels ?? [],
    shorts: (response.shorts ?? []).map(asShort),
    shortsShelves: (response.shortsShelves ?? [])
      .map((shelf): PlacedShortsShelf => ({
        title: shelf.title ?? null,
        shorts: shelf.shorts.filter((short) => !earlier?.shortIds.has(short.id)).map(asShort),
        afterId: anchor(shelf.afterIndex),
        blockIndex: shelf.blockIndex,
      }))
      .filter((shelf) => shelf.shorts.length > 0),
    shelves: (response.shelves ?? []).map((shelf): PlacedShelf => ({ ...shelf, afterId: anchor(shelf.afterIndex) })),
    postShelves: (response.postShelves ?? []).map((shelf): PlacedPostShelf => ({
      title: shelf.title ?? null,
      posts: shelf.posts,
      afterId: anchor(shelf.afterIndex),
      blockIndex: shelf.blockIndex,
    })),
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

/** A run of videos between two blocks, or one of the blocks. */
export type PlacedRow<B> = { kind: 'videos'; videos: VideoSummary[] } | { kind: 'block'; block: B };

/**
 * Lays blocks out among the videos the way YouTube ordered them. `order` is every video id as it
 * arrived, before any filtering, so a block whose video is hidden keeps its place after the one
 * before it.
 */
export function placeAmongVideos<B extends Placed>(order: string[], videos: VideoSummary[], blocks: B[]): PlacedRow<B>[] {
  const rank = new Map(order.map((id, index) => [id, index]));
  const positionOf = (block: B) => {
    if (block.afterId === null) return 0;
    const at = rank.get(block.afterId);
    if (at === undefined) return videos.length;
    return videos.filter((video) => (rank.get(video.id) ?? Infinity) <= at).length;
  };
  const placed = blocks
    .map((block, index) => ({ block, index, position: positionOf(block) }))
    .sort((a, b) => a.position - b.position || (a.block.blockIndex ?? a.index) - (b.block.blockIndex ?? b.index));
  const rows: PlacedRow<B>[] = [];
  let from = 0;
  for (const { block, position } of placed) {
    if (position > from) rows.push({ kind: 'videos', videos: videos.slice(from, position) });
    rows.push({ kind: 'block', block });
    from = Math.max(from, position);
  }
  if (from < videos.length) rows.push({ kind: 'videos', videos: videos.slice(from) });
  return rows;
}
