import { Disc3, Share2, SlidersHorizontal } from 'lucide-react';

import { shareLink } from '../../lib/clipboard';
import { getString } from '../../lib/i18n/index';
import { youtubeMusicWatchUrl } from '../../lib/youtubeUrl';
import { useAlbumLibraryStore } from '../../store/useAlbumLibraryStore';
import type { SongItem } from '../../types/music';
import type { MusicMenuAction } from './MusicCardMenu';
import { useTrackDownloadAction } from './useTrackDownloadAction';
import { useTrackBlockActions } from './useTrackBlockActions';
import { useTrackNavActions } from './useTrackNavActions';
import { useTrackRadioAction } from './useTrackRadioAction';
import { useTrackWatchVideoAction } from './useTrackWatchVideoAction';

function videoIdOf(track: SongItem): string {
  return track.videoId ?? track.id;
}

/** The playing track's menu, shared by the full player and the music bar. */
export function useNowPlayingMenuActions(
  track: SongItem | null,
  options?: { onNavigate?: () => void; onOpenEqualizer?: () => void },
): MusicMenuAction[] {
  const openAddToAlbum = useAlbumLibraryStore((s) => s.openAddToAlbum);
  const radioActions = useTrackRadioAction(track);
  const watchVideoActions = useTrackWatchVideoAction(track, options);
  const navActions = useTrackNavActions(track, options);
  const downloadActions = useTrackDownloadAction(track);
  const blockActions = useTrackBlockActions(track);

  if (!track) return [];

  const onOpenEqualizer = options?.onOpenEqualizer;
  return [
    ...radioActions,
    ...watchVideoActions,
    ...navActions,
    {
      id: 'add-to-album',
      label: getString('music_add_to_album'),
      icon: <Disc3 size={16} />,
      group: 'library',
      onSelect: () => openAddToAlbum(track),
    },
    ...downloadActions,
    {
      id: 'share',
      label: getString('music_share'),
      icon: <Share2 size={16} />,
      group: 'library',
      onSelect: () => void shareLink(track.title, youtubeMusicWatchUrl(videoIdOf(track))),
    },
    ...(onOpenEqualizer
      ? [{ id: 'equalizer', label: getString('music_equalizer'), icon: <SlidersHorizontal size={16} />, group: 'go' as const, onSelect: onOpenEqualizer }]
      : []),
    ...blockActions,
  ];
}
