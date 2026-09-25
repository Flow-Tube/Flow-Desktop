import { useEffect, useRef, useState } from 'react';
import { getMusicHistory } from './api/db';
import {
  getDailyMixes,
  getHeavyRotation,
  getMusicPlaylistPage,
  getMusicRelatedTyped,
  getMusicTasteProfile,
  searchMusicTyped,
} from './api/music';
import i18n from './i18n';
import { getString } from './i18n/index';
import { buildQuickPicks } from './musicQuickPicksBuilder';
import { dailyMixId, dailyMixRoute, expandDailyMix } from './musicMixes';
import {
  MIN_SHELF_ITEMS,
  audioMusicOnly,
  chartsSongs,
  ranked,
  recallArtist,
  relatedSongs,
  shuffled,
  songIdOf,
  takeUnused,
  toYTSong,
  ytItemId,
} from './musicRecall';
import { useMusicPlayerStore } from '../store/useMusicPlayerStore';
import type { MusicTasteProfile, PlaylistItem, SongItem, YTItem } from '../types/music';
import type { WatchHistoryRecord } from '../types/db';

export interface PersonalSection {
  id: string;
  title: string;
  subtitle?: string;
  items: YTItem[];
  route?: string;
  previews?: Record<string, SongItem[]>;
}

export interface MusicPersonalization {
  quickPicks: SongItem[];
  sections: PersonalSection[];
  loading: boolean;
  maturity: MusicTasteProfile['maturity'];
}

const HISTORY_SEED_LIMIT = 50;

// --- Artist-graph discovery ("Fans of {Artist} also like") ----------------
const SIMILAR_MAX_ANCHORS = 2;
const ARTIST_GRAPH_BASE_ANCHORS = 2;
const ARTIST_GRAPH_HIGH_APPETITE = 0.45; // ≥ this → one extra anchor + discovery surfaced earlier
const ARTIST_GRAPH_MAX_ANCHORS = 3;
const ARTIST_GRAPH_RELATED_CONSIDERED = 4; // top related artists eyed per anchor…
const ARTIST_GRAPH_RELATED_FETCHED = 3; // …of which we fetch this many (budget permitting)
const ARTIST_GRAPH_TRACKS_PER_RELATED = 3;
const ARTIST_GRAPH_SHELF_SIZE = 14;
const ARTIST_GRAPH_MAX_FETCHES = 8; // hard cap on artist-page fetches per home build

const COMMUNITY_PREVIEWS = 6;

// Cross-reload repetition guard: a session-scoped FIFO ring of recently-surfaced track ids.
// Discovery/recall shelves avoid these so reloading the home yields fresh content; On Repeat
// and Daily Mixes deliberately ignore it (they are meant to be stable).
const RECENTLY_SHOWN_MAX = 200;
const MAX_PERSONAL_SHELVES = 16;

let recentlyShown: string[] = [];

function snapshotRecentlyShown(): Set<string> {
  return new Set(recentlyShown);
}

function rememberShown(ids: Iterable<string>): void {
  for (const id of ids) {
    if (!id || recentlyShown.includes(id)) continue;
    recentlyShown.push(id);
  }
  if (recentlyShown.length > RECENTLY_SHOWN_MAX) {
    recentlyShown = recentlyShown.slice(recentlyShown.length - RECENTLY_SHOWN_MAX);
  }
}

/** artist_key → a representative seed videoId, mirroring the backend's `artist_key()`
 *  (channelId when present, else lowercased channelName). First (most recent) wins. */
function historyArtistSeeds(history: WatchHistoryRecord[]): Map<string, string> {
  const seeds = new Map<string, string>();
  for (const h of history) {
    if (!h.videoId) continue;
    const id = (h.channelId ?? '').trim();
    const key = id !== '' ? id : (h.channelName ?? '').trim().toLowerCase();
    if (key && !seeds.has(key)) seeds.set(key, h.videoId);
  }
  return seeds;
}

interface SimilarAnchor {
  key: string;
  name: string;
  seed: string;
}

