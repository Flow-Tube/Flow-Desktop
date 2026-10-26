import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useUiStore } from '../../store/useUiStore';
import { useAppSettingsStore } from '../../store/useAppSettingsStore';
import { useSubscriptionStore } from '../../store/useSubscriptionStore';
import { SidebarItem } from '../ui/SidebarItem';
import { SidebarNavIcon, type SidebarNavIconName } from '../ui/SidebarNavIcon';
import { ShortsIcon, ShortsAIcon } from '../ui/ShortsIcon';
import { SectionHeader, SubscriptionsNav } from './SidebarSections';
import { getString } from '../../lib/i18n/index';
import { SETTINGS } from '../../lib/settings/schema';

type SidebarProps = {
  mode?: 'normal' | 'overlay';
};

const navIcon = (name: SidebarNavIconName, variant: 'outline' | 'filled' = 'outline') => (
  <SidebarNavIcon name={name} variant={variant} className="h-6 w-6 shrink-0" />
);

function navIconPair(name: SidebarNavIconName) {
  return {
    icon: navIcon(name, 'outline'),
    activeIcon: navIcon(name, 'filled'),
  };
}

const shortsNavIconPair = {
  icon: <ShortsIcon className="h-6 w-6 shrink-0" />,
  activeIcon: <ShortsAIcon className="h-6 w-6 shrink-0" />,
};

const divider = <hr className="mx-4 my-3 border-chrome-neutral-800/50" />;

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
  const expanded = isOverlay || isSidebarExpanded;
  const collapsed = !expanded;

  if (
    !isOverlay &&
    (location.pathname.startsWith('/watch/') ||
      location.pathname.startsWith('/settings'))
  ) {
    return null;
  }

  const closeOverlay = isOverlay ? () => setWatchSidebarOpen(false) : undefined;

  return (
    <aside
      data-expanded={expanded}
      className={
        isOverlay
          ? 'flex h-full w-60 shrink-0 flex-col bg-background'
          : 'sidebar-rail hidden shrink-0 overflow-hidden bg-background sm:flex'
      }
    >
      {/* Always 240 px wide, so labels never rewrap while the rail opens and closes. */}
      <div className="flex min-h-0 w-60 flex-1 flex-col overflow-y-auto overflow-x-hidden py-2">
        <nav className="flex flex-col gap-0.5">
          <SidebarItem to="/" end {...navIconPair('home')} label={getString('home')} onClick={closeOverlay} collapsed={collapsed} />
          <SidebarItem to="/feed" {...navIconPair('feed')} label={getString('sidebar_flowneuron')} onClick={closeOverlay} collapsed={collapsed} />
          {showShortsNav && <SidebarItem to="/shorts" {...shortsNavIconPair} label={getString('sidebar_shorts')} onClick={closeOverlay} collapsed={collapsed} />}
          {showCategoriesNav && <SidebarItem to="/explore" {...navIconPair('explore')} label={getString('sidebar_explore')} onClick={closeOverlay} collapsed={collapsed} />}
          {showMusicNav && <SidebarItem to="/music" {...navIconPair('music')} label={getString('sidebar_music')} onClick={closeOverlay} collapsed={collapsed} />}
        </nav>

        {/* The rail's two icons and the full sections share one spot and cross-fade. */}
        <div className="grid">
          <nav className="sidebar-when-collapsed flex flex-col gap-0.5 [grid-area:1/1]">
            <SidebarItem to="/subscriptions" {...navIconPair('subscriptions')} label={getString('sidebar_subscriptions')} collapsed={collapsed} />
            <SidebarItem to="/library" {...navIconPair('you')} label={getString('sidebar_you')} collapsed={collapsed} />
          </nav>

          <div className="sidebar-when-expanded [grid-area:1/1]">
            {divider}
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

            {divider}

            <section>
              <SectionHeader label={getString('sidebar_you')} to="/library" onClick={closeOverlay} />
              <nav className="mt-1 flex flex-col gap-0.5">
                <SidebarItem to="/history" {...navIconPair('history')} label={getString('library_history_label')} onClick={closeOverlay} />
                <SidebarItem to="/playlists" {...navIconPair('playlists')} label={getString('library_playlists_label')} onClick={closeOverlay} />
                <SidebarItem to="/albums" {...navIconPair('albums')} label={getString('albums_title')} onClick={closeOverlay} />
                <SidebarItem to="/watch-later" {...navIconPair('watchLater')} label={getString('library_watch_later_label')} onClick={closeOverlay} />
                <SidebarItem to="/saved-shorts" {...shortsNavIconPair} label={getString('library_saved_shorts_label')} onClick={closeOverlay} />
                <SidebarItem to="/liked" {...navIconPair('liked')} label={getString('library_likes_label')} onClick={closeOverlay} />
                <SidebarItem to="/downloads" {...navIconPair('downloads')} label={getString('library_downloads_label')} onClick={closeOverlay} />
              </nav>
            </section>
          </div>
        </div>

        <div className="mt-auto">
          <div className="sidebar-when-expanded">
            {divider}
            <nav className="flex flex-col gap-0.5">
              <SidebarItem to="/settings" {...navIconPair('settings')} label={getString('settings_title')} onClick={closeOverlay} />
              <SidebarItem to="/sync" {...navIconPair('sync')} label={getString('sidebar_sync')} onClick={closeOverlay} />
              <SidebarItem to="/sponsorblock" {...navIconPair('extensions')} label={getString('sidebar_extensions')} onClick={closeOverlay} />
            </nav>
          </div>
          <nav className="mt-0.5 flex flex-col">
            <SidebarItem to="/support" {...navIconPair('support')} label={getString('sidebar_support')} onClick={closeOverlay} collapsed={collapsed} />
          </nav>
        </div>
      </div>
    </aside>
  );
}
