import { lazy, Suspense, useCallback, useMemo, useState, useEffect } from "react";
import { registerAutoBackup } from "./lib/api/backup";
import { getString } from "./lib/i18n/index";
import { Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { usePlayerStore } from "./store/usePlayerStore";
import { useFeedActionsStore } from "./store/useFeedActionsStore";
import { useMusicActionsStore } from "./store/useMusicActionsStore";
import { useAppSettingsStore } from "./store/useAppSettingsStore";
import { useSettingsStore } from "./store/useSettingsStore";
import { useAlbumLibraryStore } from "./store/useAlbumLibraryStore";
import { useLikesStore } from "./store/useLikesStore";
import { useNotesStore } from "./store/useNotesStore";
import { useDownloadsLibraryStore } from "./store/useDownloadsLibraryStore";
import { useDownloadCollectionsLibraryStore } from "./store/useDownloadCollectionsLibraryStore";
import { useWatchLaterStore } from "./store/useWatchLaterStore";
import { startAiList } from "./store/useAiListStore";
import { startWatchProgress } from "./store/useWatchProgressStore";
import { useSubscriptionStore } from "./store/useSubscriptionStore";
import { useNotificationStore } from "./store/useNotificationStore";
import { getOnboardingStatus } from "./lib/api/recommendation";
import { catchUpOnce } from "./lib/linked/catchUp";
import { useStartupHealth } from "./lib/useStartupHealth";
import { useSlowGraphicsNotice } from "./lib/graphicsTrial";
import { GraphicsTrialPrompt } from "./components/common/GraphicsTrialPrompt";
import { useStartupSubscriptionRefresh } from "./lib/useStartupSubscriptionRefresh";
import { useImageProxyBootstrap } from "./lib/useImageProxy";
import { WATCH_LATER_PLAYLIST_ID } from "./lib/playlistLibrary";
import type { VideoSummary } from "./types/video";
import { useProfileSwitchListener } from "./lib/profiles/useProfileSwitchListener";
import { markSwitching } from "./store/useProfilesStore";
import { ProfileSwitchOverlay } from "./components/profiles/ProfileSwitchOverlay";
import { ProfileSwitchPanel } from "./components/profiles/ProfileSwitchPanel";
import { WhosWatchingOverlay } from "./components/profiles/WhosWatchingOverlay";
import { takeSwitchingTo } from "./lib/profiles/switchProfile";

import { PageWrapper } from "./components/layout/PageWrapper";
import { TitleBar } from "./components/layout/TitleBar";

import Home from "./pages/Home";
import MusicHome from "./pages/music/MusicHome";
import MusicBrowsePage from "./pages/music/MusicBrowsePage";
import MusicMoodsPage from "./pages/music/MusicMoodsPage";
import MusicMixPage from "./pages/music/MusicMixPage";
import ArtistPage from "./pages/music/ArtistPage";
import ArtistItemsPage from "./pages/music/ArtistItemsPage";
import MusicCollectionPage from "./pages/music/MusicCollectionPage";
import Search from "./pages/Search";
import ExploreCategories from "./pages/ExploreCategories";
import Subscriptions from "./pages/Subscriptions";
import History from "./pages/History";
import Downloads from "./pages/Downloads";
import LocalMedia from "./pages/LocalMedia";
import Likes from "./pages/Likes";
import LibraryPage from "./pages/LibraryPage";
import AlbumsLibrary from "./pages/AlbumsLibrary";
import SavedShorts from "./pages/SavedShorts";
import Notes from "./pages/Notes";
import Playlists from "./pages/Playlists";
import PlaylistDetailsPage from "./pages/PlaylistDetailsPage";
import Channel from "./pages/Channel";
import DiscoverChannels from "./pages/DiscoverChannels";
import { Watch } from "./pages/Watch";
import { ShortsFeed } from "./components/shorts/ShortsFeed";
import { LayoutGroup } from "framer-motion";
import { ToastHost } from "./components/layout/ToastHost";
import { GlobalMusicAudio } from "./components/music/GlobalMusicAudio";
import { MusicPlayerSheet } from "./components/music/sheet/MusicPlayerSheet";
import { PlayingElsewhereBar } from "./components/playon/PlayingElsewhereBar";
import { RemoteDock } from "./components/playon/RemoteDock";
import { ConsentDialog } from "./components/playon/ConsentDialog";
import { MusicOnly } from "./components/music/MusicOnly";
import { EqualizerDialog } from "./components/music/eq/EqualizerDialog";
import { ContinueWatchingMini } from "./components/player/ContinueWatchingMini";
import { GlobalVideoPlayer } from "./components/watch/GlobalVideoPlayer";
import { PipWindowController } from "./components/pip/PipWindowController";
import { AddToAlbumModal } from "./components/music/AddToAlbumModal";
import { SongDetailsDialog } from "./components/music/SongDetailsDialog";
import { AddTracksToAlbumModal } from "./components/music/AddTracksToAlbumModal";
import { AddToPlaylistModal } from "./components/playlist/AddToPlaylistModal";
import { DeepFlowController } from "./components/deep-flow/DeepFlowController";
import { DeepLinkController } from "./components/handoff/DeepLinkController";
import { DiscordPresenceController } from "./components/discord/DiscordPresenceController";
import { MusicTrayController } from "./components/tray/MusicTrayController";
import { ShellPagesController } from "./components/tray/ShellPagesController";
import { GlobalMediaKeysController } from "./components/shortcuts/GlobalMediaKeysController";
import { KeyboardHelpHost } from "./components/shortcuts/KeyboardHelpHost";
import { SequenceHint } from "./components/shortcuts/SequenceHint";
import { SwipeNavigationHost } from "./components/gestures/SwipeNavigationHost";
import { PinchGridHost } from "./components/gestures/PinchGridHost";
import { useAppShortcuts } from "./lib/shortcuts/useAppShortcuts";
import { useCardArrowKeys } from "./lib/useCardArrowKeys";
import { useInterfaceZoom } from "./lib/interfaceZoom";
import { CrashReportHost } from "./components/diagnostics/CrashReportHost";
import { ScrobbleController } from "./components/scrobbling/ScrobbleController";
import { HistorySettleController } from "./components/sync/HistorySettleController";
import { WellbeingController } from "./components/settings/WellbeingController";
import { DownloadDialog } from "./components/downloads/DownloadDialog";
import { DownloadActivity } from "./components/downloads/DownloadActivity";
import { DonationPromptHost } from "./components/donations/DonationPrompt";
import { UpdateManager } from "./components/updater/UpdateManager";
import { ConfirmHost } from "./components/common/ConfirmHost";
import { NoteEditorHost } from "./components/note/NoteEditorHost";
import { ThemeController } from "./lib/useTheme";
import { useTabHistoryMouseButtons } from "./lib/tabs/useTabHistoryMouseButtons";
import { installTabPlaybackSync } from "./lib/tabs/tabPlayback";
import { useTabShortcuts } from "./lib/tabs/useTabShortcuts";
import { useActiveTabTitle } from "./lib/tabs/useActiveTabTitle";
import { useTabSession } from "./lib/tabs/useTabSession";
import { useSingleTabWhenOff } from "./lib/tabs/useSingleTabWhenOff";
import { useMediaCommands } from "./lib/useMediaCommands";
import { useCrossWindowSync } from "./lib/useCrossWindowSync";
import { useLinkedSyncEvents } from "./lib/useLinkedSyncEvents";
import { useLiveNow } from "./lib/live/useLiveNow";
import { usePlayOnEvents } from "./lib/live/usePlayOnEvents";
import { IS_MAIN_WINDOW } from "./lib/appWindow";
import { SelectionMenu } from "./components/common/SelectionMenu";

import { APP_TITLEBAR_HEIGHT, IS_LINUX_RUNTIME } from "./lib/platform";
import { showsTitleBar, titleBarHeight, useWindowButtonsPlace } from "./lib/windowButtons";
import { useMusicPlayerStore } from "./store/useMusicPlayerStore";
import type { CSSProperties } from "react";
import "./App.css";

// Pages most sessions never open load when they are first visited. They bring the charts, the
// QR scanner and the QR renderer with them, which the first script no longer has to parse.
const RecapPage = lazy(() => import("./pages/RecapPage"));
const Settings = lazy(() => import("./pages/Settings"));
const Sync = lazy(() => import("./pages/Sync"));
const Donations = lazy(() => import("./pages/Donations"));
const ImportData = lazy(() => import("./pages/ImportData"));
const ExtensionsPage = lazy(() => import("./pages/ExtensionsPage"));
const Diagnostics = lazy(() => import("./pages/Diagnostics"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const FlowNeuroPersona = lazy(() => import("./pages/FlowNeuroPersona"));

if (typeof document !== "undefined") {
  document.documentElement.style.setProperty("--app-titlebar-height", `${APP_TITLEBAR_HEIGHT}px`);
}

/**
 * Whether the title bar shows on this screen, with its height published where the layers that
 * sit below it read it: the layout div and `<html>` (the music sheet reads the latter, #693).
 */
function useTitleBar(screenHasTopBar: boolean) {
  const shown = showsTitleBar(useWindowButtonsPlace(), screenHasTopBar);
  const height = titleBarHeight(shown);
  useEffect(() => {
    document.documentElement.style.setProperty("--app-titlebar-height", `${height}px`);
  }, [height]);
  const style = useMemo(() => ({ "--app-titlebar-height": `${height}px` }) as CSSProperties, [height]);
  return { shown, style };
}

function App() {
  /*
    Selected one action at a time, never destructured off a bare `usePlayerStore()`:
    a selectorless subscription re-renders this component — and with it every route,
    feed and card below it — on every `currentTime` write, which the player emits
    about four times a second for the whole of playback.
  */
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const setQueue = usePlayerStore((s) => s.setQueue);
  const navigate = useNavigate();
  const location = useLocation();
  const musicPlayerOpen = useMusicPlayerStore((s) => s.currentTrack !== null && s.viewState !== "dock");

  // Clear the Linux startup-crash sentinel as soon as the app mounts
  useStartupHealth();
  useSlowGraphicsNotice(IS_MAIN_WINDOW && IS_LINUX_RUNTIME && location.pathname !== "/onboarding");
  useStartupSubscriptionRefresh();
  useImageProxyBootstrap();
  useTabHistoryMouseButtons();
  useAppShortcuts();
  useCardArrowKeys();
  useInterfaceZoom();
  useEffect(installTabPlaybackSync, []);
  useTabShortcuts();
  useActiveTabTitle();
  const tabsRestored = useTabSession();
  useSingleTabWhenOff();
  useCrossWindowSync();
  useMediaCommands();
  useLinkedSyncEvents();
  useLiveNow();
  usePlayOnEvents();
  useProfileSwitchListener(markSwitching);

  // Onboarding belongs to the main window; an extra window only exists once it is done.
  const [loadingOnboarding, setLoadingOnboarding] = useState(IS_MAIN_WINDOW);
  // A switch restarts the app; keep its "Switching to …" up until this profile is ready.
  const [arrivedFrom] = useState(() => (IS_MAIN_WINDOW ? takeSwitchingTo() : null));

  useEffect(() => {
    void useFeedActionsStore.getState().load();
    void useMusicActionsStore.getState().load();
    void useAppSettingsStore.getState().loadSettings();
    void useSettingsStore.getState().loadSettings();
    void useAlbumLibraryStore.getState().load();
    void useLikesStore.getState().load();
    void useNotesStore.getState().load();
    void useDownloadsLibraryStore.getState().load();
    void useDownloadCollectionsLibraryStore.getState().load();
    void useWatchLaterStore.getState().load();
    // Every subscribe button reads these, so they load once here rather than once per button.
    void useSubscriptionStore.getState().loadSubscriptions();
    void useNotificationStore.getState().loadChannelPreferences();
    startAiList();
    if (IS_MAIN_WINDOW) void registerAutoBackup(getString("settings_backup_failed_notice")).catch(() => {});
  }, []);

  useEffect(() => startWatchProgress(), []);

  // Check onboarding state from sqlite db setting
  useEffect(() => {
    if (!IS_MAIN_WINDOW) return;
    const checkOnboarding = async () => {
      // A profile added from another device has its onboarding state in what that device sent.
      await catchUpOnce();
      try {
        const completed = await getOnboardingStatus();
        if (!completed && location.pathname !== "/onboarding") {
          navigate("/onboarding");
        }
      } catch (e) {
        console.warn("Failed to read onboarding telemetry status", e);
      } finally {
        setLoadingOnboarding(false);
      }
    };
    checkOnboarding();
  }, [navigate, location.pathname]);

  /*
    Stable identities matter here beyond the usual hygiene: these are handed down
    to every page and end up as the `onPlay`/`onAddToQueue` prop of every card, so
    a fresh closure per render defeats `React.memo(VideoCard)` for the whole feed.
  */
  const handlePlayVideo = useCallback((video: VideoSummary) => {
    setQueue([video], 0);
    navigate(`/watch/${video.id}`);
  }, [setQueue, navigate]);

  const handleAddToQueue = useCallback((video: VideoSummary) => {
    addToQueue(video);
  }, [addToQueue]);

  const titleBar = useTitleBar(
    !loadingOnboarding && tabsRestored && location.pathname !== "/onboarding" && !musicPlayerOpen,
  );

  if (loadingOnboarding || !tabsRestored) {
    return (
      <div style={titleBar.style} className="relative flex h-screen flex-col overflow-hidden bg-background text-chrome-zinc-100 font-sans">
        <ThemeController />
        <TitleBar shown={titleBar.shown} />
        <div className="flex flex-1 items-center justify-center">
          {arrivedFrom ? (
            <ProfileSwitchPanel profile={arrivedFrom} />
          ) : (
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={titleBar.style} className="relative flex h-screen flex-col overflow-hidden bg-background text-chrome-zinc-100 font-sans">
      <ThemeController />
      <SelectionMenu />
      <TitleBar shown={titleBar.shown} />
      <div data-app-content className="relative min-h-0 flex-1">
      <Routes>
        <Route path="/onboarding" element={<Suspense fallback={null}><Onboarding /></Suspense>} />
        
        <Route path="/" element={<PageWrapper />}>
          <Route index element={
            <Home onPlay={handlePlayVideo} onAddToQueue={handleAddToQueue} />
          } />
          <Route path="feed" element={
            <FlowNeuroPersona />
          } />
          <Route element={<MusicOnly />}>
            <Route path="music" element={
              <MusicHome />
            } />
            <Route path="music/moods" element={<MusicMoodsPage />} />
            <Route path="music/browse" element={<MusicBrowsePage />} />
            <Route path="music/mix/:id" element={<MusicMixPage />} />
            <Route path="music/artist/:artistId" element={
              <ArtistPage />
            } />
            <Route path="music/artist/:artistId/items" element={
              <ArtistItemsPage />
            } />
            <Route path="music/album/:id" element={
              <MusicCollectionPage kind="album" />
            } />
            <Route path="music/playlist/:id" element={
              <MusicCollectionPage kind="playlist" />
            } />
            <Route path="albums" element={<AlbumsLibrary />} />
          </Route>
          <Route path="search" element={
            <Search onPlay={handlePlayVideo} onAddToQueue={handleAddToQueue} />
          } />
          <Route path="explore" element={
            <ExploreCategories onPlay={handlePlayVideo} onAddToQueue={handleAddToQueue} />
          } />
          <Route path="shorts" element={
            <ShortsFeed />
          } />
          <Route path="shorts/:videoId" element={
            <ShortsFeed />
          } />
          <Route path="subscriptions" element={
            <Subscriptions onPlay={handlePlayVideo} onAddToQueue={handleAddToQueue} />
          } />
          <Route path="channel/:channelId" element={
            <Channel onPlay={handlePlayVideo} onAddToQueue={handleAddToQueue} />
          } />
          <Route path="playlists" element={
            <Playlists onPlay={handlePlayVideo} />
          } />
          <Route path="playlist/:playlistId" element={
            <PlaylistDetailsPage
              onAddToQueue={handleAddToQueue}
            />
          } />
          <Route path="watch-later" element={
            <PlaylistDetailsPage
              playlistIdOverride={WATCH_LATER_PLAYLIST_ID}
              onAddToQueue={handleAddToQueue}
            />
          } />
          <Route path="library" element={
            <LibraryPage onPlay={handlePlayVideo} onAddToQueue={handleAddToQueue} />
          } />
          <Route path="notes" element={
            <Notes onPlay={handlePlayVideo} />
          } />
          <Route path="recap" element={
            <RecapPage onPlay={handlePlayVideo} />
          } />
          <Route path="saved-shorts" element={
            <SavedShorts />
          } />
          <Route path="history" element={
            <History onPlay={handlePlayVideo} />
          } />
          <Route path="downloads" element={
            <Downloads onPlay={handlePlayVideo} />
          } />
          <Route path="local-media" element={
            <LocalMedia />
          } />
          <Route path="liked" element={
            <Likes onPlay={handlePlayVideo} />
          } />
          <Route path="settings" element={
            <Settings />
          } />
          <Route path="sync" element={
            <Sync />
          } />
          <Route path="support" element={
            <Donations />
          } />
          <Route path="settings/import" element={
            <ImportData />
          } />
          <Route path="settings/discover-channels" element={
            <DiscoverChannels />
          } />
          <Route path="settings/diagnostics" element={
            <Diagnostics />
          } />
          <Route path="sponsorblock" element={
            <ExtensionsPage />
          } />
          <Route path="watch/:videoId" element={
            <Watch />
          } />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      </div>
      <GlobalVideoPlayer />
      <PipWindowController />
      <MusicTrayController />
      {/* Music, deep links, the updater and other once-per-app jobs run in the main window only. */}
      {IS_MAIN_WINDOW && (
        <>
          <GlobalMusicAudio />
          <ContinueWatchingMini />
          <LayoutGroup>
            <MusicPlayerSheet />
            <RemoteDock />
            <PlayingElsewhereBar />
            <ConsentDialog />
          </LayoutGroup>
          <DeepFlowController />
          <DeepLinkController />
          <GlobalMediaKeysController />
          <ShellPagesController />
          <ScrobbleController />
          <HistorySettleController />
          <WellbeingController />
        </>
      )}
      <EqualizerDialog />
      <AddToAlbumModal />
      <SongDetailsDialog />
      <AddTracksToAlbumModal />
      <AddToPlaylistModal />
      <DiscordPresenceController />
      <LayoutGroup id="downloads">
        <DownloadDialog />
        <DownloadActivity />
      </LayoutGroup>
      <DonationPromptHost enabled={IS_MAIN_WINDOW && location.pathname !== "/onboarding"} />
      <UpdateManager enabled={IS_MAIN_WINDOW && location.pathname !== "/onboarding"} />
      {IS_MAIN_WINDOW && <WhosWatchingOverlay />}
      {IS_MAIN_WINDOW && location.pathname !== "/onboarding" && <CrashReportHost />}
      {IS_MAIN_WINDOW && IS_LINUX_RUNTIME && <GraphicsTrialPrompt />}
      <ProfileSwitchOverlay />
      <NoteEditorHost />
      <KeyboardHelpHost />
      <SequenceHint />
      <SwipeNavigationHost />
      <PinchGridHost />
      <ConfirmHost />
      <ToastHost />
    </div>
  );
}

export default App;
