import { useTranslation } from 'react-i18next';
import { Shuffle } from 'lucide-react';

import { MusicItemCard } from './MusicItemCard';
import { MusicSectionHeader } from './MusicSectionHeader';
import { ShelfScroller } from '../ui/ShelfScroller';
import type { SongItem } from '../../types/music';

interface MusicSpeedDialProps {
  title: string;
  tracks: SongItem[];
  onPlay: (track: SongItem) => void;
  onShuffle: () => void;
  onQueue: (track: SongItem) => void;
}

/**
 * A three-row grid of the regular track rows, led by a Shuffle tile, so the user's most
 * reached-for songs are one click away without a long single row.
 */
export function MusicSpeedDial({ title, tracks, onPlay, onShuffle, onQueue }: MusicSpeedDialProps) {
  const { t } = useTranslation('common');
  if (tracks.length === 0) return null;
  return (
    <section>
      <MusicSectionHeader title={title} />
      <ShelfScroller className="grid auto-cols-[88%] grid-flow-col grid-rows-3 gap-x-4 gap-y-1 snap-x px-3 -mx-3 pt-3 -mt-2 pb-4 sm:auto-cols-[46%] lg:auto-cols-[31%] xl:auto-cols-[23.5%]">
        <button
          type="button"
          onClick={onShuffle}
          className="flex snap-start items-center gap-3 rounded-xl bg-surface-container-high px-4 text-left text-sm font-semibold text-chrome-neutral-100 transition-colors duration-200 ease-out hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]"
        >
          <Shuffle className="h-5 w-5 shrink-0 text-[var(--color-primary)]" />
          {t('musicShufflePlay')}
        </button>
        {tracks.map((track) => (
          <MusicItemCard
            key={track.videoId ?? track.id}
            variant="track-list"
            item={track}
            className="snap-start bg-surface-container-low pr-3"
            onPlay={() => onPlay(track)}
            onMenu={() => onQueue(track)}
          />
        ))}
      </ShelfScroller>
    </section>
  );
}
