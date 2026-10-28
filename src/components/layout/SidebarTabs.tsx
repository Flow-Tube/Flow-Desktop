import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Plus, Search, X, XCircle } from 'lucide-react';
import { useTabsStore, type ParkedVideo, type TabTitle } from '../../store/useTabsStore';
import { usePlayerStore } from '../../store/usePlayerStore';
import { useSubscriptionStore } from '../../store/useSubscriptionStore';
import { currentEntry, type TabHistory } from '../../lib/tabs/tabHistory';
import { tabIconFor, type TabIcon } from '../../lib/tabs/tabPage';
import { closeOtherTabs, closeTabWithPlayback, switchToTab } from '../../lib/tabs/tabPlayback';
import { sectionTitleKey } from '../../lib/useResolvedWindowTitle';
import { watchVideoIdFromPath } from '../../lib/watchRouteSync';
import { upgradeAvatarUrl } from '../../lib/thumbnails';
import { useProxiedImageUrl } from '../../lib/useProxiedImageUrl';
import { getString } from '../../lib/i18n/index';
import { TabRailItem } from '../ui/TabRailItem';
import { SidebarNavIcon } from '../ui/SidebarNavIcon';
import { ShortsIcon } from '../ui/ShortsIcon';
import { AnchoredPortalMenu, type MenuAnchor } from '../ui/AnchoredPortalMenu';

function TabImage({ src, round }: { src: string | undefined; round: boolean }) {
  const proxied = useProxiedImageUrl(src);
  const shape = round ? 'rounded-full' : 'rounded-md';
  if (!proxied) return <span className={`block h-6 w-6 ${shape} bg-surface-container-high`} />;
  return <img src={proxied} alt="" className={`h-6 w-6 ${shape} object-cover`} />;
}

function TabIconView({ icon }: { icon: TabIcon }) {
  const avatar = useSubscriptionStore((s) =>
    icon.kind === 'channel' ? s.subscriptions.find((channel) => channel.id === icon.channelId)?.avatarUrl : undefined,
  );
  if (icon.kind === 'video') return <TabImage src={`https://i.ytimg.com/vi/${icon.videoId}/mqdefault.jpg`} round={false} />;
  if (icon.kind === 'channel') {
    return avatar ? <TabImage src={upgradeAvatarUrl(avatar)} round /> : <SidebarNavIcon name="subscriptions" className="h-6 w-6" />;
  }
  if (icon.kind === 'shorts') return <ShortsIcon className="h-6 w-6" />;
  if (icon.kind === 'search') return <Search className="h-6 w-6" strokeWidth={1.6} />;
  return <SidebarNavIcon name={icon.name} className="h-6 w-6" />;
}

/** The name a tab shows: what its page published, or the best guess from its address. */
function useTabLabel(tab: TabHistory, title: TabTitle | undefined, parked: ParkedVideo | undefined): string {
  const { t } = useTranslation();
  const entry = currentEntry(tab);
  const watchId = watchVideoIdFromPath(entry.pathname);
  const playerTitle = usePlayerStore((s) => (watchId && s.currentVideo?.id === watchId ? s.currentVideo.title : null));

  if (title?.key === entry.key && title.text) return title.text;
  if (watchId) {
    const parkedTitle = parked?.queue.find((video) => video.id === watchId)?.title;
    return playerTitle || parkedTitle || getString('tabs_untitled');
  }
  if (entry.pathname === '/search') {
    const query = new URLSearchParams(entry.search).get('q')?.trim();
    if (query) return query;
  }
  const section = sectionTitleKey(entry.pathname);
  return section ? t(section) : getString('tabs_untitled');
}

