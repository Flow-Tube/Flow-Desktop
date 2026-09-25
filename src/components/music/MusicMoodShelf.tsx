import { MusicShelf } from './MusicShelf';
import type { MoodAndGenreItem } from '../../types/music';

interface MusicMoodShelfProps {
  title: string;
  moods: MoodAndGenreItem[];
  onOpen: (mood: MoodAndGenreItem) => void;
  onSeeAll: () => void;
}

export function MusicMoodShelf({ title, moods, onOpen, onSeeAll }: MusicMoodShelfProps) {
  if (moods.length === 0) return null;
  return (
    <MusicShelf
      title={title}
      items={moods}
      onSeeAll={onSeeAll}
      renderItem={(mood) => (
        <button
          type="button"
          onClick={() => onOpen(mood)}
          className="flex h-20 w-40 shrink-0 items-end rounded-2xl border border-chrome-neutral-800 bg-surface-container-low p-4 text-left text-sm font-medium text-chrome-neutral-100 transition-colors duration-200 ease-out hover:bg-surface-container-high focus-visible:outline-2 focus-visible:outline-[var(--color-primary)] md:w-48"
        >
          <span className="line-clamp-2">{mood.title}</span>
        </button>
      )}
    />
  );
}