// "Similar to {Artist}" — song-radio around the user's favorite artists. Anchors are taken
// from the brain's affinity ranking (the real taste model) and grounded to a seed track via
// history; only when the profile is cold/unavailable does it fall back to raw history counts.
async function buildSimilarTo(
  profile: MusicTasteProfile | null,
  history: WatchHistoryRecord[],
  used: Set<string>,
  usedAnchors: Set<string>,
  avoid: Set<string>,
): Promise<PersonalSection[]> {
  if (history.length === 0) return [];
  const seeds = historyArtistSeeds(history);

  const anchors: SimilarAnchor[] = [];
  for (const a of profile?.topArtists ?? []) {
    if (usedAnchors.has(a.key)) continue;
    const seed = seeds.get(a.key);
    if (!seed) continue;
    anchors.push({ key: a.key, name: a.name, seed });
    if (anchors.length >= SIMILAR_MAX_ANCHORS) break;
  }
  if (anchors.length === 0) {
    // Fallback: top artists by raw history counts (cold brain or profile fetch failed).
    const byArtist = new Map<string, WatchHistoryRecord[]>();
    for (const h of history) {
      const artist = (h.channelName ?? '').trim();
      if (!artist) continue;
      const list = byArtist.get(artist) ?? [];
      list.push(h);
      byArtist.set(artist, list);
    }
    const top = shuffled(
      [...byArtist.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 6),
    ).slice(0, SIMILAR_MAX_ANCHORS);
    for (const [artist, recs] of top) {
      const seed = recs.find((r) => r.videoId)?.videoId;
      if (!seed) continue;
      const key = (recs[0]?.channelId ?? '').trim() || artist.toLowerCase();
      if (usedAnchors.has(key)) continue;
      anchors.push({ key, name: artist, seed });
    }
  }

  const sections: PersonalSection[] = [];
  const seenSeeds = new Set<string>();
  for (const anchor of anchors) {
    usedAnchors.add(anchor.key);
    const page = await getMusicRelatedTyped(anchor.seed).catch(() => null);
    if (!page) continue;
    const songs = takeUnused(await ranked(audioMusicOnly(page.songs), 'similar'), 10, used, avoid);
    const mixed: YTItem[] = [
      ...songs.map(toYTSong),
      ...page.artists.slice(0, 2).map((item) => ({ type: 'artist' as const, ...item })),
      ...page.playlists.slice(0, 2).map((item) => ({ type: 'playlist' as const, ...item })),
    ];
    if (mixed.length >= MIN_SHELF_ITEMS) {
      seenSeeds.add(anchor.seed);
      sections.push({
        id: `similar-${anchor.key}`,
        title: anchor.name,
        subtitle: getString('music_similar_to'),
        items: mixed,
      });
    }
    const performances = page.otherPerformances.slice(0, 12).map(toYTSong);
    if (performances.length >= 3) sections.push({
      id: `performances-${anchor.key}`, title: i18n.t('musicOtherPerformances'),
      subtitle: anchor.name, items: performances,
    });
    const albums = page.albums.slice(0, 12).map((item) => ({ type: 'album' as const, ...item }));
    // The related page titles this shelf with the artist's name and links it to the artist.
    const moreFrom = page.sections.find((section) => section.shelfType === 'moreFromArtist');
    if (albums.length >= 3) sections.push({
      id: `artist-albums-${anchor.key}`,
      title: i18n.t('musicMoreFromArtist', { artist: moreFrom?.title || anchor.name }),
      route: moreFrom?.artistBrowseId ? `/music/artist/${moreFrom.artistBrowseId}` : undefined,
      items: albums,
    });
  }

  const recent = history[0];
  if (recent?.videoId && !seenSeeds.has(recent.videoId)) {
    const page = await getMusicRelatedTyped(recent.videoId).catch(() => null);
    const items = takeUnused(await ranked(audioMusicOnly(page?.songs ?? []), 'similar'), 12, used, avoid);
    if (items.length >= MIN_SHELF_ITEMS) {
      sections.push({
        id: `similar-${recent.videoId}`,
        title: recent.title,
        subtitle: getString('music_similar_to'),
        items: items.map(toYTSong),
      });
    }
  }
  return sections;
}

