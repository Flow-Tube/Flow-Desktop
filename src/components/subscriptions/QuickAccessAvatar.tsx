import type { ButtonHTMLAttributes } from 'react';
import { upgradeAvatarUrl } from '../../lib/thumbnails';
import { useProxiedImageUrl } from '../../lib/useProxiedImageUrl';

export interface QuickAccessAvatarProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  name: string;
  avatarUrl?: string | null;
  hasNewVideos?: boolean;
  active?: boolean;
}

export function QuickAccessAvatar({
  name,
  avatarUrl,
  hasNewVideos = false,
  active = false,
  className = '',
  ...props
}: QuickAccessAvatarProps) {
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  const imageSrc = useProxiedImageUrl(upgradeAvatarUrl(avatarUrl));

  return (
    <button
      type="button"
      className={`group flex w-20 shrink-0 snap-start cursor-pointer flex-col items-center justify-center gap-2 outline-none ${className}`}
      {...props}
    >
      <span className="relative block h-16 w-16">
        {imageSrc ? (
          <img
            src={imageSrc}
            alt={name}
            className={`h-16 w-16 rounded-full object-cover ring-2 transition-all duration-200 ${
              active
                ? 'ring-[var(--color-primary)]'
                : 'ring-transparent group-hover:ring-[var(--color-primary)]'
            }`}
            loading="lazy"
          />
        ) : (
          <span
            className={`flex h-16 w-16 items-center justify-center rounded-full bg-surface-container-high text-lg font-semibold text-chrome-neutral-300 ring-2 transition-all duration-200 ${
              active
                ? 'ring-[var(--color-primary)]'
                : 'ring-transparent group-hover:ring-[var(--color-primary)]'
            }`}
            aria-hidden="true"
          >
            {initial}
          </span>
        )}

        {hasNewVideos ? (
          <span
            aria-hidden="true"
            className="absolute end-0 top-0 h-3 w-3 rounded-full bg-[var(--color-primary)] ring-2 ring-background"
          />
        ) : null}
      </span>

      <span dir="auto"
        className={`line-clamp-1 w-full text-center text-xs font-medium transition-colors ${
          active
            ? 'text-chrome-neutral-100'
            : 'text-chrome-neutral-300 group-hover:text-chrome-neutral-100'
        }`}
      >
        {name}
      </span>
    </button>
  );
}
