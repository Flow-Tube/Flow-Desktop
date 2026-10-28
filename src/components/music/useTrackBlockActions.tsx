import { Ban, EyeOff } from 'lucide-react';

import { getString } from '../../lib/i18n/index';
import { useMusicActionsStore } from '../../store/useMusicActionsStore';
import { useUiStore } from '../../store/useUiStore';
import type { SongItem } from '../../types/music';
import type { MusicMenuAction } from './MusicCardMenu';

/**
 * The shared "Not interested" / "Don't recommend this artist" menu actions for a track.
 * Used by every music track card so the block list is reachable everywhere. Returns an empty
 * list for a null track (so callers can invoke the hook unconditionally).
 */
export function useTrackBlockActions(track: SongItem | null): MusicMenuAction[] {
  const notInterested = useMusicActionsStore((s) => s.notInterested);
  const blockArtist = useMusicActionsStore((s) => s.blockArtist);
  const showToast = useUiStore((s) => s.showToast);

  if (!track) return [];
  const primary = track.artists?.[0] ?? null;
  const artistName = primary?.name ?? '';

  const actions: MusicMenuAction[] = [
    {
      id: 'not-interested',
      label: getString('music_not_interested'),
      icon: <EyeOff size={16} />,
      group: 'feed',
      onSelect: async () => {
        await notInterested(track);
        showToast({ variant: 'success', message: getString('music_not_interested_toast') });
      },
    },
  ];

  if (artistName) {
    actions.push({
      id: 'block-artist',
      label: getString('music_dont_recommend_artist').replace('{artist}', artistName),
      icon: <Ban size={16} />,
      group: 'feed',
      onSelect: async () => {
        await blockArtist({ id: primary?.id ?? null, name: artistName });
        showToast({
          variant: 'success',
          message: getString('music_artist_blocked_toast').replace('{artist}', artistName),
        });
      },
    });
  }

  return actions;
}
