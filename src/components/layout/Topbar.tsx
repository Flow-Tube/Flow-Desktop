import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, HatGlasses, PanelLeftClose, PanelLeftOpen, Settings } from 'lucide-react';
import { useUiStore } from '../../store/useUiStore';
import { useAppSettingsStore } from '../../store/useAppSettingsStore';
import Logo from '../common/Logo';
import { IconButton } from '../ui/IconButton';
import { TopbarSearch } from './TopbarSearch';
import { SETTINGS } from '../../lib/settings/schema';
import { getString } from '../../lib/i18n/index';
import { toggleDeepFlow } from '../../lib/deepFlow';
import { NotificationsBell } from '../notifications/NotificationsBell';
import { activeTab, useTabsStore } from '../../store/useTabsStore';
import { ProfileMenuButton } from '../profiles/ProfileMenuButton';

/** PageWrapper returns focus here when Escape closes the drawer. */
export const SIDEBAR_MENU_BUTTON_ID = 'sidebar-menu-button';

export function Topbar() {
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const toggleWatchSidebar = useUiStore((s) => s.toggleWatchSidebar);
  const isSidebarExpanded = useUiStore((s) => s.isSidebarExpanded);
  const isWatchSidebarOpen = useUiStore((s) => s.isWatchSidebarOpen);
  const navigate = useNavigate();
  const location = useLocation();
  const usesDrawer = location.pathname.startsWith('/watch/') || location.pathname.startsWith('/settings');
  const sidebarOpen = usesDrawer ? isWatchSidebarOpen : isSidebarExpanded;
  const showAppLogo = useAppSettingsStore((state) => state.values[SETTINGS.SHOW_APP_LOGO_ICON] !== 'false');
  const deepFlowActive = useAppSettingsStore((state) => state.values[SETTINGS.DEEP_FLOW_ACTIVE] === 'true');
  const canGoBack = useTabsStore((state) => activeTab(state).index > 0);
  const tabCount = useTabsStore((state) => state.tabs.length);
  const canGoForward = useTabsStore((state) => {
    const tab = activeTab(state);
    return tab.index < tab.entries.length - 1;
  });

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-transparent bg-background px-3">
      {/* Left */}
      <div className="flex min-w-0 items-center gap-2">
        <IconButton
          id={SIDEBAR_MENU_BUTTON_ID}
          aria-label={getString('sidebar_menu')}
          aria-expanded={sidebarOpen}
          onClick={usesDrawer ? toggleWatchSidebar : toggleSidebar}
        >
          {sidebarOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
        </IconButton>
        {usesDrawer && tabCount > 1 && (
          <IconButton
            aria-label={getString('tabs_show', tabCount)}
            title={getString('tabs_show', tabCount)}
            onClick={toggleWatchSidebar}
          >
            <span className="grid h-5 w-5 place-items-center rounded-md border-[1.5px] border-current font-mono text-[11px] font-semibold leading-none">
              {tabCount > 99 ? '99+' : tabCount}
            </span>
          </IconButton>
        )}
        {showAppLogo && (
          <div className="cursor-pointer" onClick={() => navigate('/')}>
            <Logo size={36} showText={true} />
          </div>
        )}
        <div className="hidden ml-1 items-center sm:flex">
          <IconButton
            title={getString('topbar_back')}
            aria-label={getString('topbar_back')}
            onClick={() => navigate(-1)}
            disabled={!canGoBack}
            className="text-chrome-neutral-300 hover:text-chrome-neutral-100"
          >
            <ArrowLeft />
          </IconButton>
          <IconButton
            title={getString('topbar_forward')}
            aria-label={getString('topbar_forward')}
            onClick={() => navigate(1)}
            disabled={!canGoForward}
            className="text-chrome-neutral-300 hover:text-chrome-neutral-100"
          >
            <ArrowRight />
          </IconButton>
        </div>
      </div>

      {/* Center - Search */}
      <div className="flex max-w-[720px] flex-1 items-center justify-center px-4 md:px-8">
        <TopbarSearch />
      </div>

      {/* Right */}
      <div className="flex items-center gap-2">
        <NotificationsBell />
        <IconButton
          onClick={() => {
            void toggleDeepFlow();
          }}
          title={getString(deepFlowActive ? 'deep_flow_topbar_disable' : 'deep_flow_topbar_enable')}
          aria-pressed={deepFlowActive}
          className={deepFlowActive ? 'deep-flow-topbar-active' : undefined}
        >
          <HatGlasses />
        </IconButton>
        <IconButton onClick={() => navigate('/settings')} title={getString('settings_title')} aria-label={getString('settings_title')}>
          <Settings />
        </IconButton>
        <ProfileMenuButton />
      </div>
    </header>
  );
}
