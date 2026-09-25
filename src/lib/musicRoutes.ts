import type { YTItem } from '../types/music';

/**
 * Destination for a shelf's "see all" endpoint, chosen by browse-id page type:
 * albums, playlists and artists have dedicated pages; everything else (moods,
 * genres, home sub-feeds) is a generic grid.
 */
export function musicSeeAllRoute(
  browseId: string,
  params: string | null | undefined,
  title: string,
  items: YTItem[] = [],
): string {
  if (browseId.startsWith('MPRE')) return `/music/album/${encodeURIComponent(browseId)}`;
  if (browseId.startsWith('VL')) return `/music/playlist/${encodeURIComponent(browseId.slice(2))}`;
  if (browseId.startsWith('UC')) {
    if (!params) return `/music/artist/${encodeURIComponent(browseId)}`;
    const kind = items.some((item) => item.type === 'song') ? 'songs' : 'albums';
    const query = new URLSearchParams({ browseId, params, title, kind });
    return `/music/artist/${encodeURIComponent(browseId)}/items?${query}`;
  }
  const query = new URLSearchParams({ browseId, ...(params ? { params } : {}), title });
  return `/music/browse?${query}`;
}
