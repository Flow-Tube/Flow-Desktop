import React, { useState } from "react";
import { Disc3, Music2, Plus, X } from "lucide-react";
import { getString } from "../../lib/i18n/index";
import { Button } from "../ui/Button";
import { upgradeMusicImageUrl } from "../../lib/thumbnails";
import { useProxiedImageUrl } from "../../lib/useProxiedImageUrl";
import { useAlbumLibraryStore, type StoredAlbum } from "../../store/useAlbumLibraryStore";
import { useUiStore } from "../../store/useUiStore";

function AlbumRowArt({ album }: { album: StoredAlbum }) {
  const src = album.thumbnail ?? album.tracks?.find((track) => track.thumbnail)?.thumbnail ?? null;
  const imageSrc = useProxiedImageUrl(upgradeMusicImageUrl(src));
  if (!imageSrc) {
    return (
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-surface-container-high text-chrome-neutral-500">
        <Disc3 size={18} />
      </span>
    );
  }
  return (
    <img
      src={imageSrc}
      alt=""
      loading="lazy"
      className="h-11 w-11 shrink-0 rounded-md object-cover ring-1 ring-chrome-neutral-800/50"
    />
  );
}

export function AddToAlbumModal() {
  const addTarget = useAlbumLibraryStore((s) => s.addTarget);
  const albums = useAlbumLibraryStore((s) => s.albums);
  const addTrack = useAlbumLibraryStore((s) => s.addTrack);
  const createAlbum = useAlbumLibraryStore((s) => s.createAlbum);
  const closeAddToAlbum = useAlbumLibraryStore((s) => s.closeAddToAlbum);
  const showToast = useUiStore((s) => s.showToast);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  if (!addTarget) return null;

  const ownedAlbums = albums.filter((album) => album.source === "Owned");

  const close = () => {
    setCreating(false);
    setNewName("");
    closeAddToAlbum();
  };

  const handleAdd = async (albumId: string) => {
    await addTrack(albumId, addTarget);
    showToast({ variant: "success", message: getString("album_added_toast") });
    close();
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!newName.trim()) return;
    const album = await createAlbum(newName);
    await addTrack(album.id, addTarget);
    showToast({ variant: "success", message: getString("album_added_toast") });
    close();
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
              {getString("album_add_modal_title")}
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
          {ownedAlbums.map((album) => (
            <button
              key={album.id}
              type="button"
              onClick={() => void handleAdd(album.id)}
              className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-surface-container-high"
            >
              <AlbumRowArt album={album} />
              <span className="min-w-0 flex-1">
                <span className="line-clamp-1 text-sm font-medium text-chrome-neutral-100">{album.title}</span>
                <span className="line-clamp-1 text-xs text-chrome-neutral-500">
                  {(album.tracks?.length ?? 0)} {(album.tracks?.length ?? 0) === 1 ? "song" : "songs"}
                </span>
              </span>
            </button>
          ))}

          {ownedAlbums.length === 0 && !creating && (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-chrome-neutral-800 px-4 py-8 text-center">
              <Music2 className="h-6 w-6 text-chrome-neutral-600" />
              <p className="text-sm text-chrome-neutral-500">{getString("albums_library_empty_title")}</p>
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
              placeholder={getString("albums_name_placeholder")}
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
                {getString("albums_create")}
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
            {getString("album_add_modal_create")}
          </button>
        )}
      </div>
    </div>
  );
}

export default AddToAlbumModal;