// "Fans of {Artist} also like" — the artist-similarity graph. For the user's top id-keyed
// artists, follow the artist page's "Fans might also like" edge into adjacent artists and
// surface their top tracks. This widens discovery beyond same-song radio. Bounded to
// ARTIST_GRAPH_MAX_FETCHES artist-page calls per build; skipped on cold-start (no anchors).
async function buildArtistGraph(
  profile: MusicTasteProfile | null,
  used: Set<string>,
  usedAnchors: Set<string>,
  avoid: Set<string>,
): Promise<PersonalSection[]> {
  if (!profile || profile.maturity === 'cold_start') return [];
  const candidates = profile.topArtists.filter((a) => a.idKeyed && !usedAnchors.has(a.key));
  if (candidates.length === 0) return [];

  const anchorCount =
    profile.discoveryAppetite >= ARTIST_GRAPH_HIGH_APPETITE
      ? ARTIST_GRAPH_MAX_ANCHORS
      : ARTIST_GRAPH_BASE_ANCHORS;
  const anchors = candidates.slice(0, anchorCount);

  const sections: PersonalSection[] = [];
  const seenRelated = new Set<string>(); // dedupe related artists across anchors
  let fetches = 0;

  for (const anchor of anchors) {
    if (fetches >= ARTIST_GRAPH_MAX_FETCHES) break;
    usedAnchors.add(anchor.key);

    fetches += 1;
    const related = (await recallArtist(anchor.key))?.related;
    if (!related) continue;

    const budget = Math.max(0, ARTIST_GRAPH_MAX_FETCHES - fetches);
    const fetchable = related
      .filter((r) => r.id && !seenRelated.has(r.id))
      .slice(0, ARTIST_GRAPH_RELATED_CONSIDERED)
      .slice(0, Math.min(ARTIST_GRAPH_RELATED_FETCHED, budget));
    if (fetchable.length === 0) continue;
    fetchable.forEach((r) => seenRelated.add(r.id));
    fetches += fetchable.length;

    const pages = await Promise.all(fetchable.map((r) => recallArtist(r.id)));
    const pool = pages.flatMap((page) =>
      audioMusicOnly(page?.topSongs ?? []).slice(0, ARTIST_GRAPH_TRACKS_PER_RELATED));

    const rankedPool = await ranked(audioMusicOnly(pool), 'similar');
    const items = takeUnused(rankedPool, ARTIST_GRAPH_SHELF_SIZE, used, avoid).map(toYTSong);
    if (items.length >= MIN_SHELF_ITEMS) {
      sections.push({
        id: `fans-${anchor.key}`,
        title: getString('music_fans_also_like', anchor.name),
        items,
      });
    }
  }
  return sections;
}

async function buildDailyDiscover(
  history: WatchHistoryRecord[],
  used: Set<string>,
  avoid: Set<string>,
): Promise<PersonalSection | null> {
  if (history.length === 0) return null;
  const seeds = shuffled(history).slice(0, 8);
  const results = await Promise.all(seeds.map((seed) => relatedSongs(seed.videoId)));
  const pool = await ranked(audioMusicOnly(results.flat()), 'discover');
  const items = takeUnused(pool, 12, used, avoid).map(toYTSong);
  if (items.length < MIN_SHELF_ITEMS) return null;
  return { id: 'daily-discover', title: getString('music_daily_discover'), items };
}

const isCommunityPlaylist = (playlist: PlaylistItem): boolean =>
  !playlist.id.startsWith('RD') && !playlist.id.startsWith('OLAK')
  && (playlist.author?.name ?? '').trim().toLowerCase() !== 'youtube';

// Community playlists: typed sources first (related "Recommended playlists" for the last
// listen, then "Featured on" from the top artists' pages), with a text search only when
// those are thin. The first few are hydrated for a track preview.
async function buildFromCommunity(
  history: WatchHistoryRecord[],
  profile: MusicTasteProfile | null,
): Promise<PersonalSection | null> {
  const recent = history[0];
  const anchors = (profile?.topArtists ?? []).filter((artist) => artist.idKeyed).slice(0, 2);
  const [related, artistPages] = await Promise.all([
    recent ? getMusicRelatedTyped(recent.videoId).catch(() => null) : Promise.resolve(null),
    Promise.all(anchors.map((artist) => recallArtist(artist.key))),
  ]);
  const typed = [...(related?.playlists ?? []), ...artistPages.flatMap((page) => page?.featuredOn ?? [])]
    .filter(isCommunityPlaylist);
  const searchArtists = typed.length >= MIN_SHELF_ITEMS ? []
    : [...new Set(history.map((h) => (h.channelName ?? '').trim()).filter(Boolean))].slice(0, 3);
  const searched = await Promise.all(searchArtists.map(async (artist) => {
    try {
      const res = await searchMusicTyped(`${artist} playlist`, 'community_playlists');
      return res.sections.flatMap((s) => s.items)
        .filter((it): it is Extract<YTItem, { type: 'playlist' }> => it.type === 'playlist');
    } catch {
      return [];
    }
  }));

  const seen = new Set<string>();
  const playlists = [...typed, ...searched.flat().filter(isCommunityPlaylist)]
    .filter((playlist) => !seen.has(playlist.id) && !!seen.add(playlist.id))
    .slice(0, 12);
  if (playlists.length === 0) return null;

  const previews: Record<string, SongItem[]> = {};
  const pages = await Promise.all(playlists.slice(0, COMMUNITY_PREVIEWS)
    .map((playlist) => getMusicPlaylistPage(playlist.id, { preferCached: true }).catch(() => null)));
  pages.forEach((page, index) => {
    const playlist = playlists[index];
    if (playlist && page) previews[playlist.id] = audioMusicOnly(page.songs).slice(0, 10);
  });
  return {
    id: 'from-community',
    title: getString('music_from_community'),
    items: playlists.map((playlist) => ({ type: 'playlist' as const, ...playlist })),
    previews,
  };
}

