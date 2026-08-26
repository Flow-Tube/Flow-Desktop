import { useCallback, useState, useEffect } from "react";
import { Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { usePlayerStore } from "./store/usePlayerStore";
import { useFeedActionsStore } from "./store/useFeedActionsStore";
import { useMusicActionsStore } from "./store/useMusicActionsStore";
import { useAppSettingsStore } from "./store/useAppSettingsStore";
import { useSettingsStore } from "./store/useSettingsStore";
import { useAlbumLibraryStore } from "./store/useAlbumLibraryStore";
import { useLikesStore } from "./store/useLikesStore";
import { useDownloadsLibraryStore } from "./store/useDownloadsLibraryStore";
import { useDownloadCollectionsLibraryStore } from "./store/useDownloadCollectionsLibraryStore";
import { useWatchLaterStore } from "./store/useWatchLaterStore";
import { getOnboardingStatus } from "./lib/api/recommendation";
import { useStartupHealth } from "./lib/useStartupHealth";
import { WATCH_LATER_PLAYLIST_ID } from "./lib/playlistLibrary";
import type { VideoSummary } from "./types/video";

import { PageWrapper } from "./components/layout/PageWrapper";
import { TitleBar } from "./components/layout/TitleBar";

import Home from "./pages/Home";
import MusicHome from "./pages/music/MusicHome";
import ArtistPage from "./pages/music/ArtistPage";
import ArtistItemsPage from "./pages/music/ArtistItemsPage";
import MusicCollectionPage from "./pages/music/MusicCollectionPage";
import Search from "./pages/Search";
import ExploreCategories from "./pages/ExploreCategories";
import Subscriptions from "./pages/Subscriptions";
import History from "./pages/History";
import Downloads from "./pages/Downloads";
import Likes from "./pages/Likes";
import LibraryPage from "./pages/LibraryPage";
import AlbumsLibrary from "./pages/AlbumsLibrary";
import SavedShorts from "./pages/SavedShorts";
import Playlists from "./pages/Playlists";
import PlaylistDetailsPage from "./pages/PlaylistDetailsPage";
import Settings from "./pages/Settings";
import Sync from "./pages/Sync";
import Donations from "./pages/Donations";
import ImportData from "./pages/ImportData";
import ExtensionsPage from "./pages/ExtensionsPage";
import Channel from "./pages/Channel";
import Diagnostics from "./pages/Diagnostics";
import { Watch } from "./pages/Watch";
import { ShortsFeed } from "./components/shorts/ShortsFeed";
import Onboarding from "./pages/Onboarding";
import FlowNeuroPersona from "./pages/FlowNeuroPersona";
import { LayoutGroup } from "framer-motion";
import { ToastHost } from "./components/ui/ToastHost";
import { GlobalMusicAudio } from "./components/music/GlobalMusicAudio";
import { GlobalMusicDock } from "./components/music/GlobalMusicDock";
import { MusicOverlay } from "./components/music/MusicOverlay";
import { GlobalVideoPlayer } from "./components/watch/GlobalVideoPlayer";
import { PipWindowController } from "./components/pip/PipWindowController";
import { AddToAlbumModal } from "./components/music/AddToAlbumModal";
import { AddTracksToAlbumModal } from "./components/music/AddTracksToAlbumModal";
import { AddToPlaylistModal } from "./components/playlist/AddToPlaylistModal";
import { DeepFlowController } from "./components/deep-flow/DeepFlowController";
import { DeepLinkController } from "./components/handoff/DeepLinkController";
import { DownloadDialog } from "./components/downloads/DownloadDialog";
import { DownloadActivity } from "./components/downloads/DownloadActivity";
import { DonationPromptHost } from "./components/donations/DonationPrompt";
import { UpdateManager } from "./components/updater/UpdateManager";
import { ThemeController } from "./lib/useTheme";

import "./App.css";

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

  // Clear the Linux startup-crash sentinel as soon as the app mounts
  useStartupHealth();

  const [loadingOnboarding, setLoadingOnboarding] = useState(true);

  useEffect(() => {
    void useFeedActionsStore.getState().load();
    void useMusicActionsStore.getState().load();
    void useAppSettingsStore.getState().loadSettings();
    void useSettingsStore.getState().loadSettings();
    void useAlbumLibraryStore.getState().load();
    void useLikesStore.getState().load();
    void useDownloadsLibraryStore.getState().load();
    void useDownloadCollectionsLibraryStore.getState().load();
    void useWatchLaterStore.getState().load();
  }, []);

  // Check onboarding state from sqlite db setting
  useEffect(() => {
    const checkOnboarding = async () => {
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

  if (loadingOnboarding) {
    return (
      <div className="relative flex h-screen flex-col overflow-hidden bg-background text-chrome-zinc-100 font-sans">
        <TitleBar />
        <div className="flex flex-1 items-center justify-center">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-background text-chrome-zinc-100 font-sans">
      <ThemeController />
      <TitleBar />
      <div className="relative min-h-0 flex-1">
      <Routes>
        <Route path="/onboarding" element={<Onboarding />} />
        
        <Route path="/" element={<PageWrapper />}>
          <Route index element={
            <Home onPlay={handlePlayVideo} onAddToQueue={handleAddToQueue} />
          } />
          <Route path="feed" element={
            <FlowNeuroPersona />
          } />
          <Route path="music" element={
            <MusicHome />
          } />
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
          <Route path="albums" element={
            <AlbumsLibrary />
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
      <GlobalMusicAudio />
      <LayoutGroup>
        <GlobalMusicDock />
        <MusicOverlay />
      </LayoutGroup>
      <AddToAlbumModal />
      <AddTracksToAlbumModal />
      <AddToPlaylistModal />
      <DeepFlowController />
      <DeepLinkController />
      <LayoutGroup id="downloads">
        <DownloadDialog />
        <DownloadActivity />
      </LayoutGroup>
      <DonationPromptHost enabled={location.pathname !== "/onboarding"} />
      <UpdateManager enabled={location.pathname !== "/onboarding"} />
      <ToastHost />
    </div>
  );
}

export default App;
