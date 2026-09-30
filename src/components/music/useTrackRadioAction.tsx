import { Radio } from 'lucide-react';

import { getString } from '../../lib/i18n/index';
import { useMusicPlayerStore } from '../../store/useMusicPlayerStore';
import type { SongItem } from '../../types/music';
import type { MusicMenuAction } from './MusicCardMenu';

/** "Start radio" — springboard an endless radio seeded from this one track, the way
 *  YT Music treats each song as an independent station rather than a playlist entry. */
export function useTrackRadioAction(track: SongItem | null): MusicMenuAction[] {
  const startRadio = useMusicPlayerStore((s) => s.startRadio);
  if (!track) return [];
  return [
    {
      id: 'start-radio',
      label: getString('music_start_radio'),
      icon: <Radio size={16} />,
      onSelect: () => void startRadio(track),
    },
  ];
}
