import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getMusicMoodGenre, getMusicTasteProfile, searchMusicTyped } from './api/music';
import { pickForSession } from './musicFeedComposer';
import { audioMusicOnly, ranked, trendingSongs } from './musicRecall';
import type { PersonalSection } from './useMusicPersonalization';
import type { ArtistItem, MoodAndGenreGroup, MusicHomeChip, PlaylistItem, SongItem, YTItem } from '../types/music';

const SECTION_ORDER = ['vibes', 'mixed-for-you', 'popular-artists'];
const LANE_SIZE = 10;
const MIN_ITEMS = 3;
const GENRE_MIXES = 3;
const GENRE_MIX_SIZE = 14;
const MIXED_FOR_YOU_ARTISTS = 2;

/**
 * Preferred genre order while MusicBrain has no genre signal of its own, the same
 * mainstream set Android uses. The names come from YouTube's own genre list; any
 * that YouTube does not offer are skipped.
 */
const PREFERRED_GENRES = ['pop', 'rock', 'hip-hop', 'r&b', 'dance & electronic'];

const playlistsOf = (items: YTItem[]): PlaylistItem[] =>
  items.filter((item): item is Extract<YTItem, { type: 'playlist' }> => item.type === 'playlist');
const songsOf = (items: YTItem[]): SongItem[] =>
  items.filter((item): item is Extract<YTItem, { type: 'song' }> => item.type === 'song');

/** One artist per trending song, in chart order, using the song's cover. */
export function popularArtistsFrom(songs: SongItem[], limit: number): ArtistItem[] {
  const seen = new Set<string>();
  const artists: ArtistItem[] = [];
  for (const song of songs) {
    const artist = song.artists[0];
    if (!artist?.id || seen.has(artist.id)) continue;
    seen.add(artist.id);
    artists.push({ id: artist.id, title: artist.name, thumbnail: song.thumbnail || null, channelId: null });
    if (artists.length >= limit) break;
  }
  return artists;
}

/** Genres from YouTube's list, preferred ones first, then a per-session pick of the rest. */
export function chooseGenres<T extends { title: string }>(genres: T[], count: number): T[] {
  const preferred = PREFERRED_GENRES
    .map((name) => genres.find((genre) => genre.title.trim().toLowerCase() === name))
    .filter((genre): genre is T => !!genre);
  const rest = pickForSession(genres.filter((genre) => !preferred.includes(genre)), count,
    (genre) => genre.title, 'genres');
  return [...preferred, ...rest].slice(0, count);
}

/**
 * Discovery shelves Android shows beyond the personal ones: a "{mood} Vibes" playlist row
 * from one of YouTube's home chips, "Mixed for you" (YouTube Music's curated playlists for
 * the top artists), "Popular artists" from what is trending, and genre mixes drawn from
 * YouTube's genre pages. Each loads on its own; a failed source only removes its shelf.
 */
export function useMusicMoreSections(chips: MusicHomeChip[], moodGroups: MoodAndGenreGroup[]): PersonalSection[] {
  const { t } = useTranslation('common');
  const [sections, setSections] = useState<PersonalSection[]>([]);
  const requestRef = useRef(0);
  // Callers rebuild these arrays on every render, so choices are keyed by content.
  const chipsKey = chips.map((chip) => `${chip.title}|${chip.browseId ?? ''}|${chip.params ?? ''}`).join(';');
  const vibeChip = useMemo(
    () => pickForSession(chips.filter((chip) => !!chip.browseId), 1, (chip) => chip.title, 'vibe')[0],
    [chipsKey],
  );
  // Moods come first on YouTube's page and genres after them.
  const genres = useMemo(
    () => chooseGenres(moodGroups.slice(1).flatMap((group) => group.items), GENRE_MIXES),
    [moodGroups],
  );

  useEffect(() => {
    const request = ++requestRef.current;
    const live = () => requestRef.current === request;
    const publish = (section: PersonalSection | null, min = MIN_ITEMS) => {
      if (!section || !live() || section.items.length < min) return;
      setSections((previous) => [...previous.filter((item) => item.id !== section.id), section]
        .sort((a, b) => {
          const rank = (id: string) => (SECTION_ORDER.includes(id) ? SECTION_ORDER.indexOf(id) : SECTION_ORDER.length);
          return rank(a.id) - rank(b.id);
        }));
    };

    if (vibeChip?.browseId) {
      void getMusicMoodGenre(vibeChip.browseId, vibeChip.params ?? undefined)
        .then((page) => publish({
          id: 'vibes',
          title: t('musicVibes', { vibe: vibeChip.title }),
          subtitle: t('musicCommunityPlaylists'),
          items: playlistsOf(page.items).slice(0, LANE_SIZE).map((item) => ({ type: 'playlist' as const, ...item })),
        }))
        .catch(() => undefined);
    }

    void (async () => {
      const profile = await getMusicTasteProfile().catch(() => null);
      const names = pickForSession((profile?.topArtists ?? []).slice(0, 3), MIXED_FOR_YOU_ARTISTS,
        (artist) => artist.key, 'mixed').map((artist) => artist.name);
      const results = await Promise.all(names.map((name) =>
        searchMusicTyped(name, 'featured_playlists')
          .then((res) => playlistsOf(res.sections.flatMap((section) => section.items)))
          .catch(() => [] as PlaylistItem[])));
      const seen = new Set<string>();
      const mixed: PlaylistItem[] = [];
      for (let index = 0; mixed.length < LANE_SIZE && results.some((list) => list[index]); index += 1) {
        for (const list of results) {
          const playlist = list[index];
          if (playlist && !seen.has(playlist.id)) {
            seen.add(playlist.id);
            mixed.push(playlist);
          }
        }
      }
      publish({
        id: 'mixed-for-you',
        title: t('musicMixedForYou'),
        items: mixed.slice(0, LANE_SIZE).map((item) => ({ type: 'playlist' as const, ...item })),
      });
    })();

    void trendingSongs().then((songs) => publish({
      id: 'popular-artists',
      title: t('musicPopularArtists'),
      items: popularArtistsFrom(songs, LANE_SIZE).map((artist) => ({ type: 'artist' as const, ...artist })),
    }));

    for (const genre of genres) {
      void getMusicMoodGenre(genre.browseId, genre.params ?? undefined)
        .then(async (page) => {
          const pool = await ranked(audioMusicOnly(songsOf(page.items)), 'discover');
          publish({
            id: `genre-${genre.browseId}:${genre.params ?? ''}`,
            title: t('musicGenreMix', { genre: genre.title }),
            items: pool.slice(0, GENRE_MIX_SIZE).map((song): YTItem => ({ type: 'song', ...song })),
          }, 4);
        })
        .catch(() => undefined);
    }

    return () => { requestRef.current += 1; };
  }, [vibeChip, genres, t]);

  return sections;
}
