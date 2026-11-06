import { Info } from 'lucide-react';

import { getString } from '../../lib/i18n/index';
import { useSongDetailsStore } from '../../store/useSongDetailsStore';
import type { SongItem } from '../../types/music';
import type { MusicMenuAction } from './MusicCardMenu';

export function useTrackDetailsAction(track: SongItem | null): MusicMenuAction[] {
  const open = useSongDetailsStore((state) => state.open);
  if (!track) return [];
  return [{ id: 'details', label: getString('music_details'), icon: <Info size={16} />, group: 'library', onSelect: () => open(track) }];
}
