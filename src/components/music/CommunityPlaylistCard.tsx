import { useTranslation } from 'react-i18next';
import { ChevronRight, Play } from 'lucide-react';

import type { PlaylistItem, SongItem } from '../../types/music';

interface Props {
  playlist: PlaylistItem;
  preview: SongItem[];
  onOpen: () => void;
  onPlay: () => void;
  onPlayPreview: (track: SongItem) => void;
}

const PREVIEW_ROWS = 3;

/** A playlist sampler: cover mosaic, three playable tracks, then Play and Open. */
export function CommunityPlaylistCard({ playlist, preview, onOpen, onPlay, onPlayPreview }: Props) {
  const { t } = useTranslation('common');
  const covers = preview.map((track) => track.thumbnail).filter(Boolean).slice(0, 4);
  const byline = playlist.author?.name || playlist.songCountText;
  return (
    <div className="flex w-72 flex-col gap-3 rounded-2xl border border-chrome-neutral-800 bg-surface-container-low p-4 md:w-80">
      <button type="button" onClick={onOpen} className="group flex items-center gap-3 text-left">
        <div className="grid h-20 w-20 shrink-0 grid-cols-2 overflow-hidden rounded-xl bg-surface-container-high">
          {covers.length === 4
            ? covers.map((url) => <img key={url} src={url} alt="" loading="lazy" className="h-full w-full object-cover" />)
            : playlist.thumbnail && (
              <img src={playlist.thumbnail} alt="" loading="lazy" className="col-span-2 row-span-2 h-full w-full object-cover" />
            )}
        </div>
        <div className="min-w-0">
          <p className="line-clamp-2 text-base font-medium text-chrome-neutral-100 group-hover:underline">{playlist.title}</p>
          {byline && <p className="truncate text-sm text-chrome-neutral-400">{byline}</p>}
        </div>
      </button>

      <div className="flex flex-col divide-y divide-chrome-neutral-800 border-y border-chrome-neutral-800">
        {preview.slice(0, PREVIEW_ROWS).map((track) => (
          <button
            key={track.videoId ?? track.id}
            type="button"
            onClick={() => onPlayPreview(track)}
            className="flex items-center gap-3 px-1 py-2 text-left transition-colors duration-200 ease-out hover:bg-surface-container-high focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]"
          >
            <img src={track.thumbnail} alt="" loading="lazy" className="h-8 w-8 shrink-0 rounded-md object-cover" />
            <span className="min-w-0 truncate text-sm text-chrome-neutral-200">
              {track.title}
              {track.artists[0]?.name && <span className="text-chrome-neutral-400"> · {track.artists[0].name}</span>}
            </span>
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onPlay}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-[var(--color-on-primary)] transition-opacity duration-200 ease-out hover:opacity-90"
        >
          <Play className="h-4 w-4" />
          {t('musicPlay')}
        </button>
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex items-center gap-1 rounded-full bg-surface-container-high px-4 py-2 text-sm font-medium text-chrome-neutral-200 transition-colors duration-200 ease-out hover:bg-surface-container-highest"
        >
          {t('musicOpen')}
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
