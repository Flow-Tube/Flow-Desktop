import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Download as DownloadIcon, Loader2, ListChecks, Trash2 } from "lucide-react";

import type { VideoSummary } from "../types/video";
import type { SongItem } from "../types/music";
import type { DownloadProgress } from "../lib/api/downloads";
import { getString } from "../lib/i18n/index";
import {
  downloadRecordToSong,
  downloadRecordToVideo,
  isActiveStatus,
  useDownloadsLibrary,
} from "../lib/useDownloads";
import {
  collectionProgress,
  useDownloadCollectionsLibrary,
} from "../lib/useCollectionDownloads";
import { useDownloadStore } from "../store/useDownloadStore";
import { useCollectionDownloadStore } from "../store/useCollectionDownloadStore";
import { useMusicPlayerStore } from "../store/useMusicPlayerStore";
import { Button } from "../components/ui/Button";
import { SearchInput } from "../components/ui/SearchInput";
import { CategoryChips } from "../components/layout/CategoryChips";
import { useDebounce } from "../lib/useDebounce";
import { DownloadVideoCard } from "../components/downloads/DownloadVideoCard";
import { DownloadCollectionCard } from "../components/downloads/DownloadCollectionCard";
import { MusicItemCard } from "../components/music/MusicItemCard";
import { useGridStyle } from "../lib/useGridColumns";

type DownloadsFilter = "all" | "videos" | "music" | "playlists" | "albums";

interface DownloadsProps {
  onPlay: (video: VideoSummary) => void;
}

interface VideoEntry {
  key: string;
  recordId?: number;
  video: VideoSummary;
  progress?: DownloadProgress;
}

interface MusicEntry {
  key: string;
  recordId?: number;
  song: SongItem;
}

function progressToVideo(progress: DownloadProgress): VideoSummary {
  return {
    id: progress.videoId ?? progress.id,
    title: progress.title,
    channelName: "",
    thumbnailUrl: progress.thumbnailUrl,
    durationSeconds: null,
  };
}

function progressToSong(progress: DownloadProgress): SongItem {
  return {
    id: progress.videoId ?? progress.id,
    title: progress.title,
    artists: [],
    album: null,
    duration: null,
    musicVideoType: null,
    thumbnail: progress.thumbnailUrl ?? "",
    explicit: false,
    videoId: progress.videoId,
    playlistId: null,
    params: null,
  };
}

function matchesQuery(query: string, title: string, author?: string | null): boolean {
  if (!query) return true;
  return `${title} ${author ?? ""}`.toLowerCase().includes(query);
}

function SelectableMusicRow({
  selecting,
  selected,
  onToggle,
  children,
}: {
  selecting: boolean;
  selected: boolean;
  onToggle?: () => void;
  children: React.ReactNode;
}) {
  if (!selecting || !onToggle) return <>{children}</>;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onToggle();
      }}
      className={`relative cursor-pointer rounded-lg ring-2 transition-colors ${
        selected ? "ring-[var(--color-primary)]" : "ring-transparent"
      }`}
    >
      <div className="pointer-events-none">{children}</div>
      <span
        className={`absolute right-3 top-1/2 z-10 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full border transition-colors ${
          selected
            ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-on-primary)]"
            : "border-chrome-neutral-600 bg-surface-container text-transparent"
        }`}
      >
        <Check size={14} />
      </span>
    </div>
  );
}

