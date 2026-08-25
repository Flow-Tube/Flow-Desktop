import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Plus } from 'lucide-react';
import { useSubscriptionStore } from '../../store/useSubscriptionStore';
import { Button } from '../ui/Button';
import { getString } from '../../lib/i18n/index';
import { upgradeAvatarUrl } from '../../lib/thumbnails';
import { useProxiedImageUrl } from '../../lib/useProxiedImageUrl';
import { ColorWash, COLOR_WASH_HOST } from '../ui/ColorWash';
import { useHoverWashColor } from '../../lib/useHoverWashColor';

export interface ChannelCardProps {
  channelId: string;
  name: string;
  avatarUrl?: string | null;
  subtitle?: string | null;
  fill?: boolean;
  className?: string;
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
      <div className="grid h-full w-full place-items-center rounded-full bg-surface-container-high text-2xl font-semibold text-chrome-neutral-500">
        {name.charAt(0).toUpperCase() || '?'}
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

export function ChannelCard({
  channelId,
  name,
  avatarUrl,
  subtitle,
  fill,
  className,
}: ChannelCardProps) {
  const navigate = useNavigate();
  const washSrc = useProxiedImageUrl(upgradeAvatarUrl(avatarUrl));
  const wash = useHoverWashColor(washSrc);
  const cleanId = channelId.replace('channel:', '');
  const isSubscribed = useSubscriptionStore((s) => s.isSubscribed);
  const subscribe = useSubscriptionStore((s) => s.subscribe);
  const unsubscribe = useSubscriptionStore((s) => s.unsubscribe);
  const subscribed = isSubscribed(cleanId);

  const open = () => {
    if (cleanId) navigate(`/channel/${cleanId}`);
  };

  const toggleSubscribe = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!cleanId) return;
    if (subscribed) {
      void unsubscribe(cleanId);
    } else {
      void subscribe(cleanId, name, avatarUrl ?? undefined);
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
          <CircleAvatar src={avatarUrl} name={name} />
        </div>
      </div>

      <div className="flex w-full flex-col items-center gap-0.5">
        <span className="line-clamp-1 font-semibold text-chrome-neutral-100">{name}</span>
        <span className="line-clamp-1 text-sm text-chrome-neutral-400">{subtitle || getString('search_role_channel')}</span>
      </div>

      <Button
        variant={subscribed ? 'secondary' : 'primary'}
        size="sm"
        onClick={toggleSubscribe}
        className="mt-1"
        aria-pressed={subscribed}
      >
        {subscribed ? (
          <>
            <Check className="h-4 w-4" /> {getString('search_subscribed')}
          </>
        ) : (
          <>
            <Plus className="h-4 w-4" /> {getString('search_subscribe')}
          </>
        )}
      </Button>
    </div>
  );
}

export default ChannelCard;
