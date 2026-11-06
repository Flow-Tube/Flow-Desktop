import { describe, expect, it } from 'vitest';
import {
  dedupeTopFromBuckets,
  emptyResults,
  episodeAsSong,
  isCategoryOffered,
  pickTopResult,
  videoSections,
  withoutHidden,
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
