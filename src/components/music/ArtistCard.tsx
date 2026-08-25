import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Music2, Plus } from 'lucide-react';
import type { ArtistItem } from '../../types/music';
import { useSubscriptionStore } from '../../store/useSubscriptionStore';
import { Button } from '../ui/Button';
import { getString } from '../../lib/i18n/index';
import { upgradeAvatarUrl } from '../../lib/thumbnails';
import { useProxiedImageUrl } from '../../lib/useProxiedImageUrl';
import { ColorWash, COLOR_WASH_HOST } from '../ui/ColorWash';
import { useHoverWashColor } from '../../lib/useHoverWashColor';

export interface ArtistCardProps {
  artist: ArtistItem;
  fill?: boolean;
  className?: string;
  onOpen?: () => void;
}

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

function CircleAvatar({ src, name }: { src?: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  const imageSrc = useProxiedImageUrl(upgradeAvatarUrl(src));
  useEffect(() => setFailed(false), [imageSrc]);
  if (!imageSrc || failed) {
    return (
      <div className="grid h-full w-full place-items-center rounded-full bg-surface-container-high text-chrome-neutral-500">
        <Music2 className="h-10 w-10" />
      </div>
    );
  }
  return (
    <img
      src={imageSrc}
      alt={name}
      loading="lazy"
      onError={() => setFailed(true)}
      className="h-full w-full rounded-full object-cover"
    />
  );
}

export function ArtistCard({ artist, fill, className, onOpen }: ArtistCardProps) {
  const navigate = useNavigate();
  const washSrc = useProxiedImageUrl(upgradeAvatarUrl(artist.thumbnail));
  const wash = useHoverWashColor(washSrc);
  const target = (artist.channelId || artist.id || '').replace('channel:', '');
  const isSubscribed = useSubscriptionStore((s) => s.isSubscribed);
  const subscribe = useSubscriptionStore((s) => s.subscribe);
  const unsubscribe = useSubscriptionStore((s) => s.unsubscribe);
  const following = target ? isSubscribed(target) : false;

  const open = () => {
    if (onOpen) {
      onOpen();
      return;
    }
    if (target) navigate(`/channel/${target}`);
  };

  const toggleFollow = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!target) return;
    if (following) {
      void unsubscribe(target);
    } else {
      void subscribe(target, artist.title, artist.thumbnail ?? undefined);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      }}
      onMouseEnter={wash.onMouseEnter}
      onMouseLeave={wash.onMouseLeave}
      className={cx(
        `group ${COLOR_WASH_HOST} flex cursor-pointer flex-col items-center gap-3 rounded-2xl text-center outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]`,
        fill ? 'w-full' : 'w-40 md:w-48',
        className,
      )}
    >
      <ColorWash active={wash.isHovered} color={wash.color} radius="rounded-2xl" bleed={6} />
      <div className="aspect-square w-full">
        <div className="h-full w-full overflow-hidden rounded-full ring-1 ring-chrome-neutral-800/50 transition-transform duration-200 ease-out group-hover:scale-[1.02]">
          <CircleAvatar src={artist.thumbnail} name={artist.title} />
        </div>
      </div>

      <div className="flex w-full flex-col items-center gap-0.5">
        <span className="line-clamp-1 font-semibold text-chrome-neutral-100">{artist.title}</span>
        <span className="line-clamp-1 text-sm text-chrome-neutral-400">{getString('search_role_artist')}</span>
      </div>

      <Button
        variant={following ? 'secondary' : 'primary'}
        size="sm"
        onClick={toggleFollow}
        className="mt-1"
        disabled={!target}
        aria-pressed={following}
      >
        {following ? (
          <>
            <Check className="h-4 w-4" /> {getString('search_following')}
          </>
        ) : (
          <>
            <Plus className="h-4 w-4" /> {getString('search_follow')}
          </>
        )}
      </Button>
    </div>
  );
}

export default ArtistCard;