export const Downloads: React.FC<DownloadsProps> = ({ onPlay }) => {
  const navigate = useNavigate();
  const cardGridStyle = useGridStyle();
  const collectionGridStyle = useGridStyle({ density: "dense" });
  const { records, loading, remove, clear } = useDownloadsLibrary();
  const { records: collectionRecords, remove: removeCollections } = useDownloadCollectionsLibrary();
  const collectionRuns = useCollectionDownloadStore((state) => state.runs);
  const active = useDownloadStore((state) => state.active);
  const playQueue = useMusicPlayerStore((state) => state.playQueue);

  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<DownloadsFilter>("all");
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const filters = useMemo(
    () => [
      { key: "all" as const, label: getString("history_filter_all") },
      { key: "videos" as const, label: getString("history_filter_videos") },
      { key: "music" as const, label: getString("history_filter_music") },
      { key: "playlists" as const, label: getString("downloads_filter_playlists") },
      { key: "albums" as const, label: getString("downloads_filter_albums") },
    ],
    [],
  );
  const activeLabel = filters.find((entry) => entry.key === filter)?.label ?? filters[0]?.label ?? "";

  const query = useDebounce(searchQuery, 200).trim().toLowerCase();

  const inProgress = useMemo(
    () => Object.values(active).filter((item) => isActiveStatus(item.status)),
    [active],
  );

  const videoEntries = useMemo<VideoEntry[]>(() => {
    const fromActive = inProgress
      .filter((item) => item.mediaKind === "video")
      .map<VideoEntry>((item) => ({ key: `active-${item.id}`, video: progressToVideo(item), progress: item }));
    const fromRecords = records
      .filter((record) => record.mediaKind === "video" && record.collectionDbId == null)
      .map<VideoEntry>((record) => ({
        key: `record-${record.id}`,
        recordId: record.id,
        video: downloadRecordToVideo(record),
      }));
    return [...fromActive, ...fromRecords].filter((entry) =>
      matchesQuery(query, entry.video.title, entry.video.channelName),
    );
  }, [inProgress, records, query]);

  const musicEntries = useMemo<MusicEntry[]>(() => {
    const fromActive = inProgress
      .filter((item) => item.mediaKind !== "video")
      .map<MusicEntry>((item) => ({ key: `active-${item.id}`, song: progressToSong(item) }));
    const fromRecords = records
      .filter((record) => record.mediaKind !== "video" && record.collectionDbId == null)
      .map<MusicEntry>((record) => ({
        key: `record-${record.id}`,
        recordId: record.id,
        song: downloadRecordToSong(record),
      }));
    return [...fromActive, ...fromRecords].filter((entry) =>
      matchesQuery(query, entry.song.title, entry.song.artists.map((artist) => artist.name).join(" ")),
    );
  }, [inProgress, records, query]);

  const musicSongs = useMemo(() => musicEntries.map((entry) => entry.song), [musicEntries]);

  const runByCollection = useMemo(() => {
    const map = new Map<string, (typeof collectionRuns)[number]>();
    for (const run of Object.values(collectionRuns)) map.set(`${run.kind}:${run.collectionId}`, run);
    return map;
  }, [collectionRuns]);

  const collectionEntries = useMemo(
    () =>
      collectionRecords
        .filter((record) => matchesQuery(query, record.title, record.author))
        .map((record) => ({
          record,
          progress: collectionProgress(record, runByCollection.get(`${record.kind}:${record.collectionId}`)),
        })),
    [collectionRecords, runByCollection, query],
  );
  const playlistEntries = useMemo(
    () => collectionEntries.filter((entry) => entry.record.kind === "playlist"),
    [collectionEntries],
  );
  const albumEntries = useMemo(
    () => collectionEntries.filter((entry) => entry.record.kind === "album"),
    [collectionEntries],
  );

  const openCollection = (kind: "playlist" | "album", collectionId: string) => {
    navigate(kind === "album" ? `/music/album/${collectionId}` : `/playlist/${collectionId}`);
  };

  const standaloneRecordCount = useMemo(
    () => records.filter((record) => record.collectionDbId == null).length,
    [records],
  );

  const showVideos = (filter === "all" || filter === "videos") && videoEntries.length > 0;
  const showMusic = (filter === "all" || filter === "music") && musicEntries.length > 0;
  const showPlaylists = (filter === "all" || filter === "playlists") && playlistEntries.length > 0;
  const showAlbums = (filter === "all" || filter === "albums") && albumEntries.length > 0;
  const isEmpty = standaloneRecordCount === 0 && collectionRecords.length === 0;
  const hasResults =
    videoEntries.length > 0 ||
    musicEntries.length > 0 ||
    playlistEntries.length > 0 ||
    albumEntries.length > 0;

  const toggleSelected = (id: number) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const stopSelecting = () => {
    setSelecting(false);
    setSelectedIds(new Set());
  };

  const deleteSelected = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    await remove(ids);
    stopSelecting();
  };

  const handleClearAll = async () => {
    await clear();
    if (collectionRecords.length > 0) {
      await removeCollections(collectionRecords.map((record) => record.id));
    }
    setShowClearConfirm(false);
    stopSelecting();
  };

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto w-full pb-20">
        <header className="flex flex-col gap-5 border-b border-chrome-neutral-800 pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-3xl font-bold tracking-tight text-chrome-neutral-100 lg:text-4xl">
              {getString("downloads_page_title")}
            </h1>
            <p className="mt-2 text-sm text-chrome-neutral-400">{getString("downloads_subtitle")}</p>
          </div>

          <div className="flex w-full flex-col gap-3 sm:flex-row lg:w-auto lg:items-center">
            <SearchInput
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={getString("downloads_search_placeholder")}
              containerClassName="w-full sm:w-72"
              disabled={loading || isEmpty}
            />

            {selecting ? (
              <div className="flex shrink-0 gap-2">
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => void deleteSelected()}
                  disabled={selectedIds.size === 0}
                >
                  <Trash2 size={16} />
                  {getString("downloads_delete_selected", selectedIds.size)}
                </Button>
                <Button type="button" variant="ghost" onClick={stopSelecting}>
                  {getString("downloads_cancel_selection")}
                </Button>
              </div>
            ) : (
              <div className="flex shrink-0 gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setSelecting(true)}
                  disabled={loading || standaloneRecordCount === 0}
                >
                  <ListChecks size={16} />
                  {getString("downloads_select")}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => setShowClearConfirm(true)}
                  disabled={loading || isEmpty}
                >
                  <Trash2 size={16} />
                  {getString("clear_all")}
                </Button>
              </div>
            )}
          </div>
        </header>

        <CategoryChips
          categories={filters.map((entry) => entry.label)}
          activeCategory={activeLabel}
          onCategoryChange={(label) =>
            setFilter(filters.find((entry) => entry.label === label)?.key ?? "all")
          }
          sticky={false}
          className="mt-2"
        />

        {loading ? (
          <div className="flex flex-col items-center justify-center py-32">
            <Loader2 className="h-9 w-9 animate-spin text-[var(--color-primary)]" />
            <p className="mt-4 text-sm font-medium text-chrome-neutral-500">{getString("downloads_loading")}</p>
          </div>
        ) : isEmpty ? (
          <div className="mt-8 flex flex-col items-center justify-center rounded-2xl border border-dashed border-chrome-neutral-800 bg-surface-container-low p-10 text-center">
            <DownloadIcon className="mb-4 h-12 w-12 text-chrome-neutral-700" />
            <h3 className="font-bold text-chrome-neutral-300">{getString("downloads_empty_title")}</h3>
            <p className="mt-1 max-w-sm text-sm text-chrome-neutral-500">{getString("downloads_empty_body")}</p>
          </div>
        ) : !hasResults ? (
          <div className="mt-8 rounded-2xl border border-chrome-neutral-800 bg-surface-container-low p-8 text-center">
            <p className="text-sm font-medium text-chrome-neutral-300">{getString("downloads_no_results")}</p>
          </div>
        ) : (
          <div className="mt-8 flex flex-col gap-10">
            {showVideos ? (
              <section className="min-w-0">
                <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-chrome-neutral-500">
                  {getString("downloads_videos_section")}
                </h2>
                <div className="flow-grid gap-y-6" style={cardGridStyle}>
                  {videoEntries.map((entry) => {
                    const selectable = selecting && entry.recordId != null;
                    return (
                      <DownloadVideoCard
                        key={entry.key}
                        video={entry.video}
                        progress={entry.progress}
                        selectable={selectable}
                        selected={entry.recordId != null && selectedIds.has(entry.recordId)}
                        onToggleSelect={
                          entry.recordId != null ? () => toggleSelected(entry.recordId!) : undefined
                        }
                        onPlay={onPlay}
                        onDelete={
                          entry.recordId != null ? () => void remove([entry.recordId!]) : undefined
                        }
                      />
                    );
                  })}
                </div>
              </section>
            ) : null}

            {showMusic ? (
              <section className="min-w-0">
                <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-chrome-neutral-500">
                  {getString("downloads_music_section")}
                </h2>
                <div className="grid grid-cols-1 gap-x-4 gap-y-1 md:grid-cols-2 xl:grid-cols-3">
                  {musicEntries.map((entry, index) => (
                    <SelectableMusicRow
                      key={entry.key}
                      selecting={selecting && entry.recordId != null}
                      selected={entry.recordId != null && selectedIds.has(entry.recordId)}
                      onToggle={entry.recordId != null ? () => toggleSelected(entry.recordId!) : undefined}
                    >
                      <MusicItemCard
                        variant="track-list"
                        item={entry.song}
                        className="bg-surface-container-low pr-3"
                        onPlay={() => void playQueue(musicSongs, index)}
                      />
                    </SelectableMusicRow>
                  ))}
                </div>
              </section>
            ) : null}

            {showPlaylists ? (
              <section className="min-w-0">
                <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-chrome-neutral-500">
                  {getString("downloads_playlists_section")}
                </h2>
                <div className="flow-grid gap-y-6" style={cardGridStyle}>
                  {playlistEntries.map((entry) => (
                    <DownloadCollectionCard
                      key={`collection-${entry.record.id}`}
                      collection={entry.record}
                      progress={entry.progress}
                      onOpen={() => openCollection("playlist", entry.record.collectionId)}
                      onDelete={() => void removeCollections([entry.record.id])}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            {showAlbums ? (
              <section className="min-w-0">
                <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-chrome-neutral-500">
                  {getString("downloads_albums_section")}
                </h2>
                <div className="flow-grid gap-y-6" style={collectionGridStyle}>
                  {albumEntries.map((entry) => (
                    <DownloadCollectionCard
                      key={`collection-${entry.record.id}`}
                      collection={entry.record}
                      progress={entry.progress}
                      onOpen={() => openCollection("album", entry.record.collectionId)}
                      onDelete={() => void removeCollections([entry.record.id])}
                    />
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        )}
      </div>

      {showClearConfirm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-chrome-black/75 p-4">
          <div className="w-full max-w-sm space-y-4 rounded-2xl border border-chrome-neutral-800 bg-surface-container p-6">
            <h3 className="text-lg font-bold text-chrome-neutral-100">
              {getString("downloads_clear_confirm_title")}
            </h3>
            <p className="text-sm leading-relaxed text-chrome-neutral-400">
              {getString("downloads_clear_confirm_body")}
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowClearConfirm(false)}>
                {getString("cancel")}
              </Button>
              <Button type="button" variant="destructive" size="sm" onClick={() => void handleClearAll()}>
                {getString("clear")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default Downloads;
