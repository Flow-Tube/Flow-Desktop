import { getMusicQueueContinuation, getMusicWatchQueue } from './api/music';
import {
  MIN_SHELF_ITEMS,
  audioMusicOnly,
  trendingSongs,
  isAudioSong,
  ranked,
  recallArtist,
  relatedSongs,
} from './musicRecall';
import { interleaveQuickPickLanes, pickFanArtists, selectQuickPickSeeds } from './musicQuickPicks';
import { useLikesStore } from '../store/useLikesStore';
import type { MusicTasteProfile, SongItem } from '../types/music';
import type { WatchHistoryRecord } from '../types/db';

const TARGET = 24;
const SEED_LIMIT = 5;
const RADIO_SEEDS = 2;
const LANE_SIZE = 20;
const RADIO_MAX_PAGES = 2;
const ARTIST_LANES = 3;
const FAN_ARTISTS = 3;
const CHART_PICKS = 2;
const PICKS_PER_ARTIST = 3;

async function gatherRadio(seedId: string): Promise<SongItem[]> {
  const pool: SongItem[] = [];
  try {
    const first = await getMusicWatchQueue(seedId, `RDAMVM${seedId}`);
    pool.push(...first.items);
    let continuation = first.continuation;
    for (let page = 0; pool.length < LANE_SIZE && continuation && page < RADIO_MAX_PAGES; page += 1) {
      const next = await getMusicQueueContinuation(continuation);
      pool.push(...next.items);
      continuation = next.continuation;
    }
  } catch {
    // A failed station only removes its lane.
  }
  return pool;
}

/** Top tracks of the strongest artists plus one lane from their "fans also like" artists. */
async function artistLanes(profile: MusicTasteProfile | null): Promise<SongItem[][]> {
  const anchors = (profile?.topArtists ?? []).filter((artist) => artist.idKeyed).slice(0, ARTIST_LANES);
  const pages = await Promise.all(anchors.map((artist) => recallArtist(artist.key)));
  const lanes = pages.flatMap((page) => (page ? [audioMusicOnly(page.topSongs).slice(0, LANE_SIZE)] : []));
  const fanIds = pickFanArtists(
    pages.map((page) => (page?.related ?? []).map((artist) => artist.id)),
    new Set(profile?.topArtists.map((artist) => artist.key) ?? []),
    FAN_ARTISTS,
  );
  const fans = await Promise.all(fanIds.map(recallArtist));
  const fanLane = audioMusicOnly(fans.flatMap((page) => page?.topSongs.slice(0, LANE_SIZE / 2) ?? []));
  return [...lanes, fanLane].filter((lane) => lane.length > 0);
}

/**
 * Quick Picks: history and liked-song seeds feed radio, related and artist lanes,
 * with charts as a capped discovery lane. When nothing personal exists (first run)
 * charts may fill the shelf, and a shelf too small to be useful is not shown.
 */
export async function buildQuickPicks(
  history: WatchHistoryRecord[],
  currentTrack: SongItem | null,
  used: Set<string>,
  profile: MusicTasteProfile | null,
): Promise<SongItem[]> {
  await useLikesStore.getState().load();
  const favorites = useLikesStore.getState().items
    .filter((item) => item.kind === 'music')
    .map((item) => item.song)
    .filter(isAudioSong);
  const seeds = selectQuickPickSeeds(history, currentTrack, SEED_LIMIT, favorites);
  for (const seed of seeds) used.add(seed.videoId);

  const [radio, related, charts, artists] = await Promise.all([
    Promise.all(seeds.slice(0, RADIO_SEEDS).map((seed) => gatherRadio(seed.videoId))),
    Promise.all(seeds.map((seed) => relatedSongs(seed.videoId))),
    trendingSongs(),
    artistLanes(profile),
  ]);
  const personal = (await Promise.all(
    [...radio, ...related, ...artists].map((lane) => ranked(audioMusicOnly(lane), 'quick_picks')),
  )).filter((lane) => lane.length > 0);
  const discovery = await ranked(charts, 'discover');
  const picks = interleaveQuickPickLanes([...personal, discovery], TARGET, used, {
    chartLaneIndex: personal.length,
    chartLimit: personal.length > 0 ? CHART_PICKS : TARGET,
    artistLimit: PICKS_PER_ARTIST,
  });
  return picks.length >= MIN_SHELF_ITEMS ? picks : [];
}
