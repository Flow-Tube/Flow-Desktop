import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
} from 'lucide-react';
import { useUiStore } from '../../store/useUiStore';
import { useAppSettingsStore } from '../../store/useAppSettingsStore';
import { useSubscriptionStore, type SubscribedChannel } from '../../store/useSubscriptionStore';
import { SidebarItem } from '../ui/SidebarItem';
import { SidebarNavIcon, type SidebarNavIconName } from '../ui/SidebarNavIcon';
import { ShortsIcon, ShortsAIcon } from '../ui/ShortsIcon';
import { getString } from '../../lib/i18n/index';
import { SETTINGS } from '../../lib/settings/schema';
import { upgradeAvatarUrl } from '../../lib/thumbnails';
import { useProxiedImageUrl } from '../../lib/useProxiedImageUrl';
import { useSubscriptionAvatarHydration } from '../../lib/useSubscriptionAvatarHydration';

const SUBS_DEFAULT_LIMIT = 7;

type SidebarProps = {
  mode?: 'normal' | 'overlay';
};

function SidebarAvatar({ src }: { src?: string | null }) {
  const imageSrc = useProxiedImageUrl(upgradeAvatarUrl(src));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [imageSrc]);

  if (!imageSrc || failed) return <div className="w-6 h-6 rounded-full bg-surface-container-high" />;
  return (
    <img
      src={imageSrc}
      alt=""
      className="w-6 h-6 rounded-full object-cover"
      onError={() => setFailed(true)}
    />
  );
}

function CompactRailItem({
  path,
  icon,
  activeIcon,
  label,
  end,
}: {
  path: string;
  icon: ReactNode;
  activeIcon?: ReactNode;
  label: string;
  end?: boolean;
}) {
  return (
    <NavLink
      to={path}
      end={end}
      className={({ isActive }) =>
        `flex h-[74px] w-full flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-medium transition-colors ${
          isActive
            ? 'text-[var(--color-primary)]'
            : 'text-chrome-neutral-300 hover:bg-surface-container-low hover:text-chrome-neutral-100'
        }`
      }
    >
      {({ isActive }) => (
        <>
          {isActive ? (activeIcon ?? icon) : icon}
          <span className="max-w-full truncate px-1">{label}</span>
        </>
      )}
    </NavLink>
  );
}

const navIcon = (name: SidebarNavIconName, variant: 'outline' | 'filled' = 'outline') => (
  <SidebarNavIcon name={name} variant={variant} className="h-5 w-5 shrink-0" />
);

const railIcon = (name: SidebarNavIconName, variant: 'outline' | 'filled' = 'outline') => (
  <SidebarNavIcon name={name} variant={variant} className="h-6 w-6 shrink-0" />
);

function navIconPair(name: SidebarNavIconName) {
  return {
    icon: navIcon(name, 'outline'),
    activeIcon: navIcon(name, 'filled'),
  };
}

function railIconPair(name: SidebarNavIconName) {
  return {
    icon: railIcon(name, 'outline'),
    activeIcon: railIcon(name, 'filled'),
  };
}

const shortsNavIconPair = {
  icon: <ShortsIcon className="h-5 w-5 shrink-0" />,
  activeIcon: <ShortsAIcon className="h-5 w-5 shrink-0" />,
};

const shortsRailIconPair = {
  icon: <ShortsIcon className="h-6 w-6 shrink-0" />,
  activeIcon: <ShortsIcon className="h-6 w-6 shrink-0" />,
};

function SectionHeader({
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
      <ChevronRight className="w-4 h-4 text-chrome-neutral-400 transition-transform group-hover:translate-x-0.5" />
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
          className="mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-chrome-neutral-400 transition-colors hover:bg-surface-container-low hover:text-chrome-neutral-100"
        >
          <ChevronDown
            className={`h-4 w-4 transition-transform duration-200 ease-out ${collapsed ? '-rotate-90' : ''}`}
          />
        </button>
      )}
    </div>
  );
}

function SubscriptionsNav({
  subscriptions,
  subsExpanded,
  onToggleExpanded,
  closeOverlay,
}: {
  subscriptions: SubscribedChannel[];
  subsExpanded: boolean;
  onToggleExpanded: () => void;
  closeOverlay?: () => void;
}) {
  const visibleSubs = useMemo(
    () => (subsExpanded ? subscriptions : subscriptions.slice(0, SUBS_DEFAULT_LIMIT)),
    [subscriptions, subsExpanded],
  );
  useSubscriptionAvatarHydration(visibleSubs);

  return (
    <nav className="mt-1 flex flex-col">
      <div className={subsExpanded ? 'max-h-[45vh] overflow-y-auto' : ''}>
        {visibleSubs.map((channel) => (
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
            onClick={closeOverlay}
          />
        ))}
      </div>
      {subscriptions.length > SUBS_DEFAULT_LIMIT && (
        <SidebarItem
          icon={subsExpanded ? <ChevronUp className="h-5 w-5 shrink-0" /> : <ChevronDown className="h-5 w-5 shrink-0" />}
          label={subsExpanded ? getString('sidebar_show_less') : getString('sidebar_show_more')}
          onClick={onToggleExpanded}
        />
      )}
    </nav>
  );
}

