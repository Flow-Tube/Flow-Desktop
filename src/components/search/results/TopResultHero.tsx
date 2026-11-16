import { useState, type ReactNode } from 'react';
import { Loader2, Play, Radio, Search as SearchIcon, Shuffle } from 'lucide-react';
import { Button } from '../../ui/Button';
import { getString } from '../../../lib/i18n/index';
import { upgradeAvatarUrl, upgradeMusicImageUrl } from '../../../lib/thumbnails';
import { useProxiedImageUrl } from '../../../lib/useProxiedImageUrl';
import { useOriginalTitle } from '../../../lib/useOriginalTitle';
import { joinIsolated } from '../../../lib/direction';
import type { TopResult } from '../../../lib/useCombinedSearch';
import type { VideoSummary } from '../../../types/video';
import { cx } from './ResultParts';
import type { ResultActions } from './useResultActions';

function artistsText(artists?: { name: string }[] | null): string {
  if (!artists?.length) return '';
  return artists.map((a) => a.name).filter(Boolean).join(', ');
}

/** Shuffle or Radio, which fetch the artist's queue first and show it while they do. */
function MixButton({ kind, onStart }: { kind: 'shuffle' | 'radio'; onStart: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const Icon = busy ? Loader2 : kind === 'shuffle' ? Shuffle : Radio;
  return (
    <Button
      variant={kind === 'shuffle' ? 'primary' : 'tonal'}
      size="sm"
      disabled={busy}
      onClick={(event) => {
        event.stopPropagation();
        setBusy(true);
        void onStart().finally(() => setBusy(false));
      }}
    >
      <Icon className={cx('h-4 w-4', busy && 'animate-spin')} aria-hidden="true" />
      {getString(kind === 'shuffle' ? 'music_shuffle' : 'music_radio')}
    </Button>
  );
}

/** The single best match, large, with what you most likely want to do with it. */
export function TopResultHero({
  top,
  actions,
  onPlayVideo,
}: {
  top: TopResult;
  actions: ResultActions;
  onPlayVideo: (v: VideoSummary) => void;
}) {
  const circle = top.kind === 'artist' || top.kind === 'channel';
  const originalTitle = useOriginalTitle(top.kind === 'video' ? top.item.id : null);

  let thumb: string | null | undefined;
  let title = '';
  let subtitle = '';
  let open = () => {};
  let buttons: ReactNode = null;
  const primary = (label: string, onClick: () => void, play = false) => (
    <Button
      variant="primary"
      size="sm"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {play && <Play className="h-4 w-4" fill="currentColor" aria-hidden="true" />}
      {label}
    </Button>
  );

  switch (top.kind) {
    case 'song':
      thumb = top.item.thumbnail;
      title = top.item.title;
      subtitle = artistsText(top.item.artists);
      open = () => actions.playSong(top.item);
      buttons = primary(getString('search_action_play'), open, true);
      break;
    case 'video':
      thumb = top.item.thumbnailUrl;
      title = originalTitle || top.item.title;
      subtitle = top.item.channelName;
      open = () => onPlayVideo(top.item);
      buttons = primary(getString('search_action_play'), open, true);
      break;
    case 'album':
      thumb = top.item.thumbnail;
      title = top.item.title;
      subtitle = artistsText(top.item.artists) || (top.item.year ? String(top.item.year) : '');
      open = () => actions.openAlbum(top.item);
      buttons = primary(getString('search_action_open'), open);
      break;
    case 'artist': {
      const artist = top.item;
      thumb = artist.thumbnail;
      title = artist.title;
      subtitle = getString(artist.isProfile ? 'search_role_profile' : 'search_role_artist');
      open = () => actions.openArtist(artist);
      buttons = artist.isProfile ? (
        primary(getString('search_action_view_channel'), open)
      ) : (
        <>
          <MixButton kind="shuffle" onStart={() => actions.startArtistMix(artist, 'shuffle')} />
          <MixButton kind="radio" onStart={() => actions.startArtistMix(artist, 'radio')} />
          <Button
            variant="outline"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              open();
            }}
          >
            {getString('search_action_open_artist')}
          </Button>
        </>
      );
      break;
    }
    case 'channel':
      thumb = top.item.avatarUrl;
      title = top.item.name;
      subtitle = joinIsolated([top.item.handle, top.item.subscriberCountText]) || getString('search_role_channel');
      open = () => actions.openChannel(top.item);
      buttons = primary(getString('search_action_view_channel'), open);
      break;
  }

  const wide = top.kind === 'video';
  const displayThumb = useProxiedImageUrl(circle ? upgradeAvatarUrl(thumb) : upgradeMusicImageUrl(thumb));

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          open();
        }
      }}
      className="group flex h-full cursor-pointer flex-col gap-4 rounded-2xl border border-outline-variant bg-surface-container-low p-5 outline-none transition-colors duration-200 ease-out hover:bg-surface-container focus-visible:ring-2 focus-visible:ring-primary"
    >
      <div
        className={cx(
          'shrink-0 overflow-hidden bg-surface-container-high',
          circle ? 'h-28 w-28 rounded-full' : wide ? 'aspect-video w-56 rounded-xl' : 'h-28 w-28 rounded-xl',
        )}
      >
        {displayThumb ? (
          <img src={displayThumb} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full w-full place-items-center text-chrome-neutral-600">
            <SearchIcon className="h-8 w-8" />
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <h3 dir="auto" className="line-clamp-2 text-2xl font-bold tracking-tight text-chrome-neutral-100">{title}</h3>
        {subtitle && <span dir="auto" className="line-clamp-1 text-sm text-chrome-neutral-400">{subtitle}</span>}
      </div>
      <div className="mt-auto flex flex-wrap gap-2">{buttons}</div>
    </div>
  );
}
