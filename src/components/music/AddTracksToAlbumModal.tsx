import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Music2, Plus, Search, X } from "lucide-react";
import { getString } from "../../lib/i18n/index";
import { artistsText } from "../../lib/musicFormat";
import { upgradeMusicImageUrl } from "../../lib/thumbnails";
import { useProxiedImageUrl } from "../../lib/useProxiedImageUrl";
import { useDebounce } from "../../lib/useDebounce";
import { searchMusicTyped } from "../../lib/api/music";
import { albumDetailPath, useAlbumLibraryStore } from "../../store/useAlbumLibraryStore";
import { showSaveToast } from "../../lib/saveToast";
import { songToastItem } from "../../lib/songLikeToast";
import { useUiStore } from "../../store/useUiStore";
import type { SongItem, YTItem } from "../../types/music";

const songVideoId = (song: SongItem): string => song.videoId ?? song.id;

function ResultRow({
  song,
  added,
  onAdd,
}: {
  song: SongItem;
  added: boolean;
  onAdd: () => void;
}) {
  const imageSrc = useProxiedImageUrl(upgradeMusicImageUrl(song.thumbnail, 120));
  const subtitle = artistsText(song.artists);

  return (
    <div className="flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-surface-container-high">
      {imageSrc ? (
        <img
          src={imageSrc}
          alt=""
          loading="lazy"
          className="h-11 w-11 shrink-0 rounded-md object-cover ring-1 ring-chrome-neutral-800/50"
        />
      ) : (
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-surface-container-high text-chrome-neutral-500">
          <Music2 size={18} />
        </span>
      )}

      <div className="min-w-0 flex-1">
        <p className="line-clamp-1 text-sm font-medium text-chrome-neutral-100">{song.title}</p>
        {subtitle && <p className="line-clamp-1 text-xs text-chrome-neutral-500">{subtitle}</p>}
      </div>

      {added ? (
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-surface-container-high px-3 py-1.5 text-xs font-medium text-[var(--color-primary)]">
          <Check size={14} />
          {getString("album_track_added_badge")}
        </span>
      ) : (
        <button
          type="button"
          onClick={onAdd}
          aria-label={getString("album_add_tracks")}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-container-high text-chrome-neutral-200 transition-colors hover:bg-surface-container-highest hover:text-[var(--color-primary)]"
        >
          <Plus size={18} />
        </button>
      )}
    </div>
  );
}

export function AddTracksToAlbumModal() {
  const albumId = useAlbumLibraryStore((s) => s.searchAlbumId);
  const album = useAlbumLibraryStore((s) =>
    s.searchAlbumId ? s.albums.find((a) => a.id === s.searchAlbumId) : undefined,
  );
  const addTrack = useAlbumLibraryStore((s) => s.addTrack);
  const removeTrack = useAlbumLibraryStore((s) => s.removeTrack);
  const close = useAlbumLibraryStore((s) => s.closeTrackSearch);
  const showToast = useUiStore((s) => s.showToast);

  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, 350);
  const [results, setResults] = useState<SongItem[]>([]);
  const [loading, setLoading] = useState(false);
  const reqRef = useRef(0);

  useEffect(() => {
    if (!albumId) {
      setQuery("");
      setResults([]);
      setLoading(false);
    }
  }, [albumId]);

  useEffect(() => {
    if (!albumId) return;
    const q = debouncedQuery.trim();
    if (!q) {
      setResults([]);
      setLoading(false);
      return;
    }
    const req = ++reqRef.current;
    setLoading(true);
    searchMusicTyped(q, "songs")
      .then((res) => {
        if (reqRef.current !== req) return;
        const songs = res.sections
          .flatMap((section) => section.items)
          .filter((item): item is Extract<YTItem, { type: "song" }> => item.type === "song");
        setResults(songs);
      })
      .catch((error) => {
        if (reqRef.current !== req) return;
        console.warn("Track search failed", error);
        setResults([]);
      })
      .finally(() => {
        if (reqRef.current === req) setLoading(false);
      });
  }, [debouncedQuery, albumId]);

  if (!albumId) return null;

  const existingIds = new Set((album?.tracks ?? []).map(songVideoId));

  const handleAdd = async (song: SongItem) => {
    await addTrack(albumId, song);
    if (!album) {
      showToast({ variant: "success", message: getString("album_added_toast") });
      return;
    }
    showSaveToast({
      destination: { kind: "album", path: albumDetailPath(album), name: album.title },
      item: songToastItem(song),
      undo: () => removeTrack(albumId, songVideoId(song)),
    });
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-chrome-black/70 p-4"
      onClick={close}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl border border-chrome-neutral-800 bg-surface-container p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-chrome-neutral-100">{getString("album_add_tracks")}</h3>
            {album ? (
              <p className="mt-0.5 line-clamp-1 text-sm text-chrome-neutral-400">{album.title}</p>
            ) : null}
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

        <div className="mt-4 flex items-center gap-2 rounded-lg border border-chrome-neutral-800 bg-surface-container-low px-3 py-2 focus-within:border-chrome-neutral-700">
          <Search size={18} className="shrink-0 text-chrome-neutral-500" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={getString("album_search_placeholder")}
            className="min-w-0 flex-1 bg-transparent text-sm text-chrome-neutral-100 outline-none placeholder:text-chrome-neutral-500"
          />
          {loading ? <Loader2 size={16} className="shrink-0 animate-spin text-chrome-neutral-500" /> : null}
        </div>

        <div className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto hide-scrollbar">
          {results.length > 0 ? (
            results.map((song, index) => (
              <ResultRow
                key={`${songVideoId(song)}-${index}`}
                song={song}
                added={existingIds.has(songVideoId(song))}
                onAdd={() => void handleAdd(song)}
              />
            ))
          ) : (
            <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
              <Search className="h-6 w-6 text-chrome-neutral-600" />
              <p className="text-sm text-chrome-neutral-500">
                {debouncedQuery.trim() && !loading
                  ? getString("album_search_empty")
                  : getString("album_search_hint")}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default AddTracksToAlbumModal;
