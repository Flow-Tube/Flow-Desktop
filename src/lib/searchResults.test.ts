import { describe, expect, it } from 'vitest';
import {
  dedupeTopFromBuckets,
  emptyResults,
  episodeAsSong,
  isCategoryOffered,
  pairCreator,
  pickTopResult,
  placeAmongVideos,
  videoSections,
  withWatchState,
  withoutAiMusic,
  withoutHidden,
  withoutShorts,
  type CombinedSearchResults,
} from './searchResults';
import type { AlbumItem, ArtistItem, PlaylistItem, SongItem } from '../types/music';
import { AI_LIST_MATCHER_NONE, createAiListMatcher, toAiLists } from './aiList/matcher';
import type { SearchChannel, VideoSummary } from '../types/video';

const channel = (channelId: string): SearchChannel => ({ channelId, name: channelId, isVerified: false });

const v = (id: string): VideoSummary => ({ id, title: id, channelName: 'C' });

describe('videoSections', () => {
  it('ties each shelf to the video before it, or to the previous page for one that opens it', () => {
    const sections = videoSections(
      {
        items: [v('a'), v('b')],
        source: 'innertube',
        shelves: [
          { title: 'First', videos: [v('x')], afterIndex: 0 },
          { title: 'Middle', videos: [v('y')], afterIndex: 1 },
          { title: 'Past the end', videos: [v('z')], afterIndex: 9 },
        ],
        shortsShelves: [{ title: null, shorts: [{ id: 's', title: 's' }], afterIndex: 2 }],
      },
      { lastVideoId: 'last-of-page-one', videoIds: new Set(), shortIds: new Set() },
    );
    expect(sections.shelves.map((shelf) => shelf.afterId)).toEqual(['last-of-page-one', 'a', 'b']);
    expect(sections.shortsShelves[0]).toMatchObject({ afterId: 'b', title: null });
    expect(sections.shortsShelves[0]?.shorts[0]?.type).toBe('short');
  });

  it('tags Shorts and playlists for the cards that render them', () => {
    const sections = videoSections({
      items: [],
      source: 'innertube',
      shorts: [{ id: 's1', title: 'A Short' }],
      playlists: [{ id: 'PL1', title: 'Mix' }],
    });
    expect(sections.shorts[0]?.type).toBe('short');
    expect(sections.videoPlaylists[0]?.type).toBe('playlist');
    expect(sections.channels).toEqual([]);
    expect(sections.correction).toBeNull();
  });
});

describe('top result', () => {
  it('falls back to the first channel and leaves it out of the channel row', () => {
    const channels = [channel('UC1'), channel('UC2')];
    const top = pickTopResult([], channels, []);
    expect(top).toEqual({ kind: 'channel', item: channels[0] });
    const results = dedupeTopFromBuckets({ ...emptyResults(), topResult: top, channels });
    expect(results.channels.map((c) => c.channelId)).toEqual(['UC2']);
  });
});

describe('music results', () => {
  const artist: ArtistItem = { id: 'UC1', title: 'A', thumbnail: null, channelId: 'UC1' };

  it('finds the top result by its flag, not its title', () => {
    const top = pickTopResult([{ title: 'Something else', items: [{ type: 'artist', ...artist }], isTopResult: true }], [], []);
    expect(top?.kind).toBe('artist');
    expect(pickTopResult([{ title: 'Top result', items: [{ type: 'artist', ...artist }] }], [], [])).toBeNull();
  });

  it('plays an episode as a track of its show', () => {
    const song = episodeAsSong({
      id: 'ep1', title: 'E', author: { name: 'Show', id: null }, podcastId: 'PL1',
      thumbnail: 't', explicit: false, publishDateText: null,
    });
    expect(song.videoId).toBe('ep1');
    expect(song.playlistId).toBe('PL1');
    expect(song.artists[0]?.name).toBe('Show');
  });

  it('hides only music categories the site did not offer', () => {
    expect(isCategoryOffered('podcasts', ['songs', 'albums'])).toBe(false);
    expect(isCategoryOffered('playlists', ['featured_playlists'])).toBe(true);
    expect(isCategoryOffered('videos', ['songs'])).toBe(true);
    expect(isCategoryOffered('episodes', null)).toBe(true);
  });
});

