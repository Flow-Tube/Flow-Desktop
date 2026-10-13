import { Disc3, Share2 } from 'lucide-react';

import { shareLink } from '../../lib/clipboard';
import { getString } from '../../lib/i18n/index';
import { youtubeMusicWatchUrl } from '../../lib/youtubeUrl';
import { useAlbumLibraryStore } from '../../store/useAlbumLibraryStore';
import type { SongItem } from '../../types/music';
import type { MusicMenuAction } from './MusicCardMenu';
import { useTrackDownloadAction } from './useTrackDownloadAction';
import { useTrackNavActions } from './useTrackNavActions';

function videoIdOf(track: SongItem): string {
  return track.videoId ?? track.id;
}

/** The playing track's menu, shared by the full player and the music bar. */
export function useNowPlayingMenuActions(
  track: SongItem | null,
  options?: { onNavigate?: () => void },
): MusicMenuAction[] {
  const openAddToAlbum = useAlbumLibraryStore((s) => s.openAddToAlbum);
  const navActions = useTrackNavActions(track, options);
  const downloadActions = useTrackDownloadAction(track);

  if (!track) return [];

  return [
    ...navActions,
    {
      id: 'add-to-album',
      label: getString('music_add_to_album'),
      icon: <Disc3 size={16} />,
      onSelect: () => openAddToAlbum(track),
    },
    ...downloadActions,
    {
      id: 'share',
      label: getString('music_share'),
      icon: <Share2 size={16} />,
      onSelect: () => void shareLink(track.title, youtubeMusicWatchUrl(videoIdOf(track))),
    },
  ];
}
