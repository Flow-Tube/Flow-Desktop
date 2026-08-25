import React, { useEffect, useMemo, useState } from "react";
import { ListVideo, Plus, X } from "lucide-react";
import { getString } from "../../lib/i18n/index";
import { Button } from "../ui/Button";
import {
  addVideoToStoredPlaylist,
  createStoredPlaylist,
  loadStoredPlaylists,
  PLAYLIST_LIBRARY_UPDATED_EVENT,
  storedPlaylistToCardSummary,
  WATCH_LATER_PLAYLIST_ID,
  type StoredPlaylist,
} from "../../lib/playlistLibrary";
import { useProxiedImageUrl } from "../../lib/useProxiedImageUrl";
import { usePlaylistModalStore } from "../../store/usePlaylistModalStore";
import { useUiStore } from "../../store/useUiStore";

function PlaylistChoiceCard({
  fallbackThumbnailUrl,
  playlist,
  onClick,
}: {
  fallbackThumbnailUrl?: string | null;
  playlist: StoredPlaylist;
  onClick: () => void;
}) {
  const summary = storedPlaylistToCardSummary(playlist);
  const thumbnailUrl = summary.thumbnailUrl
    ?? (playlist.id === WATCH_LATER_PLAYLIST_ID ? fallbackThumbnailUrl : null)
    ?? null;
  const imageSrc = useProxiedImageUrl(thumbnailUrl);

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-surface-container-high"
    >
      <span className="relative aspect-video w-20 shrink-0 overflow-hidden rounded-md bg-surface-container-high ring-1 ring-chrome-neutral-800/50">
        {imageSrc ? (
          <img
            src={imageSrc}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="grid h-full w-full place-items-center text-chrome-neutral-500">
            <ListVideo size={20} />
          </span>
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="line-clamp-1 text-sm font-medium text-chrome-neutral-100">
          {summary.title}
        </span>
        <span className="line-clamp-1 text-xs text-chrome-neutral-500">
          {summary.videoCountText}
        </span>
      </span>
    </button>
  );
}

export function AddToPlaylistModal() {
  const addTarget = usePlaylistModalStore((s) => s.addTarget);
  const closeAddToPlaylist = usePlaylistModalStore((s) => s.closeAddToPlaylist);
  const showToast = useUiStore((s) => s.showToast);

  const [playlists, setPlaylists] = useState<StoredPlaylist[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const selectablePlaylists = useMemo(
    () => playlists.filter((playlist) => playlist.source === "Owned"),
    [playlists],
  );

  const load = async () => {
    try {
      setPlaylists(await loadStoredPlaylists());
    } catch (error) {
      console.warn("Failed to load playlists for add modal", error);
      setPlaylists([]);
    }
  };

  useEffect(() => {
    if (!addTarget) return;
    void load();

    window.addEventListener(PLAYLIST_LIBRARY_UPDATED_EVENT, load);
    return () => window.removeEventListener(PLAYLIST_LIBRARY_UPDATED_EVENT, load);
  }, [addTarget]);

  if (!addTarget) return null;

  const close = () => {
    setCreating(false);
    setNewName("");
    closeAddToPlaylist();
  };

  const handleAdd = async (playlistId: string) => {
    try {
      const updated = await addVideoToStoredPlaylist(playlistId, addTarget);
      if (!updated) throw new Error("Playlist not found");

      showToast({
        variant: "success",
        message: getString("video_added_to_playlist"),
      });
      close();
    } catch (error) {
      console.error("Failed to add video to playlist", error);
      showToast({
        variant: "error",
        message: getString("video_add_to_playlist_failed"),
      });
    }
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!newName.trim()) return;

    try {
      const playlist = await createStoredPlaylist(newName);
      await addVideoToStoredPlaylist(playlist.id, addTarget);
      showToast({
        variant: "success",
        message: getString("video_added_to_playlist"),
      });
      close();
    } catch (error) {
      console.error("Failed to create playlist", error);
      showToast({
        variant: "error",
        message: getString("video_add_to_playlist_failed"),
      });
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-chrome-black/70 p-4"
      onClick={close}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-chrome-neutral-800 bg-surface-container p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-chrome-neutral-100">
              {getString("playlist_add_modal_title")}
            </h3>
            <p className="mt-0.5 line-clamp-1 text-sm text-chrome-neutral-400">{addTarget.title}</p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label={getString("cancel")}
            className="shrink-0 rounded-full p-1.5 text-chrome-neutral-400 transition-colors hover:bg-surface-container-high hover:text-chrome-neutral-100"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-4 max-h-72 space-y-1 overflow-y-auto hide-scrollbar">
          {selectablePlaylists.map((playlist) => (
            <PlaylistChoiceCard
              key={playlist.id}
              fallbackThumbnailUrl={addTarget.thumbnailUrl}
              playlist={playlist}
              onClick={() => void handleAdd(playlist.id)}
            />
          ))}

          {selectablePlaylists.length === 0 && !creating && (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-chrome-neutral-800 px-4 py-8 text-center">
              <ListVideo className="h-6 w-6 text-chrome-neutral-600" />
              <p className="text-sm text-chrome-neutral-500">{getString("playlist_add_modal_empty")}</p>
            </div>
          )}
        </div>

        {creating ? (
          <form onSubmit={handleCreate} className="mt-3 flex flex-col gap-2">
            <input
              type="text"
              autoFocus
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder={getString("playlist_name_placeholder")}
              className="w-full rounded-lg border border-chrome-neutral-800 bg-surface-container-low px-3 py-2 text-sm text-chrome-neutral-100 outline-none transition-colors placeholder:text-chrome-neutral-500 focus:border-chrome-neutral-700"
            />
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                onClick={() => setCreating(false)}
                variant="ghost"
                size="sm"
                className="text-sm text-chrome-neutral-300"
              >
                {getString("cancel")}
              </Button>
              <Button
                type="submit"
                disabled={!newName.trim()}
                size="sm"
                className="px-4 text-sm"
              >
                {getString("playlist_create")}
              </Button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="mt-3 flex w-full items-center gap-3 rounded-lg p-2 text-left text-sm font-medium text-[var(--color-primary)] transition-colors hover:bg-surface-container-high"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-surface-container-high">
              <Plus size={18} />
            </span>
            {getString("playlist_add_modal_create")}
          </button>
        )}
      </div>
    </div>
  );
}

export default AddToPlaylistModal;