// "On Repeat": the user's heavy-rotation tracks (ACT-R activation), resolved locally
// by the music brain — no network. Empty until there's enough listening history.
async function buildHeavyRotation(used: Set<string>): Promise<PersonalSection | null> {
  try {
    const songs = audioMusicOnly(await getHeavyRotation(16));
    const items = takeUnused(songs, 16, used).map(toYTSong);
    if (items.length < MIN_SHELF_ITEMS) return null;
    return { id: 'on-repeat', title: getString('music_on_repeat'), items };
  } catch {
    return null;
  }
}

// Daily Mixes: clusters of the user's favorite artists (grouped by co-listening in the
// music brain), each expanded into a playlist via YT Music related songs and ranked.
async function buildDailyMixes(used: Set<string>): Promise<PersonalSection[]> {
  let mixes;
  try {
    mixes = await getDailyMixes(3);
  } catch {
    return [];
  }
  const sections: PersonalSection[] = [];
  for (const mix of mixes) {
    const pool = await expandDailyMix(mix);
    const items = takeUnused(pool, 14, used).map(toYTSong);
    if (items.length >= MIN_SHELF_ITEMS) {
      sections.push({
        id: dailyMixId(mix),
        title: `${mix.label} ${getString('music_mix')}`,
        items,
        route: dailyMixRoute(mix),
      });
    }
  }
  return sections;
}

// Cold-start surface: real charts (what's genuinely popular now), discovery-ranked —
// replaces the old hardcoded artist list.
async function buildPopularArtists(
  used: Set<string>,
  avoid: Set<string>,
): Promise<PersonalSection | null> {
  const pool = await ranked(await chartsSongs(), 'discover');
  const items = takeUnused(pool, 16, used, avoid).map(toYTSong);
  if (items.length < MIN_SHELF_ITEMS) return null;
  return { id: 'popular-songs', title: i18n.t('musicPopularSongs'), items };
}

interface BuiltSections {
  heavy: PersonalSection | null;
  mixes: PersonalSection[];
  fans: PersonalSection[];
  similar: PersonalSection[];
  daily: PersonalSection | null;
  community: PersonalSection | null;
  popular: PersonalSection | null;
}

// Dynamically orders the home shelves from the user's state instead of a fixed list:
//  • cold_start → comfort/charts-led (no artist-graph yet); never an empty home.
//  • high discovery appetite → graph-driven discovery surfaced early (after On Repeat).
//  • otherwise → comfort-first, discovery after.
// Capped at MAX_PERSONAL_SHELVES so the home never becomes an endless wall.
function planSections(profile: MusicTasteProfile | null, b: BuiltSections): PersonalSection[] {
  const maturity = profile?.maturity ?? 'cold_start';
  const highAppetite = (profile?.discoveryAppetite ?? 0) >= ARTIST_GRAPH_HIGH_APPETITE;
  const out: PersonalSection[] = [];
  const push = (s: PersonalSection | null | undefined) => {
    if (s) out.push(s);
  };
  const pushAll = (arr: PersonalSection[]) => out.push(...arr);

  if (maturity === 'cold_start') {
    push(b.heavy);
    push(b.popular);
    push(b.daily);
    push(b.community);
    pushAll(b.similar);
  } else if (highAppetite) {
    push(b.heavy);
    pushAll(b.fans);
    push(b.daily);
    pushAll(b.mixes);
    pushAll(b.similar);
    push(b.community);
    push(b.popular);
  } else {
    push(b.heavy);
    pushAll(b.mixes);
    pushAll(b.similar);
    pushAll(b.fans);
    push(b.daily);
    push(b.community);
    push(b.popular);
  }
  return out.slice(0, MAX_PERSONAL_SHELVES);
}

