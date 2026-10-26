import { Disc3, ListPlus, Play, Share2 } from 'lucide-react';

import { shareLink } from '../../lib/clipboard';
import { getString } from '../../lib/i18n/index';
import { youtubeMusicWatchUrl } from '../../lib/youtubeUrl';
import { useAlbumLibraryStore } from '../../store/useAlbumLibraryStore';
import { useMusicPlayerStore } from '../../store/useMusicPlayerStore';
import type { SongItem } from '../../types/music';
import type { MusicMenuAction } from './MusicCardMenu';
import { useTrackBlockActions } from './useTrackBlockActions';
import { useTrackDownloadAction } from './useTrackDownloadAction';
import { useTrackNavActions } from './useTrackNavActions';
import { useTrackRadioAction } from './useTrackRadioAction';

/** A song card's or row's menu: queueing first, then saving, where to go, and feed tuning. */
export function useSongMenuActions(
  song: SongItem | null,
  options?: { onNavigate?: () => void },
): MusicMenuAction[] {
  const addToQueue = useMusicPlayerStore((s) => s.addToQueue);
  const playNextInQueue = useMusicPlayerStore((s) => s.playNextInQueue);
  const openAddToAlbum = useAlbumLibraryStore((s) => s.openAddToAlbum);
  const radioActions = useTrackRadioAction(song);
  const navActions = useTrackNavActions(song, options);
  const downloadActions = useTrackDownloadAction(song);
  const blockActions = useTrackBlockActions(song);

  if (!song) return [];

  return [
    {
      id: 'play-next',
      label: getString('music_play_next'),
      tileLabel: getString('menu_tile_play_next'),
      icon: <Play size={16} />,
      group: 'quick',
      onSelect: () => playNextInQueue(song),
    },
    {
      id: 'add-to-queue',
      label: getString('music_add_to_queue'),
      tileLabel: getString('menu_tile_queue'),
      icon: <ListPlus size={16} />,
      group: 'quick',
      onSelect: () => addToQueue(song),
    },
    ...radioActions,
    ...downloadActions,
    {
      id: 'add-to-album',
      label: getString('music_add_to_album'),
      icon: <Disc3 size={16} />,
      group: 'library',
      onSelect: () => openAddToAlbum(song),
    },
    {
      id: 'share',
      label: getString('music_share'),
      icon: <Share2 size={16} />,
      group: 'library',
      onSelect: () => void shareLink(song.title, youtubeMusicWatchUrl(song.videoId ?? song.id)),
    },
    ...navActions,
    ...blockActions,
  ];
}
