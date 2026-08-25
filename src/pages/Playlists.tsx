import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ListVideo, Loader2, Plus } from "lucide-react";
import type { PlaylistSummary, VideoSummary } from "../types/video";
import { Button } from "../components/ui/Button";
import { SearchInput } from "../components/ui/SearchInput";
import { CategoryChips } from "../components/layout/CategoryChips";
import { PlaylistCard } from "../components/video/PlaylistCard";
import { Select } from "../components/ui/Select";
import { useGridStyle } from "../lib/useGridColumns";
import {
  getPlaylistTimestamp,
  loadStoredPlaylists,
  persistStoredPlaylists,
  removePlaylistFromLibrary,
  savePlaylistToLibrary,
  storedPlaylistToCardSummary,
  type StoredPlaylist,
} from "../lib/playlistLibrary";

interface PlaylistsProps {
  onPlay: (track: VideoSummary) => void;
}

type PlaylistFilter = "All" | "Owned" | "Saved";
type PlaylistSort = "Recently Added" | "Oldest" | "A-Z";
type LocalPlaylist = StoredPlaylist;

const FILTERS: PlaylistFilter[] = ["All", "Owned", "Saved"];
const SORTS: PlaylistSort[] = ["Recently Added", "Oldest", "A-Z"];

export const Playlists: React.FC<PlaylistsProps> = ({ onPlay: _onPlay }) => {
  const gridStyle = useGridStyle({ gapRem: 1.5 });
  const navigate = useNavigate();
  const [playlists, setPlaylists] = useState<LocalPlaylist[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [newPlaylistDesc, setNewPlaylistDesc] = useState("");
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<PlaylistFilter>("All");
  const [sort, setSort] = useState<PlaylistSort>("Recently Added");
  
  const visiblePlaylists = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return playlists
      .filter((playlist) => {
        const source = playlist.source ?? "Owned";
        const matchesFilter = filter === "All" || source === filter;
        const matchesSearch = !query || [
          playlist.name,
          playlist.description ?? "",
          ...playlist.tracks.map((track) => track.title),
        ].some((value) => value.toLowerCase().includes(query));

        return matchesFilter && matchesSearch;
      })
      .sort((a, b) => {
        if (sort === "A-Z") {
          return a.name.localeCompare(b.name);
        }

        const aTimestamp = getPlaylistTimestamp(a);
        const bTimestamp = getPlaylistTimestamp(b);
        return sort === "Oldest" ? aTimestamp - bTimestamp : bTimestamp - aTimestamp;
      });
  }, [filter, playlists, searchQuery, sort]);

  const loadPlaylists = async () => {
    setLoading(true);
    try {
      const storedPlaylists = await loadStoredPlaylists();
      if (storedPlaylists.length > 0) {
        setPlaylists(storedPlaylists);
      } else {
        const defaults: LocalPlaylist[] = [
          {
            id: "liked-songs",
            name: "Liked Songs",
            description: "Your favorite tracks, automatically gathered",
            createdAt: new Date().toISOString(),
            source: "Owned",
            tracks: [
              {
                id: "dQw4w9WgXcQ",
                title: "Mock Favorite Track 1",
                channelName: "Mock Artist",
                thumbnailUrl: "https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?q=80&w=150",
                durationSeconds: 210,
                publishedText: "1 year ago",
                viewCountText: "Song",
              }
            ],
          },
        ];
        await persistStoredPlaylists(defaults);
        setPlaylists(defaults);
      }
    } catch (e) {
      console.error("Failed to load playlists", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPlaylists();
  }, []);

  const handleCreatePlaylist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlaylistName.trim()) return;

    const newPlaylist: LocalPlaylist = {
      id: `playlist-${Date.now()}`,
      name: newPlaylistName,
      description: newPlaylistDesc,
      tracks: [],
      createdAt: new Date().toISOString(),
      source: "Owned",
    };

    const updated = [...playlists, newPlaylist];
    setPlaylists(updated);
    await persistStoredPlaylists(updated);

    setNewPlaylistName("");
    setNewPlaylistDesc("");
    setShowCreateModal(false);
  };

  const handlePlaylistClick = (playlist: PlaylistSummary) => {
    navigate(`/playlist/${playlist.id}`);
  };

  const handleSaveToLibrary = async (playlist: PlaylistSummary) => {
    const updated = await savePlaylistToLibrary(playlist);
    setPlaylists(updated);
    return true;
  };

  const handleRemoveFromLibrary = async (playlist: PlaylistSummary) => {
    if (!confirm("Remove this playlist from your library?")) return false;

    const updated = await removePlaylistFromLibrary(playlist.id);
    setPlaylists(updated);
    return true;
  };

  return (
    <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="space-y-6 pb-20">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-chrome-neutral-100">Playlists</h1>
              <p className="mt-1 text-sm text-chrome-neutral-400">
                Manage owned and saved media collections from one dashboard.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <SearchInput
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search playlists"
                containerClassName="w-full sm:w-72"
              />
              <Button onClick={() => setShowCreateModal(true)} className="shrink-0">
                <Plus size={16} />
                Create Playlist
              </Button>
            </div>
          </div>

          <div className="mt-6 mb-6 flex flex-col gap-4 md:flex-row md:items-center">
            <Select
              value={sort}
              onChange={(value) => setSort(value as PlaylistSort)}
              options={SORTS.map((s) => ({ value: s, label: s }))}
              className="w-full md:w-52"
            />

            <CategoryChips
              categories={FILTERS}
              activeCategory={filter}
              onCategoryChange={(category) => {
                if (FILTERS.includes(category as PlaylistFilter)) {
                  setFilter(category as PlaylistFilter);
                }
              }}
              sticky={false}
              className="py-0"
            />
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center space-y-4 py-32">
              <Loader2 className="animate-spin text-[var(--color-primary)]" size={36} />
              <p className="text-sm font-medium text-chrome-neutral-500">Assembling library index...</p>
            </div>
          ) : playlists.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-chrome-neutral-800 bg-surface-container-low p-8 py-24 text-center">
              <ListVideo className="mb-4 text-chrome-neutral-600" size={48} />
              <h3 className="font-medium text-chrome-neutral-200">No playlists yet</h3>
              <p className="mt-1 max-w-sm text-sm text-chrome-neutral-500">
                Create a playlist to start building a media collection.
              </p>
            </div>
          ) : visiblePlaylists.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-chrome-neutral-800 bg-surface-container-low p-8 py-20 text-center">
              <ListVideo className="mb-4 text-chrome-neutral-600" size={44} />
              <h3 className="font-medium text-chrome-neutral-200">No matching playlists</h3>
              <p className="mt-1 max-w-sm text-sm text-chrome-neutral-500">
                Try a different search, filter, or sort option.
              </p>
            </div>
          ) : (
            <div className="flow-grid gap-y-6" style={gridStyle}>
              {visiblePlaylists.map((playlist) => (
                <PlaylistCard
                  key={playlist.id}
                  playlist={storedPlaylistToCardSummary(playlist)}
                  isInLibrary={playlists.some((localPlaylist) => localPlaylist.id === playlist.id)}
                  onClick={handlePlaylistClick}
                  onSaveToLibrary={handleSaveToLibrary}
                  onRemoveFromLibrary={handleRemoveFromLibrary}
                />
              ))}
            </div>
          )}
        </div>

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-chrome-neutral-950/80 p-4">
          <form onSubmit={handleCreatePlaylist} className="w-full max-w-sm space-y-4 rounded-2xl border border-chrome-neutral-800 bg-surface-container p-6">
            <h3 className="text-lg font-medium text-chrome-neutral-100">Create new playlist</h3>
            
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-widest text-chrome-neutral-500">Playlist name</label>
              <input
                type="text"
                required
                value={newPlaylistName}
                onChange={(e) => setNewPlaylistName(e.target.value)}
                placeholder="e.g. My Lofi Beats"
                className="w-full rounded-lg border border-chrome-neutral-800 bg-surface-container-low px-4 py-2.5 text-sm font-medium text-chrome-neutral-100 outline-none transition-colors placeholder:text-chrome-neutral-500 focus:border-chrome-neutral-700"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-widest text-chrome-neutral-500">Description (optional)</label>
              <textarea
                value={newPlaylistDesc}
                onChange={(e) => setNewPlaylistDesc(e.target.value)}
                placeholder="Short outline..."
                rows={3}
                className="w-full resize-none rounded-lg border border-chrome-neutral-800 bg-surface-container-low px-4 py-2.5 text-sm font-medium text-chrome-neutral-100 outline-none transition-colors placeholder:text-chrome-neutral-500 focus:border-chrome-neutral-700"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowCreateModal(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
              >
                Create
              </Button>
            </div>
          </form>
        </div>
      )}

    </div>
  );
};

export default Playlists;
