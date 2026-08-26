import { useEffect, useRef } from 'react';
import { Topbar } from './Topbar';
import { Sidebar } from './Sidebar';
import { Outlet, useLocation } from 'react-router-dom';
import { useUiStore } from '../../store/useUiStore';

export function PageWrapper() {
  const location = useLocation();
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
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0, left: 0 });
  }, [location.pathname, location.search]);

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
          <Outlet />
        </main>
      </div>
      {(isWatchPage || isSettingsPage) && isWatchSidebarOpen && (
        <div className="fixed inset-x-0 bottom-0 top-22 z-50 flex">
          <button
            type="button"
            aria-label="Close sidebar"
            className="absolute inset-0 bg-chrome-black/60"
            onClick={() => setWatchSidebarOpen(false)}
          />
          <div className="relative h-full animate-sidebar-slide-in">
            <Sidebar mode="overlay" />
          </div>
        </div>
      )}
    </div>
  );
}
