import { Play, Search as SearchIcon } from 'lucide-react';
import { Button } from '../../ui/Button';
import { getString } from '../../../lib/i18n/index';
import { upgradeAvatarUrl, upgradeMusicImageUrl } from '../../../lib/thumbnails';
import { useProxiedImageUrl } from '../../../lib/useProxiedImageUrl';
import { useOriginalTitle } from '../../../lib/useOriginalTitle';
import { joinIsolated } from '../../../lib/direction';
import type { TopResult } from '../../../lib/useCombinedSearch';
import type { AlbumItem, ArtistItem, SongItem } from '../../../types/music';
import type { SearchChannel, VideoSummary } from '../../../types/video';
import { cx } from './ResultParts';

function artistsText(artists?: { name: string }[] | null): string {
  if (!artists?.length) return '';
  return artists.map((a) => a.name).filter(Boolean).join(', ');
}

export function TopResultHero({
  top,
  onPlaySong,
  onPlayVideo,
  onOpenAlbum,
  onOpenArtist,
  onOpenChannel,
}: {
  top: TopResult;
  onPlaySong: (s: SongItem) => void;
  onPlayVideo: (v: VideoSummary) => void;
  onOpenAlbum: (a: AlbumItem) => void;
  onOpenArtist: (a: ArtistItem) => void;
  onOpenChannel: (c: SearchChannel) => void;
}) {
  const circle = top.kind === 'artist' || top.kind === 'channel';
  const originalTitle = useOriginalTitle(top.kind === 'video' ? top.item.id : null);

  let thumb: string | null | undefined;
  let title = '';
  let subtitle = '';
  let actionLabel = getString('search_action_open');
  let isPlay = false;
  let action = () => {};

  switch (top.kind) {
    case 'song':
      thumb = top.item.thumbnail;
      title = top.item.title;
      subtitle = artistsText(top.item.artists);
      actionLabel = getString('search_action_play');
      isPlay = true;
      action = () => onPlaySong(top.item);
      break;
    case 'video':
      thumb = top.item.thumbnailUrl;
      title = originalTitle || top.item.title;
      subtitle = top.item.channelName;
      actionLabel = getString('search_action_play');
      isPlay = true;
      action = () => onPlayVideo(top.item);
      break;
    case 'album':
      thumb = top.item.thumbnail;
      title = top.item.title;
      subtitle = artistsText(top.item.artists) || (top.item.year ? String(top.item.year) : '');
      action = () => onOpenAlbum(top.item);
      break;
    case 'artist':
      thumb = top.item.thumbnail;
      title = top.item.title;
      subtitle = getString('search_role_artist');
      action = () => onOpenArtist(top.item);
      break;
    case 'channel':
      thumb = top.item.avatarUrl;
      title = top.item.name;
      subtitle = joinIsolated([top.item.handle, top.item.subscriberCountText]) || getString('search_role_channel');
      actionLabel = getString('search_action_view_channel');
      action = () => onOpenChannel(top.item);
      break;
  }

  const displayThumb = useProxiedImageUrl(circle ? upgradeAvatarUrl(thumb) : upgradeMusicImageUrl(thumb));

  return (
    <section className="flex flex-col">
      <p className="mb-3 px-1 text-xs font-semibold uppercase tracking-widest text-chrome-neutral-500">
        {getString('search_top_result')}
      </p>
      <div
        role="button"
        tabIndex={0}
        onClick={action}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            action();
          }
        }}
        className="group flex cursor-pointer items-center gap-5 rounded-2xl border border-chrome-neutral-800/50 bg-surface-container-low p-5 outline-none transition-colors duration-200 ease-out hover:bg-surface-container focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
      >
        <div className={cx('h-28 w-28 shrink-0 overflow-hidden ring-1 ring-chrome-neutral-800/50', circle ? 'rounded-full' : 'rounded-xl')}>
          {displayThumb ? (
            <img src={displayThumb} alt={title} loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full w-full place-items-center bg-surface-container-high text-chrome-neutral-600">
              <SearchIcon className="h-8 w-8" />
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h2 dir="auto" className="line-clamp-2 text-2xl font-bold tracking-tight text-chrome-neutral-100">{title}</h2>
          {subtitle && <span dir="auto" className="line-clamp-1 text-sm text-chrome-neutral-400">{subtitle}</span>}
          <Button
            variant="primary"
            size="sm"
            className="mt-2 w-fit"
            onClick={(e) => {
              e.stopPropagation();
              action();
            }}
          >
            {isPlay && <Play className="h-4 w-4" fill="currentColor" />}
            {actionLabel}
          </Button>
        </div>
      </div>
    </section>
  );
}
