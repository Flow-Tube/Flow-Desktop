import { useEffect, useMemo, useRef, useState } from "react";
import { ListVideo, Plus, X } from "lucide-react";
import { addVideosToPlaylistWithToast, createPlaylistWithVideos } from "../../lib/addVideosToPlaylist";
import { getString } from "../../lib/i18n/index";
import { loadStoredPlaylists, type StoredPlaylist } from "../../lib/playlistLibrary";
import { useUiStore } from "../../store/useUiStore";
import type { VideoSummary } from "../../types/video";
import { PlaylistChoiceCard } from "./PlaylistChoiceCard";
import { PlaylistFormDialog } from "./PlaylistFormDialog";

interface AddAllToPlaylistDialogProps {
  title?: string;
  /** The playlist these videos are in, which is no place to add them. */
  excludePlaylistId?: string;
  loadVideos: () => Promise<VideoSummary[]>;
  onClose: () => void;
}

/** Picks a playlist of your own, or makes one, to copy a set of videos onto. */
export function AddAllToPlaylistDialog({
  title,
  excludePlaylistId,
  loadVideos,
  onClose,
}: AddAllToPlaylistDialogProps) {
  const [playlists, setPlaylists] = useState<StoredPlaylist[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const adding = useRef(false);

  useEffect(() => {
    let current = true;
    void loadStoredPlaylists()
      .then((loaded) => {
        if (current) setPlaylists(loaded);
      })
      .catch((error) => {
        console.warn("Failed to load playlists", error);
        if (current) setPlaylists([]);
      });
    return () => {
      current = false;
    };
  }, []);

  const targets = useMemo(
    () => (playlists ?? []).filter((playlist) => playlist.source === "Owned" && playlist.id !== excludePlaylistId),
    [playlists, excludePlaylistId],
  );

  const addTo = async (add: (videos: VideoSummary[]) => Promise<boolean>) => {
    if (adding.current) return;
    adding.current = true;
    setBusy(true);
    try {
      if (await add(await loadVideos())) onClose();
    } catch (error) {
      console.error("Failed to read the playlist's videos", error);
      useUiStore.getState().showToast({ variant: "error", message: getString("merge_playlist_failed") });
    } finally {
      adding.current = false;
      setBusy(false);
    }
  };

  if (creating) {
    return (
      <PlaylistFormDialog
        title={getString("playlist_add_modal_create")}
        confirmLabel={getString("playlist_create")}
        onSubmit={(name, description) => addTo((videos) => createPlaylistWithVideos(name, description, videos))}
        onCancel={() => setCreating(false)}
      />
    );
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-chrome-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-chrome-neutral-800 bg-surface-container p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-lg font-bold text-chrome-neutral-100">{title ?? getString("playlist_add_all_title")}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={getString("cancel")}
            className="shrink-0 rounded-full p-1.5 text-chrome-neutral-400 transition-colors hover:bg-surface-container-high hover:text-chrome-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X size={18} />
          </button>
        </div>

        {busy ? (
          <p className="mt-4 text-sm text-chrome-neutral-400">{getString("playlist_add_all_loading")}</p>
        ) : (
          <>
            <div className="mt-4 max-h-72 space-y-1 overflow-y-auto hide-scrollbar">
              {targets.map((playlist) => (
                <PlaylistChoiceCard
                  key={playlist.id}
                  playlist={playlist}
                  onClick={() => void addTo((videos) => addVideosToPlaylistWithToast(playlist, videos))}
                />
              ))}
              {playlists !== null && targets.length === 0 && (
                <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-chrome-neutral-800 px-4 py-8 text-center">
                  <ListVideo className="h-6 w-6 text-chrome-neutral-600" />
                  <p className="text-sm text-chrome-neutral-500">{getString("merge_playlist_no_playlists")}</p>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="mt-3 flex w-full items-center gap-3 rounded-lg p-2 text-start text-sm font-medium text-[var(--color-primary)] transition-colors hover:bg-surface-container-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-surface-container-high">
                <Plus size={18} />
              </span>
              {getString("playlist_add_modal_create")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
