import { describe, expect, it } from 'vitest';

import { songDetailLines } from './songDetails';
import type { VideoDetails } from '../types/video';
import type { SongItem } from '../types/music';

const song = {
  id: 'a',
  videoId: 'a',
  title: 'Song',
  artists: [{ name: 'Artist', id: null }],
  album: { name: 'Album', id: 'x' },
  duration: 61,
  viewsText: '10 views',
} as SongItem;

describe('songDetailLines', () => {
  it('shows what the song already knows, without blanks', () => {
    expect(songDetailLines(song, null).map((line) => line.label)).toEqual(['Title', 'Artist', 'Album', 'Views', 'Duration']);
    expect(songDetailLines({ ...song, album: null, duration: null, viewsText: null }, null).map((line) => line.label)).toEqual(['Title', 'Artist']);
  });

  it('fills in from the video details', () => {
    const details = { title: 'Full', channelName: 'Chan', likeCountText: '5', viewCountText: '20', publishedText: 'Jan 1', subscriberCountText: '9', durationSeconds: 125 } as VideoDetails;
    const byLabel = new Map(songDetailLines(song, details).map((line) => [line.label, line.value]));
    expect(byLabel.get('Title')).toBe('Full');
    expect(byLabel.get('Views')).toBe('20');
    expect(byLabel.get('Likes')).toBe('5');
    expect(byLabel.get('Uploaded')).toBe('Jan 1');
    expect(byLabel.get('Subscribers')).toBe('9');
    expect(byLabel.get('Duration')).toBe('2:05');
    expect(byLabel.get('Artist')).toBe('Artist');
  });
});
