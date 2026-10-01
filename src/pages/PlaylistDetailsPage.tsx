import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { PlaylistAmbientHeader } from "../components/playlist/PlaylistAmbientHeader";
import { PlaylistSortableList } from "../components/playlist/PlaylistSortableList";
import {
  availablePlaylistSortOrders,
  loadPlaylistSortOrder,
  resolvePlaylistSortOrder,
  savePlaylistSortOrder,
  sortPlaylistVideos,
  type PlaylistSortOrder,
} from "../lib/playlistSort";
import {
  isProtectedPlaylistId,
  removePlaylistFromLibrary,
  savePlaylistToLibrary,
  updateStoredPlaylistTracks,
} from "../lib/playlistLibrary";
import { usePlaylistDetails } from "../lib/usePlaylistDetails";
import { usePublishTitle } from "../lib/usePublishTitle";
import { useCollectionDownloadState } from "../lib/useCollectionDownloads";
import { usePlayerStore } from "../store/usePlayerStore";
import { useCollectionDownloadStore } from "../store/useCollectionDownloadStore";
import { useUiStore } from "../store/useUiStore";
import type { PlaylistSummary, VideoSummary } from "../types/video";

interface PlaylistDetailsPageProps {
  playlistIdOverride?: string;
  onAddToQueue?: (video: VideoSummary) => void;
}

