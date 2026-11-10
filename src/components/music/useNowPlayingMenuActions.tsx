import { Blend, Disc3, Share2, SlidersHorizontal } from 'lucide-react';

import { shareLink } from '../../lib/clipboard';
import { isLocalMediaId } from '../../lib/localMediaId';
import { getString } from '../../lib/i18n/index';
import { SETTINGS } from '../../lib/settings/schema';
import { useBoolPref } from '../../lib/usePreference';
import { youtubeMusicWatchUrl } from '../../lib/youtubeUrl';
import { useAlbumLibraryStore } from '../../store/useAlbumLibraryStore';
import { useCrossfadePauseStore } from '../../store/useCrossfadePauseStore';
import type { SongItem } from '../../types/music';
import type { MusicMenuAction } from './MusicCardMenu';
import { useTrackDetailsAction } from './useTrackDetailsAction';
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
  const detailsActions = useTrackDetailsAction(track);
  const [crossfadeOn] = useBoolPref(SETTINGS.MUSIC_CROSSFADE_ENABLED);
  const crossfadePaused = useCrossfadePauseStore((s) => s.paused);
  const toggleCrossfadePause = useCrossfadePauseStore((s) => s.toggle);

  if (!track) return [];

  const onOpenEqualizer = options?.onOpenEqualizer;
  const equalizerAction = onOpenEqualizer
    ? [{ id: 'equalizer', label: getString('music_equalizer'), icon: <SlidersHorizontal size={16} />, group: 'go' as const, onSelect: onOpenEqualizer }]
    : [];
  // As on Android: off until Flow restarts, while the saved setting stays on.
  const crossfadeAction = crossfadeOn
    ? [{
        id: 'crossfade-pause',
        label: getString(crossfadePaused ? 'crossfade_resume' : 'crossfade_pause'),
        icon: <Blend size={16} />,
        group: 'go' as const,
        onSelect: toggleCrossfadePause,
      }]
    : [];
  const audioActions = [...equalizerAction, ...crossfadeAction];
  // Everything else names something on YouTube; a file on this computer isn't.
  if (isLocalMediaId(videoIdOf(track))) return audioActions;
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
    ...detailsActions,
    ...audioActions,
    ...blockActions,
  ];
}