const EMPTY_BUILD: BuiltSections = {
  heavy: null, mixes: [], fans: [], similar: [], daily: null, community: null, popular: null,
};

function sectionItemIds(sections: PersonalSection[]): Set<string> {
  const ids = new Set<string>();
  for (const section of sections) for (const item of section.items) {
    const id = ytItemId(item);
    if (id) ids.add(id);
  }
  return ids;
}

export function useMusicPersonalization(): MusicPersonalization {
  const currentTrack = useMusicPlayerStore((s) => s.currentTrack);
  const currentTrackId = currentTrack ? songIdOf(currentTrack) : null;

  const [quickPicks, setQuickPicks] = useState<SongItem[]>([]);
  const [sections, setSections] = useState<PersonalSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [maturity, setMaturity] = useState<MusicTasteProfile['maturity']>('cold_start');
  const [dataVersion, setDataVersion] = useState(0);

  const historyRef = useRef<WatchHistoryRecord[]>([]);
  const profileRef = useRef<MusicTasteProfile | null>(null);
  const sectionIdsRef = useRef<Set<string>>(new Set());
  const sectionsReqRef = useRef(0);
  const quickReqRef = useRef(0);

  useEffect(() => {
    const req = ++sectionsReqRef.current;
    setLoading(true);
    (async () => {
      const [history, profile] = await Promise.all([
        getMusicHistory(HISTORY_SEED_LIMIT, 0).catch(() => [] as WatchHistoryRecord[]),
        getMusicTasteProfile().catch(() => null),
      ]);
      if (sectionsReqRef.current !== req) return;
      historyRef.current = history;
      profileRef.current = profile;
      setMaturity(profile?.maturity ?? 'cold_start');

      const communityP = buildFromCommunity(history, profile);
      const used = new Set<string>();
      const usedAnchors = new Set<string>();
      // Avoid re-surfacing tracks shown on a recent reload — discovery/recall shelves only.
      const avoid = snapshotRecentlyShown();
      const built: BuiltSections = { ...EMPTY_BUILD };
      // Each stage publishes as soon as it lands, in planned order, so fast local
      // shelves never wait behind slower network-backed ones.
      const publish = (): boolean => {
        if (sectionsReqRef.current !== req) return false;
        const next = planSections(profile, built);
        sectionIdsRef.current = sectionItemIds(next);
        setSections(next);
        return true;
      };

      // On Repeat + Daily Mixes run first (claim the strongest tracks) and intentionally
      // ignore the recently-shown ring — they are meant to be stable. The artist-graph then
      // claims the best id-keyed anchors before Similar-To takes the remainder.
      built.heavy = await buildHeavyRotation(used);
      if (!publish()) return;
      setLoading(false);
      setDataVersion((version) => version + 1);
      built.mixes = await buildDailyMixes(used);
      if (!publish()) return;
      built.fans = await buildArtistGraph(profile, used, usedAnchors, avoid);
      if (!publish()) return;
      built.similar = await buildSimilarTo(profile, history, used, usedAnchors, avoid);
      if (!publish()) return;
      built.daily = await buildDailyDiscover(history, used, avoid);
      built.popular = await buildPopularArtists(used, avoid);
      built.community = await communityP;
      if (!publish()) return;
      rememberShown(sectionIdsRef.current); // refresh the cross-reload repetition guard
    })().catch(() => {
      if (sectionsReqRef.current === req) setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (dataVersion === 0) return;
    const req = ++quickReqRef.current;
    void buildQuickPicks(historyRef.current, currentTrack, new Set(sectionIdsRef.current), profileRef.current)
      .then((picks) => {
        if (quickReqRef.current === req) setQuickPicks(picks);
      })
      .catch(() => undefined);
  }, [currentTrackId, dataVersion]);

  return { quickPicks, sections, loading, maturity };
}
