import type { WatchHistoryRecord } from '../types/db';
import type { SongItem } from '../types/music';

export interface QuickPickSeed {
  videoId: string;
  artistKey: string;
}

const normalizedArtistKey = (channelId?: string | null, channelName?: string | null): string =>
  (channelId ?? '').trim() || (channelName ?? '').trim().toLowerCase();

/** Select recent seeds while preferring a different artist for every lane. */
export function selectQuickPickSeeds(
  history: WatchHistoryRecord[],
  currentTrack: SongItem | null,
  limit: number,
  favorites: SongItem[] = [],
): QuickPickSeed[] {
  const candidates: QuickPickSeed[] = [];
  const seenTracks = new Set<string>();

  if (currentTrack) {
    const videoId = currentTrack.videoId ?? currentTrack.id;
    if (videoId) {
      candidates.push({
        videoId,
        artistKey: normalizedArtistKey(
          currentTrack.artists[0]?.id,
          currentTrack.artists[0]?.name,
        ),
      });
      seenTracks.add(videoId);
    }
  }

  for (let index = 0; index < Math.max(history.length, favorites.length); index += 1) {
    const record = history[index];
    if (record?.videoId && !seenTracks.has(record.videoId)) {
      seenTracks.add(record.videoId);
      candidates.push({
        videoId: record.videoId,
        artistKey: normalizedArtistKey(record.channelId, record.channelName),
      });
    }
    const favorite = favorites[index];
    const favoriteId = favorite?.videoId ?? favorite?.id;
    if (favorite && favoriteId && !seenTracks.has(favoriteId)) {
      seenTracks.add(favoriteId);
      candidates.push({
        videoId: favoriteId,
        artistKey: normalizedArtistKey(favorite.artists[0]?.id, favorite.artists[0]?.name),
      });
    }
  }

  const selected: QuickPickSeed[] = [];
  const selectedArtists = new Set<string>();
  for (const candidate of candidates) {
    if (candidate.artistKey && selectedArtists.has(candidate.artistKey)) continue;
    selected.push(candidate);
    if (candidate.artistKey) selectedArtists.add(candidate.artistKey);
    if (selected.length >= limit) return selected;
  }

  for (const candidate of candidates) {
    if (selected.some((seed) => seed.videoId === candidate.videoId)) continue;
    selected.push(candidate);
    if (selected.length >= limit) break;
  }
  return selected;
}

/** Round-robin independent recall lanes so no single station can own the shelf. */
export function interleaveQuickPickLanes(
  lanes: SongItem[][],
  limit: number,
  excludedIds: Iterable<string> = [],
  options: { chartLaneIndex?: number; chartLimit?: number; artistLimit?: number } = {},
): SongItem[] {
  const seen = new Set(excludedIds);
  const seenRecordings = new Set<string>();
  const artistCounts = new Map<string, number>();
  let chartCount = 0;
  const positions = lanes.map(() => 0);
  const mixed: SongItem[] = [];
  let madeProgress = true;

  while (mixed.length < limit && madeProgress) {
    madeProgress = false;
    for (let laneIndex = 0; laneIndex < lanes.length && mixed.length < limit; laneIndex += 1) {
      const lane = lanes[laneIndex];
      if (!lane) continue;
      let position = positions[laneIndex] ?? 0;
      while (position < lane.length) {
        const song = lane[position];
        position += 1;
        positions[laneIndex] = position;
        if (!song) continue;
        const id = song.videoId ?? song.id;
        if (!id || seen.has(id)) continue;
        if (song.musicVideoType && song.musicVideoType !== 'MUSIC_VIDEO_TYPE_ATV') continue;
        if (laneIndex === options.chartLaneIndex && chartCount >= (options.chartLimit ?? Infinity)) continue;
        const artistKey = normalizedArtistKey(song.artists[0]?.id, song.artists[0]?.name);
        if (artistKey && (artistCounts.get(artistKey) ?? 0) >= (options.artistLimit ?? Infinity)) continue;
        const recordingKey = `${song.title.trim().toLowerCase()}|${artistKey}`;
        if (seenRecordings.has(recordingKey)) continue;
        seen.add(id);
        seenRecordings.add(recordingKey);
        if (artistKey) artistCounts.set(artistKey, (artistCounts.get(artistKey) ?? 0) + 1);
        if (laneIndex === options.chartLaneIndex) chartCount += 1;
        mixed.push(song);
        madeProgress = true;
        break;
      }
    }
  }

  return mixed;
}

/**
 * One "fans also like" artist from each top artist in turn, so the similar-artist
 * lane is not a single artist's neighbourhood.
 */
export function pickFanArtists(relatedPerArtist: string[][], exclude: Set<string>, count: number): string[] {
  const picked: string[] = [];
  const depth = Math.max(0, ...relatedPerArtist.map((related) => related.length));
  for (let index = 0; index < depth && picked.length < count; index += 1) {
    for (const related of relatedPerArtist) {
      const id = related[index];
      if (!id || exclude.has(id) || picked.includes(id)) continue;
      picked.push(id);
      if (picked.length >= count) break;
    }
  }
  return picked;
}
