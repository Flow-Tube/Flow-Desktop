import { MIN_SHELF_ITEMS } from './musicRecall';
import type { MusicShelf, SongItem, YTItem } from '../types/music';
import type { PersonalSection } from './useMusicPersonalization';

/** `anchor` = charts/releases that lead a first-run home. */
export type MusicFeedOrigin = 'anchor' | 'personal' | 'remote';

export interface MusicFeedSection extends PersonalSection {
  browseId?: string | null;
  params?: string | null;
  source?: string;
  origin: MusicFeedOrigin;
}

function itemKey(item: YTItem): string {
  switch (item.type) {
    case 'song': {
      const artist = item.artists[0]?.id ?? item.artists[0]?.name ?? '';
      const recording = `${item.title.trim().toLowerCase()}:${artist.trim().toLowerCase()}`;
      return recording !== ':' ? `song:${recording}` : `song:${item.videoId ?? item.id}`;
    }
    case 'album': return `album:${item.browseId}`;
    default: return `${item.type}:${item.id}`;
  }
}

const isAnchor = (section: MusicShelf) =>
  section.source === 'newReleases' || !!section.source?.startsWith('chart');

function remoteSection(section: MusicShelf): MusicFeedSection {
  const first = section.items[0];
  return {
    id: `remote:${section.source ?? section.browseId ?? section.title}:${first ? itemKey(first) : ''}`,
    title: section.title,
    subtitle: section.subtitle ?? undefined,
    items: section.items,
    browseId: section.browseId,
    params: section.params,
    source: section.source,
    origin: isAnchor(section) ? 'anchor' : 'remote',
  };
}

/**
 * Orders the whole home: a first-run home leads with charts and releases, a warm one
 * with personal shelves. Each item appears once (Quick Picks claim theirs first), and
 * a shelf that deduplication shrank below a useful size is dropped rather than shown
 * as a stub.
 */
export function composeMusicFeed(
  personal: PersonalSection[],
  remote: MusicShelf[],
  maturity: string,
  quickPicks: SongItem[],
): MusicFeedSection[] {
  const remoteSections = remote.map(remoteSection);
  const personalSections = personal.map((section): MusicFeedSection => ({ ...section, origin: 'personal' }));
  const ordered = maturity === 'cold_start'
    ? [
      ...remoteSections.filter((section) => section.origin === 'anchor'),
      ...personalSections,
      ...remoteSections.filter((section) => section.origin === 'remote'),
    ]
    : [...personalSections, ...remoteSections];
  const seen = new Set(quickPicks.map((song) => itemKey({ type: 'song', ...song })));
  const output: MusicFeedSection[] = [];
  for (const section of ordered) {
    const items = section.items.filter((item) => {
      const key = itemKey(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (items.length > 0 && items.length >= Math.min(MIN_SHELF_ITEMS, section.items.length)) {
      output.push({ ...section, items });
    }
  }
  return output;
}
