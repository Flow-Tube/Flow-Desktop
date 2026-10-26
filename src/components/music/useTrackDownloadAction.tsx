import { Download, Loader2, Trash2 } from 'lucide-react';

import { getString } from '../../lib/i18n/index';
import { findDownloadedRecord, useActiveDownloadForVideo, useIsDownloaded } from '../../lib/useDownloads';
import { useDownloadStore } from '../../store/useDownloadStore';
import { useDownloadsLibraryStore } from '../../store/useDownloadsLibraryStore';
import { useUiStore } from '../../store/useUiStore';
import type { SongItem } from '../../types/music';
import type { MusicMenuAction } from './MusicCardMenu';

function videoIdOf(track: SongItem): string {
  return track.videoId ?? track.id;
}

export function useTrackDownloadAction(track: SongItem | null): MusicMenuAction[] {
  const trackId = track ? videoIdOf(track) : '';
  const downloaded = useIsDownloaded(trackId);
  const active = useActiveDownloadForVideo(trackId);
  const openMusicDownload = useDownloadStore((s) => s.openMusic);
  const removeDownloads = useDownloadsLibraryStore((s) => s.remove);
  const showToast = useUiStore((s) => s.showToast);

  if (!track) return [];

  if (downloaded) {
    return [
      {
        id: 'download',
        label: getString('music_remove_download'),
        icon: <Trash2 size={16} />,
        onSelect: async () => {
          const record = findDownloadedRecord(trackId, 'audio');
          if (!record) return;
          await removeDownloads([record.id]);
          showToast({
            variant: 'success',
            message: getString('music_download_removed_toast'),
            image: track.thumbnail,
            imageShape: 'square',
          });
        },
      },
    ];
  }

  return [
    {
      id: 'download',
      label: active ? getString('downloads_downloading') : getString('music_download'),
      icon: active ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />,
      onSelect: () => openMusicDownload(track),
    },
  ];
}
