import { describe, expect, it } from 'vitest';
import { dedupeTopFromBuckets, emptyResults, pickTopResult, videoSections } from './searchResults';
import type { SearchChannel } from '../types/video';

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
