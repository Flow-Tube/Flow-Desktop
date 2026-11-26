import { useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { ChevronDown, ChevronRight, ChevronUp, Pin, PinOff } from 'lucide-react';
import type { SubscribedChannel } from '../../store/useSubscriptionStore';
import { SidebarItem } from '../ui/SidebarItem';
import { AnchoredPortalMenu, type MenuAnchor } from '../ui/AnchoredPortalMenu';
import { growFromPoint } from '../../lib/direction';
import { useSubscriptionOrder } from '../../lib/useSubscriptionOrder';
import { getString } from '../../lib/i18n/index';
import { openInNewTab } from '../../lib/openTarget';
import { upgradeAvatarUrl, avatarSize } from '../../lib/thumbnails';
import { useImageFallback } from '../../lib/useImageFallback';
import { useProxiedImageUrl } from '../../lib/useProxiedImageUrl';
import { useSubscriptionAvatarHydration } from '../../lib/useSubscriptionAvatarHydration';

const SUBS_DEFAULT_LIMIT = 7;

function SidebarAvatar({ src }: { src?: string | null }) {
  const imageSrc = useProxiedImageUrl(upgradeAvatarUrl(src, avatarSize(24)));
  const { src: displaySrc, onError } = useImageFallback([imageSrc]);

  if (!displaySrc) return <div className="w-6 h-6 rounded-full bg-surface-container-high" />;
  return (
    <img
      src={displaySrc}
      alt=""
      className="w-6 h-6 rounded-full object-cover"
      onError={onError}
    />
  );
}

export function SectionHeader({
  label,
  to,
  onClick,
  collapsed,
  onToggleCollapse,
}: {
  label: string;
  to?: string;
  onClick?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const inner = (
    <>
      <span>{label}</span>
      <ChevronRight className="w-4 h-4 text-chrome-neutral-400 transition-transform group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5 rtl:-scale-x-100" />
    </>
  );

  const header = to ? (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) =>
        `group flex flex-1 items-center gap-2 px-5 py-2 text-base font-semibold cursor-pointer rounded-lg transition-colors ${
          isActive
            ? 'text-[var(--color-primary)]'
            : 'text-chrome-neutral-100 hover:bg-surface-container-low'
        }`
      }
    >
      {inner}
    </NavLink>
  ) : (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-1 items-center gap-2 px-5 py-2 text-base font-semibold text-chrome-neutral-100 cursor-pointer hover:bg-surface-container-low rounded-lg"
    >
      {inner}
    </button>
  );

  return (
    <div className="mx-2 mt-2 flex items-center">
      {header}
      {onToggleCollapse && (
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-expanded={!collapsed}
          aria-label={getString(collapsed ? 'sidebar_section_expand' : 'sidebar_section_collapse')}
          className="me-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-chrome-neutral-400 transition-colors hover:bg-surface-container-low hover:text-chrome-neutral-100"
        >
          <ChevronDown
            className={`h-4 w-4 transition-transform duration-200 ease-out ${collapsed ? '-rotate-90 rtl:rotate-90' : ''}`}
          />
        </button>
      )}
    </div>
  );
}

export function SubscriptionsNav({
  subscriptions,
  pinnedCount,
  subsExpanded,
  onToggleExpanded,
  closeOverlay,
}: {
  subscriptions: SubscribedChannel[];
  /** How many of `subscriptions`, from the start, are pinned. Pins always show. */
  pinnedCount: number;
  subsExpanded: boolean;
  onToggleExpanded: () => void;
  closeOverlay?: () => void;
}) {
  const { togglePin } = useSubscriptionOrder();
  const [menu, setMenu] = useState<{ channelId: string; pinned: boolean; anchor: MenuAnchor } | null>(null);
  const limit = Math.max(SUBS_DEFAULT_LIMIT, pinnedCount);
  const visibleSubs = useMemo(
    () => (subsExpanded ? subscriptions : subscriptions.slice(0, limit)),
    [subscriptions, subsExpanded, limit],
  );
  useSubscriptionAvatarHydration(visibleSubs);

  return (
    <nav className="mt-1 flex flex-col gap-1.5">
      <div className={`flex flex-col gap-1.5 ${subsExpanded ? 'max-h-[45vh] overflow-y-auto' : ''}`}>
        {visibleSubs.map((channel, index) => {
          const pinned = index < pinnedCount;
          return (
            <SidebarItem
              key={channel.id}
              to={`/channel/${channel.id}`}
              icon={
                channel.avatarUrl ? (
                  <SidebarAvatar src={channel.avatarUrl} />
                ) : (
                  <div className="w-6 h-6 rounded-full bg-surface-container-high" />
                )
              }
              label={channel.name}
              rightElement={pinned ? <Pin aria-label={getString('subscriptions_pinned')} className="h-3.5 w-3.5 text-chrome-neutral-400" /> : undefined}
              onClick={closeOverlay}
              onOpenInNewTab={openInNewTab}
              onContextMenu={(point) => setMenu({ channelId: channel.id, pinned, anchor: { top: point.y, ...growFromPoint(point.x) } })}
            />
          );
        })}
      </div>
      {subscriptions.length > limit && (
        <SidebarItem
          icon={subsExpanded ? <ChevronUp className="h-5 w-5 shrink-0" /> : <ChevronDown className="h-5 w-5 shrink-0" />}
          label={subsExpanded ? getString('sidebar_show_less') : getString('sidebar_show_more')}
          onClick={onToggleExpanded}
        />
      )}
      {menu && (
        <AnchoredPortalMenu
          anchor={menu.anchor}
          onClose={() => setMenu(null)}
          className="z-[70] w-56 overflow-hidden rounded-xl border border-outline-soft bg-surface-container-high py-1.5"
        >
          <button
            type="button"
            onClick={() => {
              setMenu(null);
              togglePin(menu.channelId);
            }}
            className="flex w-full items-center gap-3 px-3.5 py-2.5 text-start text-sm text-chrome-zinc-300 transition-colors duration-200 ease-out hover:bg-chrome-zinc-800 hover:text-chrome-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
          >
            <span className="grid h-4 w-4 shrink-0 place-items-center text-chrome-neutral-400">
              {menu.pinned ? <PinOff size={16} /> : <Pin size={16} />}
            </span>
            <span className="min-w-0 flex-1 truncate">{getString(menu.pinned ? 'subscriptions_unpin' : 'subscriptions_pin')}</span>
          </button>
        </AnchoredPortalMenu>
      )}
    </nav>
  );
}
