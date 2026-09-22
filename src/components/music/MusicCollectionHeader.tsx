import { Bookmark, Check, Download, Loader2, Music2, Play, Search, Shuffle } from 'lucide-react';

import { getString } from '../../lib/i18n/index';
import type { CollectionMeta } from '../../lib/useMusicCollection';
import { upgradeMusicImageUrl } from '../../lib/thumbnails';
import { useImageFallback } from '../../lib/useImageFallback';
import { useProxiedImageUrl } from '../../lib/useProxiedImageUrl';

interface MusicCollectionHeaderProps {
  meta: CollectionMeta;
  canPlay: boolean;
  onPlay: () => void;
  onShuffle: () => void;
  onArtistClick?: () => void;
  saved?: boolean;
  onToggleSave?: () => void;
  onAddTracks?: () => void;
  onDownload?: () => void;
  downloadActive?: boolean;
  downloadComplete?: boolean;
}

function Cover({ src, alt }: { src: string | null | undefined; alt: string }) {
  const imageSrc = useProxiedImageUrl(upgradeMusicImageUrl(src));
  const { src: displaySrc, onError } = useImageFallback([imageSrc]);
  if (!displaySrc) {
    return (
      <div className="grid h-full w-full place-items-center bg-surface-container-high text-chrome-neutral-500">
        <Music2 className="h-12 w-12" />
      </div>
    );
  }

  return (
    <img
      src={displaySrc}
      alt={alt}
      decoding="async"
      onError={onError}
      className="h-full w-full object-cover"
    />
  );
}

export function MusicCollectionHeader({
  meta,
  canPlay,
  onPlay,
  onShuffle,
  onArtistClick,
  saved,
  onToggleSave,
  onAddTracks,
  onDownload,
  downloadActive,
  downloadComplete,
}: MusicCollectionHeaderProps) {
  const thumbnailUrl = useProxiedImageUrl(upgradeMusicImageUrl(meta.thumbnail));
  const metaParts = [
    meta.yearText,
    meta.trackCountText,
    meta.durationText,
  ].filter((part): part is string => Boolean(part?.trim()));

  return (
    <header className="relative flex h-[45vh] min-h-[350px] w-full items-end overflow-hidden bg-surface px-8 pb-8">
      {thumbnailUrl ? (
        <img
          src={thumbnailUrl}
          alt=""
          aria-hidden="true"
          decoding="async"
          className="pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover opacity-60 blur-[80px]"
        />
      ) : (
        <div aria-hidden="true" className="absolute inset-0 bg-surface-container" />
      )}

      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-[var(--color-surface)]/60 to-[var(--color-surface)]"
      />

      <div className="relative z-10 mx-auto flex w-full max-w-[1600px] flex-row items-end gap-8">
        <div className="aspect-square h-48 w-48 shrink-0 overflow-hidden rounded-xl shadow-2xl ring-1 ring-chrome-white/10 md:h-56 md:w-56 xl:h-64 xl:w-64">
          <Cover src={thumbnailUrl} alt={meta.title} />
        </div>

        <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-chrome-neutral-300">
            {meta.typeLabel}
          </span>

          <h1 className="line-clamp-2 text-5xl font-extrabold leading-tight tracking-tighter text-chrome-white lg:text-7xl">
            {meta.title}
          </h1>

          {(meta.artistName || metaParts.length > 0) && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-chrome-neutral-300">
              {meta.artistName ? (
                onArtistClick ? (
                  <button
                    type="button"
                    onClick={onArtistClick}
                    className="font-medium text-chrome-white transition-colors duration-200 ease-out hover:underline"
                  >
                    {meta.artistName}
                  </button>
                ) : (
                  <span className="font-medium text-chrome-white">{meta.artistName}</span>
                )
              ) : null}

              {meta.artistName && metaParts.length > 0 ? (
                <span className="text-chrome-neutral-400">•</span>
              ) : null}

              {metaParts.map((part, index) => (
                <span key={`${part}-${index}`} className="flex items-center gap-2">
                  {index > 0 ? <span className="text-chrome-neutral-500">•</span> : null}
                  <span>{part}</span>
                </span>
              ))}
            </div>
          )}

          {meta.description ? (
            <p className="mt-2 line-clamp-2 max-w-2xl text-sm leading-6 text-chrome-neutral-400">
              {meta.description}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={!canPlay}
              onClick={onPlay}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-chrome-neutral-100 px-6 text-base font-medium text-chrome-neutral-950 transition-colors duration-200 ease-out hover:bg-chrome-white disabled:pointer-events-none disabled:opacity-50"
            >
              <Play className="h-5 w-5" fill="currentColor" />
              {getString('music_play')}
            </button>

            <button
              type="button"
              disabled={!canPlay}
              onClick={onShuffle}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-surface-container-high px-6 text-base font-medium text-chrome-neutral-200 transition-colors duration-200 ease-out hover:bg-surface-container-highest disabled:pointer-events-none disabled:opacity-50"
            >
              <Shuffle className="h-5 w-5" />
              {getString('music_shuffle')}
            </button>

            {onToggleSave ? (
              <button
                type="button"
                aria-pressed={saved}
                aria-label={getString(saved ? 'music_remove_from_library' : 'music_save_to_library')}
                title={getString(saved ? 'music_remove_from_library' : 'music_save_to_library')}
                onClick={onToggleSave}
                className={`grid h-12 w-12 place-items-center rounded-full transition-colors duration-200 ease-out ${
                  saved
                    ? 'bg-surface-container-high text-[var(--color-primary)] hover:bg-surface-container-highest'
                    : 'bg-surface-container-high text-chrome-neutral-200 hover:bg-surface-container-highest'
                }`}
              >
                <Bookmark className="h-5 w-5" fill={saved ? 'currentColor' : 'none'} />
              </button>
            ) : null}

            {onAddTracks ? (
              <button
                type="button"
                aria-label={getString('album_add_tracks')}
                title={getString('album_add_tracks')}
                onClick={onAddTracks}
                className="grid h-12 w-12 place-items-center rounded-full bg-surface-container-high text-chrome-neutral-200 transition-colors duration-200 ease-out hover:bg-surface-container-highest"
              >
                <Search className="h-5 w-5" />
              </button>
            ) : null}

            {onDownload ? (
              <button
                type="button"
                aria-label={getString('music_download')}
                title={getString(
                  downloadComplete ? 'downloaded' : downloadActive ? 'downloads_downloading' : 'music_download',
                )}
                onClick={onDownload}
                disabled={downloadActive}
                className="grid h-12 w-12 place-items-center rounded-full bg-surface-container-high text-chrome-neutral-200 transition-colors duration-200 ease-out hover:bg-surface-container-highest disabled:opacity-60"
              >
                {downloadActive ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : downloadComplete ? (
                  <Check className="h-5 w-5 text-[var(--color-primary)]" />
                ) : (
                  <Download className="h-5 w-5" />
                )}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}

export default MusicCollectionHeader;
