import { describe, expect, it } from 'vitest';
import {
  dedupeTopFromBuckets,
  emptyResults,
  episodeAsSong,
  isCategoryOffered,
  pairCreator,
  pickTopResult,
  videoSections,
  withWatchState,
  withoutHidden,
  withoutShorts,
  type CombinedSearchResults,
} from './searchResults';
import type { ArtistItem } from '../types/music';
import type { SearchChannel, VideoSummary } from '../types/video';

const channel = (channelId: string): SearchChannel => ({ channelId, name: channelId, isVerified: false });

describe('videoSections', () => {
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
      { title: 'gone', videos: [video('d', 'UCblocked')] },
      { title: 'kept', videos: [video('e', 'UCok')] },
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
    shelves: [{ title: 'Latest', videos: [video('seen')] }],
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
      shelves: [{ title: 'Reels', videos: [video('s3', true)] }],
    });
    expect(out.shorts).toEqual([]);
    expect(out.videos.map((v) => v.id)).toEqual(['v']);
    expect(out.shelves).toEqual([]);
  });
});

describe('pairCreator', () => {
  const channel = { channelId: 'UC1', name: 'Creator', isVerified: false };
  const upload = { id: 'v', title: 'v', channelName: 'Creator', channelId: 'UC1' };
  const uploads = { title: 'Latest from Creator', videos: [upload] };

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
    const mixed = { title: 'People also watched', videos: [{ ...upload, channelId: 'UC2' }] };
    const input = { ...emptyResults(), channels: [channel], shelves: [mixed] };
    expect(pairCreator(input)).toEqual({ creator: null, results: input });
  });
});
