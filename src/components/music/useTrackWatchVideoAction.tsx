import { Clapperboard } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { musicAudioEngine } from '../../lib/audio/musicAudioEngine';
import { getString } from '../../lib/i18n/index';
import { findOfficialVideo } from '../../lib/musicVideo';
import { seekWhenVideoReady } from '../../lib/playerSeek';
import { prefetchStreamInfo } from '../../lib/streamResolution';
import { useMusicPlayerStore } from '../../store/useMusicPlayerStore';
import { useUiStore } from '../../store/useUiStore';
import type { SongItem } from '../../types/music';
import type { MusicMenuAction } from './MusicCardMenu';

const VIDEO_TYPES = new Set(['MUSIC_VIDEO_TYPE_OMV', 'MUSIC_VIDEO_TYPE_UGC']);

/**
 * "Watch video" for the playing song: its official music video opens in the
 * video player at the moment the song had reached, and the song pauses. The
 * desktop counterpart of Android's Song/Video switch, using the full video player.
 */
export function useTrackWatchVideoAction(
  track: SongItem | null,
  options?: { onNavigate?: () => void },
): MusicMenuAction[] {
  const navigate = useNavigate();
  const showToast = useUiStore((s) => s.showToast);
  if (!track) return [];

  const open = async () => {
    const video = VIDEO_TYPES.has(track.musicVideoType ?? '') ? track : await findOfficialVideo(track).catch(() => null);
    const videoId = video ? video.videoId ?? video.id : null;
    if (!videoId) {
      showToast({ variant: 'error', message: getString('music_no_official_video') });
      return;
    }
    const at = musicAudioEngine.getCurrentTime();
    useMusicPlayerStore.getState().pause();
    options?.onNavigate?.();
    prefetchStreamInfo(videoId);
    navigate(`/watch/${videoId}`);
    if (at > 1) seekWhenVideoReady(at);
  };

  return [
    {
      id: 'watch-video',
      label: getString('music_watch_video'),
      icon: <Clapperboard size={16} />,
      group: 'go',
      onSelect: () => void open(),
    },
  ];
}
