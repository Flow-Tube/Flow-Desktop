import { MusicSectionHeader } from './MusicSectionHeader';
import { ShelfScroller } from '../ui/ShelfScroller';
import type { MoodAndGenreItem } from '../../types/music';

interface MusicMoodShelfProps {
  title: string;
  moods: MoodAndGenreItem[];
  onOpen: (mood: MoodAndGenreItem) => void;
  /** The header opens the full Moods and genres page. */
  onBrowse: () => void;
}

export function MusicMoodShelf({ title, moods, onOpen, onBrowse }: MusicMoodShelfProps) {
  if (moods.length === 0) return null;
  return (
    <section>
      <MusicSectionHeader title={title} onNavigate={onBrowse} />
      <ShelfScroller className="grid auto-cols-[46%] grid-flow-col grid-rows-3 gap-2 snap-x px-3 -mx-3 pt-3 -mt-2 pb-4 sm:auto-cols-[31%] lg:auto-cols-[23.5%] xl:auto-cols-[18.8%]">
        {moods.map((mood) => (
          <button
            key={`${mood.browseId}:${mood.params ?? ''}`}
            type="button"
            onClick={() => onOpen(mood)}
            className="flex h-12 snap-start items-center rounded-xl border border-chrome-neutral-800 bg-surface-container-low px-4 text-left text-sm font-medium text-chrome-neutral-100 transition-colors duration-200 ease-out hover:bg-surface-container-high focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]"
          >
            <span className="truncate">{mood.title}</span>
          </button>
        ))}
      </ShelfScroller>
    </section>
  );
}
