import { ChevronRight, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { getString } from '../../lib/i18n/index';
import type { MusicSeedArt } from '../../types/music';

interface MusicSectionHeaderProps {
  title: string;
  /** Small context label drawn above the title ("Similar to", "Daily Mix"). */
  strapline?: string | null;
  seedArt?: MusicSeedArt | null;
  /** At most one action: the whole header navigates, a Play all pill, or a See all link. */
  onNavigate?: () => void;
  onPlayAll?: () => void;
  onSeeAll?: () => void;
}

export function MusicSectionHeader({
  title,
  strapline,
  seedArt,
  onNavigate,
  onPlayAll,
  onSeeAll,
}: MusicSectionHeaderProps) {
  const { t } = useTranslation('common');
  const heading = (
    <div className="flex min-w-0 items-center gap-3">
      {seedArt?.url && (
        <img
          src={seedArt.url}
          alt=""
          loading="lazy"
          className={`h-10 w-10 shrink-0 object-cover ${seedArt.round ? 'rounded-full' : 'rounded-md'}`}
        />
      )}
      <div className="min-w-0 text-left">
        {strapline && <p className="truncate text-sm text-chrome-neutral-400">{strapline}</p>}
        <h2 className="truncate text-xl font-bold tracking-tight text-chrome-neutral-100">{title}</h2>
      </div>
    </div>
  );

  if (onNavigate) {
    return (
      <button
        type="button"
        onClick={onNavigate}
        className="group mb-3 flex w-full items-center justify-between gap-3 rounded-lg px-1 py-0.5 transition-colors duration-200 ease-out hover:bg-surface-container-low focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]"
      >
        {heading}
        <ChevronRight className="h-5 w-5 shrink-0 text-chrome-neutral-400 transition-transform group-hover:translate-x-0.5" />
      </button>
    );
  }

  return (
    <div className="mb-3 flex items-center justify-between gap-3 px-1">
      {heading}
      {onPlayAll ? (
        <button
          type="button"
          onClick={onPlayAll}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-surface-container-high px-3.5 py-1.5 text-sm font-medium text-chrome-neutral-200 transition-colors duration-200 ease-out hover:bg-surface-container-highest"
        >
          <Play className="h-3.5 w-3.5" />
          {t('musicPlayAll')}
        </button>
      ) : onSeeAll ? (
        <button
          type="button"
          onClick={onSeeAll}
          className="group flex shrink-0 items-center gap-0.5 text-sm font-medium text-chrome-neutral-400 transition-colors duration-200 ease-out hover:text-chrome-neutral-100"
        >
          {getString('music_show_all')}
          <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </button>
      ) : null}
    </div>
  );
}