describe('withoutHidden', () => {
  const video = (id: string, channelId: string) => ({ id, channelId, title: id }) as VideoSummary;
  const results = {
    ...emptyResults(),
    topResult: { kind: 'video', item: video('top', 'UCblocked') },
    videos: [video('a', 'UCok'), video('b', 'channel:UCblocked'), video('dismissed', 'UCok')],
    live: [video('c', 'UCblocked')],
    channels: [{ channelId: 'UCblocked' }, { channelId: 'UCok' }],
    shelves: [
      { title: 'gone', videos: [video('d', 'UCblocked')], afterId: null },
      { title: 'kept', videos: [video('e', 'UCok')], afterId: null },
    ],
  } as CombinedSearchResults;
  const hidden = { videoIds: new Set(['dismissed']), channelIds: new Set(['UCblocked']) };

  it('removes blocked channels and dismissed videos everywhere', () => {
    const visible = withoutHidden(results, hidden);

    expect(visible.topResult).toBeNull();
    expect(visible.videos.map((v) => v.id)).toEqual(['a']);
    expect(visible.live).toEqual([]);
    expect(visible.channels.map((c) => c.channelId)).toEqual(['UCok']);
    expect(visible.shelves.map((s) => s.title)).toEqual(['kept']);
  });

  it('returns the same results when nothing is hidden', () => {
    expect(withoutHidden(results, { videoIds: new Set(), channelIds: new Set() })).toBe(results);
  });
});

describe('withWatchState', () => {
  const video = (id: string) => ({ id, title: id, channelName: 'c' });
  const results = {
    ...emptyResults(),
    videos: [video('seen'), video('new')],
    channels: [{ channelId: 'UC1', name: 'A', isVerified: false }],
    shelves: [{ title: 'Latest', videos: [video('seen')], afterId: null }],
  };
  const watched = new Set(['seen']);

  it('leaves everything under Any', () => {
    expect(withWatchState(results, 'any', watched)).toBe(results);
  });

  it('keeps channels under Unwatched, where they are still new', () => {
    const unwatched = withWatchState(results, 'unwatched', watched);
    expect(unwatched.videos.map((v) => v.id)).toEqual(['new']);
    expect(unwatched.channels).toHaveLength(1);
    expect(unwatched.shelves).toEqual([]);
  });

  it('is only videos under Watched', () => {
    const only = withWatchState(results, 'watched', watched);
    expect(only.videos.map((v) => v.id)).toEqual(['seen']);
    expect(only.channels).toEqual([]);
    expect(only.shelves).toHaveLength(1);
  });
});

describe('withoutShorts', () => {
  it('takes Shorts out of every list', () => {
    const video = (id: string, isShort: boolean) => ({ id, title: id, channelName: 'c', isShort });
    const out = withoutShorts({
      ...emptyResults(),
      shorts: [{ ...video('s', true), type: 'short' as const }],
      videos: [video('s2', true), video('v', false)],
      shelves: [{ title: 'Reels', videos: [video('s3', true)], afterId: null }],
    });
    expect(out.shorts).toEqual([]);
    expect(out.videos.map((v) => v.id)).toEqual(['v']);
    expect(out.shelves).toEqual([]);
  });
});

describe('pairCreator', () => {
  const channel = { channelId: 'UC1', name: 'Creator', isVerified: false };
  const upload = { id: 'v', title: 'v', channelName: 'Creator', channelId: 'UC1' };
  const uploads = { title: 'Latest from Creator', videos: [upload], afterId: null };

  it('joins a channel and its own shelf into one card', () => {
    const { creator, results } = pairCreator({
      ...emptyResults(),
      topResult: { kind: 'channel', item: channel },
      channels: [channel],
      shelves: [uploads],
    });
    expect(creator).toEqual({ channel, latest: uploads });
    expect(results.channels).toEqual([]);
    expect(results.shelves).toEqual([]);
    expect(results.topResult).toBeNull();
  });

  it('leaves a shelf of several channels alone', () => {
    const mixed = { title: 'People also watched', videos: [{ ...upload, channelId: 'UC2' }], afterId: null };
    const input = { ...emptyResults(), channels: [channel], shelves: [mixed] };
    expect(pairCreator(input)).toEqual({ creator: null, results: input });
  });
});