function TabRow({ tab, collapsed, onNavigate, onOpenMenu }: {
  tab: TabHistory;
  collapsed: boolean;
  onNavigate?: () => void;
  onOpenMenu: (tabId: string, anchor: MenuAnchor) => void;
}) {
  const active = useTabsStore((s) => s.activeId === tab.id);
  const playing = useTabsStore((s) => s.playerTabId === tab.id);
  const title = useTabsStore((s) => s.titles[tab.id]);
  const parked = useTabsStore((s) => s.parked[tab.id]);
  const label = useTabLabel(tab, title, parked);

  return (
    <TabRailItem
      label={label}
      icon={<TabIconView icon={tabIconFor(currentEntry(tab).pathname)} />}
      active={active}
      playing={playing}
      collapsed={collapsed}
      closeLabel={getString('tabs_close')}
      playingLabel={getString('tabs_playing')}
      onSelect={() => {
        switchToTab(tab.id);
        onNavigate?.();
      }}
      onClose={() => closeTabWithPlayback(tab.id)}
      onOpenMenu={(point) => onOpenMenu(tab.id, { top: point.y, left: point.x })}
    />
  );
}

function TabMenuRow({ icon, label, onSelect }: { icon: React.ReactNode; label: string; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left text-sm text-chrome-zinc-300 transition-colors duration-200 ease-out hover:bg-chrome-zinc-800 hover:text-chrome-zinc-100"
    >
      <span className="grid h-4 w-4 shrink-0 place-items-center text-chrome-neutral-400">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}

/** Open tabs in the side rail. Hidden while the window has a single tab. */
export function SidebarTabs({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const tabs = useTabsStore((s) => s.tabs);
  const openTab = useTabsStore((s) => s.openTab);
  const duplicateTab = useTabsStore((s) => s.duplicateTab);
  const [menu, setMenu] = useState<{ tabId: string; anchor: MenuAnchor } | null>(null);

  if (tabs.length < 2) return null;

  const closeMenu = () => setMenu(null);
  const newTab = () => {
    openTab('/', { activate: true });
    onNavigate?.();
  };

  return (
    <section aria-label={getString('tabs_section')}>
      <hr className="mx-4 my-3 border-chrome-neutral-800/50" />
      {!collapsed && (
        <div className="flex items-center justify-between py-1 pl-5 pr-3">
          <span className="text-base font-semibold text-chrome-neutral-100">{getString('tabs_section')}</span>
          <button
            type="button"
            aria-label={getString('tabs_new')}
            title={getString('tabs_new')}
            onClick={newTab}
            className="grid h-8 w-8 place-items-center rounded-full text-chrome-neutral-400 transition-colors duration-200 ease-out hover:bg-surface-container-low hover:text-chrome-neutral-100"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      )}
      <nav className="mt-1 flex flex-col gap-1.5">
        {tabs.map((tab) => (
          <TabRow
            key={tab.id}
            tab={tab}
            collapsed={collapsed}
            onNavigate={onNavigate}
            onOpenMenu={(tabId, anchor) => setMenu({ tabId, anchor })}
          />
        ))}
      </nav>
      {menu && (
        <AnchoredPortalMenu
          anchor={menu.anchor}
          onClose={closeMenu}
          className="z-[70] w-56 overflow-hidden rounded-xl border border-chrome-neutral-800 bg-surface-container-high py-1.5"
        >
          <TabMenuRow icon={<Plus size={16} />} label={getString('tabs_new')} onSelect={() => { closeMenu(); newTab(); }} />
          <TabMenuRow icon={<Copy size={16} />} label={getString('tabs_duplicate')} onSelect={() => { closeMenu(); duplicateTab(menu.tabId); }} />
          <TabMenuRow icon={<XCircle size={16} />} label={getString('tabs_close_others')} onSelect={() => { closeMenu(); closeOtherTabs(menu.tabId); }} />
          <TabMenuRow icon={<X size={16} />} label={getString('tabs_close')} onSelect={() => { closeMenu(); closeTabWithPlayback(menu.tabId); }} />
        </AnchoredPortalMenu>
      )}
    </section>
  );
}
