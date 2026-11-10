import { useEffect, useLayoutEffect, useRef } from 'react';
import { getString } from '../../lib/i18n/index';
import { Topbar } from './Topbar';
import { Sidebar } from './Sidebar';
import { NavigationType, Outlet, useLocation, useNavigationType } from 'react-router-dom';
import { useUiStore } from '../../store/useUiStore';
import { ScrollContainerContext } from '../../lib/useScrollContainer';
import { usePageEnterMotion } from '../../lib/usePageEnterMotion';
import { SIDEBAR_MENU_BUTTON_ID } from './Topbar';
import { recalledScroll, rememberScroll, restoreScroll } from '../../lib/tabs/scrollMemory';

export function PageWrapper() {
  const location = useLocation();
  const navigationType = useNavigationType();
  // Per-field, not a bare `useUiStore()`: the store also carries `searchQuery`,
  // so a selectorless subscription re-rendered the whole routed page — feed and
  // every mounted card included — on each keystroke in the search box.
  const isWatchSidebarOpen = useUiStore((s) => s.isWatchSidebarOpen);
  const setWatchSidebarOpen = useUiStore((s) => s.setWatchSidebarOpen);
  const isWatchPage = location.pathname.startsWith('/watch/');
  const isSettingsPage = location.pathname.startsWith('/settings');
  const isPlaylistDetailsPage =
    location.pathname.startsWith('/playlist/') ||
    location.pathname === '/watch-later';
  const isMusicCollectionPage =
    location.pathname.startsWith('/music/album/') ||
    location.pathname.startsWith('/music/playlist/');
  const isHistoryPage = location.pathname === '/history';

  const mainRef = useRef<HTMLElement>(null);
  // The watch page only fades: its player is a separate frame that follows the page's slot.
  usePageEnterMotion(mainRef, location.pathname, !isWatchPage);

  /*
    Set before paint: removing the outgoing page clamps the scroll and fires a
    scroll event, which must not overwrite the offset saved for that page.
  */
  const entryKeyRef = useRef(location.key);
  useLayoutEffect(() => {
    entryKeyRef.current = location.key;
  }, [location.key]);

  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const onScroll = () => rememberScroll(entryKeyRef.current, main.scrollTop);
    main.addEventListener('scroll', onScroll, { passive: true });
    return () => main.removeEventListener('scroll', onScroll);
  }, []);

  // Back, Forward and tab switches return to where the page was left; anything new starts at the top.
  const pagePath = location.pathname + location.search;
  const previousPagePathRef = useRef(pagePath);
  useEffect(() => {
    const main = mainRef.current;
    const samePage = previousPagePathRef.current === pagePath;
    previousPagePathRef.current = pagePath;
    if (!main) return;
    // A replace that only swaps state (a filter, a resolved id) is still the same page.
    if (navigationType === NavigationType.Replace && samePage) {
      rememberScroll(location.key, main.scrollTop);
      return;
    }
    return restoreScroll(main, navigationType === NavigationType.Pop ? recalledScroll(location.key) : 0);
  }, [location.key, navigationType, pagePath]);

  // Leaving by Back, search or the mini player must not leave the drawer open for the next visit.
  useEffect(() => {
    setWatchSidebarOpen(false);
  }, [location.pathname, setWatchSidebarOpen]);

  const drawerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isWatchSidebarOpen) return;
    drawerRef.current?.querySelector<HTMLElement>('a, button')?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.fullscreenElement) return;
      setWatchSidebarOpen(false);
      document.getElementById(SIDEBAR_MENU_BUTTON_ID)?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isWatchSidebarOpen, setWatchSidebarOpen]);

  return (
    <div className="flex h-full flex-col bg-background text-chrome-zinc-100 overflow-hidden font-sans">
      <Topbar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main
          ref={mainRef}
          className={
            isPlaylistDetailsPage
              || isMusicCollectionPage
              || isHistoryPage
              ? "flex min-h-0 flex-1 flex-col overflow-hidden"
              : "flex-1 overflow-y-auto"
          }
        >
          {/*
            Pages cannot find this element on their own — they render inside it,
            and their own root is an auto-height block whose overflow never
            engages. Anything needing the real scrollport reads it from here.
          */}
          <ScrollContainerContext.Provider value={mainRef}>
            <Outlet />
          </ScrollContainerContext.Provider>
        </main>
      </div>
      {(isWatchPage || isSettingsPage) && (
        <div
          data-open={isWatchSidebarOpen}
          inert={!isWatchSidebarOpen}
          className={`fixed inset-x-0 bottom-0 top-[calc(var(--app-titlebar-height)+3.5rem)] z-50 flex ${
            isWatchSidebarOpen ? '' : 'pointer-events-none'
          }`}
        >
          <button
            type="button"
            tabIndex={-1}
            aria-label={getString('sidebar_close')}
            className="sidebar-scrim absolute inset-0 bg-chrome-black/60"
            onClick={() => setWatchSidebarOpen(false)}
          />
          <div ref={drawerRef} className="sidebar-drawer relative h-full">
            <Sidebar mode="overlay" />
          </div>
        </div>
      )}
    </div>
  );
}