describe('withoutAiMusic', () => {
  const AI = 'UCaaaaaaaaaaaaaaaaaaaaaa';
  const REAL = 'UCrrrrrrrrrrrrrrrrrrrrrr';
  const ai = createAiListMatcher(
    toAiLists({ handles: [], ids: [] }, { handles: [], ids: [] }, { handles: [], ids: [AI] }),
    { blockEnabled: false, warnEnabled: false, musicEnabled: true, exemptIds: new Set(), exemptHandles: new Set() },
    null,
  );
  const song = (id: string, ...artistIds: string[]) =>
    ({ id, title: id, artists: artistIds.map((a) => ({ id: a, name: a })) }) as SongItem;
  const album = (browseId: string, artistId: string) =>
    ({ browseId, title: browseId, artists: [{ id: artistId, name: artistId }] }) as AlbumItem;
  const playlist = (id: string, authorId: string) => ({ id, title: id, author: { id: authorId, name: authorId } }) as PlaylistItem;
  const artist = { id: AI, title: 'AI band' } as ArtistItem;

  it('drops songs, collaborations, albums and playlists by a listed artist and keeps the artist card', () => {
    const results: CombinedSearchResults = {
      ...emptyResults(),
      topResult: { kind: 'artist', item: artist },
      songs: [song('a', AI), song('b', REAL, AI), song('c', REAL)],
      albums: [album('A1', AI), album('A2', REAL)],
      playlists: [playlist('P1', AI), playlist('P2', REAL)],
      artists: [artist],
    };
    const kept = withoutAiMusic(results, ai);
    expect(kept.songs.map((s) => s.id)).toEqual(['c']);
    expect(kept.albums.map((a) => a.browseId)).toEqual(['A2']);
    expect(kept.playlists.map((p) => p.id)).toEqual(['P2']);
    expect(kept.artists).toEqual([artist]);
    expect(kept.topResult?.kind).toBe('artist');
  });

  it('drops a listed song or album top result', () => {
    const top = withoutAiMusic({ ...emptyResults(), topResult: { kind: 'song', item: song('a', AI) } }, ai);
    expect(top.topResult).toBeNull();
  });

  it('returns the same object when nothing goes or the filter is off', () => {
    const clean: CombinedSearchResults = { ...emptyResults(), songs: [song('c', REAL)] };
    expect(withoutAiMusic(clean, ai)).toBe(clean);
    const listed: CombinedSearchResults = { ...emptyResults(), songs: [song('a', AI)] };
    expect(withoutAiMusic(listed, AI_LIST_MATCHER_NONE)).toBe(listed);
  });
});

describe('videoSections on a later page', () => {
  it('skips videos and Shorts the earlier pages showed', () => {
    const sections = videoSections(
      {
        items: [v('new1'), v('seen'), v('new2')],
        source: 'innertube',
        shelves: [{ title: 'After a repeat', videos: [v('x')], afterIndex: 2 }],
        shortsShelves: [
          { title: null, shorts: [{ id: 'old', title: 'old' }, { id: 'fresh', title: 'fresh' }], afterIndex: 0 },
          { title: null, shorts: [{ id: 'old', title: 'old' }], afterIndex: 3 },
        ],
      },
      { lastVideoId: 'end-of-page-one', videoIds: new Set(['seen']), shortIds: new Set(['old']) },
    );
    expect(sections.shelves[0]?.afterId).toBe('new1');
    expect(sections.shortsShelves.map((shelf) => shelf.shorts.map((short) => short.id))).toEqual([['fresh']]);
    expect(sections.shortsShelves[0]?.afterId).toBe('end-of-page-one');
  });
});

describe('placeAmongVideos', () => {
  const block = (name: string, afterId: string | null) => ({ name, afterId });
  const shape = (rows: ReturnType<typeof placeAmongVideos<ReturnType<typeof block>>>) =>
    rows.map((row) => (row.kind === 'videos' ? row.videos.map((video) => video.id).join('') : `[${row.block.name}]`));

  it('puts each block after its video, in arrival order', () => {
    const order = ['a', 'b', 'c', 'd'];
    const rows = placeAmongVideos(order, order.map(v), [block('shorts', 'b'), block('top', null), block('posts', 'b')]);
    expect(shape(rows)).toEqual(['[top]', 'ab', '[shorts]', '[posts]', 'cd']);
  });

  it('keeps a block in place when the video before it is filtered out', () => {
    const rows = placeAmongVideos(['a', 'b', 'c'], [v('a'), v('c')], [block('shelf', 'b')]);
    expect(shape(rows)).toEqual(['a', '[shelf]', 'c']);
  });

  it('orders blocks at the same place the way they arrived', () => {
    const rows = placeAmongVideos(['a'], [v('a')], [{ ...block('second', 'a'), blockIndex: 1 }, { ...block('first', 'a'), blockIndex: 0 }]);
    expect(shape(rows)).toEqual(['a', '[first]', '[second]']);
  });

  it('sends a block whose video it never saw to the end', () => {
    const rows = placeAmongVideos(['a'], [v('a')], [block('shelf', 'gone')]);
    expect(shape(rows)).toEqual(['a', '[shelf]']);
  });
});

describe('post strips', () => {
  it('leave out posts by a blocked channel, and strips left empty', () => {
    const post = (id: string, authorChannelId: string | null) => ({ type: 'post' as const, id, authorName: id, authorChannelId });
    const results = {
      ...emptyResults(),
      postShelves: [
        { title: null, afterId: null, posts: [post('p1', 'UCblocked'), post('p2', 'UCok')] },
        { title: null, afterId: 'a', posts: [post('p3', 'UCblocked')] },
      ],
    };
    const visible = withoutHidden(results, { videoIds: new Set(), channelIds: new Set(['UCblocked']) });
    expect(visible.postShelves.map((shelf) => shelf.posts.map((p) => p.id))).toEqual([['p2']]);
  });
});
