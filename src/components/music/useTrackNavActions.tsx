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

  const primaryArtist = track.artists?.find((a) => a.id) ?? track.artists?.[0] ?? null;
  const artistId = primaryArtist?.id ?? null;
  if (artistId) {
    actions.push({
      id: 'view-artist',
      label: getString('music_view_artist'),
      icon: <User size={16} />,
      group: 'go',
      onSelect: () => {
        options?.onNavigate?.();
        navigate(`/music/artist/${artistId}`);
      },
    });
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