export function Sidebar({ mode = 'normal' }: SidebarProps) {
  const isSidebarExpanded = useUiStore((s) => s.isSidebarExpanded);
  const isSubsSectionCollapsed = useUiStore((s) => s.isSubsSectionCollapsed);
  const toggleSubsSection = useUiStore((s) => s.toggleSubsSection);
  const setWatchSidebarOpen = useUiStore((s) => s.setWatchSidebarOpen);
  const { subscriptions } = useSubscriptionStore();
  const location = useLocation();
  const [subsExpanded, setSubsExpanded] = useState(false);
  const showShortsNav = useAppSettingsStore((state) => state.values[SETTINGS.SHORTS_NAVIGATION_ENABLED] !== 'false');
  const showMusicNav = useAppSettingsStore((state) => state.values[SETTINGS.MUSIC_NAVIGATION_ENABLED] !== 'false');
  const showCategoriesNav = useAppSettingsStore((state) => state.values[SETTINGS.CATEGORIES_NAV_TAB_ENABLED] !== 'false');

  const isOverlay = mode === 'overlay';
  const isExpanded = isOverlay || isSidebarExpanded;

  if (
    !isOverlay &&
    (location.pathname.startsWith('/watch/') ||
      location.pathname.startsWith('/settings'))
  ) {
    return null;
  }

  if (!isExpanded) {
    return (
      <aside className="hidden w-20 shrink-0 overflow-y-auto bg-background px-1.5 py-2 sm:flex">
        <nav className="flex w-full flex-col items-center gap-1">
          <CompactRailItem path="/" {...railIconPair('home')} label={getString('home')} end />
          <CompactRailItem path="/feed" {...railIconPair('feed')} label={getString('sidebar_flowneuron')} />
          {showShortsNav && <CompactRailItem path="/shorts" {...shortsRailIconPair} label={getString('sidebar_shorts')} />}
          {showCategoriesNav && <CompactRailItem path="/explore" {...railIconPair('explore')} label={getString('sidebar_explore')} />}
          {showMusicNav && <CompactRailItem path="/music" {...railIconPair('music')} label={getString('sidebar_music')} />}
          <CompactRailItem path="/subscriptions" {...railIconPair('subscriptions')} label={getString('sidebar_subscriptions')} />
          <CompactRailItem path="/library" {...railIconPair('you')} label={getString('sidebar_you')} />
          <div className="mt-auto w-full pt-1">
            <CompactRailItem path="/support" {...railIconPair('support')} label={getString('settings_group_support')} />
          </div>
        </nav>
      </aside>
    );
  }

  const closeOverlay = isOverlay ? () => setWatchSidebarOpen(false) : undefined;

  return (
    <aside
      className={`flex h-full w-64 shrink-0 flex-col overflow-y-auto bg-background py-3 ${
        isOverlay ? '' : 'hidden sm:flex'
      }`}
    >
      {/* Core */}
      <nav className="flex flex-col">
        <SidebarItem to="/" end {...navIconPair('home')} label={getString('home')} onClick={closeOverlay} />
        <SidebarItem to="/feed" {...navIconPair('feed')} label={getString('sidebar_flowneuron')} onClick={closeOverlay} />
        {showShortsNav && <SidebarItem to="/shorts" {...shortsNavIconPair} label={getString('sidebar_shorts')} onClick={closeOverlay} />}
        {showCategoriesNav && <SidebarItem to="/explore" {...navIconPair('explore')} label={getString('sidebar_explore')} onClick={closeOverlay} />}
        {showMusicNav && <SidebarItem to="/music" {...navIconPair('music')} label={getString('sidebar_music')} onClick={closeOverlay} />}
      </nav>

      <hr className="border-chrome-neutral-800/50 my-3 mx-4" />

      {/* Subscriptions */}
      <section>
        <SectionHeader
          label={getString('sidebar_subscriptions')}
          to="/subscriptions"
          onClick={closeOverlay}
          collapsed={isSubsSectionCollapsed}
          onToggleCollapse={toggleSubsSection}
        />
        {!isSubsSectionCollapsed && (
          <SubscriptionsNav
            subscriptions={subscriptions}
            subsExpanded={subsExpanded}
            onToggleExpanded={() => setSubsExpanded(!subsExpanded)}
            closeOverlay={closeOverlay}
          />
        )}
      </section>

      <hr className="border-chrome-neutral-800/50 my-3 mx-4" />

      {/* You */}
      <section>
        <SectionHeader label={getString('sidebar_you')} to="/library" onClick={closeOverlay} />
        <nav className="mt-1 flex flex-col">
          <SidebarItem to="/history" {...navIconPair('history')} label={getString('library_history_label')} onClick={closeOverlay} />
          <SidebarItem to="/playlists" {...navIconPair('playlists')} label={getString('library_playlists_label')} onClick={closeOverlay} />
          <SidebarItem to="/albums" {...navIconPair('albums')} label={getString('albums_title')} onClick={closeOverlay} />
          <SidebarItem to="/watch-later" {...navIconPair('watchLater')} label={getString('library_watch_later_label')} onClick={closeOverlay} />
          <SidebarItem to="/saved-shorts" {...shortsNavIconPair} label={getString('library_saved_shorts_label')} onClick={closeOverlay} />
          <SidebarItem to="/liked" {...navIconPair('liked')} label={getString('library_likes_label')} onClick={closeOverlay} />
          <SidebarItem to="/downloads" {...navIconPair('downloads')} label={getString('library_downloads_label')} onClick={closeOverlay} />
        </nav>
      </section>

      <div className="mt-auto">
        <hr className="border-chrome-neutral-800/50 my-3 mx-4" />
        <nav className="flex flex-col">
          <SidebarItem to="/settings" {...navIconPair('settings')} label={getString('settings_title')} onClick={closeOverlay} />
          <SidebarItem to="/sync" {...navIconPair('sync')} label="Sync" onClick={closeOverlay} />
          <SidebarItem to="/sponsorblock" {...navIconPair('extensions')} label={getString('sidebar_extensions')} onClick={closeOverlay} />
          <SidebarItem to="/support" {...navIconPair('support')} label={getString('sidebar_support')} onClick={closeOverlay} />
        </nav>
      </div>
    </aside>
  );
}
