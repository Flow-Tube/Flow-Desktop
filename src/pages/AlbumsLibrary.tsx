import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Disc3, Plus } from "lucide-react";
import { getString } from "../lib/i18n/index";
import { Button } from "../components/ui/Button";
import { Select } from "../components/ui/Select";
import { SearchInput } from "../components/ui/SearchInput";
import { CategoryChips } from "../components/layout/CategoryChips";
import { MusicItemCard } from "../components/music/MusicItemCard";
import { useGridStyle } from "../lib/useGridColumns";
import {
  albumDetailPath,
  storedAlbumToItem,
  useAlbumLibraryStore,
  type StoredAlbum,
} from "../store/useAlbumLibraryStore";

type AlbumFilter = "All" | "Owned" | "Saved";
type AlbumSort = "Recently Added" | "Oldest" | "A-Z";

const FILTERS: AlbumFilter[] = ["All", "Owned", "Saved"];
const SORTS: AlbumSort[] = ["Recently Added", "Oldest", "A-Z"];

const albumTimestamp = (album: StoredAlbum): number => {
  if (album.createdAt) {
    const ts = Date.parse(album.createdAt);
    if (!Number.isNaN(ts)) return ts;
  }
  const idTs = album.id.match(/\d+$/)?.[0];
  return idTs ? Number(idTs) : 0;
};

export const AlbumsLibrary: React.FC = () => {
  const gridStyle = useGridStyle({ density: "dense", gapRem: 1.5 });
  const navigate = useNavigate();
  const albums = useAlbumLibraryStore((s) => s.albums);
  const loaded = useAlbumLibraryStore((s) => s.loaded);
  const load = useAlbumLibraryStore((s) => s.load);
  const createAlbum = useAlbumLibraryStore((s) => s.createAlbum);

  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<AlbumFilter>("All");
  const [sort, setSort] = useState<AlbumSort>("Recently Added");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const visibleAlbums = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return albums
      .filter((album) => {
        const matchesFilter = filter === "All" || album.source === filter;
        const matchesSearch =
          !query ||
          [album.title, ...(album.artists?.map((artist) => artist.name) ?? [])].some(
            (value) => value?.toLowerCase().includes(query),
          );
        return matchesFilter && matchesSearch;
      })
      .sort((a, b) => {
        if (sort === "A-Z") return a.title.localeCompare(b.title);
        const at = albumTimestamp(a);
        const bt = albumTimestamp(b);
        return sort === "Oldest" ? at - bt : bt - at;
      });
  }, [albums, filter, searchQuery, sort]);

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!newName.trim()) return;
    const album = await createAlbum(newName, newDesc);
    setNewName("");
    setNewDesc("");
    setShowCreateModal(false);
    navigate(albumDetailPath(album));
  };

  return (
    <div className="flex-1 overflow-y-auto px-8 py-6">
      <div className="space-y-6 pb-20">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-chrome-neutral-100">
              {getString("albums_title")}
            </h1>
            <p className="mt-1 text-sm text-chrome-neutral-400">
              {getString("albums_library_subtitle")}
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <SearchInput
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={getString("albums_library_search")}
              containerClassName="w-full sm:w-72"
            />
            <Button onClick={() => setShowCreateModal(true)} className="shrink-0">
              <Plus size={16} />
              {getString("albums_create")}
            </Button>
          </div>
        </div>

        <div className="mt-6 mb-6 flex flex-col gap-4 md:flex-row md:items-center">
          <Select
            value={sort}
            onChange={(value) => setSort(value as AlbumSort)}
            options={SORTS.map((s) => ({ value: s, label: s }))}
            className="w-full md:w-52"
          />

          <CategoryChips
            categories={FILTERS}
            activeCategory={filter}
            onCategoryChange={(category) => {
              if (FILTERS.includes(category as AlbumFilter)) {
                setFilter(category as AlbumFilter);
              }
            }}
            sticky={false}
            className="py-0"
          />
        </div>

        {albums.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-chrome-neutral-800 bg-surface-container-low p-8 py-24 text-center">
            <Disc3 className="mb-4 text-chrome-neutral-600" size={48} />
            <h3 className="font-medium text-chrome-neutral-200">
              {getString("albums_library_empty_title")}
            </h3>
            <p className="mt-1 max-w-sm text-sm text-chrome-neutral-500">
              {getString("albums_library_empty_body")}
            </p>
          </div>
        ) : visibleAlbums.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-chrome-neutral-800 bg-surface-container-low p-8 py-20 text-center">
            <Disc3 className="mb-4 text-chrome-neutral-600" size={44} />
            <h3 className="font-medium text-chrome-neutral-200">
              {getString("albums_no_match_title")}
            </h3>
            <p className="mt-1 max-w-sm text-sm text-chrome-neutral-500">
              {getString("albums_no_match_body")}
            </p>
          </div>
        ) : (
          <div className="flow-grid gap-y-6" style={gridStyle}>
            {visibleAlbums.map((album) => (
              <MusicItemCard
                key={album.id}
                variant="album"
                item={storedAlbumToItem(album)}
                fill
                onOpen={() => navigate(albumDetailPath(album))}
                onPlay={() => navigate(albumDetailPath(album))}
              />
            ))}
          </div>
        )}
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-chrome-neutral-950/80 p-4">
          <form
            onSubmit={handleCreate}
            className="w-full max-w-sm space-y-4 rounded-2xl border border-chrome-neutral-800 bg-surface-container p-6"
          >
            <h3 className="text-lg font-medium text-chrome-neutral-100">
              {getString("albums_create_title")}
            </h3>

            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-widest text-chrome-neutral-500">
                {getString("albums_name_label")}
              </label>
              <input
                type="text"
                required
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder={getString("albums_name_placeholder")}
                className="w-full rounded-lg border border-chrome-neutral-800 bg-surface-container-low px-4 py-2.5 text-sm font-medium text-chrome-neutral-100 outline-none transition-colors placeholder:text-chrome-neutral-500 focus:border-chrome-neutral-700"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-widest text-chrome-neutral-500">
                {getString("albums_desc_label")}
              </label>
              <textarea
                value={newDesc}
                onChange={(event) => setNewDesc(event.target.value)}
                placeholder={getString("albums_desc_placeholder")}
                rows={3}
                className="w-full resize-none rounded-lg border border-chrome-neutral-800 bg-surface-container-low px-4 py-2.5 text-sm font-medium text-chrome-neutral-100 outline-none transition-colors placeholder:text-chrome-neutral-500 focus:border-chrome-neutral-700"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => setShowCreateModal(false)}>
                {getString("cancel")}
              </Button>
              <Button type="submit">{getString("albums_create")}</Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default AlbumsLibrary;
