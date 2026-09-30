import { MusicItemCard } from './MusicItemCard';
import { MusicSectionHeader } from './MusicSectionHeader';
import { ShelfScroller } from '../ui/ShelfScroller';
import type { SongItem } from '../../types/music';

interface MusicQuickPicksShelfProps {
  title: string;
  tracks: SongItem[];
  onPlay: (track: SongItem) => void;
  onQueue: (track: SongItem) => void;
}

export function MusicQuickPicksShelf({ title, tracks, onPlay, onQueue }: MusicQuickPicksShelfProps) {
  if (tracks.length === 0) return null;
  return (
    <section>
      <MusicSectionHeader title={title} />
      <ShelfScroller className="grid auto-cols-[88%] grid-flow-col grid-rows-3 gap-x-4 gap-y-1 snap-x px-3 -mx-3 pt-3 -mt-2 pb-4 sm:auto-cols-[46%] lg:auto-cols-[31%] xl:auto-cols-[23.5%]">
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
