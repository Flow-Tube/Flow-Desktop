import { Disc, User } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { getString } from '../../lib/i18n/index';
import type { SongItem } from '../../types/music';
import type { MusicMenuAction } from './MusicCardMenu';

export function useTrackNavActions(
  track: SongItem | null,
  options?: { onNavigate?: () => void },
): MusicMenuAction[] {
  const navigate = useNavigate();
  if (!track) return [];

  const actions: MusicMenuAction[] = [];

  const seenIds = new Set<string>();
  const artistsWithId: { name: string; id: string }[] = [];
  for (const artist of track.artists ?? []) {
    if (artist.id && !seenIds.has(artist.id)) {
      seenIds.add(artist.id);
      artistsWithId.push({ name: artist.name, id: artist.id });
    }
  }

  if (artistsWithId.length === 1) {
    const artist = artistsWithId[0];
    if (artist) {
      actions.push({
        id: 'view-artist',
        label: getString('music_view_artist'),
        icon: <User size={16} />,
        group: 'go',
        onSelect: () => {
          options?.onNavigate?.();
          navigate(`/music/artist/${artist.id}`);
        },
      });
    }
  } else if (artistsWithId.length > 1) {
    for (const artist of artistsWithId) {
      actions.push({
        id: `view-artist-${artist.id}`,
        label: `${getString('music_view_artist')}: ${artist.name}`,
        icon: <User size={16} />,
        group: 'go',
        onSelect: () => {
          options?.onNavigate?.();
          navigate(`/music/artist/${artist.id}`);
        },
      });
    }
  }

  const albumId = track.album?.id ?? null;
  if (albumId) {
    actions.push({
      id: 'view-album',
      label: getString('music_view_album'),
      icon: <Disc size={16} />,
      group: 'go',
      onSelect: () => {
        options?.onNavigate?.();
        navigate(`/music/album/${albumId}`);
      },
    });
  }

  return actions;
}