export function PlaylistDetailsPage({
  playlistIdOverride,
  onAddToQueue,
}: PlaylistDetailsPageProps) {
  const params = useParams<{ playlistId: string }>();
  const playlistId = playlistIdOverride ?? params.playlistId;
  const navigate = useNavigate();
  const setQueue = usePlayerStore((state) => state.setQueue);
  const addToQueue = usePlayerStore((state) => state.addToQueue);
  const showToast = useUiStore((state) => state.showToast);

  const {
    loading,
    error,
    storedPlaylist,
    meta,
    videos,
  } = usePlaylistDetails(playlistId);
  usePublishTitle(meta?.title);

  const [storedSortOrder, setStoredSortOrder] = useState<string | null>(() =>
    playlistId ? loadPlaylistSortOrder(playlistId) : null,
  );
  const [manualVideos, setManualVideos] = useState<VideoSummary[]>([]);
  const [savedInLibrary, setSavedInLibrary] = useState(false);

  useEffect(() => {
    setManualVideos(videos);
  }, [videos]);

  useEffect(() => {
    setStoredSortOrder(playlistId ? loadPlaylistSortOrder(playlistId) : null);
  }, [playlistId]);

  useEffect(() => {
    setSavedInLibrary(Boolean(storedPlaylist));
  }, [storedPlaylist]);

  const handleSortChange = (next: PlaylistSortOrder) => {
    setStoredSortOrder(next);
    if (playlistId) savePlaylistSortOrder(playlistId, next);
  };

  const isProtected =
    Boolean(storedPlaylist?.isProtected) ||
    (playlistId ? isProtectedPlaylistId(playlistId) : false);
  const isOwned = storedPlaylist?.source === "Owned" && !isProtected;
  const isLocalPlaylist = savedInLibrary || isProtected;
  const sortOrder = resolvePlaylistSortOrder(storedSortOrder, isLocalPlaylist);

  const displayVideos = useMemo(
    () => sortPlaylistVideos(manualVideos, sortOrder, isProtected),
    [manualVideos, sortOrder, isProtected],
  );

  const leadVideo = manualVideos[0];
  const heroThumbnailUrl = leadVideo?.thumbnailUrl ?? meta?.thumbnailUrl ?? null;

  const startPlaylistDownload = useCollectionDownloadStore((state) => state.startPlaylist);
  const downloadState = useCollectionDownloadState(meta?.id, "playlist");

  const handleDownloadPlaylist = () => {
    if (!meta || videos.length === 0) return;
    void startPlaylistDownload(
      {
        collectionId: meta.id,
        title: meta.title,
        author: meta.channelName || undefined,
        thumbnailUrl: heroThumbnailUrl ?? meta.thumbnailUrl ?? undefined,
      },
      videos,
    );
  };

  const handleReorder = async (nextVideos: VideoSummary[]) => {
    setManualVideos(nextVideos);
    if (storedPlaylist) {
      await updateStoredPlaylistTracks(storedPlaylist.id, nextVideos);
    }
  };

  const handleAddAllToQueue = () => {
    if (displayVideos.length === 0) return;
    let added = 0;
    for (const video of displayVideos) {
      if (addToQueue(video) === "added") added += 1;
    }
    showToast({
      variant: added > 0 ? "success" : "info",
      message:
        added > 0
          ? `Added ${added} ${added === 1 ? "video" : "videos"} to queue`
          : "Already in your queue",
    });
  };

  const handleCopyLink = async () => {
    if (!meta) return;
    try {
      await navigator.clipboard.writeText(
        `https://www.youtube.com/playlist?list=${meta.id}`,
      );
      showToast({ variant: "success", message: "Playlist link copied" });
    } catch (copyError) {
      console.error("Failed to copy playlist link", copyError);
      showToast({ variant: "error", message: "Could not copy link" });
    }
  };

  const handleSaveToLibrary = async () => {
    if (!meta) return;
    const summary: PlaylistSummary = {
      type: "playlist",
      id: meta.id,
      title: meta.title,
      thumbnailUrl: heroThumbnailUrl ?? meta.thumbnailUrl ?? null,
      videoCountText: meta.videoCountText,
    };
    try {
      const playlists = await savePlaylistToLibrary(summary);
      const saved = playlists.find((playlist) => playlist.id === meta.id);
      if (saved) setManualVideos(saved.tracks);
      setSavedInLibrary(true);
      showToast({
        variant: "success",
        message: `Saved "${meta.title}" to library`,
      });
    } catch (saveError) {
      console.error("Failed to save playlist to library", saveError);
      showToast({ variant: "error", message: "Could not save playlist" });
    }
  };

  const handleRemoveFromLibrary = async () => {
    if (!meta || isProtected) return;
    const confirmMessage = isOwned
      ? `Delete "${meta.title}"? This can't be undone.`
      : `Remove "${meta.title}" from your library?`;
    if (!window.confirm(confirmMessage)) return;

    try {
      await removePlaylistFromLibrary(meta.id);
      setSavedInLibrary(false);
      showToast({
        variant: "success",
        message: isOwned
          ? `Deleted "${meta.title}"`
          : `Removed "${meta.title}" from library`,
      });
      navigate("/playlists");
    } catch (removeError) {
      console.error("Failed to remove playlist from library", removeError);
      showToast({ variant: "error", message: "Could not update library" });
    }
  };

  const playQueue = (shuffle: boolean) => {
    if (displayVideos.length === 0) return;
    const queue = shuffle
      ? [...displayVideos].sort(() => Math.random() - 0.5)
      : displayVideos;
    const first = queue[0];
    if (!first) return;
    setQueue(queue, 0);
    navigate(`/watch/${first.id}`);
  };

  const playFromPlaylist = (video: VideoSummary) => {
    const startIndex = displayVideos.findIndex((item) => item.id === video.id);
    const safeIndex = startIndex >= 0 ? startIndex : 0;
    setQueue(displayVideos, safeIndex);
    navigate(`/watch/${video.id}`);
  };

  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <Loader2 className="animate-spin text-[var(--color-primary)]" size={36} />
        <p className="text-sm font-medium text-chrome-neutral-500">Loading playlist...</p>
      </div>
    );
  }

  if (error || !meta) {
    return (
      <div className="mx-auto flex h-full max-w-3xl flex-col items-center justify-center px-6 text-center">
        <p className="text-sm text-chrome-neutral-400">{error ?? "Playlist not found."}</p>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="mt-4 text-sm font-medium text-[var(--color-primary)] transition-colors hover:opacity-90"
        >
          Go back
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mx-auto grid h-full min-h-0 w-full max-w-[1600px] grid-cols-1 gap-8 p-6 lg:grid-cols-[360px_1fr]">
          <PlaylistAmbientHeader
            meta={meta}
            heroVideoId={leadVideo?.id}
            heroThumbnailUrl={heroThumbnailUrl}
          canPlay={displayVideos.length > 0}
          onPlayAll={() => playQueue(false)}
          onShuffle={() => playQueue(true)}
          onDownload={handleDownloadPlaylist}
          downloadActive={downloadState.active}
          downloadComplete={downloadState.isComplete}
          onAddToQueue={handleAddAllToQueue}
          onCopyLink={handleCopyLink}
          onSaveToLibrary={handleSaveToLibrary}
          onRemoveFromLibrary={handleRemoveFromLibrary}
          isSaved={savedInLibrary}
          isProtected={isProtected}
          isOwned={isOwned}
        />

        <PlaylistSortableList
          videos={manualVideos}
          displayVideos={displayVideos}
          sortOrder={sortOrder}
          sortOptions={availablePlaylistSortOrders(isLocalPlaylist)}
          onSortChange={handleSortChange}
          onReorder={handleReorder}
          onPlay={playFromPlaylist}
          onAddToQueue={onAddToQueue}
        />
      </div>
    </div>
  );
}

export default PlaylistDetailsPage;
